import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { SqlitePaperStore } from '../store/sqlite';
import { bookmark, linkPdf } from './bookmarks';
import { ProviderFailure, ScholarlyClient, retryAfterMs } from './client';
import { normalizeDoi, normalizeArxiv, openAlexMetadata, crossrefMetadata, titleMatches } from './metadata';
import { discoveryQueries, openAlexSource, crossrefSource, openAlexItem } from '../feed/scholarly-sources';
import { RelatedPaperService, mergeRelated } from '../feed/related';
import { deduplicate } from '../feed/ranking';
import { FeedService } from '../feed/index';
import { handleLibrary } from '../api/routes/library';
import { handleSync } from '../api/routes/sync';
import { createApiServer, TOKEN_HEADER } from '../api/index';
import { JobManager } from '../jobs/state';
import { TranslationPipeline } from '../translation/index';
import type { SourceContext } from '../feed/sources';

const stores: SqlitePaperStore[] = [];
const rootFolders: string[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.db.close();
  for (const root of rootFolders.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
function open(root = mkdtempSync(join(tmpdir(), 'fractal-discovery-'))) {
  rootFolders.push(root);
  const s = new SqlitePaperStore(root);
  stores.push(s);
  return s;
}
function reopen(s: SqlitePaperStore) {
  stores.splice(stores.indexOf(s), 1);
  s.db.close();
  const next = new SqlitePaperStore(s.root);
  stores.push(next);
  return next;
}
function request(value: unknown, type?: string): IncomingMessage {
  const r = Readable.from([Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))]) as IncomingMessage;
  r.headers = type ? { 'content-type': type } : {};
  r.url = '/';
  return r;
}
const publication = { title: 'Behavioral Shadows', authors: ['Ada Lovelace'], url: 'https://example.org/paper' };
const ctx = (): SourceContext => ({
  interests: { categories: ['cs.CL'], topics: ['language models'], authors: [], custom: [{ id: 'custom', label: 'Graph studies', query: 'graph reasoning' }] },
  followedTopics: [{ id: 'followed', field: 'cs.CL', label: 'Attention models', query: 'attention models', origin: 'user', followed: true }],
  now: new Date('2026-09-30T00:00:00Z'),
  get: async () => '',
  libraryArxivIds: [],
  rssFeeds: [],
});
const oaWork = {
  id: 'https://openalex.org/W1',
  display_name: 'Behavioral Shadows',
  type: 'article',
  doi: 'https://doi.org/10.1234/PAPER',
  publication_year: 2026,
  publication_date: '2026-09-15',
  primary_location: { source: { type: 'journal', display_name: 'Journal' }, landing_page_url: 'https://example.org/paper' },
  open_access: { is_oa: false },
  authorships: [{ author: { display_name: 'Ada Lovelace' } }],
};
const json = (value: unknown) => Response.json(value);

function identityPdf(text: string, subject = '') {
  const escape = (value: string) => value.replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 12 Tf 40 700 Td (${escape(text)}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Title (Identity test) /Subject (${escape(subject)}) >>`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((value, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${value}\nendobj\n`;
  });
  const offset = Buffer.byteLength(output);
  output += `xref\n0 7\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((v) => `${String(v).padStart(10, '0')} 00000 n `)
    .join('\n')}\ntrailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  return Buffer.from(output);
}

describe('publication discovery', () => {
  it('uses real field/custom/followed/interest queries across OpenAlex and Crossref without restricting obsolete work types', async () => {
    const c = ctx(),
      urls: string[] = [];
    c.get = async (url) => {
      urls.push(url);
      return JSON.stringify(
        url.includes('openalex')
          ? {
              results: [
                oaWork,
                { ...oaWork, id: 'https://openalex.org/W2', display_name: 'Conference', doi: null, type: 'conference-paper', primary_location: null },
                { ...oaWork, id: 'https://openalex.org/W3', display_name: 'Preprint', doi: null, type: 'preprint', primary_location: null },
              ],
            }
          : {
              message: {
                items: [
                  {
                    title: ['Behavioral Shadows'],
                    DOI: '10.1234/paper',
                    type: 'journal-article',
                    'container-title': ['Journal'],
                    issued: { 'date-parts': [[2026, 9, 15]] },
                  },
                ],
              },
            },
      );
    };
    expect(discoveryQueries(c).map((q) => q.text)).toEqual(
      expect.arrayContaining(['Computation and Language', 'graph reasoning', 'attention models', 'language models']),
    );
    const a = await openAlexSource.load(c),
      b = await crossrefSource.load(c);
    expect(urls.some((url) => new URL(url).searchParams.get('search') === 'attention models')).toBe(true);
    expect(urls.every((url) => !new URL(url).searchParams.get('filter')?.includes('type:'))).toBe(true);
    expect(a.map((x) => x.publication?.publicationKind)).toEqual(expect.arrayContaining(['journal', 'conference', 'preprint']));
    const merged = deduplicate([...a, ...b]);
    expect(merged.filter((x) => x.doi === '10.1234/paper')).toHaveLength(1);
    expect(merged.find((x) => x.doi === '10.1234/paper')).toMatchObject({ source: 'openAlex,crossref', topicIds: ['followed'] });
  });
  it('maps followed authors to provider author queries and does not invent a unique OpenAlex author', async () => {
    const c = ctx();
    c.interests = { categories: [], topics: [], authors: ['Ada Lovelace'] };
    c.followedTopics = [];
    const urls: string[] = [];
    c.get = async (url) => {
      urls.push(url);
      return JSON.stringify(
        url.includes('/authors?')
          ? { results: [{ id: 'https://openalex.org/A1', display_name: 'Ada Lovelace' }] }
          : url.includes('openalex')
            ? { results: [oaWork] }
            : { message: { items: [] } },
      );
    };
    await openAlexSource.load(c);
    await crossrefSource.load(c);
    expect(urls.some((u) => new URL(u).searchParams.get('filter')?.includes('author.id:A1'))).toBe(true);
    expect(urls.some((u) => new URL(u).searchParams.get('query.author') === 'Ada Lovelace')).toBe(true);
    const report = vi.fn();
    c.report = report;
    c.get = async () =>
      JSON.stringify({
        results: [
          { id: 'https://openalex.org/A1', display_name: 'Ada Lovelace' },
          { id: 'https://openalex.org/A2', display_name: 'Ada Lovelace' },
        ],
      });
    expect(await openAlexSource.load(c)).toHaveLength(0);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'not_found' }));
  });
  it('preserves unknown metadata, Unicode identity, reported arxiv DOI and direction-sensitive titles', () => {
    expect(normalizeDoi('https://doi.org/10.1234%2FABC')).toBe('10.1234/abc');
    expect(normalizeArxiv('https://arxiv.org/abs/1706.03762v2')).toBe('1706.03762');
    expect(openAlexMetadata({})).toMatchObject({
      year: null,
      venue: null,
      publicationKind: 'unknown',
      publicationDate: null,
      oaAvailability: 'unknown',
      oaPdfUrl: null,
    });
    expect(openAlexMetadata({ type: 'conference-paper' }).publicationKind).toBe('conference');
    expect(
      crossrefMetadata({ link: [{ 'content-type': 'application/pdf', URL: 'https://example.org/a.pdf' }], license: [{ URL: 'https://creativecommons.org' }] })
        .oaAvailability,
    ).toBe('unknown');
    expect(crossrefMetadata({ issued: { 'date-parts': [[2026]] } })).toMatchObject({ year: 2026, publicationDate: null });
    const item = openAlexItem({ ...oaWork, doi: 'https://doi.org/10.48550/arXiv.1706.03762', publication_date: null }, ctx(), {
      text: '',
      categories: [],
      topicIds: [],
    })!;
    expect(item).toMatchObject({ arxivId: '1706.03762', dateBasis: 'observed', publication: { publicationDate: null } });
    expect(titleMatches('Effect of treatment A on treatment B', 'Effect of treatment B on treatment A')).toBe(false);
    expect(titleMatches('ÉTUDE — 한국어', 'étude 한국어')).toBe(true);
    expect(
      deduplicate([
        { ...item, title: 'ÉTUDE 한국어', doi: null, arxivId: null },
        { ...item, title: 'étude — 한국어', doi: '10.1000/test', arxivId: null },
      ]),
    ).toHaveLength(1);
  });
  it('merges bridge identities without leaving duplicate DOI/arxiv groups', () => {
    const item = openAlexItem(oaWork, ctx(), { text: '', categories: [], topicIds: [] })!;
    const merged = deduplicate([
      { ...item, title: 'First title', doi: '10.1000/x', arxivId: null },
      { ...item, title: 'Second title', doi: null, arxivId: '1706.03762' },
      { ...item, title: 'Third title', doi: '10.1000/x', arxivId: '1706.03762v2' },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ doi: '10.1000/x', arxivId: '1706.03762' });
  });
  it('reports provider details on first-call and cached whole-source feed failures', async () => {
    const s = open(),
      item = openAlexItem(oaWork, ctx(), { text: '', categories: [], topicIds: [] })!;
    let failure = false;
    const source = {
      id: 'openAlex',
      load: async () => {
        if (failure)
          throw new ProviderFailure({
            provider: 'openAlex',
            state: 'rate_limited',
            message: 'openAlex returned HTTP 429',
            retryAt: '2026-09-30T01:00:00.000Z',
          });
        return [item];
      },
    };
    let clock = ctx().now;
    const feed = new FeedService(s, {} as any, undefined, fetch, () => clock, [source]);
    try {
      failure = true;
      expect((await feed.refresh()).sourceStatus).toMatchObject([
        {
          source: 'openAlex',
          state: 'error',
          fetchedAt: null,
          errorCode: 'rate_limited',
          retryAt: '2026-09-30T01:00:00.000Z',
          message: 'openAlex returned HTTP 429',
        },
      ]);
      failure = false;
      await feed.refresh();
      clock = new Date(clock.getTime() + 1000);
      failure = true;
      const stale = await feed.refresh();
      expect(stale.sourceStatus).toMatchObject([{ state: 'cached', errorCode: 'rate_limited' }]);
      expect(stale.sections.top).toHaveLength(1);
      expect(stale.sourceStatus[0].fetchedAt).toBe(ctx().now.toISOString());
      clock = new Date(clock.getTime() + 1000);
      expect((await feed.refresh()).sourceStatus[0].fetchedAt).toBe(ctx().now.toISOString());
    } finally {
      await feed.stop();
    }
  });
  it('keeps old source switches and enables new optional sources while feed saves remain metadata-only', async () => {
    const s = open(),
      acquirer = { resolve: vi.fn(), acquire: vi.fn() } as any;
    const item = openAlexItem(oaWork, ctx(), { text: '', categories: ['cs.CL'], topicIds: [] })!;
    const feed = new FeedService(s, acquirer, undefined, fetch, () => ctx().now, [{ id: 'openAlex', load: async () => [item] }]);
    s.db.prepare('INSERT INTO feed_meta VALUES(?,?)').run(
      'settings',
      JSON.stringify({
        sources: { arxiv: false, huggingFace: true, news: true, recommendations: false },
        customRssFeeds: [],
        digestEnabled: false,
        translateNewsTitles: false,
        refreshIntervalHours: 6,
      }),
    );
    expect(feed.settings().sources).toMatchObject({ arxiv: false, openAlex: true, crossref: true });
    try {
      await feed.refresh();
      const saved = await feed.save(item.id);
      expect(saved).toMatchObject({ hasPdf: false, record: { saved: true, lastReadAt: null } });
      expect(s.getPaper(saved.paperKey)).toBeNull();
      expect(acquirer.acquire).not.toHaveBeenCalled();
    } finally {
      await feed.stop();
    }
  });
});

describe('metadata bookmark and PDF link', () => {
  it('bookmarks idempotently and links at the same key across duplicate requests and restart without losing user data', async () => {
    let s = open();
    const result = await handleLibrary('POST', ['api', 'library', 'bookmarks'], request(publication), { store: s, acquirer: {} as any });
    const data = (result as any).data;
    const key = data.paperKey;
    expect(data).toMatchObject({ hasPdf: false, record: { saved: true, lastReadAt: null } });
    expect(bookmark(s, publication).paperKey).toBe(key);
    s.putFolder({ id: 'folder', name: 'Folder' });
    s.patchLibrary(key, { tags: ['keep'], collections: ['folder'], title: 'Edited title' });
    const memo = {
      kind: 'memo' as const,
      id: '7d45c154-e720-46c5-81cc-cf8415792dd9',
      paperKey: key,
      page: 1,
      text: 'Keep annotation',
      rect: null,
      quote: null,
      updatedAt: '2026-01-01T00:00:00Z',
      deleted: false,
      rev: 1,
      deviceId: 'android',
    };
    s.db.prepare('INSERT INTO annotations VALUES(?,?,?)').run(memo.id, key, JSON.stringify(memo)); // legacy/imported annotation, without changing annotation API semantics
    s.putHistory({
      id: 'history',
      paperKey: key,
      kind: 'question',
      question: 'Why?',
      text: 'Answer',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:00:00Z',
      requestId: null,
      context: {},
      answer: null,
      error: null,
      rev: 1,
      deviceId: 'android',
      deleted: false,
    });
    const bytes = readFileSync(new URL('../../test/fixtures/structure.pdf', import.meta.url));
    const linked = await Promise.all([linkPdf(s, key, bytes), linkPdf(s, key, bytes)]);
    expect(linked[0]).toEqual(linked[1]);
    expect(linked[0].paper.catalogKey).toBe(key);
    expect(s.getLibrary(key)).toMatchObject({ title: 'Edited title', tags: ['keep'], collections: ['folder'], saved: true });
    expect(s.getAnnotation('7d45c154-e720-46c5-81cc-cf8415792dd9')).toEqual(memo);
    expect(s.getHistory('history')?.text).toBe('Answer');
    s = reopen(s);
    expect(await linkPdf(s, key, bytes)).toMatchObject({ hasPdf: true, paper: { catalogKey: key } });
    const response = await handleLibrary('POST', ['api', 'library', key, 'pdf'], request(bytes, 'application/pdf'), { store: s, acquirer: {} as any });
    expect((response as any).data.paperKey).toBe(key);
    await expect(linkPdf(s, key, Buffer.concat([bytes, Buffer.from('\n%change')]))).rejects.toMatchObject({ error: { code: 'SOURCE_CHANGED' } });
    s.patchLibrary(key, { saved: false });
    expect(s.getPdf(key)).toEqual(bytes);
    expect(s.getHistory('history')?.text).toBe('Answer');
  });
  it('gives contradictory no-ID author/year records separate keys and does not pick an ambiguous existing title', () => {
    const s = open(),
      first = bookmark(s, publication);
    s.patchLibrary(first.paperKey, { tags: ['keep'] });
    const before = s.getLibrary(first.paperKey);
    const second = bookmark(s, { ...publication, authors: ['Charles Babbage'] });
    expect(second.paperKey).not.toBe(first.paperKey);
    expect(s.getLibrary(first.paperKey)).toEqual(before);
    const unknown = bookmark(s, { ...publication, authors: [] });
    expect(unknown.paperKey).not.toBe(first.paperKey);
    expect(unknown.paperKey).not.toBe(second.paperKey);
    expect(s.getLibrary(first.paperKey)).toEqual(before);
    const one = bookmark(s, {
        ...publication,
        title: 'Year ambiguity',
        publication: { year: 2025, venue: null, publicationKind: 'unknown', publicationDate: null, oaAvailability: 'unknown', oaPdfUrl: null },
      }),
      two = bookmark(s, {
        ...publication,
        title: 'Year ambiguity',
        publication: { year: 2026, venue: null, publicationKind: 'unknown', publicationDate: null, oaAvailability: 'unknown', oaPdfUrl: null },
      });
    expect(one.paperKey).not.toBe(two.paperKey);
    expect(bookmark(s, publication).paperKey).toBe(first.paperKey);
  });
  it('links safe legacy/no-identifier catalogs but rejects traversal, reserved keys and known identifier conflicts', async () => {
    const s = open(),
      initial = bookmark(s, publication).record;
    const bytes = readFileSync(new URL('../../test/fixtures/structure.pdf', import.meta.url));
    s.publishMetadata({ ...initial, paperKey: 'legacy-catalog', id: 'legacy', bibtexKey: 'legacy' });
    expect((await linkPdf(s, 'legacy-catalog', bytes)).paper.catalogKey).toBe('legacy-catalog');
    s.publishMetadata({ ...initial, paperKey: 'legacy.catalog', id: 'legacy-dot', bibtexKey: 'legacy-dot' });
    expect((await linkPdf(s, 'legacy.catalog', bytes)).paper.catalogKey).toBe('legacy.catalog');
    await expect(linkPdf(s, '../escape', bytes)).rejects.toThrow('unsupported');
    s.publishMetadata({ ...initial, paperKey: '1706.03762v1', id: 'reserved', bibtexKey: 'reserved' });
    await expect(linkPdf(s, '1706.03762v1', bytes)).rejects.toThrow('Reserved');
    s.publishMetadata({ ...initial, paperKey: 'conflict', id: 'conflict', bibtexKey: 'conflict', doi: '10.9999/conflict' });
    const before = s.getLibrary('conflict');
    await expect(linkPdf(s, 'conflict', identityPdf('Own paper', 'doi:10.1234/explicit'))).rejects.toThrow('conflict');
    expect(s.getLibrary('conflict')).toEqual(before);
    expect(s.getPdf('conflict')).toBeNull();
  });
  it('rolls back all catalog metadata and reader writes on transactional failure and can retry after restart', async () => {
    let s = open();
    const { paperKey: key } = bookmark(s, publication),
      before = s.getLibrary(key);
    const bytes = readFileSync(new URL('../../test/fixtures/structure.pdf', import.meta.url));
    s.db.exec("CREATE TEMP TRIGGER reject_blocks BEFORE INSERT ON blocks BEGIN SELECT RAISE(FAIL,'reject blocks'); END");
    await expect(linkPdf(s, key, bytes)).rejects.toThrow();
    expect(s.getLibrary(key)).toEqual(before);
    expect(s.getPaper(key)).toBeNull();
    expect(s.getPdf(key)).toBeNull();
    s = reopen(s);
    expect((await linkPdf(s, key, bytes)).hasPdf).toBe(true);
  });
  it('does not reject user association based on an incidental cited first-page DOI', async () => {
    const s = open(),
      { paperKey: key } = bookmark(s, { ...publication, doi: '10.9999/target' });
    const bytes = identityPdf('Prior work is cited at doi:10.1234/incidental');
    const result = await linkPdf(s, key, bytes);
    expect(result).toMatchObject({ hasPdf: true, record: { doi: '10.9999/target' } });
    expect(s.listBlocks(key).some((b) => b.sourceText.includes('10.1234/incidental'))).toBe(true);
  });
  it('preserves a timestamp/progress event through actual CAS sync endpoint including replay and intentional progress-only edits', async () => {
    const s = open(),
      { paperKey: key } = bookmark(s, publication),
      context = { store: s, acquirer: {} as any };
    s.patchLibrary(key, { lastReadAt: '2026-09-30T10:00:00.000Z', readProgress: { page: 5 } });
    const mutation = {
      paperKey: key,
      baseRev: s.getLibrary(key)!.rev!,
      deviceId: 'android',
      requestId: 'older-event',
      patch: { lastReadAt: '2026-09-29T10:00:00.000Z', readProgress: { page: 2 } },
    };
    const result = await handleSync('POST', ['api', 'sync', 'push'], request({ papers: [mutation] }), context);
    expect(result).toMatchObject({
      data: { metadataResults: [{ applied: true, current: { lastReadAt: '2026-09-30T10:00:00.000Z', readProgress: { page: 5 } } }] },
    });
    expect(await handleSync('POST', ['api', 'sync', 'push'], request({ papers: [mutation] }), context)).toEqual(result);
    const progress = { ...mutation, baseRev: s.getLibrary(key)!.rev!, requestId: 'progress-only', patch: { readProgress: { page: 3 } } };
    expect(await handleSync('POST', ['api', 'sync', 'push'], request({ papers: [progress] }), context)).toMatchObject({
      data: { metadataResults: [{ current: { lastReadAt: '2026-09-30T10:00:00.000Z', readProgress: { page: 3 } } }] },
    });
  });
  it('compares equal ISO spellings and microsecond read events through CAS push without losing progress', async () => {
    const s = open(),
      { paperKey: key } = bookmark(s, publication),
      context = { store: s, acquirer: {} as any };
    s.patchLibrary(key, { lastReadAt: '2026-09-30T10:00:00.000Z', readProgress: { page: 5 } });
    const push = async (lastReadAt: string, page: number, requestId: string) =>
      handleSync(
        'POST',
        ['api', 'sync', 'push'],
        request({
          papers: [{ paperKey: key, baseRev: s.getLibrary(key)!.rev!, deviceId: 'android', requestId, patch: { lastReadAt, readProgress: { page } } }],
        }),
        context,
      );
    await push('2026-09-30T10:00:00Z', 2, 'equivalent');
    expect(s.getLibrary(key)).toMatchObject({ lastReadAt: '2026-09-30T10:00:00.000Z', readProgress: { page: 5 } });
    await push('2026-09-30T10:00:00.000001Z', 6, 'micro-newer');
    expect(s.getLibrary(key)).toMatchObject({ lastReadAt: '2026-09-30T10:00:00.000001Z', readProgress: { page: 6 } });
    await push('2026-09-30T10:00:00.000000999Z', 1, 'nano-older');
    expect(s.getLibrary(key)?.readProgress?.page).toBe(6);
    await push('2026-09-30T10:00:00.000001000Z', 1, 'nano-equal');
    expect(s.getLibrary(key)?.readProgress?.page).toBe(6);
    await push('2026-09-30T10:00:00.000002Z', 7, 'micro-newest');
    expect(s.getLibrary(key)?.readProgress?.page).toBe(7);
  });
});

describe('provider isolation and related reliability', () => {
  it('keeps related lookup for another paper working after actual HTTP paper deletion', async () => {
    const s = open(),
      first = bookmark(s, { ...publication, doi: '10.1234/first' }),
      second = bookmark(s, { ...publication, doi: '10.1234/second' });
    await linkPdf(s, first.paperKey, identityPdf('First paper'));
    await linkPdf(s, second.paperKey, identityPdf('Second paper'));
    const nativeFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ references: [{ title: 'Surviving reference', url: 'https://example.org/ref' }], citations: [] })),
    );
    const jobs = new JobManager(s),
      translator = {
        connection: async () => ({ status: 'subscription', modelIds: ['model'], defaultModelId: 'model', limits: null }),
        translate: async () => {
          throw new Error('Not used');
        },
      } as any;
    const server = createApiServer({
      store: s,
      jobs,
      pipeline: new TranslationPipeline({ store: s, jobs, translator }),
      acquirer: {} as any,
      translator,
      paperChat: { forget: async () => {}, ask: async () => ({ text: 'Answer', usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null } }) },
    });
    try {
      const address = await server.listen(0),
        base = `http://127.0.0.1:${address.port}`;
      const deleted = await nativeFetch(`${base}/api/papers/${first.paperKey}`, { method: 'DELETE', headers: { [TOKEN_HEADER]: server.token, origin: base } });
      expect(deleted.status).toBe(200);
      const result = await nativeFetch(`${base}/api/papers/${second.paperKey}/related`);
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({ data: { status: 'ready', items: [{ title: 'Surviving reference' }] } });
    } finally {
      await server.close();
      vi.unstubAllGlobals();
    }
  });
  it('bounds Retry-After, isolates cooldowns and keeps secrets in headers on allowlisted no-redirect requests', async () => {
    vi.stubEnv('OPENALEX_API_KEY', 'secret');
    vi.stubEnv('SEMANTIC_SCHOLAR_API_KEY', 'other-secret');
    const fetcher = vi.fn(async (url: string) =>
      url.includes('semanticscholar') ? new Response('', { status: 429, headers: { 'retry-after': '99999999' } }) : json({ results: [] }),
    );
    const c = new ScholarlyClient(fetcher as any, { intervalMs: 0 });
    await expect(c.json('semanticScholar', 'https://api.semanticscholar.org/graph/v1/paper/x')).rejects.toMatchObject({ status: { state: 'rate_limited' } });
    await expect(c.json('semanticScholar', 'https://api.semanticscholar.org/graph/v1/paper/y')).rejects.toBeInstanceOf(ProviderFailure);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await c.json('openAlex', 'https://api.openalex.org/works');
    const call = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(call[0]).not.toContain('secret');
    expect(call[1]).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer secret' } });
    await expect(c.json('openAlex', 'https://evil.example/works')).rejects.toThrow('allowlisted');
    expect(retryAfterMs('999999999')).toBe(60000);
    expect(retryAfterMs('-1')).toBeGreaterThanOrEqual(1000);
  });
  it('serializes each provider, spaces requests and permits independent providers to proceed concurrently', async () => {
    const starts: number[] = [];
    let active = 0,
      maxActive = 0;
    const fetcher = vi.fn(async () => {
      starts.push(Date.now());
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      return json({ results: [] });
    });
    const c = new ScholarlyClient(fetcher as any, { intervalMs: 25 });
    await Promise.all([c.json('crossref', 'https://api.crossref.org/works/a'), c.json('crossref', 'https://api.crossref.org/works/b')]);
    expect(maxActive).toBe(1);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(20);
    maxActive = 0;
    await Promise.all([c.json('crossref', 'https://api.crossref.org/works/c'), c.json('openAlex', 'https://api.openalex.org/works/c')]);
    expect(maxActive).toBe(2);
  });
  it('stops spending OpenAlex daily quota after successful exhaustion headers and reports the real reset', async () => {
    const fetcher = vi.fn(async () => json({ results: [] }));
    fetcher.mockImplementation(async () => new Response('{"results":[]}', { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '3600' } }));
    const c = new ScholarlyClient(fetcher as any, { intervalMs: 0, now: () => 0 });
    await c.json('openAlex', 'https://api.openalex.org/works');
    await expect(c.json('openAlex', 'https://api.openalex.org/works?q=x')).rejects.toMatchObject({
      status: { state: 'budget_exhausted', retryAt: '1970-01-01T01:00:00.000Z' },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('caller abort leaves another shared lookup alive, while service shutdown aborts bounded work before store closure', async () => {
    const s = open(),
      { paperKey: key } = bookmark(s, { ...publication, doi: '10.1234/test' });
    const fetcher = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return json({ references: [{ title: 'Reference', url: 'https://example.org/ref' }], citations: [] });
    });
    const service = new RelatedPaperService(s, fetcher as any, { intervalMs: 0 }),
      abort = new AbortController();
    const first = service.get(key, abort.signal).catch((error) => error),
      second = service.get(key);
    abort.abort();
    expect((await first).name).toBe('AbortError');
    expect((await second).items).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await service.close();
    s.db.prepare('DELETE FROM related_provider_cache').run();
    const hanging = new RelatedPaperService(s, (async () => new Promise<Response>(() => {})) as any, { intervalMs: 0 });
    const work = hanging.get(key);
    const started = Date.now();
    await hanging.close();
    await work;
    expect(Date.now() - started).toBeLessThan(250);
    expect(s.db.prepare('SELECT count(*) n FROM related_provider_cache').get()?.n).toBe(0);
  });
  it('deduplicates concurrent related requests, validates DOI miss title fallback and keeps multiple relation edges', async () => {
    const s = open(),
      { paperKey: key } = bookmark(s, { ...publication, doi: '10.1234/missing' });
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('semanticscholar')) return new Response('', { status: 503 });
      if (url.includes('/works/https://doi.org/')) return new Response('', { status: 404 });
      if (url.includes('search='))
        return json({ results: [{ ...oaWork, doi: null, related_works: ['https://openalex.org/W2'], referenced_works: ['https://openalex.org/W2'] }] });
      if (url.includes('openalex_id:'))
        return json({ results: [{ ...oaWork, id: 'https://openalex.org/W2', display_name: 'Related', doi: 'https://doi.org/10.1234/related' }] });
      return json({ results: [] });
    });
    const service = new RelatedPaperService(s, fetcher as any, { intervalMs: 0 });
    const values = await Promise.all(Array.from({ length: 12 }, () => service.get(key)));
    expect(values.every((v) => v.source === 'openAlex')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(values[0]).toMatchObject({
      status: 'ready',
      providerStatus: [
        { provider: 'semanticScholar', state: 'error' },
        { provider: 'openAlex', state: 'ok' },
      ],
      items: [{ relations: ['cites', 'similar'], provider: 'openAlex' }],
    });
    expect(urls.some((url) => url.includes('search=Behavioral'))).toBe(true);
    await service.get(key);
    expect(fetcher).toHaveBeenCalledTimes(6); // isolated S2 failure does not invalidate fresh OA cache
  });
  it('rejects reordered title identity, never synthesizes arxiv DOI, and reports unavailable timestamp honestly', async () => {
    const s = open(),
      { paperKey: key } = bookmark(s, { ...publication, title: 'Effect of treatment A on treatment B', arxivId: '1706.03762' });
    const fetcher = vi.fn(async (url: string) =>
      url.includes('semanticscholar')
        ? new Response('', { status: 404 })
        : json({ results: [{ ...oaWork, display_name: 'Effect of treatment B on treatment A' }] }),
    );
    const result = await new RelatedPaperService(s, fetcher as any, { intervalMs: 0 }).get(key);
    expect(result).toMatchObject({ status: 'unavailable', fetchedAt: null, providerStatus: [{ state: 'not_found' }, { state: 'not_found' }] });
    expect(fetcher.mock.calls.every(([u]) => !u.includes('10.48550'))).toBe(true);
  });
  it('never collapses equal titles with contradictory identifiers or author/year evidence', async () => {
    const s = open(),
      first = bookmark(s, { ...publication, doi: '10.1234/first' }),
      second = bookmark(s, { ...publication, doi: '10.1234/second' });
    expect(second.paperKey).not.toBe(first.paperKey);
    const a = openAlexItem(oaWork, ctx(), { text: '', categories: [], topicIds: [] })!;
    expect(
      deduplicate([
        { ...a, doi: '10.1234/first' },
        { ...a, doi: '10.1234/second' },
      ]),
    ).toHaveLength(2);
    expect(
      deduplicate([
        { ...a, doi: null, authors: ['Ada Lovelace'] },
        { ...a, doi: null, authors: ['Charles Babbage'] },
      ]),
    ).toHaveLength(2);
    const fetcher = vi.fn(async (url: string) =>
      url.includes('semanticscholar') ? new Response('', { status: 503 }) : json({ results: [{ ...oaWork, doi: '10.1234/second' }] }),
    );
    expect(await new RelatedPaperService(s, fetcher as any, { intervalMs: 0 }).get(first.paperKey)).toMatchObject({ status: 'unavailable', items: [] });
  });
  it('rejects ambiguous equal-title lookup and contradictory known authors/year rather than selecting the first work', async () => {
    const s = open(),
      { paperKey: key } = bookmark(s, publication);
    let candidates = [
      { ...oaWork, doi: null },
      { ...oaWork, doi: null, id: 'https://openalex.org/W2' },
    ];
    const fetcher = vi.fn(async () => json({ results: candidates }));
    const service = new RelatedPaperService(s, fetcher as any, { intervalMs: 0 });
    expect(await service.get(key)).toMatchObject({ status: 'unavailable', providerStatus: [{ state: 'not_found' }, { state: 'not_found' }] });
    candidates = [{ ...oaWork, doi: null, authorships: [{ author: { display_name: 'Charles Babbage' } }] }];
    expect(await service.get(key)).toMatchObject({ status: 'unavailable' });
    s.patchLibrary(key, { year: 2025 });
    candidates = [{ ...oaWork, doi: null }];
    expect(await service.get(key)).toMatchObject({ status: 'unavailable' });
  });
  it('reuses fresh empty first-provider evidence while retaining useful cached fallback on repeated requests', async () => {
    const s = open(),
      { paperKey: key } = bookmark(s, { ...publication, doi: '10.1234/paper' });
    const fetcher = vi.fn(async (url: string) =>
      url.includes('semanticscholar')
        ? json({ references: [], citations: [] })
        : url.includes('/works/https://doi.org/')
          ? json({ ...oaWork, related_works: ['https://openalex.org/W2'] })
          : url.includes('openalex_id:')
            ? json({ results: [{ ...oaWork, id: 'https://openalex.org/W2', display_name: 'Related fallback' }] })
            : json({ results: [] }),
    );
    const service = new RelatedPaperService(s, fetcher as any, { intervalMs: 0 });
    expect(await service.get(key)).toMatchObject({ source: 'openAlex', items: [{ title: 'Related fallback' }] });
    const count = fetcher.mock.calls.length;
    expect(await service.get(key)).toMatchObject({
      source: 'openAlex',
      items: [{ title: 'Related fallback' }],
      providerStatus: [
        { provider: 'semanticScholar', state: 'ok' },
        { provider: 'openAlex', state: 'ok' },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(count);
  });
  it('gives OpenAlex a fresh independent budget after a hung Semantic Scholar and isolates per-provider timeouts', async () => {
    const s = open(),
      { paperKey: key } = bookmark(s, { ...publication, doi: '10.1234/test' });
    const started = Date.now();
    const fetcher = vi.fn((url: string) =>
      url.includes('semanticscholar')
        ? new Promise<Response>(() => {})
        : Promise.resolve(
            url.includes('/works/https://doi.org/')
              ? json({ ...oaWork, doi: 'https://doi.org/10.1234/test', related_works: ['https://openalex.org/W2'] })
              : url.includes('openalex_id:')
                ? json({ results: [{ ...oaWork, id: 'https://openalex.org/W2', display_name: 'Related' }] })
                : json({ results: [] }),
          ),
    );
    const result = await new RelatedPaperService(s, fetcher as any, { intervalMs: 0, timeoutMs: 35, providerBudgetMs: 100 }).get(key);
    expect(result).toMatchObject({
      source: 'openAlex',
      status: 'ready',
      providerStatus: [
        { provider: 'semanticScholar', state: 'timeout' },
        { provider: 'openAlex', state: 'ok' },
      ],
    });
    expect(Date.now() - started).toBeLessThan(500);
  });
  it('returns stale useful cache with original successful time, provider-specific errors and no cross-identity reuse', async () => {
    const s = open(),
      { paperKey: key } = bookmark(s, { ...publication, doi: '10.1234/test' });
    let now = Date.parse('2026-09-01T00:00:00Z'),
      outage = false;
    const fetcher = vi.fn(async (url: string) =>
      outage
        ? new Response('', { status: url.includes('semanticscholar') ? 429 : 503 })
        : json({ references: [{ title: 'Cached reference', externalIds: { DOI: '10.1000/ref' }, url: 'https://doi.org/10.1000/ref' }], citations: [] }),
    );
    const service = new RelatedPaperService(s, fetcher as any, { intervalMs: 0, now: () => now });
    const fresh = await service.get(key);
    now += 8 * 86400000;
    outage = true;
    const stale = await service.get(key);
    expect(stale).toMatchObject({
      status: 'stale',
      fetchedAt: fresh.fetchedAt,
      items: [{ title: 'Cached reference' }],
      providerStatus: [
        { provider: 'semanticScholar', state: 'rate_limited' },
        { provider: 'openAlex', state: 'error' },
      ],
    });
    s.patchLibrary(key, { doi: '10.1234/changed' });
    expect(await service.get(key)).toMatchObject({ status: 'unavailable', fetchedAt: null });
  });
  it('retains a useful stale first-provider cache when the terminal provider is freshly empty, including repeat reads', async () => {
    const s = open(),
      { paperKey: key } = bookmark(s, { ...publication, doi: '10.1234/paper' });
    let now = Date.parse('2026-09-01T00:00:00Z'),
      outage = false;
    const fetcher = vi.fn(async (url: string) =>
      url.includes('semanticscholar')
        ? outage
          ? new Response('', { status: 429 })
          : json({ references: [{ title: 'Prior reference', url: 'https://example.org/ref' }], citations: [] })
        : url.includes('/works/https://doi.org/')
          ? json({ ...oaWork, related_works: [], referenced_works: [] })
          : json({ results: [] }),
    );
    const service = new RelatedPaperService(s, fetcher as any, { intervalMs: 0, now: () => now }),
      first = await service.get(key);
    outage = true;
    now += 8 * 86400000;
    expect(await service.get(key)).toMatchObject({ status: 'stale', fetchedAt: first.fetchedAt, items: [{ title: 'Prior reference' }] });
    const count = fetcher.mock.calls.length;
    expect(await service.get(key)).toMatchObject({ status: 'stale', fetchedAt: first.fetchedAt, items: [{ title: 'Prior reference' }] });
    expect(fetcher).toHaveBeenCalledTimes(count);
  });
  it('merges compatible DOI/arxiv related bridges and preserves contradictory same-title works', () => {
    const base = {
      title: 'First',
      authors: [],
      year: null,
      doi: '10.1234/first',
      arxivId: null,
      url: 'https://example.org/paper',
      relation: 'cites' as const,
      inLibrary: false,
    };
    const second = { ...base, title: 'Second', doi: null, arxivId: '1706.03762', relation: 'citedBy' as const };
    const bridge = { ...base, title: 'Bridge', arxivId: '1706.03762', relation: 'similar' as const };
    expect(mergeRelated([[base], [second], [bridge]])).toMatchObject([{ relations: ['cites', 'citedBy', 'similar'] }]);
    expect(mergeRelated([[base], [{ ...base, doi: '10.1234/second' }]])).toHaveLength(2);
  });
  it('retains reference results when the recommendation endpoint requires authentication and labels the response partial', async () => {
    const s = open(),
      { paperKey: key } = bookmark(s, { ...publication, doi: '10.1234/test' });
    const fetcher = vi.fn(async (url: string) =>
      url.includes('recommendations')
        ? new Response('', { status: 401 })
        : json({ paperId: 'a'.repeat(40), references: [{ title: 'Reference', url: 'https://example.org/ref' }], citations: [] }),
    );
    const result = await new RelatedPaperService(s, fetcher as any, { intervalMs: 0 }).get(key);
    expect(result).toMatchObject({
      status: 'partial',
      items: [{ relation: 'cites' }],
      providerStatus: [{ state: 'ok' }, { provider: 'semanticScholar', state: 'auth_required' }],
    });
  });
});
