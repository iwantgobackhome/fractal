import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { PdfJsStructureDetector, expandCitation } from './detector';
import { latexFiles, matchLatex, parseLatexSources } from './source';
import { enrichReference } from './enrichment';
import { StructureService } from './service';
import { SqlitePaperStore } from '../store/sqlite';
import { extractPdf } from '../pdf/index';
import { handleStructure } from '../api/routes/structure';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url)));

describe('paper structure', () => {
  it('uses migration 5 without claiming versions 3 or 4', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fractal-structure-migration-'));
    try {
      const db = new DatabaseSync(join(directory, 'library.sqlite'));
      db.exec("CREATE TABLE migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO migrations VALUES(3, datetime('now')); INSERT INTO migrations VALUES(4, datetime('now'));");
      db.close();
      const store = new SqlitePaperStore(directory);
      expect(store.db.prepare('SELECT version FROM migrations ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }]);
      expect(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='structure_items'").get()).toMatchObject({ name: 'structure_items' });
      store.db.close();
      const reopened = new SqlitePaperStore(directory);
      expect(reopened.db.prepare('SELECT count(*) n FROM migrations WHERE version=5').get()).toMatchObject({ n: 1 });
      reopened.db.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('detects a vector figure, ruled table, numbered equation and citation ranges in a real PDF', async () => {
    const structure = await new PdfJsStructureDetector().detect(fixture('structure.pdf'), 'fixture');
    expect(structure.items.map((item) => item.label)).toEqual(['Figure 1', '(1)', 'Table 1']);
    expect(structure.items.every((item) => item.bbox.width > 0 && item.bbox.height > 0)).toBe(true);
    expect(structure.items.find((item) => item.kind === 'equation')?.caption).toContain('E = mc2');
    expect(structure.references.map((entry) => entry.n)).toEqual(['1', '2', '3', '4']);
    expect(structure.references[0]?.doi).toBe('10.1234/example');
    expect(structure.markers).toHaveLength(1);
    expect(structure.markers[0]?.references).toEqual(['1', '3', '4']);
    expect(structure.markers[0]?.bbox.width).toBeLessThan(0.1);
  });

  it('expands bounded numeric ranges', () => {
    expect(expandCitation('[3, 7–9]')).toEqual(['3', '7', '8', '9']);
    expect(expandCitation('[1-200]')).toEqual([]);
  });

  it('reads an arXiv tarball and attaches labels, captions and equation LaTeX', () => {
    const fragments = parseLatexSources(latexFiles(fixture('source.tar.gz')));
    expect(fragments).toHaveLength(3);
    const items = [
      { id: 'a', kind: 'figure' as const, page: 1, bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, label: 'Figure 1', caption: 'Figure 1: Blue rectangle', confidence: 0.9 },
      { id: 'b', kind: 'equation' as const, page: 1, bbox: { x: 0.1, y: 0.4, width: 0.2, height: 0.1 }, label: '(1)', caption: 'E = mc2', confidence: 0.8 },
    ];
    const matched = matchLatex(items, fragments);
    expect(matched[0]?.sourceLabel).toBe('fig:blue');
    expect(matched[1]?.latex).toContain('mc^2');
  });

  it('uses Semantic Scholar, then OpenAlex when the first service fails', async () => {
    const reference = { n: '1', raw: 'Example Method', doi: '10.1234/example' };
    const semantic = async () => new Response(JSON.stringify({ title: 'Example Method', abstract: 'Abstract', year: 2020, venue: 'Journal', externalIds: { DOI: '10.1234/example' }, citationCount: 3, openAccessPdf: { url: 'https://example.org/a.pdf' } }), { status: 200 });
    expect((await enrichReference(reference, semantic as typeof fetch))?.provider).toBe('semantic-scholar');
    const urls: string[] = [];
    const fallback = async (url: string | URL | Request) => {
      urls.push(String(url));
      return urls.length === 1 ? new Response(null, { status: 429 }) : new Response(JSON.stringify({ results: [{ title: 'Example Method', publication_year: 2020, cited_by_count: 4, ids: { doi: 'https://doi.org/10.1234/example' }, best_oa_location: { pdf_url: 'https://example.org/b.pdf' } }] }), { status: 200 });
    };
    expect((await enrichReference(reference, fallback as typeof fetch))?.provider).toBe('openalex');
  });

  it('stores detection and serves pending and ready route responses', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fractal-structure-'));
    const store = new SqlitePaperStore(directory);
    try {
      const key = `pdf-${'a'.repeat(64)}-${'b'.repeat(64)}`;
      const bytes = fixture('structure.pdf');
      const pdfSha256 = createHash('sha256').update(bytes).digest('hex');
      const extracted = await extractPdf(bytes, key);
      store.savePaper({ paperKey: key, sourceKind: 'publication', arxivId: null, version: null, title: 'Fixture', authors: [], sourceUrl: 'https://example.org/fixture.pdf', pdfSha256, pageCount: 1, extractionVersion: extracted.extractionVersion, status: 'ready', coverage: extracted.coverage, createdAt: new Date().toISOString() }, bytes);
      const structure = new StructureService(store);
      store.saveBlocks(key, extracted.blocks);
      const context = { store, structure, acquirer: { resolve: async () => { throw Error('unused'); }, acquire: async () => { throw Error('unused'); }, reextract: async () => { throw Error('unused'); } } };
      const request = {} as IncomingMessage;
      const first = await handleStructure('GET', ['api', 'papers', key, 'structure'], request, context);
      expect(first?.status).toBe(202);
      for (let attempt = 0; attempt < 100 && structure.read(key).status !== 'ready'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const ready = await handleStructure('GET', ['api', 'papers', key, 'structure'], request, context);
      expect(ready?.status).toBe(200);
      expect(structure.read(key).references).toHaveLength(4);
      const fetcher = (async () => new Response(JSON.stringify({ title: 'Example Method' }), { status: 200 })) as typeof fetch;
      const reference = await handleStructure('GET', ['api', 'papers', key, 'references', '1'], request, { ...context, structure: new StructureService(store, new PdfJsStructureDetector(), fetcher) });
      expect(reference?.status).toBe(200);
    } finally {
      store.db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
