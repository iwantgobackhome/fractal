import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeedInterests } from '@fractal/shared';
import { SqlitePaperStore } from '../store/sqlite';
import type { PaperAcquirer } from '../api/index';
import type { ProviderRegistry } from '../ai/registry';
import { handleFeed } from '../api/routes/feed';
import { FeedService, isStale, isoWeek } from './index';
import { deduplicate, rankItems } from './ranking';
import { CachedFetcher, newsSource, parseArxivAtom, parseHfDaily, parseSyndication, recommendationSource, type FeedSource, type RawItem } from './sources';

const interests: FeedInterests = { categories: ['cs.CL'], topics: ['language model'], authors: [], custom: [] };
const now = new Date('2026-09-30T12:00:00.000Z');
const base: RawItem = {
  id: 'arxiv:2609.12345',
  kind: 'paper',
  title: 'Language models for science',
  authors: ['A Researcher'],
  abstract: 'A useful language model.',
  source: 'arxiv',
  url: 'https://arxiv.org/abs/2609.12345',
  arxivId: '2609.12345',
  doi: null,
  categories: ['cs.CL'],
  publishedAt: '2026-09-29T12:00:00.000Z',
  popularity: 0,
};
const arxivXml = `<?xml version="1.0"?><feed xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry><id>http://arxiv.org/abs/2609.12345v1</id><title>Language &amp; Vision</title>
  <summary> A study of multimodal language. </summary><published>2026-09-29T12:00:00Z</published>
  <author><name>A Researcher</name></author><category term="cs.CL"/><arxiv:primary_category term="cs.CV"/>
  <arxiv:doi>10.1234/example</arxiv:doi></entry></feed>`;
const rss = `<rss><channel><item><title>AI &amp; Science</title><link>https://example.org/news</link>
  <description><![CDATA[<p>Research news</p>]]></description><pubDate>Tue, 29 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
const atom = `<feed><entry><title>Field update</title><link href="https://example.org/atom"/>
  <summary>New result</summary><updated>2026-09-29T12:00:00Z</updated></entry></feed>`;

describe('feed sources and ranking', () => {
  it('parses arXiv Atom categories, DOI and authors', () => {
    expect(parseArxivAtom(arxivXml)).toMatchObject([
      { title: 'Language & Vision', arxivId: '2609.12345', doi: '10.1234/example', authors: ['A Researcher'], categories: ['cs.CV', 'cs.CL'] },
    ]);
  });

  it('parses Hugging Face daily papers and upvotes', () => {
    const rows = [
      {
        paper: {
          id: '2609.12345',
          title: 'Language models for science',
          summary: 'Abstract',
          authors: [{ name: 'A Researcher' }],
          publishedAt: '2026-09-24T12:00:00Z',
          submittedOnDailyAt: '2026-09-29T12:00:00Z',
          upvotes: 42,
        },
      },
    ];
    expect(parseHfDaily(rows)).toMatchObject([{ arxivId: '2609.12345', popularity: 42, publishedAt: '2026-09-29T12:00:00.000Z', authors: ['A Researcher'] }]);
  });

  it('parses RSS 2.0 and Atom news', () => {
    expect(parseSyndication(rss, 'example.org')).toMatchObject([{ title: 'AI & Science', abstract: 'Research news' }]);
    expect(parseSyndication(atom, 'example.org')).toMatchObject([{ title: 'Field update', url: 'https://example.org/atom' }]);
  });

  it('selects curated news feeds for the reader field', async () => {
    const get = vi.fn().mockResolvedValue(rss);
    await newsSource.load({ interests: { categories: ['q-bio.MN'], topics: [], authors: [], custom: [] }, libraryArxivIds: [], rssFeeds: [], get, now });
    expect(get).toHaveBeenCalledTimes(6);
    expect(get.mock.calls.some(([url]) => url === 'https://www.nature.com/subjects/biological-sciences.rss')).toBe(true);
    expect(get.mock.calls.some(([url]) => String(url).includes('/headlines/section/topic/SCIENCE'))).toBe(true);
  });

  it('deduplicates arXiv, DOI and title and ranks interest matches first', () => {
    const duplicate = { ...base, id: 'hf:2609.12345', source: 'huggingFace', popularity: 100 };
    const unrelated = {
      ...base,
      id: 'other',
      arxivId: null,
      title: 'New material discovery',
      categories: [],
      abstract: '',
      publishedAt: '2026-09-30T11:00:00.000Z',
    };
    expect(deduplicate([base, duplicate])).toHaveLength(1);
    const ranked = rankItems([unrelated, base, duplicate], interests, [], now);
    expect(ranked.map((item) => item.title)).toEqual(['Language models for science', 'New material discovery']);
    expect(ranked[0]?.reason).toBe('관심 분야 cs.CL');
    expect(ranked[0]?.popularity).toBe(100);
  });

  it('sends conditional request headers and reuses the cached body on 304', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'feed-cache-'));
    const store = new SqlitePaperStore(directory);
    try {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(new Response('first', { headers: { etag: '"a"' } }))
        .mockResolvedValueOnce(new Response(null, { status: 304 }));
      const cache = new CachedFetcher(store, fetcher);
      expect(await cache.get('https://example.org/rss')).toBe('first');
      expect(await cache.get('https://example.org/rss')).toBe('first');
      expect(fetcher.mock.calls[1]?.[1]?.headers['If-None-Match']).toBe('"a"');
    } finally {
      store.db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('posts library seeds to Semantic Scholar recommendations', async () => {
    const get = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({ recommendedPapers: [{ paperId: 's2-id', title: 'A recommended paper', publicationDate: '2026-09-28', citationCount: 10 }] }),
      );
    const result = await recommendationSource.load({ interests, libraryArxivIds: ['2609.12345'], rssFeeds: [], get, now });
    expect(JSON.parse(get.mock.calls[0]?.[2] as string)).toEqual({ positivePaperIds: ['ARXIV:2609.12345'], negativePaperIds: [] });
    expect(result).toMatchObject([{ source: 'recommendations', title: 'A recommended paper' }]);
  });
});

const directories: string[] = [];
const stores: SqlitePaperStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function service(sources: FeedSource[], registry?: ProviderRegistry) {
  const directory = mkdtempSync(join(tmpdir(), 'feed-test-'));
  directories.push(directory);
  const store = new SqlitePaperStore(directory);
  stores.push(store);
  const acquirer = { resolve: vi.fn(), acquire: vi.fn(), reextract: vi.fn() } as unknown as PaperAcquirer;
  return new FeedService(store, acquirer, registry, vi.fn() as unknown as typeof fetch, () => now, sources);
}

describe('feed service and route', () => {
  it('migrates legacy interests and assigns custom IDs and fallback queries', async () => {
    const feed = service([]);
    stores
      .at(-1)!
      .db.prepare('INSERT INTO feed_meta(key,data) VALUES(?,?)')
      .run('interests', JSON.stringify({ categories: ['cs.CL'], topics: [], authors: [] }));
    expect(feed.interests().custom).toEqual([]);
    const request = Readable.from([
      JSON.stringify({ categories: ['cs.CL'], topics: [], authors: [], custom: [{ label: '확산 로봇', query: '' }] }),
    ]) as IncomingMessage;
    request.headers = {};
    const result = await handleFeed('PUT', ['api', 'feed', 'interests'], request, { feed, url: new URL('http://localhost/api/feed/interests') });
    expect(result).toMatchObject({ data: { custom: [{ label: '확산 로봇', query: '확산 로봇' }] } });
    expect(feed.interests().custom?.[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(feed.categories('전산언어학').map((item) => item.code)).toContain('cs.CL');
    await feed.stop();
  });
  it('detects stale snapshots and ISO weeks', () => {
    expect(isoWeek(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
    expect(isStale(null, now, 6)).toBe(true);
    expect(isStale('2026-09-30T07:00:00Z', now, 6)).toBe(false);
    expect(isStale('2026-09-30T05:00:00Z', now, 6)).toBe(true);
  });

  it('refreshes on start only when the snapshot is stale', async () => {
    const load = vi.fn().mockResolvedValue([base]);
    const feed = service([{ id: 'arxiv', load }]);
    feed.start();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(feed.read().generatedAt).not.toBeNull());
    feed.start();
    expect(load).toHaveBeenCalledTimes(1);
    await feed.stop();
  });

  it('preserves partial results when one source fails', async () => {
    const feed = service([
      { id: 'arxiv', load: async () => [base] },
      {
        id: 'huggingFace',
        load: async () => {
          throw new Error('offline');
        },
      },
    ]);
    feed.putInterests(interests);
    const result = await feed.refresh();
    expect(result.sections.top).toHaveLength(1);
    expect(result.sourceStatus).toMatchObject([{ state: 'ok' }, { state: 'error' }]);
    await feed.stop();
  });

  it('never calls AI when digest is off; prompts and stores it once when enabled', async () => {
    const complete = vi.fn(async function* (_feature: string, input: { messages: Array<{ content: string }> }) {
      expect(input.messages[0]?.content).toContain('[1] Language models for science');
      yield { type: 'text' as const, text: '언어 모델 동향 [1]' };
    });
    const feed = service([{ id: 'arxiv', load: async () => [base] }], { complete } as unknown as ProviderRegistry);
    feed.putInterests(interests);
    await feed.refresh();
    expect(complete).not.toHaveBeenCalled();
    feed.putSettings({ ...feed.settings(), digestEnabled: true });
    await feed.refresh();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(feed.read().digest?.text).toBe('언어 모델 동향 [1]');
    await feed.refresh();
    expect(complete).toHaveBeenCalledTimes(1);
    await feed.stop();
  });

  it('handles interests and feed route bodies', async () => {
    const feed = service([{ id: 'arxiv', load: async () => [base] }]);
    const body = Readable.from([JSON.stringify(interests)]) as IncomingMessage;
    body.headers = {};
    const put = await handleFeed('PUT', ['api', 'feed', 'interests'], body, { feed, url: new URL('http://localhost/api/feed/interests') });
    expect(put).toMatchObject({ kind: 'json', data: interests });
    await feed.refresh();
    const request = Readable.from([]) as IncomingMessage;
    request.headers = {};
    const get = await handleFeed('GET', ['api', 'feed'], request, { feed, url: new URL('http://localhost/api/feed') });
    expect(get).toMatchObject({ kind: 'json', data: { sections: { top: [{ title: base.title }] } } });
    await feed.stop();
  });
});
