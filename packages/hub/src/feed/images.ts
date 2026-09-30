import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import type { SqlitePaperStore } from '../store/sqlite';
import type { FeedItem } from '@fractal/shared';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CACHE_BYTES = 300 * 1024 * 1024;
const types = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
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
): Promise<{ body: Buffer; contentType: string }> {
  let url = raw;
  for (let redirects = 0; redirects < 5; redirects++) {
    await assertPublicImageUrl(url, resolver);
    const response = await fetcher(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Fractal/0.1 (personal research reader)' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
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
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_IMAGE_BYTES) throw new Error('Image too large');
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    return { body: Buffer.concat(chunks), contentType };
  }
  throw new Error('Too many image redirects');
}
export async function fetchPublicArticle(raw: string, fetcher: typeof fetch = fetch, resolver: typeof lookup = lookup): Promise<{ html: string; url: string }> {
  let url = raw;
  for (let redirects = 0; redirects < 5; redirects++) {
    await assertPublicImageUrl(url, resolver);
    const response = await fetcher(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'Fractal/0.1 (personal research reader)' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
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
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 1_000_000) throw new Error('Article too large');
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    return { html: Buffer.concat(chunks).toString('utf8'), url };
  }
  throw new Error('Too many article redirects');
}
export function firstFigureImage(html: string, pageUrl: string): string | null {
  for (const match of html.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi)) {
    const figure = match[1]!;
    if (!/<(?:figcaption|caption)\b|class=["'][^"']*ltx_caption/i.test(figure)) continue;
    const src = /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(figure)?.[1];
    if (!src || /(?:logo|equation|formula|icon)/i.test(src)) continue;
    try {
      const url = new URL(src.replace(/&amp;/g, '&'), pageUrl);
      if (url.protocol === 'https:') return url.href;
    } catch {
      /* skip */
    }
  }
  return null;
}
export function ogImage(html: string, pageUrl: string): string | null {
  const tag = /<meta\b(?=[^>]*(?:property|name)=["']og:image["'])[^>]*>/i.exec(html)?.[0];
  const src = tag ? /content=["']([^"']+)["']/i.exec(tag)?.[1] : null;
  if (!src) return null;
  try {
    const url = new URL(src.replace(/&amp;/g, '&'), pageUrl);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
export class FeedImageStore {
  private readonly directory: string;
  constructor(
    private readonly store: SqlitePaperStore,
    root: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.directory = join(root, 'feed-images');
    mkdirSync(this.directory, { recursive: true });
  }
  register(url: string): { url: string } | null {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return null;
      const hash = createHash('sha256').update(parsed.href).digest('hex');
      this.store.db.prepare('INSERT OR IGNORE INTO feed_images(hash,source_url) VALUES(?,?)').run(hash, parsed.href);
      return { url: `/api/feed/images/${hash}` };
    } catch {
      return null;
    }
  }
  article(url: string): Promise<{ html: string; url: string }> {
    return fetchPublicArticle(url, this.fetcher);
  }
  async get(hash: string): Promise<{ body: Buffer; contentType: string } | null> {
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;
    const row = this.store.db.prepare('SELECT source_url,content_type FROM feed_images WHERE hash=?').get(hash) as
      { source_url: string; content_type: string | null } | undefined;
    if (!row) return null;
    const file = join(this.directory, hash);
    if (row.content_type && existsSync(file)) {
      this.store.db.prepare('UPDATE feed_images SET accessed_at=? WHERE hash=?').run(new Date().toISOString(), hash);
      return { body: readFileSync(file), contentType: row.content_type };
    }
    try {
      const image = await fetchPublicImage(row.source_url, this.fetcher);
      writeFileSync(file, image.body);
      this.store.db
        .prepare('UPDATE feed_images SET content_type=?,size=?,accessed_at=? WHERE hash=?')
        .run(image.contentType, image.body.length, new Date().toISOString(), hash);
      this.evict();
      return image;
    } catch {
      return null;
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
