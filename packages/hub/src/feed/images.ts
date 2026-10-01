import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import type { SqlitePaperStore } from '../store/sqlite';
import type { FeedItem } from '@fractal/shared';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { publicGet, validatePublicUrl } from '../publication/network';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CACHE_BYTES = 300 * 1024 * 1024;
const types = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
/** A picture reused by separate stories is usually a publisher or aggregator logo. */
export function dropSharedImages(items: Pick<FeedItem, 'id' | 'image'>[], fingerprints: Map<string, string>): void {
  const users = new Map<string, Set<string>>();
  for (const item of items) {
    if (!item.image) continue;
    for (const key of [item.image.url, fingerprints.get(item.id)].filter((value): value is string => !!value)) {
      const stories = users.get(key) ?? new Set<string>();
      stories.add(item.id);
      users.set(key, stories);
    }
  }
  for (const item of items) {
    if (item.image && [item.image.url, fingerprints.get(item.id)].some((key) => key && (users.get(key)?.size ?? 0) > 1)) item.image = null;
  }
}
export function imageDimensions(body: Buffer, type: string): { width: number; height: number } | null {
  if (type === 'image/png' && body.length >= 24 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
  if (type === 'image/gif' && body.length >= 10 && body.toString('ascii', 0, 3) === 'GIF') return { width: body.readUInt16LE(6), height: body.readUInt16LE(8) };
  if (type === 'image/webp' && body.length >= 30 && body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 12, 16) === 'VP8X')
    return { width: body.readUIntLE(24, 3) + 1, height: body.readUIntLE(27, 3) + 1 };
  if (type === 'image/webp' && body.length >= 30 && body.toString('ascii', 12, 16) === 'VP8 ' && body.subarray(23, 26).equals(Buffer.from([157, 1, 42])))
    return { width: body.readUInt16LE(26) & 0x3fff, height: body.readUInt16LE(28) & 0x3fff };
  if (type === 'image/webp' && body.length >= 25 && body.toString('ascii', 12, 16) === 'VP8L' && body[20] === 0x2f) {
    const bits = body.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (type === 'image/avif' && body.toString('ascii', 4, 8) === 'ftyp' && body.toString('ascii', 8, 32).includes('avif')) {
    const offset = body.indexOf('ispe', 0, 'ascii');
    if (offset >= 4 && offset + 16 <= body.length && body.readUInt32BE(offset - 4) === 20)
      return { width: body.readUInt32BE(offset + 8), height: body.readUInt32BE(offset + 12) };
  }
  if (type === 'image/jpeg' && body.length >= 4 && body[0] === 0xff && body[1] === 0xd8) {
    let pos = 2;
    while (pos + 9 < body.length) {
      if (body[pos] !== 0xff) break;
      const marker = body[pos + 1]!;
      const length = body.readUInt16BE(pos + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker))
        return { width: body.readUInt16BE(pos + 7), height: body.readUInt16BE(pos + 5) };
      if (length < 2) break;
      pos += length + 2;
    }
  }
  return null;
}
function privateIp(value: string): boolean {
  const ip = value.toLowerCase().replace(/^::ffff:/, '');
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || a! >= 224;
  }
  if (isIP(ip) === 6) return ip === '::1' || ip === '::' || ip.startsWith('fc') || ip.startsWith('fd') || /^fe[89ab]/.test(ip) || ip.startsWith('2001:db8');
  return true;
}
export async function assertPublicImageUrl(raw: string, resolver: typeof lookup = lookup): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Image URL must be public HTTPS');
  if (isIP(url.hostname)) {
    if (privateIp(url.hostname)) throw new Error('Private image address');
  } else {
    const addresses = await resolver(url.hostname, { all: true });
    if (!addresses.length || addresses.some((address) => privateIp(address.address))) throw new Error('Private image address');
  }
  return url;
}
export async function fetchPublicImage(
  raw: string,
  fetcher: typeof fetch = fetch,
  resolver: typeof lookup = lookup,
  signal?: AbortSignal,
): Promise<{ body: Buffer; contentType: string; url: string }> {
  if (fetcher === fetch) {
    const result = await publicGet(raw, { maxBytes: MAX_IMAGE_BYTES, timeoutMs: 8000, signal, acceptedContentTypes: [...types] });
    if (!types.has(result.contentType)) throw new Error('Unsupported image type');
    return { body: result.bytes, contentType: result.contentType, url: result.url };
  }
  let url = raw;
  const scopedSignal = AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]);
  for (let redirects = 0; redirects < 5; redirects++) {
    await abortable(assertPublicImageUrl(url, resolver), scopedSignal);
    const response = await abortable(
      fetcher(url, {
        redirect: 'manual',
        signal: scopedSignal,
        headers: { 'User-Agent': 'Fractal/0.1 (personal research reader)' },
      }),
      scopedSignal,
    );
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      void response.body?.cancel().catch(() => {});
      if (!location) throw new Error('Image redirect missing location');
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
    const contentType = response.headers.get('content-type')?.split(';')[0]?.toLowerCase() ?? '';
    if (!types.has(contentType)) throw new Error('Unsupported image type');
    if (Number(response.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) throw new Error('Image too large');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty image');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await abortable(reader.read(), scopedSignal);
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_IMAGE_BYTES) throw new Error('Image too large');
        chunks.push(chunk.value);
      }
    } finally {
      await abortable(reader.cancel(), scopedSignal).catch(() => {});
      reader.releaseLock();
    }
    return { body: Buffer.concat(chunks), contentType, url };
  }
  throw new Error('Too many image redirects');
}
export async function fetchPublicArticle(
  raw: string,
  fetcher: typeof fetch = fetch,
  resolver: typeof lookup = lookup,
  signal?: AbortSignal,
): Promise<{ html: string; url: string }> {
  if (fetcher === fetch) {
    const result = await publicGet(raw, { maxBytes: 2 * 1024 * 1024, timeoutMs: 8000, signal, acceptedContentTypes: ['text/html', 'application/xhtml+xml'] });
    if (!['text/html', 'application/xhtml+xml'].includes(result.contentType)) throw new Error('Article is not HTML');
    return { html: result.bytes.toString('utf8'), url: result.url };
  }
  let url = raw;
  const scopedSignal = AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]);
  for (let redirects = 0; redirects < 5; redirects++) {
    await abortable(assertPublicImageUrl(url, resolver), scopedSignal);
    const response = await abortable(
      fetcher(url, {
        redirect: 'manual',
        signal: scopedSignal,
        headers: { 'User-Agent': 'Fractal/0.1 (personal research reader)' },
      }),
      scopedSignal,
    );
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      void response.body?.cancel().catch(() => {});
      if (!location) throw new Error('Article redirect missing location');
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok || !/^(text\/html|application\/xhtml\+xml)/i.test(response.headers.get('content-type') ?? '')) throw new Error('Article is not HTML');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty article');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await abortable(reader.read(), scopedSignal);
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 2 * 1024 * 1024) throw new Error('Article too large');
        chunks.push(chunk.value);
      }
    } finally {
      await abortable(reader.cancel(), scopedSignal).catch(() => {});
      reader.releaseLock();
    }
    return { html: Buffer.concat(chunks).toString('utf8'), url };
  }
  throw new Error('Too many article redirects');
}
const MAX_CANDIDATES = 6;
const unwanted =
  /(?:logo|favicon|avatar|gravatar|tracking|spacer|placeholder|(?:^|[\/_\s.-])(?:pixel|badge|sprite|icon)(?:[\/_\s.-]|$)|equation|formula|mathjax|ltx_eq|supplement)/i;
/** Only raster HTTPS candidates; final DNS/type/size validation happens before caching. */
export function suitableImageUrl(raw: string | null | undefined, pageUrl: string): string | null {
  if (!raw || raw.length > 4096) return null;
  try {
    const url = validatePublicUrl(new URL(raw.replace(/&amp;/g, '&'), pageUrl).href);
    if (url.hostname === 'news.google.com' || /\.(?:svg|pdf)(?:$|\?)/i.test(url.pathname) || unwanted.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}
function srcsetValues(raw: string | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((part) => {
      const [url, descriptor] = part.trim().split(/\s+/);
      return { url: url ?? '', size: Number.parseFloat(descriptor ?? '1') || 1 };
    })
    .sort((a, b) => b.size - a.size)
    .map((entry) => entry.url);
}
/** Variants belong to the same content image, so exhaust them before moving to the next figure. */
export function imageElementUrls(node: Element, pageUrl: string): string[] {
  if (unwanted.test([node.getAttribute('alt'), node.getAttribute('class'), node.getAttribute('id'), node.getAttribute('role')].join(' '))) return [];
  if (
    node.closest(
      'nav,footer,aside,[aria-hidden="true"],.ltx_equation,.ltx_eqn_table,.ltx_table,.related,.related-articles,.related-news,.news-article--related-news,.recent-news,[class*="related-archive"],[class*="recent-news--teaser"]',
    )
  )
    return [];
  const width = Number(node.getAttribute('width')),
    height = Number(node.getAttribute('height'));
  if ((width > 0 && width < 80) || (height > 0 && height < 60)) return [];
  const sources = [...(node.parentElement?.localName === 'picture' ? node.parentElement.querySelectorAll('source') : [])];
  const raw = [
    node.getAttribute('data-src'),
    node.getAttribute('data-original'),
    node.getAttribute('data-lazy-src'),
    ...srcsetValues(node.getAttribute('data-srcset')),
    ...sources.flatMap((source) => srcsetValues(source.getAttribute('data-srcset') ?? source.getAttribute('srcset'))),
    ...srcsetValues(node.getAttribute('srcset')),
    node.getAttribute('src'),
  ];
  return [...new Set(raw.map((value) => suitableImageUrl(value, pageUrl)).filter((value): value is string => !!value))].slice(0, 3);
}
export function figureImageCandidates(html: string, pageUrl: string): string[] {
  const { document } = parseHTML(html);
  const candidates: string[] = [];
  for (const figure of document.querySelectorAll('figure,.ltx_figure,.fig,.fig-group,[id^="fig"],[id^="Fig"]')) {
    const caption = figure.querySelector('figcaption,caption,.ltx_caption,.caption,.fig-caption');
    if (!caption || !caption.textContent?.trim() || /^\s*(?:table|algorithm|equation|supplementary(?:\s+figure)?)\b/i.test(caption.textContent)) continue;
    if (unwanted.test([figure.id, figure.className].join(' '))) continue;
    for (const node of figure.querySelectorAll('img')) candidates.push(...imageElementUrls(node as unknown as Element, pageUrl));
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return [...new Set(candidates)].slice(0, MAX_CANDIDATES);
}
export function firstFigureImage(html: string, pageUrl: string): string | null {
  return figureImageCandidates(html, pageUrl)[0] ?? null;
}
export function ogImage(html: string, pageUrl: string): string | null {
  const { document } = parseHTML(html);
  for (const tag of document.querySelectorAll('meta[property="og:image"],meta[name="og:image"],meta[name="twitter:image"]')) {
    const url = suitableImageUrl(tag.getAttribute('content'), pageUrl);
    if (url) return url;
  }
  return null;
}
export function articleImageCandidates(html: string, pageUrl: string): string[] {
  const { document } = parseHTML(html);
  let content = document.querySelector('article,[itemprop="articleBody"],.article-body,.entry-content');
  if (!content) {
    const readable = new Readability(document.cloneNode(true) as unknown as Document, { charThreshold: 100 }).parse();
    content = readable?.content ? parseHTML(readable.content).document.documentElement : document.querySelector('main');
  }
  const candidates: string[] = [];
  if (content)
    for (const node of content.querySelectorAll('img')) {
      candidates.push(...imageElementUrls(node as unknown as Element, pageUrl));
      if (candidates.length >= MAX_CANDIDATES) break;
    }
  for (const node of document.querySelectorAll(
    '[itemprop="image"] img,img[itemprop="image"],.article-hero img,.hero-image img,.news-article--media--image img',
  ))
    candidates.push(...imageElementUrls(node as unknown as Element, pageUrl));
  const og = ogImage(html, pageUrl);
  if (og) candidates.push(og);
  return [...new Set(candidates)].slice(0, MAX_CANDIDATES);
}
export class FeedImageStore {
  private readonly directory: string;
  private readonly pending = new Map<string, Promise<{ body: Buffer; contentType: string } | null>>();
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(
    private readonly store: SqlitePaperStore,
    root: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly signal?: AbortSignal,
    private readonly now: () => number = Date.now,
    private readonly resolver: typeof lookup = lookup,
  ) {
    this.directory = join(root, 'feed-images');
    mkdirSync(this.directory, { recursive: true });
  }
  register(url: string): { url: string } | null {
    try {
      const suitable = suitableImageUrl(url, url);
      if (!suitable) return null;
      const parsed = new URL(suitable);
      const hash = createHash('sha256').update(parsed.href).digest('hex');
      this.store.db.prepare('INSERT OR IGNORE INTO feed_images(hash,source_url) VALUES(?,?)').run(hash, parsed.href);
      return { url: `/api/feed/images/${hash}` };
    } catch {
      return null;
    }
  }
  article(url: string, signal?: AbortSignal): Promise<{ html: string; url: string }> {
    return fetchPublicArticle(url, this.fetcher, this.resolver, this.scopedSignal(signal));
  }
  private scopedSignal(signal?: AbortSignal): AbortSignal | undefined {
    return this.signal && signal ? AbortSignal.any([this.signal, signal]) : (this.signal ?? signal);
  }
  private meta<T>(key: string): T | undefined {
    const row = this.store.db.prepare('SELECT data FROM feed_meta WHERE key=?').get(key) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : undefined;
  }
  private putMeta(key: string, value: unknown): void {
    this.store.db.prepare('INSERT INTO feed_meta(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(key, JSON.stringify(value));
  }
  /** Policy key upgrades only image discovery; existing feed/library/cache identities stay intact. */
  async thumbnail(
    item: Pick<FeedItem, 'kind' | 'title' | 'url' | 'arxivId' | 'image'> & { imageCandidate?: string },
    page: (url: string, signal?: AbortSignal) => Promise<{ html: string; url: string }> = this.article.bind(this),
    signal?: AbortSignal,
  ): Promise<{ image: NonNullable<FeedItem['image']>; fingerprint: string } | null> {
    const key = `thumbnail:first-content-v2:${createHash('sha256')
      .update(JSON.stringify([item.kind, item.url, item.arxivId, item.imageCandidate]))
      .digest('hex')}`;
    const cached = this.meta<{ expires: number; candidates: string[] }>(key);
    let candidates = cached && cached.expires > this.now() ? cached.candidates : undefined;
    if (!candidates) {
      candidates = [];
      let available = false;
      try {
        let pageUrl = item.url;
        if (item.kind === 'paper' && item.arxivId) {
          const explicit = /^https:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf|html)\/([^?#]+?)(?:\.pdf)?$/.exec(item.url)?.[1];
          pageUrl = `https://arxiv.org/html/${explicit ?? item.arxivId}`;
        }
        const fetched = await page(pageUrl, signal);
        if (new URL(fetched.url).hostname !== 'news.google.com') {
          candidates = item.kind === 'paper' ? figureImageCandidates(fetched.html, fetched.url) : articleImageCandidates(fetched.html, fetched.url);
          available = true;
        }
      } catch {
        /* Missing/paywalled HTML must not discard a trustworthy provider thumbnail. */
      }
      if (signal?.aborted || this.signal?.aborted) return null;
      const fallback = suitableImageUrl(item.imageCandidate, item.url);
      if (fallback) candidates.push(fallback);
      candidates = [...new Set(candidates)].slice(0, MAX_CANDIDATES);
      this.putMeta(key, { expires: this.now() + (available ? 86400000 : 3600000), candidates });
    }
    // At most four image GETs per item. No PDF acquisition occurs in this path.
    const hashes = candidates.map((candidate) => this.register(candidate)?.url.split('/').at(-1)).filter((hash): hash is string => !!hash);
    if (item.image?.url.match(/^\/api\/feed\/images\/[a-f0-9]{64}$/)) hashes.push(item.image.url.split('/').at(-1)!);
    for (const hash of [...new Set(hashes)].slice(0, 4)) {
      if (signal?.aborted || this.signal?.aborted) break;
      const fetched = await this.get(hash, signal);
      if (signal?.aborted || this.signal?.aborted) break;
      if (!fetched) continue;
      const dimensions = imageDimensions(fetched.body, fetched.contentType)!;
      return {
        image: { url: `/api/feed/images/${hash}`, ...dimensions, alt: item.title },
        fingerprint: createHash('sha256').update(fetched.body).digest('hex'),
      };
    }
    return null;
  }
  async get(hash: string, signal?: AbortSignal): Promise<{ body: Buffer; contentType: string } | null> {
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;
    const existing = this.pending.get(hash);
    if (existing) return existing;
    const promise = this.load(hash, this.scopedSignal(signal)).finally(() => this.pending.delete(hash));
    this.pending.set(hash, promise);
    return promise;
  }
  private async load(hash: string, signal?: AbortSignal): Promise<{ body: Buffer; contentType: string } | null> {
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;
    const row = this.store.db.prepare('SELECT source_url,content_type FROM feed_images WHERE hash=?').get(hash) as
      { source_url: string; content_type: string | null } | undefined;
    if (!row) return null;
    if (!suitableImageUrl(row.source_url, row.source_url)) return null;
    const failureKey = `feed-image-failure:${hash}`;
    if ((this.meta<number>(failureKey) ?? 0) > this.now()) return null;
    const file = join(this.directory, hash);
    if (row.content_type && existsSync(file)) {
      const body = readFileSync(file);
      if (usableImage(body, row.content_type)) {
        this.store.db.prepare('UPDATE feed_images SET accessed_at=? WHERE hash=?').run(new Date(this.now()).toISOString(), hash);
        return { body, contentType: row.content_type };
      }
      rmSync(file, { force: true });
    }
    if (this.active >= 4) {
      if (this.queue.length >= 32) return null;
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else this.active++;
    try {
      if (signal?.aborted) return null;
      const image = await fetchPublicImage(row.source_url, this.fetcher, this.resolver, signal);
      if (!usableImage(image.body, image.contentType)) throw new Error('Image is too small or not a recognized raster');
      writeFileSync(file, image.body);
      this.store.db
        .prepare('UPDATE feed_images SET content_type=?,size=?,accessed_at=? WHERE hash=?')
        .run(image.contentType, image.body.length, new Date(this.now()).toISOString(), hash);
      this.store.db.prepare('DELETE FROM feed_meta WHERE key=?').run(failureKey);
      this.evict();
      return image;
    } catch {
      if (!signal?.aborted) this.putMeta(failureKey, this.now() + 3600000);
      return null;
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
  private evict(): void {
    const rows = this.store.db.prepare('SELECT hash,size FROM feed_images WHERE size IS NOT NULL ORDER BY accessed_at ASC').all() as {
      hash: string;
      size: number;
    }[];
    let total = rows.reduce((sum, row) => sum + row.size, 0);
    for (const row of rows) {
      if (total <= MAX_CACHE_BYTES) break;
      rmSync(join(this.directory, row.hash), { force: true });
      this.store.db.prepare('UPDATE feed_images SET content_type=NULL,size=NULL,accessed_at=NULL WHERE hash=?').run(row.hash);
      total -= row.size;
    }
  }
}
function usableImage(body: Buffer, contentType: string): boolean {
  const size = imageDimensions(body, contentType);
  return (
    !!size &&
    size.width >= 100 &&
    size.height >= 60 &&
    size.width * size.height >= 12000 &&
    size.width * size.height <= 50_000_000 &&
    size.width / size.height <= 20 &&
    size.height / size.width <= 10
  );
}
