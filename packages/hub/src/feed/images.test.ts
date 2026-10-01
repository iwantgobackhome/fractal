import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { SqlitePaperStore } from '../store/sqlite';
import { FeedImageStore, articleImageCandidates, figureImageCandidates, imageDimensions, fetchPublicArticle } from './images';
import { publicGet } from '../publication/network';
import { FeedService } from './index';
import type { PaperAcquirer } from '../api/index';
import type { FeedSource, RawItem } from './sources';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.215.14', family: 4 }]) }));
const directories: string[] = [];
const stores: SqlitePaperStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function setup(fetcher: typeof fetch, now = Date.now) {
  const root = mkdtempSync(join(tmpdir(), 'thumbnail-test-'));
  directories.push(root);
  const store = new SqlitePaperStore(root);
  stores.push(store);
  return { root, store, images: new FeedImageStore(store, root, fetcher, undefined, now) };
}
const png = (width = 640, height = 480) => {
  // Controlled header fixture, not evidence of real public image decoding.
  const body = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(body);
  body.writeUInt32BE(width, 16);
  body.writeUInt32BE(height, 20);
  return body;
};
const base: RawItem = {
  id: 'arxiv:2609.40325',
  kind: 'paper',
  title: 'World audit',
  authors: ['Researcher'],
  abstract: 'A paper.',
  source: 'arxiv',
  url: 'https://arxiv.org/abs/2609.40325v1',
  arxivId: '2609.40325',
  doi: null,
  categories: ['cs.AI'],
  publishedAt: '2026-09-30T00:00:00.000Z',
  popularity: 0,
  image: null,
};
const figure = (src: string, caption = 'Figure 1: Result') => `<figure><img src="${src}"><figcaption>${caption}</figcaption></figure>`;

describe('first content image discovery', () => {
  it('keeps figure order, resolves relative/lazy/picture/srcset sources, and rejects non-figures', () => {
    const html = `<img src="cover.jpg"><figure><img src="logo.png"><figcaption>Figure 0</figcaption></figure>
      ${figure('equation.png')}${figure('supplement.png', 'Supplementary Figure 1')}
      <figure><picture><source srcset="small.webp 320w, big.webp 800w"><img src="placeholder.svg" data-src="../first.png?a=1&amp;b=2"></picture><figcaption>Figure 1: Method</figcaption></figure>
      <div class="fig" id="fig2"><img src="second.jpg"><div class="caption">Figure 2: Data</div></div>`;
    expect(figureImageCandidates(html, 'https://example.com/paper/full')).toEqual([
      'https://example.com/first.png?a=1&b=2',
      'https://example.com/paper/big.webp',
      'https://example.com/paper/small.webp',
      'https://example.com/paper/second.jpg',
    ]);
  });
  it('prefers first real news content image over OG and ignores icons, equations, avatars and pixels', () => {
    const html = `<html><head><meta property="og:image" content="/lead.jpg"></head><body>
      <header><img src="/brand.jpg" alt="publisher logo"></header><article><h1>Science news</h1>
      <img src="/person.jpg" class="avatar"><img src="/math.png" alt="equation"><img src="/beacon.png" width="1" height="1">
      <img src="data:image/gif;base64,x" data-src="/content.jpg"><img src="/later.jpg"></article></body></html>`;
    expect(articleImageCandidates(html, 'https://example.com/news')).toEqual([
      'https://example.com/content.jpg',
      'https://example.com/later.jpg',
      'https://example.com/lead.jpg',
    ]);
    expect(articleImageCandidates('<meta property="og:image" content="/site-logo.jpg">', 'https://example.com/news')).toEqual([]);
  });
  it('prefers captioned HTML figure over provider thumbnail and pins explicit arXiv revision', async () => {
    const fetcher = vi.fn(async () => new Response(png(), { headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch;
    const { images } = setup(fetcher);
    const page = vi.fn(async (_url: string) => ({ html: figure('/first.png') + figure('/second.png'), url: 'https://arxiv.org/html/2609.40325v1' }));
    const item = { ...base, image: null, imageCandidate: 'https://example.com/provider.jpg' };
    const selected = await images.thumbnail(item, page);
    expect(page.mock.calls[0]?.[0]).toBe('https://arxiv.org/html/2609.40325v1');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://arxiv.org/first.png', expect.anything());
    expect(selected?.image).toMatchObject({ width: 640, height: 480, alt: base.title });
  });
  it('tries next figure after a failed candidate, then reuses bytes/discovery and persistent negative cache', async () => {
    let time = 1000;
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith('/first.png') ? new Response('missing', { status: 404 }) : new Response(png(), { headers: { 'content-type': 'image/png' } }),
    ) as unknown as typeof fetch;
    const { images, store, root } = setup(fetcher, () => time);
    const page = vi.fn(async () => ({ html: figure('/first.png') + figure('/second.png'), url: base.url }));
    const item = { ...base, image: null };
    const selected = await images.thumbnail(item, page);
    expect(selected?.image.url).toBe(images.register('https://arxiv.org/second.png')?.url);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const restart = new FeedImageStore(store, root, fetcher, undefined, () => time);
    expect(await restart.thumbnail(item, page)).toEqual(selected);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(page).toHaveBeenCalledTimes(1);
    time += 3600001;
    await restart.thumbnail(item, page);
    expect(fetcher).toHaveBeenCalledTimes(3); // retry failed first candidate after its negative TTL
    expect(page).toHaveBeenCalledTimes(1);
  });
  it('uses trustworthy source fallback when HTML is unavailable, and leaves no-image rows clean without PDF requests', async () => {
    const fetcher = vi.fn(async () => new Response(png(), { headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch;
    const { images } = setup(fetcher);
    const page = vi.fn(async () => {
      throw new Error('HTML unavailable');
    });
    const selected = await images.thumbnail({ ...base, image: null, imageCandidate: 'https://example.com/provider.png' }, page);
    expect(selected?.image.url).toBe(images.register('https://example.com/provider.png')?.url);
    expect(await images.thumbnail({ ...base, url: base.url + '?no-image', image: null }, page)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetcher).mock.calls.every(([url]) => !String(url).includes('/pdf/'))).toBe(true);
  });
  it('rejects tiny/wrong raster bytes and bounds fallback attempts', async () => {
    const fetcher = vi.fn(async () => new Response(png(1, 1), { headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch;
    const { images } = setup(fetcher);
    const page = async () => ({ html: Array.from({ length: 20 }, (_, i) => figure(`/figure-${i}.png`)).join(''), url: base.url });
    expect(await images.thumbnail({ ...base, image: null }, page)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(await images.thumbnail({ ...base, image: null }, page)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('deduplicates concurrent image fetches and caps network concurrency at four', async () => {
    let active = 0,
      maximum = 0;
    const fetcher = vi.fn(async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return new Response(png(), { headers: { 'content-type': 'image/png' } });
    }) as unknown as typeof fetch;
    const { images } = setup(fetcher);
    const hashes = Array.from({ length: 12 }, (_, i) => images.register(`https://example.com/image-${i}.png`)!.url.split('/').at(-1)!);
    await Promise.all([...hashes, hashes[0]!].map((hash) => images.get(hash)));
    expect(fetcher).toHaveBeenCalledTimes(12);
    expect(maximum).toBe(4);
  });
  it('reads common lossy/lossless WebP dimensions', () => {
    const lossy = Buffer.alloc(30);
    lossy.write('RIFF');
    lossy.write('VP8 ', 12);
    Buffer.from([157, 1, 42]).copy(lossy, 23);
    lossy.writeUInt16LE(640, 26);
    lossy.writeUInt16LE(480, 28);
    expect(imageDimensions(lossy, 'image/webp')).toEqual({ width: 640, height: 480 });
    const lossless = Buffer.alloc(25);
    lossless.write('RIFF');
    lossless.write('VP8L', 12);
    lossless[20] = 0x2f;
    lossless.writeUInt32LE(639 | (479 << 14), 21);
    expect(imageDimensions(lossless, 'image/webp')).toEqual({ width: 640, height: 480 });
  });
  it('rejects PDF discovery responses before reading a byte and cancels stalled HTML body reads', async () => {
    const read = vi.fn(async () => ({ done: true as const, value: undefined }));
    await expect(
      publicGet('https://example.com/paper', {
        acceptedContentTypes: ['text/html'],
        lookup: async () => [{ address: '93.184.215.14', family: 4 }],
        request: async () => ({ status: 200, headers: { 'content-type': 'application/pdf' }, body: { [Symbol.asyncIterator]: () => ({ next: read }) } }),
      }),
    ).rejects.toThrow('Unsupported response content type');
    expect(read).not.toHaveBeenCalled();
    const controller = new AbortController();
    const stalled = vi.fn(
      async () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'text/html' } }),
    ) as unknown as typeof fetch;
    const work = fetchPublicArticle(base.url, stalled, undefined, controller.signal);
    await vi.waitFor(() => expect(stalled).toHaveBeenCalledTimes(1));
    controller.abort(new Error('deadline'));
    await expect(work).rejects.toThrow('deadline');
  });
});

describe('feed thumbnail integration', () => {
  it('commits metadata with text-only rows at its total deadline and has no late image mutation', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const { store, root } = setup(fetcher);
    const now = new Date('2026-09-30T12:00:00.000Z');
    const sources: FeedSource[] = [
      {
        id: 'arxiv',
        load: async () => [
          base,
          { ...base, id: 'news:one', kind: 'news', title: 'Science news', url: 'https://example.com/story', arxivId: null, categories: [] },
        ],
      },
    ];
    const feed = new FeedService(store, {} as PaperAcquirer, undefined, fetcher, () => now, sources, root);
    feed.putSettings({ ...feed.settings(), translateNewsTitles: false });
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => deadline.signal);
    try {
      const work = feed.refresh();
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      expect(vi.mocked(fetcher).mock.calls.map(([url]) => String(url))).toEqual(['https://arxiv.org/html/2609.40325v1', 'https://example.com/story']);
      deadline.abort(new Error('total deadline'));
      const result = await work;
      expect(result.sections.top[0]?.image).toBeNull();
      expect(result.sections.news[0]?.image).toBeNull();
      expect(result.sourceStatus[0]?.state).toBe('ok');
      expect(result.generatedAt).toBe(now.toISOString());
      const snapshot = JSON.stringify(feed.read());
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(JSON.stringify(feed.read())).toBe(snapshot);
      expect(store.db.prepare("SELECT count(*) AS count FROM feed_meta WHERE key LIKE 'thumbnail:%'").get()).toEqual({ count: 0 });
    } finally {
      timeout.mockRestore();
      await feed.stop();
    }
  });
  it('updates only optional images while preserving saved/read/library/publication identity and old feed cache', async () => {
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(url.endsWith('.png') ? png() : figure('/figure.png'), { headers: { 'content-type': url.endsWith('.png') ? 'image/png' : 'text/html' } }),
    ) as unknown as typeof fetch;
    const { store, root } = setup(fetcher);
    const now = new Date('2026-09-30T12:00:00.000Z');
    const item = {
      ...base,
      publication: {
        year: 2026,
        venue: null,
        publicationDate: '2026-09-30',
        publicationKind: 'preprint' as const,
        oaAvailability: 'open' as const,
        oaPdfUrl: null,
        sources: [],
      },
    };
    const sources: FeedSource[] = [{ id: 'arxiv', load: async () => [item] }];
    const feed = new FeedService(store, {} as PaperAcquirer, undefined, fetcher, () => now, sources, root);
    feed.putSettings({ ...feed.settings(), translateNewsTitles: false });
    const old = { ...base, id: 'old-week-paper' };
    store.db.prepare('INSERT INTO feed_items(week,id,data) VALUES(?,?,?)').run('2026-W39', old.id, JSON.stringify(old));
    try {
      const first = (await feed.refresh()).sections.top[0]!;
      expect(first.id).toBe(base.id);
      expect(first.image).toMatchObject({ width: 640, height: 480 });
      const saved = await feed.save(base.id);
      const before = JSON.stringify(store.listLibrary());
      expect((await feed.refresh()).sections.top[0]).toMatchObject({ id: base.id, inLibrary: true, publication: item.publication });
      expect(JSON.stringify(store.listLibrary())).toBe(before);
      expect(await feed.save(base.id)).toEqual(saved);
      expect(store.db.prepare('SELECT data FROM feed_items WHERE week=?').get('2026-W39')).toEqual({ data: JSON.stringify(old) });
      const hash = first.image!.url.split('/').at(-1)!;
      expect(
        createHash('sha256')
          .update((await feed.image(hash))!.body)
          .digest('hex'),
      ).toBe(createHash('sha256').update(png()).digest('hex'));
    } finally {
      await feed.stop();
    }
  });
});
