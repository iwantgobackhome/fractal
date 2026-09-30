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
import { latexFiles, matchLatex, mathSimilarity, parseLatexSources } from './source';
import { ENRICHMENT_CACHE_VERSION, enrichReference, validEnrichment } from './enrichment';
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
      db.exec(
        "CREATE TABLE migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO migrations VALUES(3, datetime('now')); INSERT INTO migrations VALUES(4, datetime('now'));",
      );
      db.close();
      const store = new SqlitePaperStore(directory);
      expect(store.db.prepare('SELECT version FROM migrations ORDER BY version').all()).toEqual([
        { version: 1 },
        { version: 2 },
        { version: 3 },
        { version: 4 },
        { version: 5 },
        { version: 6 },
        { version: 7 },
        { version: 8 },
        { version: 9 },
        { version: 10 },
        { version: 11 },
        { version: 12 },
      ]);
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
      {
        id: 'a',
        kind: 'figure' as const,
        page: 1,
        bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        label: 'Figure 1',
        caption: 'Figure 1: Blue rectangle',
        confidence: 0.9,
      },
      { id: 'b', kind: 'equation' as const, page: 1, bbox: { x: 0.1, y: 0.4, width: 0.2, height: 0.1 }, label: '(1)', caption: 'E = mc2', confidence: 0.8 },
    ];
    const matched = matchLatex(items, fragments);
    expect(matched[0]?.sourceLabel).toBe('fig:blue');
    expect(matched[1]?.latex).toContain('mc^2');
  });

  it('does not count a starred align block or assign its formula to either numbered equation', () => {
    const fragments = parseLatexSources([fixture('equation-order.tex').toString('utf8')]);
    expect(fragments.map((fragment) => fragment.number)).toEqual(['1', undefined, '2']);
    const bbox = { x: 0.3, y: 0.3, width: 0.5, height: 0.1 };
    const items = [
      { id: 'ffn', kind: 'equation' as const, page: 2, bbox, label: '(2)', caption: 'FFN( x ) = max(0, xW 1 + b 1)W 2 + b 2', confidence: 0.8 },
      {
        id: 'attention',
        kind: 'equation' as const,
        page: 1,
        bbox,
        label: '(1)',
        caption: 'QK T Attention( Q, K, V ) = softmax( sqrt(d k) ) V',
        confidence: 0.8,
      },
      { id: 'unrelated', kind: 'equation' as const, page: 3, bbox, label: '(3)', caption: 'z = integral of unrelated symbols', confidence: 0.5 },
    ];
    const matched = matchLatex(items, fragments);
    expect(matched[0]?.sourceLabel).toBe('eq:ffn');
    expect(matched[1]?.sourceLabel).toBe('eq:attention');
    expect(matched[2]?.latex).toBeUndefined();
    expect(mathSimilarity(items[0].caption, fragments[0].latex!)).toBeLessThan(mathSimilarity(items[0].caption, fragments[2].latex!));
  });

  it('uses Semantic Scholar, then OpenAlex when the first service fails', async () => {
    const reference = { n: '1', raw: 'Example Method', doi: '10.1234/example' };
    const semantic = async () =>
      new Response(
        JSON.stringify({
          title: 'Example Method',
          abstract: 'Abstract',
          year: 2020,
          venue: 'Journal',
          externalIds: { DOI: '10.1234/example' },
          citationCount: 3,
          openAccessPdf: { url: 'https://example.org/a.pdf' },
        }),
        { status: 200 },
      );
    expect((await enrichReference(reference, semantic as typeof fetch))?.provider).toBe('semantic-scholar');
    const urls: string[] = [];
    const fallback = async (url: string | URL | Request) => {
      urls.push(String(url));
      return urls.length === 1
        ? new Response(null, { status: 429 })
        : new Response(
            JSON.stringify({
              results: [
                {
                  title: 'Example Method',
                  publication_year: 2020,
                  cited_by_count: 4,
                  ids: { doi: 'https://doi.org/10.1234/example' },
                  best_oa_location: { pdf_url: 'https://example.org/b.pdf' },
                },
              ],
            }),
            { status: 200 },
          );
    };
    expect((await enrichReference(reference, fallback as typeof fetch))?.provider).toBe('openalex');
  });

  it('rejects wrong titles and years from mocked reference providers', async () => {
    const reference = {
      n: '11',
      raw: 'Kaiming He, Xiangyu Zhang, Shaoqing Ren, and Jian Sun. Deep residual learning for im- age recognition. In CVPR, 2016.',
      authors: 'Kaiming He, Xiangyu Zhang, Shaoqing Ren, and Jian Sun',
      year: 2016,
    };
    const good = { title: 'Deep Residual Learning for Image Recognition', year: 2016, authors: [{ name: 'Kaiming He' }], externalIds: {} };
    const wrongTitle = { ...good, title: 'Person search: New paradigm of person re-identification' };
    const wrongYear = { ...good, year: 2020 };
    const mock = (candidate: object, fallback: object = { results: [] }) => {
      const seen: string[] = [];
      const fetcher = (async (input: string | URL | Request) => {
        seen.push(String(input));
        return new Response(JSON.stringify(seen.length === 1 ? candidate : fallback), { status: 200 });
      }) as typeof fetch;
      return { fetcher, seen };
    };
    const accepted = mock(good);
    expect((await enrichReference(reference, accepted.fetcher))?.title).toBe(good.title);
    expect(accepted.seen).toHaveLength(1);
    const rejectedTitle = mock(wrongTitle, {
      results: [{ title: good.title, publication_year: 2016, authorships: [{ author: { display_name: 'Jian Sun' } }] }],
    });
    expect((await enrichReference(reference, rejectedTitle.fetcher))?.provider).toBe('openalex');
    const rejectedYear = mock(wrongYear);
    expect(await enrichReference(reference, rejectedYear.fetcher)).toBeNull();
    expect(
      validEnrichment(
        reference,
        {
          title: wrongTitle.title,
          abstract: null,
          year: 2020,
          venue: null,
          externalIds: {},
          citationCount: null,
          openAccessPdf: null,
          provider: 'semantic-scholar',
        },
        ['Kaiming He'],
      ),
    ).toBe(false);
  });

  it('ignores enrichment cache rows written before candidate validation', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fractal-reference-cache-'));
    const store = new SqlitePaperStore(directory);
    try {
      const reference = { n: '11', raw: 'Deep residual learning for image recognition.', doi: '10.1000/correct' };
      store.db.prepare("INSERT INTO reference_enrichment VALUES(?,?,datetime('now'))").run('10.1000/correct', JSON.stringify({ title: 'Wrong paper' }));
      let calls = 0;
      const fetcher = (async () => {
        calls += 1;
        return new Response(JSON.stringify({ title: 'Deep residual learning for image recognition', externalIds: { DOI: '10.1000/correct' } }), {
          status: 200,
        });
      }) as typeof fetch;
      const service = new StructureService(store, new PdfJsStructureDetector(), fetcher);
      expect((await service.enrichment(reference))?.title).toBe('Deep residual learning for image recognition');
      expect(calls).toBe(1);
      expect(store.db.prepare('SELECT cache_key FROM reference_enrichment WHERE cache_key=?').get(`${ENRICHMENT_CACHE_VERSION}:10.1000/correct`)).toBeTruthy();
    } finally {
      store.db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('stores detection and serves pending and ready route responses', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fractal-structure-'));
    const store = new SqlitePaperStore(directory);
    try {
      const key = `pdf-${'a'.repeat(64)}-${'b'.repeat(64)}`;
      const bytes = fixture('structure.pdf');
      const pdfSha256 = createHash('sha256').update(bytes).digest('hex');
      const extracted = await extractPdf(bytes, key);
      store.savePaper(
        {
          paperKey: key,
          sourceKind: 'publication',
          arxivId: null,
          version: null,
          title: 'Fixture',
          authors: [],
          sourceUrl: 'https://example.org/fixture.pdf',
          pdfSha256,
          pageCount: 1,
          extractionVersion: extracted.extractionVersion,
          status: 'ready',
          coverage: extracted.coverage,
          createdAt: new Date().toISOString(),
        },
        bytes,
      );
      const structure = new StructureService(store);
      store.saveBlocks(key, extracted.blocks);
      const context = {
        store,
        structure,
        acquirer: {
          resolve: async () => {
            throw Error('unused');
          },
          acquire: async () => {
            throw Error('unused');
          },
          reextract: async () => {
            throw Error('unused');
          },
        },
      };
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
      const reference = await handleStructure('GET', ['api', 'papers', key, 'references', '1'], request, {
        ...context,
        structure: new StructureService(store, new PdfJsStructureDetector(), fetcher),
      });
      expect(reference?.status).toBe(200);
    } finally {
      store.db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
