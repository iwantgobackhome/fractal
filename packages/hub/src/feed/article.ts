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
  } catch { return null; }
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
      if (text.length >= 3) blocks.push({ type: tag === 'blockquote' ? 'quote' : tag as ArticleBlock['type'], text });
    }
  }
  if (blocks.length === 0) return null;
  const leadImage = publicImage(ogImage(html, url), url, images);
  const publishedAt = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ?? undefined;
  return {
    url: originalUrl, finalUrl: url, title: article.title,
    ...(article.byline ? { byline: article.byline } : {}),
    ...(article.siteName ? { siteName: article.siteName } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(document.documentElement.getAttribute('lang') ? { lang: document.documentElement.getAttribute('lang')! } : {}),
    ...(leadImage ? { leadImage } : {}), blocks,
  };
}

function publisherLink(html: string, base: string): string | null {
  if (!new URL(base).hostname.endsWith('news.google.com')) return null;
  const { document } = parseHTML(html);
  const values = [
    document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    document.querySelector('meta[property="og:url"]')?.getAttribute('content'),
    document.querySelector('meta[http-equiv="refresh"]')?.getAttribute('content')?.match(/url=(.+)$/i)?.[1],
    ...[...document.querySelectorAll('a[href]')].slice(0, 100).map((node) => node.getAttribute('href')),
  ];
  for (const value of values) {
    if (!value) continue;
    try {
      const target = new URL(value, base);
      if (target.protocol === 'https:' && !target.hostname.endsWith('google.com') && !target.hostname.endsWith('news.google.com')) return target.href;
    } catch { /* continue */ }
  }
  return null;
}

export class ArticleReader {
  constructor(private readonly store: SqlitePaperStore, private readonly images: FeedImageStore | null, private readonly fetcher: typeof fetch = fetch, private readonly resolver: typeof lookup = lookup) {}
  async get(url: string): Promise<Article> {
    try { await assertPublicImageUrl(url, this.resolver); } catch { throw appError('INVALID_INPUT', 'Article URL must be public HTTPS.'); }
    const cached = this.store.db.prepare('SELECT data,fetched_at FROM news_articles WHERE url=?').get(url) as { data: string; fetched_at: string } | undefined;
    if (cached && Date.now() - Date.parse(cached.fetched_at) < 86400000) return JSON.parse(cached.data) as Article;
    try {
      let fetched = await fetchPublicArticle(url, this.fetcher, this.resolver);
      const publisher = publisherLink(fetched.html, fetched.url);
      if (publisher) fetched = await fetchPublicArticle(publisher, this.fetcher, this.resolver);
      const article = extractArticleHtml(fetched.html, fetched.url, url, this.images);
      if (!article) throw new Error('No readable article');
      this.store.db.prepare('INSERT INTO news_articles(url,data,fetched_at) VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at')
        .run(url, JSON.stringify(article), new Date().toISOString());
      return article;
    } catch { throw appError('ARTICLE_UNAVAILABLE', 'This article could not be read here. Open it in your browser.'); }
  }
}
