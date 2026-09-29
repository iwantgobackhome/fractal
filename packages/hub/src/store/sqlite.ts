import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Annotation, Block, Highlight, Job, LibraryPatch, LibraryRecord, Paper, RestartTranslationRequest, Translation } from '@fractal/shared';
import { annotationSchema, libraryPatchSchema } from '@fractal/shared';
import { PaperStore, appError, busy, invalidInput, notFound, type ConversationRecord, type DeleteReport } from './index';
import { readRecord } from './atomic';
import { assertSafeKey, validateBlock, validateConversationRecord, validateHighlight, validateJob, validatePaper, validateTranslation } from './validate';
import { bibtexKeyBase, legacyBibtexKey, uniqueBibtexKey, yearFromArxivId } from '../library/citation';

type Row = Record<string, unknown>;
const value = <T>(row: Row | undefined, field = 'data'): T | null => (row ? (JSON.parse(String(row[field])) as T) : null);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Production store. JSON import is read-only; all subsequent records live in SQLite. */
export class SqlitePaperStore extends PaperStore {
  readonly db: DatabaseSync;
  onBlocksSaved?: (paperKey: string) => void;
  constructor(root: string, legacyRoot?: string) {
    super(root);
    mkdirSync(root, { recursive: true });
    this.db = new DatabaseSync(join(root, 'library.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
    this.migrate();
    if (legacyRoot && legacyRoot !== root) this.importLegacy(legacyRoot);
  }
  override ensureRoot(): void {
    mkdirSync(this.root, { recursive: true });
  }
  private migrate(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS papers(paper_key TEXT PRIMARY KEY, data TEXT NOT NULL, pdf_hash TEXT);
      CREATE TABLE IF NOT EXISTS blocks(paper_key TEXT, block_id TEXT, data TEXT NOT NULL, PRIMARY KEY(paper_key,block_id));
      CREATE TABLE IF NOT EXISTS translations(paper_key TEXT, identity TEXT, data TEXT NOT NULL, PRIMARY KEY(paper_key,identity));
      CREATE TABLE IF NOT EXISTS jobs(job_id TEXT PRIMARY KEY, paper_key TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS highlights(id TEXT PRIMARY KEY, paper_key TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations(paper_key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS restart_receipts(paper_key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bibliography(paper_key TEXT PRIMARY KEY, doi TEXT, arxiv_id TEXT, pdf_hash TEXT, data TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS bibliography_doi ON bibliography(doi) WHERE doi IS NOT NULL;
      CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS annotations(id TEXT PRIMARY KEY, paper_key TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS changes(seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, item_key TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS paper_fts USING fts5(paper_key UNINDEXED, block_id UNINDEXED, page UNINDEXED, title, abstract, authors, text);
      INSERT OR IGNORE INTO migrations VALUES(1, datetime('now'));
      CREATE TABLE IF NOT EXISTS tags(name TEXT PRIMARY KEY);
      INSERT OR IGNORE INTO migrations VALUES(2, datetime('now'));
      CREATE TABLE IF NOT EXISTS feed_meta(key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS feed_items(week TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(week,id));
      CREATE TABLE IF NOT EXISTS feed_fetch(url TEXT PRIMARY KEY, etag TEXT, modified TEXT, body TEXT NOT NULL, fetched_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS feed_digests(week TEXT PRIMARY KEY, data TEXT NOT NULL);
      INSERT OR IGNORE INTO migrations VALUES(4, datetime('now'));`);

    const citationMigration = this.db.prepare('SELECT 1 FROM migrations WHERE version = 3').get();
    if (!citationMigration) this.backfillCitations();
    if (!this.db.prepare('SELECT 1 FROM migrations WHERE version = 5').get()) this.migrateStructure();
  }

  /** Paper structure tables (figures, equations, references, citation markers). */
  private migrateStructure(): void {
    this.db.exec('SAVEPOINT structure_migration');
    try {
      this.db.exec(`CREATE TABLE IF NOT EXISTS structure_state(paper_key TEXT PRIMARY KEY, version TEXT NOT NULL, status TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS structure_items(paper_key TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(paper_key,id));
        CREATE TABLE IF NOT EXISTS structure_references(paper_key TEXT NOT NULL, n TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(paper_key,n));
        CREATE TABLE IF NOT EXISTS structure_markers(paper_key TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(paper_key,id));
        CREATE TABLE IF NOT EXISTS reference_enrichment(cache_key TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS arxiv_source_cache(source_key TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at TEXT NOT NULL);`);
      this.db.prepare("INSERT INTO migrations VALUES(5, datetime('now'))").run();
      this.db.exec('RELEASE structure_migration');
    } catch (error) {
      this.db.exec('ROLLBACK TO structure_migration');
      this.db.exec('RELEASE structure_migration');
      throw error;
    }
  }

  /** Repair old keys based on the date added before enforcing uniqueness. */
  private backfillCitations(): void {
    const rows = this.db.prepare('SELECT paper_key, data FROM bibliography').all() as Row[];
    const records = rows.map((row) => JSON.parse(String(row.data)) as LibraryRecord);
    records.sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.paperKey.localeCompare(b.paperKey));

    const used = new Set<string>();
    const chosen = new Map<string, LibraryRecord>();
    const edited = records.filter((record) => record.bibtexKey !== legacyBibtexKey(record));
    const generated = records.filter((record) => record.bibtexKey === legacyBibtexKey(record));
    const editedKeys = new Set(edited.map((record) => record.paperKey));

    for (const record of [...edited, ...generated]) {
      const year = record.year ?? yearFromArxivId(record.arxivId);
      const base = editedKeys.has(record.paperKey) ? record.bibtexKey : bibtexKeyBase({ ...record, year });
      const bibtexKey = uniqueBibtexKey(base, used);
      used.add(bibtexKey);
      chosen.set(record.paperKey, { ...record, year, bibtexKey });
    }

    this.db.exec('BEGIN');
    try {
      const update = this.db.prepare('UPDATE bibliography SET data = ? WHERE paper_key = ?');
      for (const record of records) {
        const next = chosen.get(record.paperKey)!;
        if (next.year === record.year && next.bibtexKey === record.bibtexKey) continue;
        update.run(JSON.stringify(next), record.paperKey);
        this.change('paper', record.paperKey);
      }
      this.db.exec("CREATE UNIQUE INDEX bibliography_citekey ON bibliography(json_extract(data, '$.bibtexKey'))");
      this.db.prepare("INSERT INTO migrations VALUES(3, datetime('now'))").run();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private nextBibtexKey(base: string, paperKey: string): string {
    const rows = this.db.prepare("SELECT json_extract(data, '$.bibtexKey') AS citekey FROM bibliography WHERE paper_key <> ?").all(paperKey) as Row[];
    const used = new Set(rows.map((row) => String(row.citekey)));
    return uniqueBibtexKey(base, used);
  }
  private change(kind: string, key: string): void {
    this.db.prepare('INSERT INTO changes(kind,item_key) VALUES(?,?)').run(kind, key);
  }
  private importLegacy(root: string): void {
    if (!existsSync(root)) return;
    for (const key of readdirSync(root)) {
      if (!/^[A-Za-z0-9._-]+$/.test(key) || key.startsWith('.') || !statSync(join(root, key)).isDirectory() || this.getPaper(key)) continue;
      const dir = join(root, key);
      const paper = readRecord<Paper>(join(dir, 'paper.json'));
      if (!paper) continue;
      try {
        this.db.exec('BEGIN');
        const pdf = existsSync(join(dir, 'original.pdf')) ? readFileSync(join(dir, 'original.pdf')) : undefined;
        this.savePaper(paper, pdf);
        const blocks = readRecord<Block[]>(join(dir, 'blocks.json'));
        if (blocks) this.saveBlocks(key, blocks);
        const translations = readRecord<Translation[]>(join(dir, 'translations.json')) ?? [];
        for (const t of translations) this.saveTranslation(key, t);
        const job = readRecord<Job>(join(dir, 'job.json'));
        if (job) this.saveJob(job);
        const highlights = readRecord<Highlight[]>(join(dir, 'highlights.json')) ?? [];
        for (const h of highlights) this.saveHighlight(key, h);
        const chat = readRecord<ConversationRecord>(join(dir, 'chat.json'));
        if (chat) this.saveConversation(key, chat);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        process.stderr.write(`Fractal: skipped legacy paper ${key}: ${String(error)}\n`);
      }
    }
  }
  override savePaper(paper: Paper, pdfBytes?: Buffer | Uint8Array): Paper {
    const p = validatePaper(paper);
    const previous = this.getPaper(p.paperKey);
    let pdfHash = p.pdfSha256 ?? previous?.pdfSha256 ?? null;
    if (pdfBytes) pdfHash = this.saveBlob(pdfBytes);
    this.db
      .prepare('INSERT INTO papers VALUES(?,?,?) ON CONFLICT(paper_key) DO UPDATE SET data=excluded.data,pdf_hash=COALESCE(excluded.pdf_hash,papers.pdf_hash)')
      .run(p.paperKey, JSON.stringify({ ...p, pdfSha256: pdfHash }), pdfHash);
    this.updateBibliography({ ...p, pdfSha256: pdfHash });
    if (!previous || JSON.stringify(previous) !== JSON.stringify(p)) this.change('paper', p.paperKey);
    return { ...p, pdfSha256: pdfHash };
  }
  override getPaper(key: string): Paper | null {
    assertSafeKey(key);
    return value<Paper>(this.db.prepare('SELECT data FROM papers WHERE paper_key=?').get(key) as Row | undefined);
  }
  override listPapers(): string[] {
    return (this.db.prepare('SELECT paper_key FROM papers ORDER BY paper_key').all() as Row[]).map((r) => String(r.paper_key));
  }
  private saveBlob(bytes: Buffer | Uint8Array): string {
    const sha = hash(bytes),
      dir = join(this.root, 'pdfs');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${sha}.pdf`);
    if (!existsSync(path)) {
      const temp = join(dir, `.${randomUUID()}.tmp`);
      writeFileSync(temp, bytes);
      renameSync(temp, path);
    }
    return sha;
  }
  override getPdf(key: string): Buffer | null {
    assertSafeKey(key);
    const row = this.db.prepare('SELECT pdf_hash FROM papers WHERE paper_key=?').get(key) as Row | undefined;
    const path = row?.pdf_hash ? join(this.root, 'pdfs', `${row.pdf_hash}.pdf`) : null;
    return path && existsSync(path) ? readFileSync(path) : null;
  }
  override savePdf(key: string, bytes: Buffer | Uint8Array): void {
    const current = this.getPaper(key);
    if (!current) throw notFound(`paper not found: ${key}`);
    const sha = this.saveBlob(bytes);
    this.db.prepare('UPDATE papers SET pdf_hash=?,data=? WHERE paper_key=?').run(sha, JSON.stringify({ ...current, pdfSha256: sha }), key);
    this.db.prepare('UPDATE bibliography SET pdf_hash=? WHERE paper_key=?').run(sha, key);
  }
  override saveBlocks(key: string, blocks: Block[]): Block[] {
    assertSafeKey(key);
    const checked = blocks.map((b) => validateBlock(b, key));
    if (new Set(checked.map((b) => b.blockId)).size !== checked.length) throw invalidInput('중복된 블록 식별자가 있습니다.');
    this.db.exec('SAVEPOINT blocks');
    try {
      this.db.prepare('DELETE FROM blocks WHERE paper_key=?').run(key);
      const insert = this.db.prepare('INSERT INTO blocks VALUES(?,?,?)');
      for (const b of checked) insert.run(key, b.blockId, JSON.stringify(b));
      this.reindex(key);
      this.db.exec('RELEASE blocks');
    } catch (e) {
      this.db.exec('ROLLBACK TO blocks');
      this.db.exec('RELEASE blocks');
      throw e;
    }
    this.onBlocksSaved?.(key);
    return checked;
  }
  override listBlocks(key: string): Block[] {
    assertSafeKey(key);
    return (this.db.prepare('SELECT data FROM blocks WHERE paper_key=?').all(key) as Row[])
      .map((r) => JSON.parse(String(r.data)) as Block)
      .sort((a, b) => a.order - b.order);
  }
  override getBlock(key: string, id: string): Block | null {
    return this.listBlocks(key).find((b) => b.blockId === id) ?? null;
  }
  override saveTranslation(key: string, t: Translation): Translation {
    const v = validateTranslation(t),
      b = this.getBlock(key, v.blockId);
    if (!b) throw notFound('block not found');
    if (b.sourceHash !== v.sourceHash) throw appError('SOURCE_CHANGED', '번역할 원문이 변경되었습니다. 다시 시도해 주세요.');
    const id = [v.blockId, v.sourceHash, v.modelId, v.promptVersion].join('\0');
    const old = value<Translation>(this.db.prepare('SELECT data FROM translations WHERE paper_key=? AND identity=?').get(key, id) as Row | undefined);
    if (old?.status === 'completed' && v.status !== 'completed') return old;
    this.db.prepare('INSERT INTO translations VALUES(?,?,?) ON CONFLICT(paper_key,identity) DO UPDATE SET data=excluded.data').run(key, id, JSON.stringify(v));
    return v;
  }
  override listTranslations(key: string): Translation[] {
    assertSafeKey(key);
    return (this.db.prepare('SELECT data FROM translations WHERE paper_key=?').all(key) as Row[]).map((r) => JSON.parse(String(r.data)) as Translation);
  }
  override findReusableTranslation(key: string, blockId: string, sourceHash: string, modelId: string, promptVersion: string): Translation | null {
    return (
      this.listTranslations(key).find(
        (t) => t.blockId === blockId && t.sourceHash === sourceHash && t.modelId === modelId && t.promptVersion === promptVersion && t.status === 'completed',
      ) ?? null
    );
  }
  override saveJob(job: Job): Job {
    const j = validateJob(job);
    this.db.prepare('DELETE FROM jobs WHERE paper_key=?').run(j.paperKey);
    this.db.prepare('INSERT INTO jobs VALUES(?,?,?)').run(j.jobId, j.paperKey, JSON.stringify(j));
    return j;
  }
  override getJobForPaper(key: string): Job | null {
    assertSafeKey(key);
    return value<Job>(this.db.prepare('SELECT data FROM jobs WHERE paper_key=?').get(key) as Row | undefined);
  }
  override getJob(id: string): Job | null {
    return value<Job>(this.db.prepare('SELECT data FROM jobs WHERE job_id=?').get(id) as Row | undefined);
  }
  override listJobs(): Job[] {
    return (this.db.prepare('SELECT data FROM jobs').all() as Row[]).map((r) => JSON.parse(String(r.data)) as Job);
  }
  override recoverRestarts(): void {}
  override assertTranslationReadable(_key: string): void {}
  override lastTranslationRestart(
    key: string,
  ): Pick<import('./restart').TranslationResetRecord, 'requestId' | 'expectedJobId' | 'modelId' | 'promptVersion' | 'jobId'> | null {
    return value(this.db.prepare('SELECT data FROM restart_receipts WHERE paper_key=?').get(key) as Row | undefined);
  }
  override restartTranslation(key: string, input: RestartTranslationRequest, promptVersion: string): Job {
    const old = this.getJobForPaper(key);
    if (!old) throw notFound('job not found');
    const receipt = this.lastTranslationRestart(key);
    if (receipt?.requestId === input.requestId) {
      if (receipt.expectedJobId === input.expectedJobId && receipt.modelId === input.modelId && receipt.promptVersion === promptVersion) return old;
      throw busy('restart request conflict');
    }
    if (old.jobId !== input.expectedJobId) throw busy('job changed');
    const job = {
      ...old,
      jobId: randomUUID(),
      modelId: input.modelId,
      promptVersion,
      generation: old.generation + 1,
      state: 'running' as const,
      pauseReason: null,
      completedBlocks: 0,
      updatedAt: new Date().toISOString(),
    };
    this.db.exec('BEGIN');
    try {
      this.clearDerivedWork(key);
      this.saveJob(job);
      this.db
        .prepare('INSERT INTO restart_receipts VALUES(?,?) ON CONFLICT(paper_key) DO UPDATE SET data=excluded.data')
        .run(key, JSON.stringify({ ...input, promptVersion, jobId: job.jobId }));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return job;
  }
  override clearDerivedWork(key: string): void {
    this.db.prepare('DELETE FROM translations WHERE paper_key=?').run(key);
    this.db.prepare('DELETE FROM jobs WHERE paper_key=?').run(key);
    this.db.prepare('DELETE FROM restart_receipts WHERE paper_key=?').run(key);
  }
  override saveHighlight(key: string, h: Highlight): Highlight {
    const v = validateHighlight(h, key),
      id = this.highlightUuid(v.highlightId);
    this.db.exec('SAVEPOINT legacy_highlight');
    try {
      this.db.prepare('INSERT INTO highlights VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(v.highlightId, key, JSON.stringify(v));
      this.upsertAnnotation({
        kind: 'highlight',
        id,
        paperKey: key,
        page: v.page,
        text: v.text,
        color: v.color,
        rects: v.rects.map(({ x, y, width, height }) => ({ x, y, width, height })),
        note: v.note,
        updatedAt: v.updatedAt,
        deleted: false,
        rev: 0,
        deviceId: 'hub',
      });
      this.db.exec('RELEASE legacy_highlight');
      return v;
    } catch (error) {
      this.db.exec('ROLLBACK TO legacy_highlight');
      this.db.exec('RELEASE legacy_highlight');
      throw error;
    }
  }
  override listHighlights(key: string): Highlight[] {
    assertSafeKey(key);
    return (this.db.prepare('SELECT data FROM highlights WHERE paper_key=?').all(key) as Row[]).map((r) => JSON.parse(String(r.data)) as Highlight);
  }
  override getHighlight(key: string, id: string): Highlight | null {
    return this.listHighlights(key).find((h) => h.highlightId === id) ?? null;
  }
  override deleteHighlight(key: string, id: string): boolean {
    const old = this.getHighlight(key, id);
    if (!old) return false;
    this.db.exec('SAVEPOINT legacy_highlight');
    try {
      this.db.prepare('DELETE FROM highlights WHERE paper_key=? AND id=?').run(key, id);
      this.upsertAnnotation({
        kind: 'highlight',
        id: this.highlightUuid(id),
        paperKey: key,
        page: old.page,
        text: old.text,
        color: old.color,
        rects: old.rects.map(({ x, y, width, height }) => ({ x, y, width, height })),
        note: old.note,
        updatedAt: new Date().toISOString(),
        deleted: true,
        rev: 0,
        deviceId: 'hub',
      });
      this.db.exec('RELEASE legacy_highlight');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK TO legacy_highlight');
      this.db.exec('RELEASE legacy_highlight');
      throw error;
    }
  }
  override getConversation(key: string): ConversationRecord | null {
    return value<ConversationRecord>(this.db.prepare('SELECT data FROM conversations WHERE paper_key=?').get(key) as Row | undefined);
  }
  override saveConversation(key: string, record: ConversationRecord): ConversationRecord {
    if (!this.getPaper(key)) throw notFound('paper not found');
    const v = validateConversationRecord(record);
    this.db.prepare('INSERT INTO conversations VALUES(?,?) ON CONFLICT(paper_key) DO UPDATE SET data=excluded.data').run(key, JSON.stringify(v));
    return v;
  }
  override deleteConversation(key: string): boolean {
    return Number(this.db.prepare('DELETE FROM conversations WHERE paper_key=?').run(key).changes) > 0;
  }
  override deletePaper(key: string): DeleteReport {
    const pdfHash = this.getPaper(key)?.pdfSha256 ?? null;
    const report: DeleteReport = {
      paperKey: key,
      scope: 'local',
      remoteDeleted: false,
      removedPaper: !!this.getPaper(key),
      removedPdf: !!this.getPdf(key),
      removedBlocks: this.listBlocks(key).length,
      removedTranslations: this.listTranslations(key).length,
      removedJob: !!this.getJobForPaper(key),
      removedHighlights: this.listHighlights(key).length,
      removedChatMessages: this.getConversation(key)?.messages.length ?? 0,
    };
    this.db.exec('BEGIN');
    try {
      for (const table of [
        'papers',
        'blocks',
        'translations',
        'jobs',
        'highlights',
        'conversations',
        'bibliography',
        'annotations',
        'restart_receipts',
        'structure_state',
        'structure_items',
        'structure_references',
        'structure_markers',
      ])
        this.db.prepare(`DELETE FROM ${table} WHERE paper_key=?`).run(key);
      this.db.prepare('DELETE FROM paper_fts WHERE paper_key=?').run(key);
      this.change('paper', key);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    if (pdfHash) {
      const remaining = this.db.prepare('SELECT count(*) n FROM papers WHERE pdf_hash=?').get(pdfHash) as Row;
      if (Number(remaining.n) === 0) rmSync(join(this.root, 'pdfs', `${pdfHash}.pdf`), { force: true });
    }
    return report;
  }
  private updateBibliography(p: Paper): void {
    const old = this.getLibrary(p.paperKey);
    const now = new Date().toISOString();
    const authors = p.authors.map((name) => {
      const parts = name.trim().split(/\s+/);
      return { given: parts.slice(0, -1).join(' '), family: parts.at(-1) ?? name };
    });
    const year = yearFromArxivId(p.arxivId);

    const record: LibraryRecord = old
      ? {
          ...old,
          title: p.title ?? old.title,
          authors: authors.length ? authors : old.authors,
          arxivId: p.arxivId ?? old.arxivId,
          year: old.year ?? year,
          url: p.sourceUrl,
          updatedAt: now,
        }
      : {
          id: randomUUID(),
          paperKey: p.paperKey,
          title: p.title,
          authors,
          year,
          venue: null,
          doi: null,
          arxivId: p.arxivId,
          url: p.sourceUrl,
          abstract: null,
          tags: [],
          collections: [],
          addedAt: p.createdAt,
          updatedAt: now,
          status: 'unread',
          bibtexKey: this.nextBibtexKey(bibtexKeyBase({ authors, year }), p.paperKey),
        };

    this.db
      .prepare(
        'INSERT INTO bibliography VALUES(?,?,?,?,?) ON CONFLICT(paper_key) DO UPDATE SET doi=excluded.doi,arxiv_id=excluded.arxiv_id,pdf_hash=excluded.pdf_hash,data=excluded.data',
      )
      .run(p.paperKey, record.doi?.toLowerCase() ?? null, record.arxivId, p.pdfSha256, JSON.stringify(record));
    this.reindex(p.paperKey);
  }
  getLibrary(key: string): LibraryRecord | null {
    return value<LibraryRecord>(this.db.prepare('SELECT data FROM bibliography WHERE paper_key=?').get(key) as Row | undefined);
  }
  listLibrary(): LibraryRecord[] {
    return (this.db.prepare('SELECT data FROM bibliography ORDER BY paper_key').all() as Row[]).map((r) => JSON.parse(String(r.data)) as LibraryRecord);
  }
  patchLibrary(key: string, patch: LibraryPatch): LibraryRecord {
    const old = this.getLibrary(key);
    if (!old) throw notFound('논문을 찾을 수 없습니다.');

    const parsed = libraryPatchSchema.safeParse(patch);
    if (!parsed.success) throw invalidInput('서지 정보 형식이 올바르지 않습니다.');

    const values = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined));
    const next = { ...old, ...values, updatedAt: new Date().toISOString() } as LibraryRecord;

    if (parsed.data.bibtexKey !== undefined) {
      if (this.nextBibtexKey(next.bibtexKey, key) !== next.bibtexKey) {
        throw invalidInput('이미 사용 중인 인용 키입니다.');
      }
    } else if (old.year === null && next.year !== null && old.bibtexKey === bibtexKeyBase(old)) {
      // DOI metadata can arrive immediately after the paper row is first saved.
      next.bibtexKey = this.nextBibtexKey(bibtexKeyBase(next), key);
    }

    this.db
      .prepare('UPDATE bibliography SET doi=?,arxiv_id=?,data=? WHERE paper_key=?')
      .run(next.doi?.toLowerCase() ?? null, next.arxivId ?? null, JSON.stringify(next), key);
    this.reindex(key);
    this.change('paper', key);
    return next;
  }
  findDuplicate(doi: string | null, arxiv: string | null, sha: string | null): string | null {
    const row = this.db
      .prepare('SELECT paper_key FROM bibliography WHERE (? IS NOT NULL AND doi=?) OR (? IS NOT NULL AND arxiv_id=?) OR (? IS NOT NULL AND pdf_hash=?) LIMIT 1')
      .get(doi, doi, arxiv, arxiv, sha, sha) as Row | undefined;
    return row ? String(row.paper_key) : null;
  }
  private reindex(key: string): void {
    this.db.prepare('DELETE FROM paper_fts WHERE paper_key=?').run(key);
    const r = this.getLibrary(key);
    if (!r) return;
    const blocks = this.listBlocks(key);
    const insert = this.db.prepare('INSERT INTO paper_fts VALUES(?,?,?,?,?,?,?)');
    insert.run(key, null, null, r.title ?? '', r.abstract ?? '', r.authors.map((a) => `${a.given} ${a.family}`).join(' '), '');
    for (const b of blocks) insert.run(key, b.blockId, b.regions[0]?.page ?? null, '', '', '', b.sourceText);
  }
  pull(since: number): { cursor: string; papers: LibraryRecord[]; annotations: Annotation[] } {
    const changes = this.db.prepare('SELECT kind,item_key FROM changes WHERE seq>? ORDER BY seq').all(since) as Row[];
    const keys = new Set(changes.filter((r) => r.kind === 'paper').map((r) => String(r.item_key))),
      ids = new Set(changes.filter((r) => r.kind === 'annotation').map((r) => String(r.item_key)));
    return {
      cursor: String((this.db.prepare('SELECT COALESCE(MAX(seq),0) n FROM changes').get() as Row).n),
      papers: [...keys].map((k) => this.getLibrary(k)).filter((r): r is LibraryRecord => r !== null),
      annotations: [...ids].map((id) => this.getAnnotation(id)).filter((a): a is Annotation => a !== null),
    };
  }
  getAnnotation(id: string): Annotation | null {
    return value<Annotation>(this.db.prepare('SELECT data FROM annotations WHERE id=?').get(id) as Row | undefined);
  }
  private highlightUuid(id: string): string {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return id;
    const h = hash(Buffer.from(id));
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }
  listAnnotations(key: string): Annotation[] {
    return (this.db.prepare('SELECT data FROM annotations WHERE paper_key=?').all(key) as Row[]).map((r) => JSON.parse(String(r.data)) as Annotation);
  }
  upsertAnnotation(input: Annotation): { id: string; applied: boolean; rev: number } {
    const parsed = annotationSchema.safeParse(input);
    if (!parsed.success) throw invalidInput('주석 형식이 올바르지 않습니다.');
    const a = parsed.data;
    if (!this.getPaper(a.paperKey)) throw notFound('paper not found');
    const old = this.getAnnotation(a.id);
    const newer = !old || a.updatedAt > old.updatedAt || (a.updatedAt === old.updatedAt && a.deviceId > old.deviceId);
    if (!newer) return { id: a.id, applied: false, rev: old!.rev };
    const next = { ...a, rev: (old?.rev ?? 0) + 1 };
    this.db.exec('SAVEPOINT annotation_upsert');
    try {
      this.db
        .prepare('INSERT INTO annotations VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET paper_key=excluded.paper_key,data=excluded.data')
        .run(a.id, a.paperKey, JSON.stringify(next));
      if (a.kind === 'highlight' && a.deviceId !== 'hub') {
        if (a.deleted) {
          this.db.prepare('DELETE FROM highlights WHERE id=?').run(a.id);
        } else {
          const prior = this.getHighlight(a.paperKey, a.id);
          const h: Highlight = {
            highlightId: a.id,
            paperKey: a.paperKey,
            page: a.page,
            rects: a.rects.map((r) => ({ page: a.page, ...r })),
            text: a.text,
            color: a.color,
            note: a.note,
            createdAt: prior?.createdAt ?? a.updatedAt,
            updatedAt: a.updatedAt,
          };
          this.db.prepare('INSERT INTO highlights VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(a.id, a.paperKey, JSON.stringify(h));
        }
      }
      this.change('annotation', a.id);
      this.db.exec('RELEASE annotation_upsert');
      return { id: a.id, applied: true, rev: next.rev };
    } catch (error) {
      this.db.exec('ROLLBACK TO annotation_upsert');
      this.db.exec('RELEASE annotation_upsert');
      throw error;
    }
  }
}
