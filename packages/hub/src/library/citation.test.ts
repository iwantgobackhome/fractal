import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Paper } from '@fractal/shared';
import { SqlitePaperStore } from '../store/sqlite';
import { bibtex } from '../export/index';
import { resolveDoi } from '../ingest/index';
import { toHttp } from '../api/errors';
import { yearFromArxivId } from './citation';

const directories: string[] = [];
const stores: SqlitePaperStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) {
    try { store.db.close(); } catch { /* already closed for a migration test */ }
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'fractal-citation-'));
  directories.push(directory);
  return directory;
}

function openStore(directory: string): SqlitePaperStore {
  const store = new SqlitePaperStore(directory);
  stores.push(store);
  return store;
}

function arxivPaper(arxivId: string, author = 'Ashish Vaswani'): Paper {
  return {
    paperKey: `${arxivId}v1`,
    sourceKind: 'arxiv',
    arxivId,
    version: 1,
    title: 'A research paper',
    authors: [author],
    sourceUrl: `https://arxiv.org/pdf/${arxivId}v1`,
    pdfSha256: null,
    pageCount: null,
    extractionVersion: null,
    status: 'fetching',
    coverage: null,
    createdAt: '2026-09-30T00:00:00.000Z',
  };
}

describe('citation year and key', () => {
  it('reports an unknown Crossref DOI as non-retryable NOT_FOUND', async () => {
    const missing = (async () => ({ ok: false, status: 404 } as Response)) as typeof fetch;
    let error: unknown;
    try {
      await resolveDoi('10.1234/doesnotexist', missing);
    } catch (cause) {
      error = cause;
    }

    expect(toHttp(error)).toMatchObject({
      status: 404,
      error: {
        code: 'NOT_FOUND',
        message: '이 DOI를 찾지 못했습니다. DOI를 다시 확인해 주세요.',
        retryable: false,
      },
    });

    const unavailable = (async () => ({ ok: false, status: 503 } as Response)) as typeof fetch;
    let upstreamError: unknown;
    try {
      await resolveDoi('10.1234/doesnotexist', unavailable);
    } catch (cause) {
      upstreamError = cause;
    }
    expect(toHttp(upstreamError)).toMatchObject({ status: 502, error: { code: 'NETWORK', retryable: true } });
  });

  it('uses the Crossref issued year when published is absent', async () => {
    const response = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: { issued: { 'date-parts': [[2022, 5, 1]] } } }),
    } as Response)) as typeof fetch;
    const metadata = await resolveDoi('10.1234/example', response, '');
    expect(metadata.year).toBe(2022);
  });

  it('derives the year from modern and old-style arXiv identifiers', () => {
    expect(yearFromArxivId('1706.03762')).toBe(2017);
    expect(yearFromArxivId('0704.0001')).toBe(2007);
    expect(yearFromArxivId('hep-th/9901001')).toBe(1999);
    expect(yearFromArxivId('math/0305001')).toBe(2003);
    expect(yearFromArxivId('hep-th/0801001')).toBeNull();
    expect(yearFromArxivId('invalid')).toBeNull();
  });

  it('uses publication year and unique keys, then preserves edited keys', () => {
    const store = openStore(temporaryDirectory());
    const first = arxivPaper('1706.03762');
    const second = arxivPaper('1707.00001');
    store.savePaper(first);
    store.savePaper(second);

    expect(store.getLibrary(first.paperKey)).toMatchObject({ year: 2017, bibtexKey: 'vaswani2017' });
    expect(store.getLibrary(second.paperKey)).toMatchObject({ year: 2017, bibtexKey: 'vaswani2017a' });
    expect(bibtex([store.getLibrary(first.paperKey)!])).toContain('year = {2017}');

    store.savePaper({ ...first, title: 'A revised title' });
    expect(store.getLibrary(first.paperKey)?.bibtexKey).toBe('vaswani2017');
    expect(() => store.patchLibrary(second.paperKey, { bibtexKey: 'vaswani2017' })).toThrow();
    store.patchLibrary(first.paperKey, { bibtexKey: 'transformer2017' });
    store.savePaper(first);
    expect(store.getLibrary(first.paperKey)?.bibtexKey).toBe('transformer2017');
  });

  it('uses Crossref year when DOI metadata arrives after a paper is saved', () => {
    const store = openStore(temporaryDirectory());
    const paper: Paper = {
      ...arxivPaper('1706.03762', 'Ada Lovelace'),
      paperKey: `pdf-${'a'.repeat(64)}-${'b'.repeat(64)}`,
      sourceKind: 'publication',
      arxivId: null,
      version: null,
      sourceUrl: 'https://example.org/paper.pdf',
    };
    store.savePaper(paper);
    expect(store.getLibrary(paper.paperKey)?.bibtexKey).toBe('lovelaceundated');

    store.patchLibrary(paper.paperKey, { doi: '10.1234/example', year: 2024 });
    expect(store.getLibrary(paper.paperKey)).toMatchObject({ year: 2024, bibtexKey: 'lovelace2024' });
    store.savePaper(paper);
    expect(store.getLibrary(paper.paperKey)?.bibtexKey).toBe('lovelace2024');
  });

  it('backfills old rows in migration 3 without replacing edited keys', () => {
    const directory = temporaryDirectory();
    const store = openStore(directory);
    const first = arxivPaper('1706.03762');
    const second = arxivPaper('1707.00001');
    const edited = arxivPaper('1708.00001');
    for (const paper of [first, second, edited]) store.savePaper(paper);

    store.db.exec('DROP INDEX bibliography_citekey');
    store.db.prepare('DELETE FROM migrations WHERE version = 3').run();
    const update = store.db.prepare('UPDATE bibliography SET data = ? WHERE paper_key = ?');
    for (const paper of [first, second, edited]) {
      const record = store.getLibrary(paper.paperKey)!;
      update.run(JSON.stringify({
        ...record,
        year: null,
        bibtexKey: paper === edited ? 'my-transformer-key' : 'vaswani2026',
      }), paper.paperKey);
    }
    store.db.close();

    const migrated = openStore(directory);
    expect(migrated.getLibrary(first.paperKey)).toMatchObject({ year: 2017, bibtexKey: 'vaswani2017' });
    expect(migrated.getLibrary(second.paperKey)).toMatchObject({ year: 2017, bibtexKey: 'vaswani2017a' });
    expect(migrated.getLibrary(edited.paperKey)).toMatchObject({ year: 2017, bibtexKey: 'my-transformer-key' });
    expect(migrated.db.prepare('SELECT count(*) AS count FROM migrations').get()).toMatchObject({ count: 4 });
  });
});
