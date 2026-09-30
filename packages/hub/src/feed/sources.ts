import { createHash } from 'node:crypto';
import type { FeedItem, FeedInterests, FeedSourceStatus } from '@fractal/shared';
import type { SqlitePaperStore } from '../store/sqlite';

export type RawItem = Omit<FeedItem, 'score' | 'reason' | 'reasonCode' | 'reasonParams' | 'inLibrary'>;
export interface FeedSource {
  id: string;
  load(context: SourceContext): Promise<RawItem[]>;
}
export interface SourceContext {
  interests: FeedInterests;
  libraryArxivIds: string[];
  rssFeeds: string[];
  get(url: string, headers?: Record<string, string>, body?: string): Promise<string>;
  now: Date;
  report?: (status: FeedSourceStatus) => void;
}

const compact = (value: string): string => value.replace(/\s+/g, ' ').trim();
const digest = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24);
const text = (xml: string): string =>
  compact(
    xml
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
        const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
        if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
        if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10));
        return named[entity.toLowerCase()] ?? '';
      }),
  );
const groups = (xml: string, name: string): string[] =>
  [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'gi'))].map((match) => match[1] ?? '');
const field = (xml: string, name: string): string => text(groups(xml, name)[0] ?? '');
const attr = (xml: string, element: string, attribute: string): string[] => {
  const tags = [...xml.matchAll(new RegExp(`<${element}(?:\\s[^>]*?)?\\/?\s*>`, 'gi'))].map((match) => match[0]);
  return tags.map((tag) => new RegExp(`${attribute}=["']([^"']+)["']`, 'i').exec(tag)?.[1] ?? '').filter(Boolean);
};
const date = (value: unknown): string | null => {
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};
const arxivId = (value: string): string | null => /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:)([^/?#\s]+)/i.exec(value)?.[1]?.replace(/v\d+$/, '') ?? null;
const doi = (value: string): string | null => /10\.\d{4,9}\/[^\s<>"']+/i.exec(value)?.[0]?.replace(/[.,;]$/, '') ?? null;

export function parseArxivAtom(xml: string): RawItem[] {
  return groups(xml, 'entry').flatMap((entry) => {
    const title = field(entry, 'title');
    const publishedAt = date(field(entry, 'published'));
    const url = field(entry, 'id').replace(/^http:\/\//, 'https://');
    if (!title || !publishedAt || !/^https:\/\//.test(url)) return [];
    const id = arxivId(url);
    const categories = attr(entry, 'category', 'term');
    const primary = attr(entry, 'arxiv:primary_category', 'term');
    return [
      {
        id: `arxiv:${id ?? digest(url)}`,
        kind: 'paper' as const,
        title,
        authors: groups(entry, 'author')
          .map((author) => field(author, 'name'))
          .filter(Boolean),
        abstract: field(entry, 'summary').slice(0, 3000),
        source: 'arxiv',
        url,
        arxivId: id,
        doi: field(entry, 'arxiv:doi') || doi(entry),
        categories: [...new Set([...primary, ...categories])],
        publishedAt,
        popularity: 0,
      },
    ];
  });
}

export function parseHfDaily(value: unknown): RawItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const paper = (row.paper && typeof row.paper === 'object' ? row.paper : row) as Record<string, unknown>;
    const id = String(paper.id ?? '');
    const title = compact(String(paper.title ?? ''));
    const publishedAt = date(paper.submittedOnDailyAt ?? row.date ?? row.publishedAt ?? paper.publishedAt);
    if (!title || !publishedAt || !id) return [];
    const url = `https://huggingface.co/papers/${encodeURIComponent(id)}`;
    const authors = Array.isArray(paper.authors)
      ? paper.authors.map((author) => (typeof author === 'string' ? author : String((author as { name?: unknown }).name ?? ''))).filter(Boolean)
      : [];
    const categories = Array.isArray(paper.categories) ? paper.categories.filter((category): category is string => typeof category === 'string') : [];
    return [
      {
        id: `hf:${id}`,
        kind: 'paper' as const,
        title,
        authors,
        abstract: compact(String(paper.summary ?? paper.abstract ?? '')).slice(0, 3000),
        source: 'huggingFace',
        url,
        arxivId: arxivId(id) ?? (/^\d{4}\.\d{4,5}/.test(id) ? id.replace(/v\d+$/, '') : null),
        doi: doi(String(paper.doi ?? '')),
        categories,
        publishedAt,
        popularity: Math.max(0, Number(row.numUpvotes ?? paper.upvotes ?? row.upvotes ?? 0) || 0),
      },
    ];
  });
}

export function parseSyndication(xml: string, source: string): RawItem[] {
  const entries = groups(xml, 'item').length ? groups(xml, 'item') : groups(xml, 'entry');
  return entries.flatMap((entry) => {
    const title = field(entry, 'title');
    const rssLink = field(entry, 'link');
    const atomLink = attr(entry, 'link', 'href').find((link) => /^https?:\/\//.test(link));
    const url = rssLink || atomLink || '';
    const publishedAt = date(field(entry, 'pubDate') || field(entry, 'published') || field(entry, 'updated'));
    if (!title || !publishedAt || !/^https?:\/\//.test(url)) return [];
    return [
      {
        id: `news:${digest(url)}`,
        kind: 'news' as const,
        title,
        authors: [],
        abstract: (field(entry, 'description') || field(entry, 'summary') || field(entry, 'content')).slice(0, 3000),
        source,
        url,
        arxivId: null,
        doi: null,
        categories: [],
        publishedAt,
        popularity: 0,
      },
    ];
  });
}

export function parseRecommendations(value: unknown): RawItem[] {
  const rows = (value as { recommendedPapers?: unknown } | null)?.recommendedPapers;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const title = compact(String(row.title ?? ''));
    const url = String(row.url ?? (row.paperId ? `https://www.semanticscholar.org/paper/${row.paperId}` : ''));
    const publishedAt = date(row.publicationDate ?? `${row.year ?? new Date().getUTCFullYear()}-01-01`);
    if (!title || !publishedAt || !/^https:\/\//.test(url)) return [];
    const external = row.externalIds as Record<string, unknown> | undefined;
    return [
      {
        id: `s2:${String(row.paperId ?? digest(url))}`,
        kind: 'paper' as const,
        title,
        authors: Array.isArray(row.authors) ? row.authors.map((author) => String((author as { name?: unknown }).name ?? '')).filter(Boolean) : [],
        abstract: compact(String(row.abstract ?? '')).slice(0, 3000),
        source: 'recommendations',
        url,
        arxivId: external?.ArXiv ? String(external.ArXiv) : null,
        doi: external?.DOI ? String(external.DOI) : null,
        categories: [],
        publishedAt,
        popularity: Math.max(0, (Number(row.citationCount ?? 0) || 0) / Math.max(1, new Date().getUTCFullYear() - new Date(publishedAt).getUTCFullYear() + 1)),
      },
    ];
  });
}

export const DEFAULT_RSS_FEEDS = [
  'https://research.google/blog/rss/',
  'https://deepmind.google/blog/rss.xml',
  'https://openai.com/news/rss.xml',
  'https://bair.berkeley.edu/blog/feed.xml',
  'https://thegradient.pub/rss/',
];

export const FIELD_RSS_FEEDS: Record<string, string[]> = {
  computing: DEFAULT_RSS_FEEDS,
  mathematics: ['https://www.nature.com/subjects/mathematics-and-computing.rss'],
  biology: ['https://www.nature.com/subjects/biological-sciences.rss'],
  physics: ['https://www.nature.com/subjects/physics.rss'],
};

function curatedFeeds(categories: string[]): string[] {
  if (!categories.length) return DEFAULT_RSS_FEEDS;
  const groups = new Set<string>();
  for (const category of categories) {
    if (/^(cs|eess|stat)\./.test(category)) {
      groups.add('computing');
    } else if (/^(math|q-fin|econ)\./.test(category)) {
      groups.add('mathematics');
    } else if (/^q-bio\./.test(category)) {
      groups.add('biology');
    } else {
      groups.add('physics');
    }
  }
  return [...new Set([...groups].flatMap((group) => FIELD_RSS_FEEDS[group] ?? []))];
}

export const arxivSource: FeedSource = {
  id: 'arxiv',
  async load(context) {
    const cutoff = context.now.getTime() - 7 * 86400000;
    const results = await Promise.allSettled(
      context.interests.categories.map(async (category) => {
        const query = new URL('https://export.arxiv.org/api/query');
        query.searchParams.set('search_query', `cat:${category}`);
        query.searchParams.set('start', '0');
        query.searchParams.set('max_results', '500');
        query.searchParams.set('sortBy', 'submittedDate');
        query.searchParams.set('sortOrder', 'descending');
        return parseArxivAtom(await context.get(query.href)).filter((item) => Date.parse(item.publishedAt) >= cutoff);
      }),
    );
    results.forEach((result, index) =>
      context.report?.({
        source: `arxiv:${context.interests.categories[index]}`,
        state: result.status === 'fulfilled' ? 'ok' : 'error',
        fetchedAt: result.status === 'fulfilled' ? context.now.toISOString() : null,
        ...(result.status === 'rejected' ? { message: '분야별 새 논문을 가져오지 못했습니다.' } : {}),
      }),
    );
    if (results.length && results.every((result) => result.status === 'rejected')) throw new Error('arXiv categories unavailable');
    return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  },
};

export const huggingFaceSource: FeedSource = {
  id: 'huggingFace',
  async load(context) {
    const days = Array.from({ length: 7 }, (_, offset) => new Date(context.now.getTime() - offset * 86400000).toISOString().slice(0, 10));
    const results = await Promise.allSettled(
      days.map(async (day) => parseHfDaily(JSON.parse(await context.get(`https://huggingface.co/api/daily_papers?date=${day}`)) as unknown)),
    );
    results.forEach((result, index) =>
      context.report?.({
        source: `huggingFace:${days[index]}`,
        state: result.status === 'fulfilled' ? 'ok' : 'error',
        fetchedAt: result.status === 'fulfilled' ? context.now.toISOString() : null,
        ...(result.status === 'rejected' ? { message: '일별 순위를 가져오지 못했습니다.' } : {}),
      }),
    );
    if (results.every((result) => result.status === 'rejected')) throw new Error('Hugging Face unavailable');
    return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  },
};

export const newsSource: FeedSource = {
  id: 'news',
  async load(context) {
    const feeds = [...new Set([...curatedFeeds(context.interests.categories), ...context.rssFeeds])];
    const results = await Promise.allSettled(feeds.map(async (url) => parseSyndication(await context.get(url), new URL(url).hostname)));
    results.forEach((result, index) =>
      context.report?.({
        source: `news:${new URL(feeds[index]!).hostname}`,
        state: result.status === 'fulfilled' ? 'ok' : 'error',
        fetchedAt: result.status === 'fulfilled' ? context.now.toISOString() : null,
        ...(result.status === 'rejected' ? { message: '뉴스 피드를 가져오지 못했습니다.' } : {}),
      }),
    );
    if (results.every((result) => result.status === 'rejected')) throw new Error('모든 뉴스 피드를 가져오지 못했습니다.');
    return results
      .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
      .filter((item) => Date.parse(item.publishedAt) >= context.now.getTime() - 7 * 86400000);
  },
};

export const recommendationSource: FeedSource = {
  id: 'recommendations',
  async load(context) {
    const ids = context.libraryArxivIds.slice(0, 20);
    if (!ids.length) return [];
    const url = new URL('https://api.semanticscholar.org/recommendations/v1/papers/');
    url.searchParams.set('limit', '100');
    url.searchParams.set('fields', 'title,abstract,authors,year,publicationDate,url,externalIds,citationCount');
    const headers: Record<string, string> = {};
    if (process.env.SEMANTIC_SCHOLAR_API_KEY) headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
    const body = JSON.stringify({ positivePaperIds: ids.map((id) => `ARXIV:${id}`), negativePaperIds: [] });
    return parseRecommendations(JSON.parse(await context.get(url.href, headers, body)) as unknown);
  },
};

export class CachedFetcher {
  constructor(
    private readonly store: SqlitePaperStore,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async get(url: string, extraHeaders: Record<string, string> = {}, requestBody?: string): Promise<string> {
    const key = requestBody ? `${url}\n${requestBody}` : url;
    const previous = this.store.db.prepare('SELECT etag, modified, body FROM feed_fetch WHERE url=?').get(key) as
      { etag: string | null; modified: string | null; body: string } | undefined;
    const email = process.env.FRACTAL_CONTACT_EMAIL;
    const headers: Record<string, string> = {
      'User-Agent': email ? `Fractal/0.1 (mailto:${email})` : 'Fractal/0.1 (personal research reader)',
      ...extraHeaders,
    };
    if (requestBody) headers['Content-Type'] = 'application/json';
    if (previous?.etag && !requestBody) headers['If-None-Match'] = previous.etag;
    if (previous?.modified && !requestBody) headers['If-Modified-Since'] = previous.modified;
    const response = await this.fetcher(url, { method: requestBody ? 'POST' : 'GET', headers, body: requestBody, signal: AbortSignal.timeout(20000) });
    if (response.status === 304 && previous) return previous.body;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    if (body.length > 5_000_000) throw new Error('응답이 너무 큽니다.');
    this.store.db
      .prepare(
        'INSERT INTO feed_fetch(url,etag,modified,body,fetched_at) VALUES(?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET etag=excluded.etag,modified=excluded.modified,body=excluded.body,fetched_at=excluded.fetched_at',
      )
      .run(key, response.headers.get('etag'), response.headers.get('last-modified'), body, new Date().toISOString());
    return body;
  }
}
