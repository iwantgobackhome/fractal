import { describe, expect, it, vi } from 'vitest';
import { arxivCategories, arxivGroups, newsKeywordsForCategory, type FeedItem } from '@fractal/shared';
import { customSearchQuery, newsSource, parseSyndication } from './sources';
import { assertPublicImageUrl, dropSharedImages, fetchPublicArticle, fetchPublicImage, firstFigureImage, imageDimensions, ogImage } from './images';
import { newsMatchScore } from './news-relevance';
import { retainNewsByField } from './index';
import { toHttp } from '../api/errors';
import { mergeRelated } from './related';
import { RelatedPaperService } from './related';
import type { RelatedPaper } from '@fractal/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlitePaperStore } from '../store/sqlite';

describe('W5 feed sources', () => {
  it('has the full official taxonomy and builds bounded custom arXiv queries', () => {
    expect(arxivCategories).toHaveLength(155);
    expect(arxivCategories.find((category) => category.code === 'cs.CL')?.name.ko).toBe('전산언어학');
    expect(arxivGroups.find((group) => group.id === 'quant-ph')?.name.ko).toBe('양자물리학');
    expect(customSearchQuery('diffusion robot language')).toBe('all:diffusion AND all:robot AND all:language');
    expect(customSearchQuery('')).toBe('');
  });
  it('extracts RSS media and Bing thumbnails and HTML figure/og images', () => {
    const date = 'Tue, 29 Sep 2026 14:39:00 GMT';
    expect(
      parseSyndication(
        `<rss><item><title>Nature</title><link>https://nature.com/a</link><pubDate>${date}</pubDate><media:content url="https://nature.com/a.jpg"/></item></rss>`,
        'nature',
      )[0]?.imageCandidate,
    ).toBe('https://nature.com/a.jpg');
    expect(
      parseSyndication(
        `<rss><item><title>Bing</title><link>http://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Fexample.com%2Fa</link><pubDate>${date}</pubDate><News:Image>http://www.bing.com/p.jpg</News:Image></item></rss>`,
        'bing',
      )[0],
    ).toMatchObject({ url: 'https://example.com/a', imageCandidate: 'https://www.bing.com/p.jpg' });
    expect(firstFigureImage('<figure><img src="x.png"/><figcaption>Figure 1</figcaption></figure>', 'https://arxiv.org/html/123')).toBe(
      'https://arxiv.org/html/x.png',
    );
    expect(ogImage('<meta property="og:image" content="/cover.jpg">', 'https://example.com/a')).toBe('https://example.com/cover.jpg');
    expect(
      parseSyndication(
        `<rss><item><title>Vision model advances - Example Daily</title><link>https://news.google.com/articles/abc</link><source url="https://example.com">Example Daily</source><description>Computer vision research</description><pubDate>${date}</pubDate><media:thumbnail url="https://news.google.com/logo.png"/></item></rss>`,
        'news.google.com',
      )[0],
    ).toMatchObject({ title: 'Vision model advances', source: 'Example Daily', imageCandidate: undefined });
  });
  it('requires visible interest terms and rejects shared story images', () => {
    const interests = { categories: ['cs.CV'], topics: [], authors: [], custom: [] };
    expect(newsMatchScore('WISE volunteers identified 3,000 brown dwarfs', 'Astronomy discovery', interests, 'cs.CV')).toBe(0);
    expect(newsMatchScore('Computer vision model advances', 'Visual pattern recognition', interests, 'cs.CV')).toBeGreaterThanOrEqual(3);
    expect(newsMatchScore('컴퓨터 비전 연구', '', interests, 'cs.CV')).toBeGreaterThan(0);
    const image = { url: `/api/feed/images/${'a'.repeat(64)}` };
    const items = [
      { id: 'a', image: { ...image } },
      { id: 'b', image: { ...image } },
      { id: 'c', image: { url: `/api/feed/images/${'b'.repeat(64)}` } },
    ];
    dropSharedImages(items, new Map());
    expect(items.map((item) => item.image)).toEqual([null, null, { url: `/api/feed/images/${'b'.repeat(64)}` }]);
  });
  it('uses concise English and Korean searches and keeps general news unfiltered', async () => {
    const date = 'Tue, 29 Sep 2026 14:39:00 GMT';
    const xml = `<rss><item><title>WISE volunteers identified 3,000 brown dwarfs - Example</title><link>https://news.google.com/a</link><source>Example</source><description>Astronomy discovery</description><pubDate>${date}</pubDate></item><item><title>Computer vision advances - Example</title><link>https://news.google.com/b</link><source>Example</source><description>New recognition model</description><pubDate>${date}</pubDate></item></rss>`;
    const urls: string[] = [];
    const items = await newsSource.load({
      interests: { categories: ['cs.CV'], topics: [], authors: [], custom: [] },
      uiLanguage: 'ko',
      libraryArxivIds: [],
      rssFeeds: [],
      now: new Date('2026-09-30T00:00:00Z'),
      get: async (url) => {
        urls.push(url);
        return xml;
      },
    });
    expect(newsKeywordsForCategory('cs.CV')).toEqual({ en: ['computer vision', 'image recognition'], ko: ['컴퓨터 비전', '영상 인식'] });
    expect(urls.some((url) => new URL(url).searchParams.get('q')?.includes('컴퓨터 비전'))).toBe(true);
    expect(urls.some((url) => new URL(url).searchParams.get('q')?.includes('computer vision'))).toBe(true);
    expect(urls.some((url) => url.includes('Computer+Vision+and+Pattern+Recognition'))).toBe(false);
    expect(items.filter((item) => item.categories.includes('cs.CV')).every((item) => item.title.includes('Computer vision'))).toBe(true);
    expect(items.some((item) => item.categories.length === 0 && item.title.includes('WISE volunteers'))).toBe(true);
  });
  it('retains 30 stories per field and 40 general stories without a global news cap', () => {
    const news = (id: string, categories: string[]) => ({ id, kind: 'news', categories }) as FeedItem;
    const ranked = [
      ...Array.from({ length: 35 }, (_, index) => news(`ai-${index}`, ['cs.AI'])),
      ...Array.from({ length: 35 }, (_, index) => news(`cv-${index}`, ['cs.CV'])),
      ...Array.from({ length: 50 }, (_, index) => news(`general-${index}`, [])),
    ];
    const kept = retainNewsByField(ranked, { categories: ['cs.AI', 'cs.CV'], topics: [], authors: [], custom: [] });
    expect(kept).toHaveLength(100);
    expect(kept.filter((item) => item.categories.includes('cs.AI'))).toHaveLength(30);
    expect(kept.filter((item) => item.categories.includes('cs.CV'))).toHaveLength(30);
    expect(kept.filter((item) => item.categories.length === 0)).toHaveLength(40);
  });
  it('rejects private addresses, wrong image types, and oversized images', async () => {
    await expect(assertPublicImageUrl('https://127.0.0.1/a.png')).rejects.toThrow();
    await expect(assertPublicImageUrl('http://example.com/a.png')).rejects.toThrow();
    const resolver = vi.fn(async () => [{ address: '93.184.215.14', family: 4 }]) as any;
    await expect(
      fetchPublicImage('https://example.com/a', vi.fn(async () => new Response('text', { headers: { 'content-type': 'text/plain' } })) as any, resolver),
    ).rejects.toThrow('Unsupported');
    await expect(
      fetchPublicImage(
        'https://example.com/a',
        vi.fn(async () => new Response('x', { headers: { 'content-type': 'image/png', 'content-length': '6000000' } })) as any,
        resolver,
      ),
    ).rejects.toThrow('too large');
    await expect(
      fetchPublicArticle(
        'https://example.com/a',
        vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/secret' } })) as any,
        resolver,
      ),
    ).rejects.toThrow('Private');
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(imageDimensions(png, 'image/png')).toEqual({ width: 640, height: 480 });
  });
  it('merges related papers by stable identity and keeps relation and strongest count', () => {
    const base: RelatedPaper = {
      title: 'Same',
      authors: [],
      year: 2026,
      arxivId: '1234.56789',
      doi: null,
      url: 'https://arxiv.org/abs/1234.56789',
      relation: 'similar',
      inLibrary: false,
      citationCount: 10,
    };
    expect(mergeRelated([[base], [{ ...base, relation: 'cites', citationCount: 20, inLibrary: true }]])).toMatchObject([
      { relation: 'similar', citationCount: 20, inLibrary: true },
    ]);
  });
  it('caches Semantic Scholar results per paper for seven days', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fractal-related-'));
    const store = new SqlitePaperStore(root);
    try {
      store.savePaper({
        paperKey: '1706.03762v1',
        sourceKind: 'arxiv',
        arxivId: '1706.03762',
        version: 1,
        title: 'Attention Is All You Need',
        authors: [],
        sourceUrl: 'https://arxiv.org/abs/1706.03762',
        pdfSha256: null,
        pageCount: null,
        extractionVersion: null,
        status: 'fetching',
        coverage: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      const item = {
        title: 'Related',
        authors: [{ name: 'Ada' }],
        year: 2025,
        url: 'https://arxiv.org/abs/2501.12345',
        externalIds: { ArXiv: '2501.12345' },
        citationCount: 5,
      };
      const fetcher = vi.fn(
        async () => new Response(JSON.stringify({ references: [item], citations: [] }), { headers: { 'content-type': 'application/json' } }),
      ) as unknown as typeof fetch;
      const related = new RelatedPaperService(store, fetcher);
      expect((await related.get('1706.03762v1')).items).toMatchObject([{ title: 'Related', relation: 'cites' }]);
      expect((await related.get('1706.03762v1')).items).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      store.db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('falls back to OpenAlex immediately on a Semantic Scholar 429', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fractal-related-fallback-'));
    const store = new SqlitePaperStore(root);
    try {
      store.savePaper({
        paperKey: '2609.29233v1',
        sourceKind: 'arxiv',
        arxivId: '2609.29233',
        version: 1,
        title: 'Behavioral Shadows',
        authors: [],
        sourceUrl: 'https://arxiv.org/abs/2609.29233',
        pdfSha256: null,
        pageCount: null,
        extractionVersion: null,
        status: 'fetching',
        coverage: null,
        createdAt: '2026-09-30T00:00:00.000Z',
      });
      const fetcher = vi.fn(async (url: string) => {
        if (url.includes('semanticscholar.org')) return new Response('', { status: 429 });
        if (url.includes('/works/https://doi.org/'))
          return Response.json({ id: 'https://openalex.org/W1', related_works: ['https://openalex.org/W2'], referenced_works: [] });
        if (url.includes('openalex_id:'))
          return Response.json({
            results: [
              { id: 'https://openalex.org/W2', display_name: 'Related work', doi: 'https://doi.org/10.1000/test', authorships: [], publication_year: 2025 },
            ],
          });
        return Response.json({ results: [] });
      }) as unknown as typeof fetch;
      const started = Date.now();
      const result = await new RelatedPaperService(store, fetcher).get('2609.29233v1');
      expect(result).toMatchObject({ source: 'openAlex', items: [{ title: 'Related work', relation: 'similar' }] });
      expect(fetcher).toHaveBeenCalledTimes(4);
      expect(Date.now() - started).toBeLessThan(1000);
      const limited = vi.fn(async () => new Response('', { status: 429 })) as unknown as typeof fetch;
      store.db.prepare('DELETE FROM related_papers').run();
      const failure = await new RelatedPaperService(store, limited).get('2609.29233v1').catch((error: unknown) => error);
      expect(failure).toMatchObject({ error: { code: 'RELATED_RATE_LIMITED', retryable: true } });
      expect(limited).toHaveBeenCalledTimes(2);
      expect(toHttp(failure).status).toBe(429);
      const emptyFallback = vi.fn(async (url: string) =>
        url.includes('semanticscholar.org')
          ? new Response('', { status: 429 })
          : url.includes('/works/https://doi.org/')
            ? Response.json({ id: 'https://openalex.org/W1', related_works: [], referenced_works: [] })
            : Response.json({ results: [] }),
      ) as unknown as typeof fetch;
      await expect(new RelatedPaperService(store, emptyFallback).get('2609.29233v1')).rejects.toMatchObject({
        error: { code: 'RELATED_RATE_LIMITED' },
      });
    } finally {
      store.db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
