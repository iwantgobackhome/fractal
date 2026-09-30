import { describe, expect, it, vi } from 'vitest';
import { arxivCategories, arxivGroups } from '@fractal/shared';
import { customSearchQuery, parseSyndication } from './sources';
import { assertPublicImageUrl, fetchPublicArticle, fetchPublicImage, firstFigureImage, imageDimensions, ogImage } from './images';
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
        async (url: string) =>
          new Response(JSON.stringify(url.includes('recommendations') ? { recommendedPapers: [item] } : { references: [item], citations: [] }), {
            headers: { 'content-type': 'application/json' },
          }),
      ) as unknown as typeof fetch;
      const related = new RelatedPaperService(store, fetcher);
      expect((await related.get('1706.03762v1')).items).toMatchObject([{ title: 'Related', relation: 'similar' }]);
      expect((await related.get('1706.03762v1')).items).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      store.db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
