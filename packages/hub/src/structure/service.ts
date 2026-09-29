import type { PaperStructure, ReferenceEnrichment, ReferenceEntry, StructureItem, CitationMarker } from '@fractal/shared';
import type { SqlitePaperStore } from '../store/sqlite';
import { PdfJsStructureDetector, STRUCTURE_VERSION, type StructureDetector } from './detector';
import { fetchArxivSource, matchLatex, type SourceFragment } from './source';
import { enrichReference } from './enrichment';

type Row = Record<string, unknown>;

export class StructureService {
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    readonly store: SqlitePaperStore,
    private readonly detector: StructureDetector = new PdfJsStructureDetector(),
    private readonly fetcher: typeof fetch = fetch,
  ) {
    store.db.prepare('UPDATE structure_state SET status=? WHERE status=?').run('pending', 'running');
    store.onBlocksSaved = (key) => this.schedule(key, true);
  }

  read(key: string): PaperStructure {
    const row = this.store.db.prepare('SELECT version,status FROM structure_state WHERE paper_key=?').get(key) as Row | undefined;
    if (!row || row.version !== STRUCTURE_VERSION) return { version: STRUCTURE_VERSION, status: 'pending', items: [], references: [], markers: [] };
    const read = <T>(table: string): T[] => (this.store.db.prepare(`SELECT data FROM ${table} WHERE paper_key=? ORDER BY rowid`).all(key) as Row[]).map((entry) => JSON.parse(String(entry.data)) as T);
    return { version: STRUCTURE_VERSION, status: row.status as PaperStructure['status'], items: read<StructureItem>('structure_items'), references: read<ReferenceEntry>('structure_references'), markers: read<CitationMarker>('structure_markers') };
  }

  schedule(key: string, force = false): void {
    if (this.running.has(key)) return;
    if (!force && this.read(key).status === 'ready') return;
    if (!this.store.getPdf(key)) return;
    this.store.db.prepare('INSERT INTO structure_state VALUES(?,?,?) ON CONFLICT(paper_key) DO UPDATE SET version=excluded.version,status=excluded.status').run(key, STRUCTURE_VERSION, 'running');
    const job = new Promise<void>((resolve) => setImmediate(resolve))
      .then(async () => {
        const bytes = this.store.getPdf(key);
        const paper = this.store.getPaper(key);
        if (!bytes || !paper) return;
        const result = await this.detector.detect(bytes, key, this.store.listBlocks(key));
        if (paper.arxivId) {
          const sourceKey = `${paper.arxivId}${paper.version ? `v${paper.version}` : ''}`;
          const cached = this.store.db.prepare('SELECT data FROM arxiv_source_cache WHERE source_key=?').get(sourceKey) as Row | undefined;
          let fragments: SourceFragment[];
          if (cached) {
            fragments = JSON.parse(String(cached.data)) as SourceFragment[];
          } else {
            fragments = await fetchArxivSource(sourceKey, this.fetcher);
            this.store.db.prepare('INSERT OR REPLACE INTO arxiv_source_cache VALUES(?,?,datetime(\'now\'))').run(sourceKey, JSON.stringify(fragments));
          }
          result.items = matchLatex(result.items, fragments);
        }
        if (!this.store.getPaper(key)) return;
        this.write(key, result);
      })
      .catch(() => {
        if (this.store.getPaper(key)) this.store.db.prepare('UPDATE structure_state SET status=? WHERE paper_key=?').run('failed', key);
      })
      .finally(() => this.running.delete(key));
    this.running.set(key, job);
  }

  private write(key: string, result: PaperStructure): void {
    this.store.db.exec('SAVEPOINT structure');
    try {
      for (const table of ['structure_items', 'structure_references', 'structure_markers']) this.store.db.prepare(`DELETE FROM ${table} WHERE paper_key=?`).run(key);
      const insert = (table: string, id: string, data: unknown) => this.store.db.prepare(`INSERT INTO ${table} VALUES(?,?,?)`).run(key, id, JSON.stringify(data));
      for (const item of result.items) insert('structure_items', item.id, item);
      for (const reference of result.references) insert('structure_references', reference.n, reference);
      for (const marker of result.markers) insert('structure_markers', marker.id, marker);
      this.store.db.prepare('UPDATE structure_state SET status=? WHERE paper_key=?').run('ready', key);
      this.store.db.exec('RELEASE structure');
    } catch (error) {
      this.store.db.exec('ROLLBACK TO structure');
      this.store.db.exec('RELEASE structure');
      throw error;
    }
  }

  async enrichment(reference: ReferenceEntry): Promise<ReferenceEnrichment | null> {
    const cacheKey = reference.doi?.toLowerCase() ?? reference.arxivId?.toLowerCase() ?? reference.title?.toLowerCase() ?? reference.raw.toLowerCase();
    const cached = this.store.db.prepare('SELECT data FROM reference_enrichment WHERE cache_key=?').get(cacheKey) as Row | undefined;
    if (cached) return JSON.parse(String(cached.data)) as ReferenceEnrichment | null;
    const data = await enrichReference(reference, this.fetcher);
    this.store.db.prepare('INSERT OR REPLACE INTO reference_enrichment VALUES(?,?,datetime(\'now\'))').run(cacheKey, JSON.stringify(data));
    return data;
  }
}
