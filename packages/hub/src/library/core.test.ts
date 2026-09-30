import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Annotation, Block, Paper } from '@fractal/shared';
import { writeRecord } from '../store/atomic';
import { SqlitePaperStore } from '../store/sqlite';
import { searchLibrary } from './search';
import { resolveDoi, metadataFromPdf, ingestPdf, ingestUrl } from '../ingest/index';
import { bibtex, cslJson, markdown } from '../export/index';
import { handleLibrary } from '../api/routes/library';
import { handleAnnotations } from '../api/routes/annotations';
import { handleSync } from '../api/routes/sync';
import { toHttp } from '../api/errors';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
function root() {
  const r = mkdtempSync(join(tmpdir(), 'fractal-core-'));
  roots.push(r);
  return r;
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
function paper(key = `pdf-${hash('url')}-${hash('pdf')}`): Paper {
  return {
    paperKey: key,
    sourceKind: 'publication',
    arxivId: null,
    version: null,
    title: 'Quantum Materials',
    authors: ['Ada Lovelace'],
    sourceUrl: 'https://example.org/paper.pdf',
    pdfSha256: null,
    pageCount: null,
    extractionVersion: null,
    status: 'fetching',
    coverage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}
function block(key: string): Block {
  return {
    blockId: 'block1',
    paperKey: key,
    order: 0,
    kind: 'paragraph',
    sourceText: 'A remarkable graphene result',
    sourceHash: hash('A remarkable graphene result'),
    regions: [{ page: 1, x: 0.1, y: 0.2, width: 0.5, height: 0.1 }],
    alignment: 'exact',
    translatable: true,
    fontFamily: 'serif',
    fontWeight: 'normal',
    fontSize: 0.12,
    pageOrdinal: 0,
  };
}
function pdf(title = 'An Interesting PDF'): Buffer {
  const stream = `BT /F1 24 Tf 50 740 Td (${title}) Tj ET`;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
    `<< /Title (${title}) /Subject (doi:10.1234/example) >>`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(output));
    output += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const n of offsets.slice(1)) output += `${String(n).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}
function request(data?: unknown, headers: Record<string, string> = {}, url = '/'): IncomingMessage {
  const bytes = data === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(data));
  const stream = Readable.from([bytes]) as IncomingMessage;
  stream.headers = headers;
  stream.url = url;
  return stream;
}
const metadataFetch = (async (url: string) =>
  Response.json(
    url.includes('crossref') ? { message: { title: ['An Interesting PDF'], author: [], published: { 'date-parts': [[2024]] } } } : { best_oa_location: null },
  )) as typeof fetch;
async function mappedError(run: () => Promise<unknown>) {
  try {
    await run();
    throw new Error('expected route to reject');
  } catch (error) {
    return toHttp(error);
  }
}
describe('SQLite library', () => {
  it('keeps bibliography and Markdown export snapshots stable', () => {
    const store = new SqlitePaperStore(root());
    const p = paper();
    store.savePaper(p);
    store.patchLibrary(p.paperKey, { doi: '10.1234/example', year: 2024, bibtexKey: 'lovelace2024' });
    const record = store.getLibrary(p.paperKey)!;
    expect(bibtex([record])).toMatchInlineSnapshot(`
      "@article{lovelace2024,
        title = {Quantum Materials},
        author = {Lovelace, Ada},
        year = {2024},
        doi = {10.1234/example},
        url = {https://example.org/paper.pdf},
      }
      "
    `);
    expect(JSON.stringify(cslJson([record]))).toMatchInlineSnapshot(
      `"[{"id":"lovelace2024","type":"article-journal","title":"Quantum Materials","author":[{"given":"Ada","family":"Lovelace"}],"issued":{"date-parts":[[2024]]},"container-title":null,"DOI":"10.1234/example","URL":"https://example.org/paper.pdf","abstract":null}]"`,
    );
    expect(markdown(record, [], [{ page: 2, text: 'A quoted result', note: 'My note' }], ['AI summary'])).toMatchInlineSnapshot(`
      "---
      citekey: "lovelace2024"
      title: "Quantum Materials"
      doi: "10.1234/example"
      ---

      # Quantum Materials

      > A quoted result
      > — p. 2

      My note

      ## AI notes

      AI summary
      "
    `);
    store.db.close();
  });
  it('imports a PaperRead fixture without changing the source and migrates once', () => {
    const r = root(),
      old = join(r, 'PaperRead'),
      next = join(r, 'Fractal'),
      p = paper(),
      id = randomUUID();
    mkdirSync(join(old, p.paperKey), { recursive: true });
    writeRecord(join(old, p.paperKey, 'paper.json'), p);
    writeRecord(join(old, p.paperKey, 'blocks.json'), [block(p.paperKey)]);
    writeRecord(join(old, p.paperKey, 'highlights.json'), [
      {
        highlightId: id,
        paperKey: p.paperKey,
        page: 1,
        rects: [{ page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.1 }],
        text: 'Quote',
        color: 'yellow',
        note: null,
        createdAt: p.createdAt,
        updatedAt: p.createdAt,
      },
    ]);
    const store = new SqlitePaperStore(next, old);
    expect(store.getPaper(p.paperKey)?.title).toBe(p.title);
    expect(store.listBlocks(p.paperKey)).toHaveLength(1);
    expect(store.listAnnotations(p.paperKey)[0]).toMatchObject({ id, kind: 'highlight' });
    expect(store.db.prepare('SELECT count(*) n FROM migrations').get()).toMatchObject({ n: 13 });
    store.db.close();
    const again = new SqlitePaperStore(next, old);
    expect(again.listPapers()).toHaveLength(1);
    expect(searchLibrary('graphene', { store: again })[0]).toMatchObject({ paperKey: p.paperKey, page: 1, blockId: 'block1' });
    expect(searchLibrary('quantum', { store: again })[0]?.paperKey).toBe(p.paperKey);
    again.db.close();
  });
  it('uses DOI and Unpaywall metadata with injected fetch', async () => {
    const calls: string[] = [];
    const fetcher = (async (input: string) => {
      calls.push(input);
      return Response.json(
        input.includes('crossref')
          ? {
              message: {
                title: ['Paper Title'],
                author: [{ given: 'Ada', family: 'Lovelace' }],
                published: { 'date-parts': [[2024]] },
                'container-title': ['Journal'],
                URL: 'https://doi.org/10.1234/example',
              },
            }
          : { best_oa_location: { url_for_pdf: 'https://example.org/free.pdf' } },
      );
    }) as typeof fetch;
    expect(await resolveDoi('10.1234/example', fetcher, 'user@example.org')).toMatchObject({
      doi: '10.1234/example',
      pdfUrl: 'https://example.org/free.pdf',
      year: 2024,
    });
    expect(calls).toHaveLength(2);
    const failing = (async (url: string) => (url.includes('unpaywall') ? new Response(null, { status: 503 }) : metadataFetch(url))) as typeof fetch;
    expect(await mappedError(() => resolveDoi('10.1234/example', failing, 'user@example.org'))).toMatchObject({
      status: 502,
      error: { code: 'NETWORK', retryable: true },
    });
  });
  it('extracts PDF title and DOI and deduplicates identical upload', async () => {
    const bytes = pdf();
    expect(await metadataFromPdf(bytes)).toMatchObject({ title: 'An Interesting PDF', doi: '10.1234/example' });
    const store = new SqlitePaperStore(root());
    const first = await ingestPdf(store, bytes, 'upload://first', metadataFetch);
    const second = await ingestPdf(store, bytes, 'upload://second', metadataFetch);
    expect(second.paperKey).toBe(first.paperKey);
    expect(store.listPapers()).toHaveLength(1);
    expect(store.getPdf(first.paperKey)).toEqual(bytes);
    expect(store.getLibrary(first.paperKey)).toMatchObject({ saved: false, savedAt: null, lastReadAt: null });
    store.db.close();
  });
  it('deduplicates URL and upload by PDF hash', async () => {
    const bytes = pdf('A Different PDF'),
      store = new SqlitePaperStore(root());
    const uploaded = await ingestPdf(store, bytes, 'upload://first', metadataFetch);
    const candidate = paper(`pdf-${hash('remote')}-${hash('other')}`);
    candidate.pdfSha256 = hash(bytes.toString('binary'));
    const acquirer = {
      resolve: async () => candidate,
      acquire: async () => ({ paper: candidate, blocks: [], pdf: bytes }),
      reextract: async () => ({ paper: candidate, blocks: [] }),
    };
    const opened = await ingestUrl(store, 'https://example.org/paper.pdf', acquirer, metadataFetch);
    expect(opened.paperKey).toBe(uploaded.paperKey);
    expect(store.listPapers()).toHaveLength(1);
    store.db.close();
  });
  it('acquires a PDF for a metadata-only DOI match while preserving saved state and memberships', async () => {
    const store = new SqlitePaperStore(root());
    const bytes = pdf();
    try {
      const first = await ingestPdf(store, bytes, 'upload://first', metadataFetch);
      const record = store.getLibrary(first.paperKey)!;
      store.deletePaper(first.paperKey);
      store.putFolder({ id: 'metadata-folder', name: 'Metadata' });
      store.publishMetadata({ ...record, saved: true, collections: ['metadata-folder'], tags: ['kept'] });
      expect(store.getPaper(first.paperKey)).toBeNull();
      const acquired = await ingestPdf(store, bytes, 'upload://another-source', metadataFetch);
      expect(acquired.paperKey).toBe(first.paperKey);
      expect(store.getPdf(first.paperKey)).toEqual(bytes);
      expect(store.getLibrary(first.paperKey)).toMatchObject({ saved: true, tags: ['kept'], collections: ['metadata-folder'] });
    } finally {
      store.db.close();
    }
  });
  it('does not return null for an arXiv metadata-only duplicate during URL acquisition', async () => {
    const store = new SqlitePaperStore(root());
    try {
      const templatePaper = paper();
      store.savePaper(templatePaper);
      const template = store.getLibrary(templatePaper.paperKey)!;
      const candidate: Paper = {
        ...templatePaper,
        paperKey: '2501.00001v1',
        sourceKind: 'arxiv',
        arxivId: '2501.00001',
        version: 1,
        sourceUrl: 'https://arxiv.org/pdf/2501.00001v1',
      };
      store.publishMetadata({
        ...template,
        id: randomUUID(),
        paperKey: candidate.paperKey,
        arxivId: candidate.arxivId,
        bibtexKey: 'metadata-arxiv',
        saved: true,
      });
      const acquired = await ingestUrl(
        store,
        candidate.sourceUrl,
        {
          resolve: async () => candidate,
          acquire: async () => ({ paper: candidate, blocks: [], pdf: Buffer.from('pdf') }),
          reextract: async () => ({ paper: candidate, blocks: [] }),
        },
        metadataFetch,
      );
      expect(acquired.paperKey).toBe(candidate.paperKey);
      expect(store.getLibrary(candidate.paperKey)?.saved).toBe(true);
    } finally {
      store.db.close();
    }
  });
  it('rejects a catalog-to-reader identity mismatch before creating an unrelated duplicate', async () => {
    const store = new SqlitePaperStore(root());
    vi.stubEnv('FRACTAL_CONTACT_EMAIL', 'test@example.org');
    try {
      const templatePaper = paper();
      store.savePaper(templatePaper);
      const template = store.getLibrary(templatePaper.paperKey)!;
      const catalog = store.publishMetadata({
        ...template,
        id: randomUUID(),
        paperKey: 'catalog-only',
        doi: '10.1234/catalog',
        bibtexKey: 'catalog',
        saved: true,
        tags: ['kept'],
      });
      const candidate = paper(`pdf-${hash('different-url')}-${hash('different-pdf')}`);
      const fetcher = (async (url: string) =>
        Response.json(
          url.includes('crossref') ? { message: { title: ['Catalog'], author: [] } } : { best_oa_location: { url_for_pdf: candidate.sourceUrl } },
        )) as typeof fetch;
      const acquirer = {
        resolve: async () => candidate,
        acquire: async () => ({ paper: candidate, blocks: [], pdf: Buffer.from('pdf') }),
        reextract: async () => ({ paper: candidate, blocks: [] }),
      };
      await expect(ingestUrl(store, 'doi:10.1234/catalog', acquirer, fetcher)).rejects.toThrow('linked');
      expect(store.getPaper(candidate.paperKey)).toBeNull();
      expect(store.listPapers()).toEqual([templatePaper.paperKey]);
      expect(store.getLibrary(catalog.paperKey)).toEqual(catalog);
    } finally {
      vi.unstubAllEnvs();
      store.db.close();
    }
  });
  it('exports bibliography and annotations and applies sync LWW and tombstones', () => {
    const store = new SqlitePaperStore(root()),
      p = paper();
    store.savePaper(p);
    store.patchLibrary(p.paperKey, { doi: '10.1234/example', year: 2024, bibtexKey: 'lovelace2024' });
    const record = store.getLibrary(p.paperKey)!;
    expect(bibtex([record])).toContain('@article{lovelace2024,');
    expect(cslJson([record])).toMatchObject([{ DOI: '10.1234/example' }]);
    const id = randomUUID();
    const annotation: Annotation = {
      kind: 'memo',
      id,
      paperKey: p.paperKey,
      page: 1,
      text: 'My note',
      rect: null,
      quote: 'a quote',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deleted: false,
      rev: 0,
      deviceId: 'a',
    };
    expect(store.upsertAnnotation(annotation).applied).toBe(true);
    expect(store.upsertAnnotation({ ...annotation, updatedAt: '2025-01-01T00:00:00.000Z' }).applied).toBe(false);
    expect(store.upsertAnnotation({ ...annotation, updatedAt: '2026-01-02T00:00:00.000Z', deleted: true }).applied).toBe(true);
    expect(store.upsertAnnotation(annotation).applied).toBe(false);
    expect(store.pull(0).annotations).toMatchObject([{ id, deleted: true }]);
    expect(markdown(record, [annotation], [], ['AI summary'])).toContain('## Memo · p. 1');
    expect(markdown(record, [annotation], [], ['AI summary'])).toContain('## AI notes');
    store.db.close();
  });
  it('serves route-level sync and ranged PDF responses', async () => {
    const store = new SqlitePaperStore(root()),
      p = paper(),
      bytes = pdf('Range Check');
    store.savePaper(p, bytes);
    const ctx = {
      store,
      acquirer: { resolve: async () => p, acquire: async () => ({ paper: p, blocks: [], pdf: bytes }), reextract: async () => ({ paper: p, blocks: [] }) },
    };
    const pull = await handleSync('GET', ['api', 'sync', 'pull'], request(undefined, {}, '/api/sync/pull?since=0'), ctx);
    expect(pull).toMatchObject({ kind: 'json', data: { papers: [{ paperKey: p.paperKey }] } });
    const id = randomUUID();
    const memo: Annotation = {
      kind: 'memo',
      id,
      paperKey: p.paperKey,
      page: 1,
      text: 'Route note',
      rect: null,
      quote: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
      deleted: false,
      rev: 0,
      deviceId: 'mobile',
    };
    const pushed = await handleSync('POST', ['api', 'sync', 'push'], request({ annotations: [memo] }), ctx);
    expect(pushed).toMatchObject({ kind: 'json', data: { results: [{ id, applied: true }] } });
    const ranged = await handleLibrary('GET', ['api', 'papers', p.paperKey, 'pdf'], request(undefined, { range: 'bytes=0-9' }), ctx);
    expect(ranged).toMatchObject({ kind: 'bytes', status: 206, headers: { 'content-range': `bytes 0-9/${bytes.length}` } });
    if (ranged?.kind === 'bytes') expect(ranged.body).toEqual(bytes.subarray(0, 10));
    expect(await handleLibrary('GET', ['api', 'papers', p.paperKey, 'pdf'], request(undefined, { range: 'bytes=999999-' }), ctx)).toMatchObject({
      kind: 'bytes',
      status: 416,
    });
    const etag = ranged?.kind === 'bytes' ? ranged.headers?.etag : undefined;
    expect(etag).toBeTruthy();
    const matching = await handleLibrary('GET', ['api', 'papers', p.paperKey, 'pdf'], request(undefined, { range: 'bytes=0-9', 'if-range': etag! }), ctx);
    expect(matching).toMatchObject({ kind: 'bytes', status: 206 });
    const stale = await handleLibrary('GET', ['api', 'papers', p.paperKey, 'pdf'], request(undefined, { range: 'bytes=0-9', 'if-range': '"old-pdf"' }), ctx);
    expect(stale).toMatchObject({ kind: 'bytes', status: 200 });
    if (stale?.kind === 'bytes') expect(stale.body).toEqual(bytes);
    store.db.close();
  });
  it('preserves Android brush, shape, and tilt through annotations and sync pull', async () => {
    const store = new SqlitePaperStore(root());
    const savedPaper = paper();
    store.savePaper(savedPaper);
    const ctx = {
      store,
      acquirer: {
        resolve: async () => savedPaper,
        acquire: async () => ({ paper: savedPaper, blocks: [], pdf: Buffer.alloc(0) }),
        reextract: async () => ({ paper: savedPaper, blocks: [] }),
      },
    };
    const stroke = {
      kind: 'ink',
      id: randomUUID(),
      paperKey: savedPaper.paperKey,
      page: 1,
      tool: 'pen',
      brush: 'shape',
      shape: { type: 'rectangle', snapped: true },
      color: '#123456',
      width: 0.004,
      points: [
        [0.1, 0.2, 0.5, 0],
        [0.3, 0.4, 0.7, 10],
      ],
      tilt: [0.2, 0.4],
      updatedAt: '2026-01-01T00:00:00.000Z',
      deleted: false,
      rev: 0,
      deviceId: 'android',
    };
    const path = ['api', 'papers', savedPaper.paperKey, 'annotations'];
    expect(await handleAnnotations('POST', path, request(stroke), ctx)).toMatchObject({ kind: 'json', status: 201 });
    const annotations = await handleAnnotations('GET', path, request(), ctx);
    expect(annotations).toMatchObject({ kind: 'json', data: [{ brush: 'shape', shape: stroke.shape, tilt: stroke.tilt }] });
    const pull = await handleSync('GET', ['api', 'sync', 'pull'], request(undefined, {}, '/api/sync/pull?since=0'), ctx);
    expect(pull).toMatchObject({ kind: 'json', data: { annotations: [{ brush: 'shape', shape: stroke.shape, tilt: stroke.tilt }] } });
    store.db.close();
  });
  it('maps rejected route inputs to Korean 4xx and upstream failures to 502', async () => {
    const store = new SqlitePaperStore(root()),
      p = paper();
    store.savePaper(p);
    const acquirer = {
      resolve: async () => p,
      acquire: async () => ({ paper: p, blocks: [], pdf: Buffer.alloc(0) }),
      reextract: async () => ({ paper: p, blocks: [] }),
    };
    const ctx = { store, acquirer, fetcher: metadataFetch };
    const server = createServer((req, res) => {
      void (async () => {
        try {
          const path = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
          const result = (await handleLibrary(req.method ?? 'GET', path, req, ctx)) ?? (await handleSync(req.method ?? 'GET', path, req, ctx));
          if (!result) {
            res.writeHead(404);
            res.end();
            return;
          }
          res.writeHead(result.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(result.kind === 'json' ? { data: result.data } : { data: null }));
        } catch (cause) {
          const { status, error } = toHttp(cause);
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error }));
        }
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (path: string, data: unknown, type = 'application/json') =>
      fetch(base + path, { method: 'POST', headers: { 'content-type': type }, body: type === 'application/json' ? JSON.stringify(data) : String(data) });
    try {
      const badDoi = await post('/api/papers/open', { input: 'doi:broken' });
      expect(badDoi.status).toBe(400);
      expect(await badDoi.json()).toMatchObject({ error: { code: 'INVALID_INPUT', message: 'DOI 형식이 올바르지 않습니다.' } });
      const noPdf = await post('/api/papers/open', { input: 'doi:10.1234/example' });
      expect(noPdf.status).toBe(400);
      expect(((await noPdf.json()) as { error: { message: string } }).error.message).toContain('PDF 파일을 직접 올려 주세요');
      const wrongType = await post('/api/papers/upload', 'plain text', 'text/plain');
      expect(wrongType.status).toBe(415);
      expect(((await wrongType.json()) as { error: { message: string } }).error.message).toContain('PDF 파일만');
      const badCursor = await fetch(base + '/api/sync/pull?since=-1');
      expect(badCursor.status).toBe(400);
      expect(((await badCursor.json()) as { error: { message: string } }).error.message).toContain('커서');
      const badPush = await post('/api/sync/push', { annotations: 'wrong' });
      expect(badPush.status).toBe(400);
      expect(((await badPush.json()) as { error: { message: string } }).error.message).toBe('요청 형식이 올바르지 않습니다.');
      ctx.fetcher = (async () => ({ ok: false, status: 503 }) as Response) as typeof fetch;
      const failedCrossref = await post('/api/papers/open', { input: 'doi:10.1234/example' });
      expect(failedCrossref.status).toBe(502);
      expect(await failedCrossref.json()).toMatchObject({ error: { code: 'NETWORK', retryable: true } });
      const oversized = await mappedError(() =>
        handleLibrary(
          'POST',
          ['api', 'papers', 'upload'],
          request(undefined, { 'content-type': 'application/pdf', 'content-length': String(100 * 1024 * 1024 + 1) }),
          ctx,
        ),
      );
      expect(oversized).toMatchObject({ status: 413, error: { code: 'TOO_LARGE', message: '100MB보다 큰 PDF는 올릴 수 없습니다.' } });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.db.close();
    }
  });
  it('rolls back annotation, highlight mirror, and change log together', () => {
    const store = new SqlitePaperStore(root()),
      p = paper();
    store.savePaper(p);
    const id = randomUUID(),
      annotation: Annotation = {
        kind: 'highlight',
        id,
        paperKey: p.paperKey,
        page: 1,
        text: 'Atomic quote',
        color: 'yellow',
        rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }],
        note: null,
        updatedAt: '2026-01-01T00:00:00.000Z',
        deleted: false,
        rev: 0,
        deviceId: 'mobile',
      };
    const before = store.pull(0).cursor;
    store.db.exec("CREATE TEMP TRIGGER reject_change BEFORE INSERT ON changes BEGIN SELECT RAISE(FAIL, 'change failed'); END");
    expect(() => store.upsertAnnotation(annotation)).toThrow();
    expect(store.getAnnotation(id)).toBeNull();
    expect(store.getHighlight(p.paperKey, id)).toBeNull();
    expect(store.pull(0).cursor).toBe(before);
    store.db.exec('DROP TRIGGER reject_change');
    store.db.close();
  });
});
