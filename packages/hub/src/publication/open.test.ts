import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SqlitePaperStore } from '../store/sqlite';
import { createApiServer, TOKEN_HEADER, type ApiServer } from '../api/index';
import { JobManager } from '../jobs/state';
import { TranslationPipeline } from '../translation/index';
import { bookmark, linkPdf, publicationCatalog } from '../scholarly/bookmarks';
import { openAlexMetadata, unknownPublication } from '../scholarly/metadata';
import { resolveDoi, ingestUrl } from '../ingest/index';
import { type PublicationAcquisitionOptions } from './open';

const bytes = readFileSync(new URL('../../test/fixtures/text-layout.pdf', import.meta.url));
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const input = { title: 'Acquisition test', authors: ['Ada Lovelace'], url: 'https://publisher.example/paper' };
const roots: string[] = [],
  stores: SqlitePaperStore[] = [],
  servers: ApiServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const store of stores.splice(0)) store.db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
type Reply = { status?: number; type?: string; body?: Buffer | string; headers?: Record<string, string> };
function identifiedPdf(subject: string): Buffer {
  const stream = 'BT /F1 12 Tf 40 700 Td (Own identifier conflict) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Subject (${subject}) >>`,
  ];
  let output = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((value, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${value}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 7\n0000000000 65535 f \n${offsets.map((v) => `${String(v).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}
async function application(respond: (url: URL, signal: AbortSignal, init?: RequestInit) => Reply | Promise<Reply>, extra: PublicationAcquisitionOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'fractal-acquisition-'));
  roots.push(root);
  const store = new SqlitePaperStore(root);
  stores.push(store);
  const urls: string[] = [];
  const network: PublicationAcquisitionOptions = {
    providerIntervalMs: 0,
    providerFetch: (async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      urls.push(url.href);
      const reply = await respond(url, init?.signal as AbortSignal, init);
      return new Response(Buffer.isBuffer(reply.body) ? new Uint8Array(reply.body) : (reply.body ?? null), {
        status: reply.status ?? 200,
        headers: { 'content-type': reply.type ?? 'application/json', ...reply.headers },
      });
    }) as typeof fetch,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (url, _, signal) => {
      urls.push(url.href);
      const reply = await respond(url, signal);
      return {
        status: reply.status ?? 200,
        headers: { 'content-type': reply.type ?? 'application/pdf', ...reply.headers },
        body: (async function* () {
          if (reply.body) yield Buffer.from(reply.body);
        })(),
      };
    },
    ...extra,
  };
  const jobs = new JobManager(store);
  const translator = {
    connection: async () => ({ status: 'subscription', modelIds: [], defaultModelId: null, limits: null }),
    translate: async () => {
      throw new Error('Unused translator');
    },
  } as any;
  const server = createApiServer({
    store,
    jobs,
    translator,
    pipeline: new TranslationPipeline({ store, jobs, translator }),
    acquirer: {} as any,
    paperChat: {} as any,
    publicationNetwork: network,
  });
  servers.push(server);
  const address = await server.listen(0),
    base = `http://127.0.0.1:${address.port}`;
  const post = async (value: unknown = input, route = '/api/publications/open'): Promise<{ status: number; data?: any; error?: any }> => {
    const response = await fetch(base + route, {
      method: 'POST',
      headers: { [TOKEN_HEADER]: server.token, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
    return { status: response.status, ...((await response.json()) as Record<string, any>) };
  };
  return { store, urls, post, base, token: server.token };
}

describe('publication acquisition over authenticated application HTTP', () => {
  it.each(['open', 'link'])(
    'refuses altered cached bytes via %s HTTP without replacing bytes or changing user metadata; restored cache succeeds',
    async (route) => {
      const { store, urls, post, base, token } = await application(() => ({ body: bytes }));
      const opened = await post();
      const key = opened.data.paperKey;
      store.putFolder({ id: 'kept-folder', name: 'Kept folder', parentId: null });
      store.putFolder({ id: 'kept-child', name: 'Kept child', parentId: 'kept-folder' });
      store.patchLibrary(key, {
        saved: true,
        tags: ['kept-tag'],
        collections: ['kept-child'],
        lastReadAt: '2026-09-01T00:00:00.000Z',
        readProgress: { page: 1, fraction: 0.25 },
      });
      const now = new Date().toISOString();
      store.putHistory({
        id: 'kept-history',
        paperKey: key,
        kind: 'question',
        question: 'Kept question',
        text: 'Kept answer',
        status: 'completed',
        createdAt: now,
        updatedAt: now,
        completedAt: now,
        requestId: null,
        context: {},
        answer: null,
        error: null,
        rev: 1,
        deviceId: 'hub',
        deleted: false,
      });
      const before = store.getLibrary(key),
        paper = store.getPaper(key),
        history = store.listHistory(key),
        folders = store.listFolders(),
        library = store.listLibrary();
      expect(await post()).toMatchObject({ status: 200, data: { paperKey: key, hasPdf: true, paper: { pdfSha256: sha(bytes) } } });
      const path = join(store.root, 'pdfs', `${sha(bytes)}.pdf`),
        altered = Buffer.concat([bytes, Buffer.from('\n% altered local cache\n')]);
      writeFileSync(path, altered);
      for (const headers of [{}, { range: 'bytes=0-31' }, { 'if-none-match': `"${sha(altered)}"` }] as Record<string, string>[]) {
        const served = await fetch(`${base}/api/papers/${key}/pdf`, { headers });
        expect(served.status).toBe(409);
        expect(served.headers.get('content-type')).toContain('application/json');
        const failure = await served.json();
        expect(failure).toMatchObject({ error: { code: 'SOURCE_CHANGED', retryable: false } });
        expect(failure.error.message).toContain('캐시 파일은 교체되지 않았습니다');
        expect(failure.data).toBeUndefined();
        expect(failure.error.message).not.toMatch(/\.pdf|stack|<html>|\\/);
      }
      const link =
        route === 'link'
          ? await fetch(`${base}/api/library/${key}/pdf`, {
              method: 'POST',
              headers: { [TOKEN_HEADER]: token, origin: base, 'content-type': 'application/pdf' },
              body: new Uint8Array(bytes),
            })
          : null;
      const rejected = link ? { status: link.status, ...(await link.json()) } : await post();
      expect(rejected).toMatchObject({ status: 409, error: { code: 'SOURCE_CHANGED', retryable: false } });
      expect(rejected.error.message).toContain('캐시 파일은 교체되지 않았습니다');
      expect(rejected.data).toBeUndefined();
      expect(store.getPdf(key)).toEqual(altered);
      expect(store.getLibrary(key)).toEqual(before);
      expect(store.getPaper(key)).toEqual(paper);
      expect(store.listHistory(key)).toEqual(history);
      expect(store.listFolders()).toEqual(folders);
      expect(store.listLibrary()).toEqual(library);
      expect(urls).toHaveLength(1);
      writeFileSync(path, bytes);
      const full = await fetch(`${base}/api/papers/${key}/pdf`);
      expect(full.status).toBe(200);
      expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
      expect(full.headers.get('etag')).toBe(`"${sha(bytes)}"`);
      const partial = await fetch(`${base}/api/papers/${key}/pdf`, { headers: { range: 'bytes=0-31', 'if-range': `"${sha(bytes)}"` } });
      expect(partial.status).toBe(206);
      expect(partial.headers.get('content-range')).toBe(`bytes 0-31/${bytes.length}`);
      expect(Buffer.from(await partial.arrayBuffer())).toEqual(bytes.subarray(0, 32));
      const unchanged = await fetch(`${base}/api/papers/${key}/pdf`, { headers: { 'if-none-match': `"${sha(bytes)}"` } });
      expect(unchanged.status).toBe(304);
      expect(await unchanged.text()).toBe('');
      expect(await post()).toMatchObject({ status: 200, data: { paperKey: key, hasPdf: true, paper: { pdfSha256: sha(bytes) } } });
      expect(store.getPdf(key)).toEqual(bytes);
      expect(store.getLibrary(key)).toEqual(before);
      expect(store.listHistory(key)).toEqual(history);
      expect(urls).toHaveLength(1);
      // Preserve legacy byte-serving when no canonical Paper exists.
      const legacyPaper = vi.spyOn(store, 'getPaper').mockReturnValue(null);
      const legacyPdf = await fetch(`${base}/api/papers/${key}/pdf`);
      expect(legacyPdf.status).toBe(200);
      expect(Buffer.from(await legacyPdf.arrayBuffer())).toEqual(bytes);
      legacyPaper.mockRestore();
    },
  );
  it.each(['en', 'ko'] as const)('returns specific bounded acquisition causes in %s while unrelated validation stays generic', async (language) => {
    const cases = [
      {
        code: 'INVALID_INPUT',
        reply: { type: 'text/html', body: '<html><form>Sign in: password private-secret</form></html>' },
        expected: { en: 'one main PDF', ko: '논문 PDF를 하나로 확인' },
      },
      { code: 'AUTH_REQUIRED', reply: { status: 403, body: 'private-secret' }, expected: { en: 'source requires authorization', ko: '접근 권한이 필요' } },
      { code: 'NOT_FOUND', reply: { status: 404, body: 'private-secret' }, expected: { en: 'No publicly downloadable PDF', ko: '공개 다운로드 가능한 PDF' } },
      { code: 'NETWORK', reply: { status: 503, body: '<html>private-secret</html>' }, expected: { en: 'rejected the download', ko: '다운로드가 거부' } },
    ];
    for (const item of cases) {
      const { store, post } = await application(() => item.reply);
      store.putPreferences({ ...store.getPreferences(), uiLanguage: language });
      const result = await post();
      expect(result.error.code).toBe(item.code);
      expect(result.error.message).toContain(item.expected[language]);
      expect(result.error.message.length).toBeLessThan(240);
      expect(result.error.message).not.toMatch(/private-secret|<html>|password|stack/);
      expect(result.error).not.toHaveProperty('reason');
      const generic = await post({ title: '' });
      expect(generic.error.message).toBe(language === 'en' ? 'Invalid request.' : '요청 형식이 올바르지 않습니다.');
    }
    const login = await application((url) =>
      url.pathname === '/paper'
        ? { type: 'text/html', body: '<meta name="citation_pdf_url" content="/pdf">' }
        : { type: 'text/html', body: '<html>Sign in private-secret</html>' },
    );
    login.store.putPreferences({ ...login.store.getPreferences(), uiLanguage: language });
    const result = await login.post();
    expect(result.error.code).toBe('UNSUPPORTED_PDF');
    expect(result.error.message).toContain(language === 'en' ? 'sign-in page' : '로그인 페이지');
    expect(result.error.message).not.toContain('private-secret');
  });
  it('coalesces identical opens, stores real PDF bytes under stable unsaved catalog identity and records Recent only on read', async () => {
    const { store, urls, post, base } = await application(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { body: bytes };
    });
    const results = await Promise.all([post(), post(), post()]);
    for (const result of results)
      expect(result).toMatchObject({
        status: 200,
        data: { hasPdf: true, record: { saved: false, status: 'unread', lastReadAt: null }, paper: { pdfSha256: sha(bytes) } },
      });
    const key = results[0]!.data.paperKey;
    expect(results.every((r) => r.data.paperKey === key)).toBe(true);
    expect(urls).toHaveLength(1);
    expect(store.listLibrary()).toHaveLength(1);
    expect(store.listPapers()).toHaveLength(1);
    expect(store.getPdf(key)).toEqual(bytes);
    expect(store.listBlocks(key).length).toBeGreaterThan(0);
    const pdf = await fetch(`${base}/api/papers/${key}/pdf`);
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer())).toEqual(bytes);
    expect((await post()).data.paperKey).toBe(key);
    expect(urls).toHaveLength(1);
    expect((await post({}, `/api/papers/${key}/read`)).data.lastReadAt).toEqual(expect.any(String));
    expect(bookmark(store, input).record.saved).toBe(true);
  });
  it.each([false, true])('preserves saved=%s, nested folders, tags, read history and stable legacy key', async (saved) => {
    const { store, post } = await application(() => ({ body: bytes }));
    const initial = publicationCatalog(store, input).record;
    store.db.prepare('DELETE FROM bibliography WHERE paper_key=?').run(initial.paperKey);
    store.publishMetadata({ ...initial, id: 'legacy.catalog', paperKey: 'legacy.catalog', saved });
    store.putFolder({ id: 'parent', name: 'Parent', parentId: null });
    store.putFolder({ id: 'child', name: 'Child', parentId: 'parent' });
    const old = store.patchLibrary('legacy.catalog', { tags: ['kept'], collections: ['child'], status: 'reading', lastReadAt: '2026-09-01T00:00:00.000Z' });
    const result = await post();
    expect(result).toMatchObject({
      status: 200,
      data: {
        paperKey: 'legacy.catalog',
        hasPdf: true,
        record: {
          saved,
          tags: old.tags,
          collections: old.collections,
          status: old.status,
          lastReadAt: old.lastReadAt,
          savedAt: old.savedAt,
          addedAt: old.addedAt,
        },
      },
    });
    expect(store.getFolder('child')?.parentId).toBe('parent');
  });
  it.each([
    ['citation direct', '<meta name="citation_pdf_url" content="https://publisher.example/main.pdf">', 'https://publisher.example/main.pdf'],
    [
      'relative entity endpoint',
      '<meta content="../download?id=1&amp;format=pdf" name="citation_pdf_url">',
      'https://publisher.example/download?id=1&format=pdf',
    ],
    ['alternate PDF', '<link rel="alternate" type="application/pdf" href="/content/123">', 'https://publisher.example/content/123'],
    [
      'main anchor without extension',
      '<a href="/download/123">Download PDF</a><a href="/supporting.pdf">Supporting information</a>',
      'https://publisher.example/download/123',
    ],
  ])('acquires passive HTML %s', async (_, html, target) => {
    const { urls, post } = await application((url) => (url.href === input.url ? { type: 'text/html', body: html } : { body: bytes }));
    expect(await post()).toMatchObject({ status: 200, data: { hasPdf: true, record: { saved: false } } });
    expect(urls).toEqual([input.url, target]);
  });
  it.each([
    '<a href="/one.pdf">PDF</a><a href="/two.pdf">PDF</a>',
    '<meta name="citation_pdf_url" content="/supplement.pdf"><a href="/supplement.pdf">Supplement PDF</a>',
    '<a href="/download">Download</a><a href="/article">Acquisition test</a>',
    '<!-- <meta name="citation_pdf_url" content="/hidden.pdf"> --><script><a href="/script.pdf">PDF</a></script>',
  ])('rejects ambiguous, supplementary or ungrounded discovery without saving or reading', async (html) => {
    const { store, urls, post } = await application(() => ({ type: 'text/html', body: html }));
    expect(await post()).toMatchObject({ status: 400, error: { code: 'INVALID_INPUT', retryable: false } });
    expect(urls).toEqual([input.url]);
    expect(store.listPapers()).toEqual([]);
    expect(store.listLibrary()[0]).toMatchObject({ saved: false, status: 'unread', lastReadAt: null });
  });
  it('uses Crossref reported PDF with no email and leaves OA availability unknown', async () => {
    vi.stubEnv('FRACTAL_CONTACT_EMAIL', '');
    const { post, urls } = await application((url) =>
      url.hostname === 'api.crossref.org'
        ? {
            type: 'application/json',
            body: JSON.stringify({
              message: { DOI: '10.1234/paper', link: [{ URL: 'https://publisher.example/tdm', 'content-type': 'application/pdf', 'content-version': 'vor' }] },
            }),
          }
        : { body: bytes },
    );
    expect(await post({ ...input, doi: '10.1234/paper', publication: unknownPublication() })).toMatchObject({
      status: 200,
      data: { record: { saved: false, publication: { oaAvailability: 'unknown' } }, hasPdf: true },
    });
    expect(urls).toHaveLength(2);
    expect(urls.some((url) => /unpaywall|email=/.test(url))).toBe(false);
  });
  it('finds an alternative OA location after best and primary lack a PDF and the first reported PDF fails', async () => {
    vi.stubEnv('FRACTAL_CONTACT_EMAIL', '');
    const work = {
      doi: 'https://doi.org/10.1234/paper',
      open_access: { is_oa: true },
      primary_location: { is_oa: true, pdf_url: null },
      best_oa_location: { is_oa: true, pdf_url: null },
      locations: [
        { is_oa: true, pdf_url: 'https://repository.example/first' },
        { is_oa: true, pdf_url: 'https://repository.example/second' },
      ],
    };
    expect(openAlexMetadata(work).oaPdfUrl).toBe('https://repository.example/first');
    const { post, urls } = await application((url) =>
      url.hostname === 'api.crossref.org'
        ? { type: 'application/json', body: '{"message":{}}' }
        : url.hostname === 'api.openalex.org'
          ? { type: 'application/json', body: JSON.stringify(work) }
          : url.pathname === '/second'
            ? { body: bytes }
            : { status: 404 },
    );
    expect(
      await post({ ...input, doi: '10.1234/paper', publication: { ...unknownPublication(), oaPdfUrl: 'https://repository.example/first' } }),
    ).toMatchObject({ status: 200, data: { hasPdf: true } });
    expect(urls.filter((url) => url.endsWith('/first'))).toHaveLength(1);
    expect(urls.at(-1)).toBe('https://repository.example/second');
  });
  it.each(['1706.03762v2', undefined])('uses canonical arXiv PDF and preserves version with arxivId=%s', async (arxivId) => {
    const { post, urls } = await application(() => ({ body: bytes }));
    expect(await post({ ...input, url: 'https://arxiv.org/abs/1706.03762v2', arxivId })).toMatchObject({ status: 200, data: { hasPdf: true } });
    expect(urls).toEqual(['https://arxiv.org/pdf/1706.03762v2']);
  });
  it.each([
    [401, 'AUTH_REQUIRED', 401],
    [403, 'AUTH_REQUIRED', 401],
    [404, 'NOT_FOUND', 404],
    [429, 'NETWORK', 502],
    [503, 'NETWORK', 502],
  ] as const)('keeps HTTP %s failure as %s', async (status, code, expectedStatus) => {
    const { post, store } = await application(() => ({ status }));
    expect(await post()).toMatchObject({ status: expectedStatus, error: { code, retryable: code === 'NETWORK' } });
    expect(store.listPapers()).toEqual([]);
  });
  it('refuses a PDF label returning login HTML or non-PDF bytes', async () => {
    const { post } = await application(() => ({ type: 'application/pdf', body: '<html>Sign in</html>' }));
    expect(await post()).toMatchObject({ status: 400, error: { code: 'UNSUPPORTED_PDF' } });
  });
  it('accepts a public redirect and refuses private redirects and unbounded loops', async () => {
    let mode = 'public';
    const { post, store, urls } = await application((url) =>
      url.pathname === '/main.pdf'
        ? { body: bytes }
        : { status: 302, headers: { location: mode === 'public' ? '/main.pdf' : mode === 'private' ? 'https://localhost/private' : '/paper' } },
    );
    expect(await post()).toMatchObject({ status: 200, data: { hasPdf: true } });
    mode = 'private';
    expect(await post({ ...input, title: 'Private redirect' })).toMatchObject({ status: 400, error: { code: 'INVALID_INPUT' } });
    mode = 'loop';
    const count = urls.length;
    expect(await post({ ...input, title: 'Redirect loop' })).toMatchObject({ status: 502, error: { code: 'NETWORK', retryable: true } });
    expect(urls.length - count).toBe(6);
    expect(store.listPapers()).toHaveLength(1);
  });
  it('enforces the total timeout even when the trusted request ignores abort', async () => {
    const { post, store } = await application(() => new Promise<Reply>(() => {}), { timeoutMs: 30 });
    const start = Date.now();
    expect(await post()).toMatchObject({ status: 502, error: { code: 'NETWORK', retryable: true } });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(store.listPapers()).toEqual([]);
  });
  it('enforces declared and streamed 50 MiB boundaries before extraction', async () => {
    const { post } = await application(() => ({ headers: { 'content-length': String(50 * 1024 * 1024 + 1) }, body: bytes }));
    expect(await post()).toMatchObject({ status: 400, error: { code: 'TOO_LARGE' } });
    const streamed = await application(() => ({ body: Buffer.alloc(50 * 1024 * 1024 + 1) }));
    expect(await streamed.post()).toMatchObject({ status: 400, error: { code: 'TOO_LARGE' } });
  });
  it('does not overwrite an existing revision or force saved true; linkPdf still rejects changed bytes', async () => {
    const { store, post, urls } = await application(() => ({ body: bytes }));
    const key = (await post()).data.paperKey;
    expect((await post({ ...input, publication: { ...unknownPublication(), oaPdfUrl: 'https://publisher.example/changed' } })).data.paperKey).toBe(key);
    expect(urls).toHaveLength(1);
    await expect(linkPdf(store, key, Buffer.concat([bytes, Buffer.from('\n%changed')]))).rejects.toMatchObject({ error: { code: 'SOURCE_CHANGED' } });
    expect(store.getPdf(key)).toEqual(bytes);
    expect(store.getLibrary(key)?.saved).toBe(false);
  });
  it('rejects publisher or provider identifier conflicts before fetching their PDF', async () => {
    const { post, urls } = await application((url) =>
      url.hostname === 'api.crossref.org'
        ? {
            type: 'application/json',
            body: '{"message":{"DOI":"10.1234/other","link":[{"URL":"https://publisher.example/wrong","content-type":"application/pdf"}]}}',
          }
        : { body: bytes },
    );
    expect(await post({ ...input, doi: '10.1234/target' })).toMatchObject({ status: 400, error: { code: 'INVALID_INPUT' } });
    expect(urls).toHaveLength(1);
    const html = await application(() => ({
      type: 'text/html',
      body: '<meta name="citation_doi" content="10.1234/other"><meta name="citation_pdf_url" content="/wrong">',
    }));
    expect(await html.post({ ...input, doi: '10.1234/target', publication: { ...unknownPublication(), oaPdfUrl: input.url } })).toMatchObject({
      status: 400,
      error: { code: 'INVALID_INPUT' },
    });
    expect(html.urls).toHaveLength(1);
  });
  it.each([
    ['doi:10.1234/other', { doi: '10.1234/target' }],
    ['arxiv:1706.03762', { arxivId: '1706.03763' }],
  ])('refuses conflicting own PDF metadata %s through the application route', async (subject, identifiers) => {
    const { post, store, urls } = await application(() => ({ body: identifiedPdf(subject as string) }));
    expect(
      await post({ ...input, ...(identifiers as object), publication: { ...unknownPublication(), oaPdfUrl: 'https://publisher.example/reported.pdf' } }),
    ).toMatchObject({ status: 400, error: { code: 'INVALID_INPUT', retryable: false } });
    expect(urls).toHaveLength(1);
    expect(store.listPapers()).toEqual([]);
    expect(store.listLibrary()[0]).toMatchObject({ saved: false, lastReadAt: null, status: 'unread' });
  });
  it('keeps the existing hash when a missing stored PDF can only be reacquired with changed bytes', async () => {
    let changed = false;
    const { store, post } = await application(() => ({ body: changed ? Buffer.concat([bytes, Buffer.from('\n%changed')]) : bytes }));
    const key = (await post()).data.paperKey;
    rmSync(join(store.root, 'pdfs', `${sha(bytes)}.pdf`));
    changed = true;
    expect(await post()).toMatchObject({ status: 409, error: { code: 'SOURCE_CHANGED', retryable: false } });
    expect(store.getPaper(key)?.pdfSha256).toBe(sha(bytes));
    expect(store.getPdf(key)).toBeNull();
    expect(store.getLibrary(key)).toMatchObject({ saved: false, lastReadAt: null, status: 'unread' });
  });
  it('caps candidate attempts and permits a later explicit retry after failure', async () => {
    vi.stubEnv('FRACTAL_CONTACT_EMAIL', '');
    let succeeds = false;
    const { post, urls } = await application((url) =>
      url.hostname === 'api.crossref.org'
        ? {
            type: 'application/json',
            body: JSON.stringify({
              message: {
                DOI: '10.1234/paper',
                link: Array.from({ length: 20 }, (_, i) => ({ URL: `https://publisher.example/pdf/${i}`, 'content-type': 'application/pdf' })),
              },
            }),
          }
        : url.hostname === 'api.openalex.org'
          ? { type: 'application/json', body: '{}' }
          : succeeds
            ? { body: bytes }
            : { status: 404 },
    );
    expect(await post({ ...input, doi: '10.1234/paper' })).toMatchObject({ status: 404, error: { code: 'NOT_FOUND' } });
    expect(urls.filter((url) => new URL(url).hostname === 'publisher.example')).toHaveLength(6);
    succeeds = true;
    expect(await post({ ...input, doi: '10.1234/paper' })).toMatchObject({ status: 200, data: { record: { saved: false }, hasPdf: true } });
  });
  it('uses configured provider authentication and shared cooldowns without forwarding credentials to publisher requests', async () => {
    vi.stubEnv('FRACTAL_CONTACT_EMAIL', '');
    vi.stubEnv('OPENALEX_API_KEY', 'configured-key');
    const calls: Array<{ url: string; headers: RequestInit['headers']; redirect: RequestInit['redirect'] }> = [];
    const { post, urls } = await application(
      (url, _, init) => {
        if (init) calls.push({ url: url.href, headers: init.headers, redirect: init.redirect });
        return url.hostname === 'api.crossref.org'
          ? { type: 'application/json', body: '{"message":{}}' }
          : url.hostname === 'api.openalex.org'
            ? { status: 429, headers: { 'retry-after': '60' } }
            : { status: 404 };
      },
      { providerIntervalMs: undefined },
    );
    expect(await post({ ...input, doi: '10.1234/quota-one' })).toMatchObject({ status: 429, error: { code: 'QUOTA', retryable: true } });
    expect(await post({ ...input, title: 'Other DOI', doi: '10.1234/quota-two' })).toMatchObject({ status: 429, error: { code: 'QUOTA', retryable: true } });
    expect(urls.filter((url) => new URL(url).hostname === 'api.openalex.org')).toHaveLength(1);
    expect(calls.find((call) => new URL(call.url).hostname === 'api.openalex.org')).toMatchObject({
      redirect: 'error',
      headers: { Authorization: 'Bearer configured-key' },
    });
    expect(
      calls.filter((call) => new URL(call.url).hostname !== 'api.openalex.org').every((call) => !(call.headers as Record<string, string>).Authorization),
    ).toBe(true);
    expect(urls.every((url) => !url.includes('configured-key'))).toBe(true);
  });
  it('allows a grounded publisher landing page to succeed despite unavailable optional DOI providers', async () => {
    vi.stubEnv('FRACTAL_CONTACT_EMAIL', '');
    const { post } = await application((url) =>
      url.hostname.startsWith('api.')
        ? { status: 503 }
        : url.pathname === '/paper'
          ? { type: 'text/html', body: '<meta name="citation_pdf_url" content="/main.pdf">' }
          : { body: bytes },
    );
    expect(await post({ ...input, doi: '10.1234/paper' })).toMatchObject({ status: 200, data: { hasPdf: true, record: { saved: false } } });
  });
  it('aborts outstanding acquisition and drains it before the owned server closes', async () => {
    let start!: () => void;
    const started = new Promise<void>((r) => {
      start = r;
    });
    const { post, store } = await application(() => {
      start();
      return new Promise<Reply>(() => {});
    });
    const pending = post();
    await started;
    const begin = Date.now();
    await servers.at(-1)!.close();
    expect(Date.now() - begin).toBeLessThan(1000);
    await pending.catch(() => {});
    expect(store.listPapers()).toEqual([]);
  });
});

describe('legacy DOI metadata/open compatibility without contact email', () => {
  it('uses public Crossref PDF links without requiring Unpaywall', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ message: { title: ['Test'], link: [{ URL: 'https://publisher.example/full', 'content-type': 'application/pdf' }] } }),
    );
    expect(await resolveDoi('10.1234/test', fetcher as any, '')).toMatchObject({ pdfUrl: 'https://publisher.example/full' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('tries a DOI landing page when metadata providers have no PDF, preserving legacy response', async () => {
    vi.stubEnv('FRACTAL_CONTACT_EMAIL', '');
    const { store } = await application(() => ({ body: bytes }));
    const resolver = vi.fn(async () => ({ paperKey: 'unused', arxivId: null, pdfSha256: null }));
    const acquirer = {
      resolve: resolver,
      acquire: async () => {
        throw new Error('Passive landing attempted');
      },
    } as any;
    const fetcher = (async () => Response.json({ message: { title: ['Test'] } })) as typeof fetch;
    await expect(ingestUrl(store, '10.1234/test', acquirer, fetcher)).rejects.toThrow('Passive landing attempted');
    expect(resolver).toHaveBeenCalledWith('https://doi.org/10.1234/test');
  });
});
