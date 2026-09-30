import { Readability } from '@mozilla/readability';
import { lookup } from 'node:dns/promises';
import { parseHTML } from 'linkedom';
import type { Article, ArticleBlock, FeedItem } from '@fractal/shared';
import type { SqlitePaperStore } from '../store/sqlite';
import { appError } from '../store/errors';
import { assertPublicImageUrl, fetchPublicArticle, ogImage, type FeedImageStore } from './images';

function publicImage(raw: string | null | undefined, pageUrl: string, images: FeedImageStore | null): FeedItem['image'] {
  if (!raw || !images) return null;
  try {
    const url = new URL(raw, pageUrl);
    if (url.protocol !== 'https:' || url.hostname === 'news.google.com') return null;
    return images.register(url.href);
  } catch {
    return null;
  }
}

export function extractArticleHtml(html: string, url: string, originalUrl: string, images: FeedImageStore | null): Article | null {
  const { document } = parseHTML(html);
  const article = new Readability(document as unknown as Document, { charThreshold: 100 }).parse();
  if (!article?.title || !article.content || (article.textContent?.trim().length ?? 0) < 100) return null;
  const content = parseHTML(article.content).document;
  const blocks: ArticleBlock[] = [];
  for (const node of content.querySelectorAll('p,h2,h3,blockquote,li,img')) {
    const tag = node.localName;
    if (node.parentElement?.closest('p,h2,h3,blockquote,li')) continue;
    if (tag === 'img') {
      const image = publicImage(node.getAttribute('src'), url, images);
      if (image) blocks.push({ type: 'img', image });
    } else {
      const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (text.length >= 3) blocks.push({ type: tag === 'blockquote' ? 'quote' : (tag as ArticleBlock['type']), text });
    }
  }
  if (blocks.length === 0) return null;
  const leadImage = publicImage(ogImage(html, url), url, images);
  const publishedAt = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ?? undefined;
  return {
    url: originalUrl,
    finalUrl: url,
    title: article.title,
    ...(article.byline ? { byline: article.byline } : {}),
    ...(article.siteName ? { siteName: article.siteName } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(document.documentElement.getAttribute('lang') ? { lang: document.documentElement.getAttribute('lang')! } : {}),
    ...(leadImage ? { leadImage } : {}),
    blocks,
  };
}

function publisherLink(html: string, base: string): string | null {
  if (!new URL(base).hostname.endsWith('news.google.com')) return null;
  const { document } = parseHTML(html);
  const values = [
    document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    document.querySelector('meta[property="og:url"]')?.getAttribute('content'),
    document
      .querySelector('meta[http-equiv="refresh"]')
      ?.getAttribute('content')
      ?.match(/url=(.+)$/i)?.[1],
  ];
  for (const value of values) {
    if (!value) continue;
    try {
      const target = new URL(value, base);
      if (target.protocol === 'https:' && !target.hostname.endsWith('google.com') && !target.hostname.endsWith('news.google.com')) return target.href;
    } catch {
      /* continue */
    }
  }
  return null;
}

/** Google News RSS links use an opaque article ID. Resolve it through the same
 * endpoint the public Google News page uses, then apply the normal HTTPS/DNS guard. */
export async function decodeGooglePublisher(html: string, sourceUrl: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const id = /\/(?:articles|read)\/([A-Za-z0-9_-]{20,1000})(?:[/?]|$)/.exec(new URL(sourceUrl).pathname)?.[1];
  const signature = /data-n-a-sg="([A-Za-z0-9_-]+)"/.exec(html)?.[1];
  const timestamp = /data-n-a-ts="(\d+)"/.exec(html)?.[1];
  if (!id || !signature || !timestamp) return null;
  const inner = JSON.stringify([
    'garturlreq',
    [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id,
    Number(timestamp),
    signature,
  ]);
  const form = new URLSearchParams({ 'f.req': JSON.stringify([[['Fbv4je', inner]]]) });
  const response = await fetcher('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(7000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Origin: 'https://news.google.com', Referer: 'https://news.google.com/' },
  });
  if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 100_000) return null;
  const body = await response.text();
  if (body.length > 100_000) return null;
  for (const line of body.split('\n')) {
    if (!line.startsWith('[[')) continue;
    try {
      const outer = JSON.parse(line) as unknown[][];
      const innerResult = JSON.parse(String(outer[0]?.[2])) as unknown[];
      const target = innerResult[1];
      if (typeof target === 'string' && target.startsWith('https://')) return target;
    } catch {
      /* Another response chunk. */
    }
  }
  return null;
}

export class ArticleReader {
  constructor(
    private readonly store: SqlitePaperStore,
    private readonly images: FeedImageStore | null,
    private readonly fetcher: typeof fetch = fetch,
    private readonly resolver: typeof lookup = lookup,
  ) {}
  async get(url: string): Promise<Article> {
    try {
      await assertPublicImageUrl(url, this.resolver);
    } catch {
      throw appError('INVALID_INPUT', 'Article URL must be public HTTPS.');
    }
    const cached = this.store.db.prepare('SELECT data,fetched_at FROM news_articles WHERE url=?').get(url) as { data: string; fetched_at: string } | undefined;
    if (cached && Date.now() - Date.parse(cached.fetched_at) < 86400000) return JSON.parse(cached.data) as Article;
    try {
      let fetched = await fetchPublicArticle(url, this.fetcher, this.resolver);
      const publisher =
        publisherLink(fetched.html, fetched.url) ??
        (new URL(fetched.url).hostname === 'news.google.com' ? await decodeGooglePublisher(fetched.html, fetched.url, this.fetcher) : null);
      if (publisher) {
        await assertPublicImageUrl(publisher, this.resolver);
        fetched = await fetchPublicArticle(publisher, this.fetcher, this.resolver);
      }
      const article = extractArticleHtml(fetched.html, fetched.url, url, this.images);
      if (!article) throw new Error('No readable article');
      this.store.db
        .prepare(
          'INSERT INTO news_articles(url,data,fetched_at) VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at',
        )
        .run(url, JSON.stringify(article), new Date().toISOString());
      return article;
    } catch {
      throw appError('ARTICLE_UNAVAILABLE', 'This article could not be read here. Open it in your browser.');
    }
  }
}
