import { describe, expect, it, vi } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractArticleHtml, ArticleReader } from './article';
import { fetchPublicArticle } from './images';
import { SqlitePaperStore } from '../store/sqlite';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}.html`, import.meta.url)), 'utf8');
describe('in-app article reader', () => {
  it('extracts news and blog into plain text blocks with metadata', () => {
    const news = extractArticleHtml(fixture('news'), 'https://example.com/story', 'https://news.google.com/articles/one', null);
    expect(news).toMatchObject({ title: 'New telescope discovers a nearby world', lang: 'en', publishedAt: '2026-09-30T02:00:00Z' });
    expect(news?.blocks.some((block) => block.type === 'h2' && block.text === 'How it was found')).toBe(true);
    expect(news?.blocks.some((block) => block.type === 'p' && block.text?.includes('unusual clouds'))).toBe(true);
    const blog = extractArticleHtml(fixture('blog'), 'https://example.org/post', 'https://example.org/post', null);
    expect(blog?.blocks.some((block) => block.type === 'p' && block.text?.includes('transparent answers'))).toBe(true);
    expect(JSON.stringify(blog)).not.toContain('<p>');
  });
  it('rejects paywalls and private redirects', async () => {
    expect(extractArticleHtml(fixture('paywall'), 'https://example.com/paywall', 'https://example.com/paywall', null)).toBeNull();
    const resolver = vi.fn(async () => [{ address: '93.184.215.14', family: 4 }]) as any;
    await expect(fetchPublicArticle('https://example.com/a', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } })) as any, resolver)).rejects.toThrow('Private');
    const root = mkdtempSync(join(tmpdir(), 'fractal-article-'));
    const store = new SqlitePaperStore(root);
    try {
      const reader = new ArticleReader(store, null);
      await expect(reader.get('https://127.0.0.1/private')).rejects.toMatchObject({ error: { code: 'INVALID_INPUT' } });
    } finally { store.db.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('follows a Google News publisher link and caches the extracted article', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fractal-article-cache-'));
    const store = new SqlitePaperStore(root);
    const fetcher = vi.fn(async (url: string) => new Response(
      url.includes('news.google.com') ? '<html><head><link rel="canonical" href="https://example.com/story"></head><body>Redirect</body></html>' : fixture('news'),
      { headers: { 'content-type': 'text/html' } },
    )) as unknown as typeof fetch;
    const resolver = vi.fn(async () => [{ address: '93.184.215.14', family: 4 }]) as any;
    try {
      const reader = new ArticleReader(store, null, fetcher, resolver);
      const url = 'https://news.google.com/articles/one';
      expect(await reader.get(url)).toMatchObject({ url, finalUrl: 'https://example.com/story' });
      expect(await reader.get(url)).toMatchObject({ url, finalUrl: 'https://example.com/story' });
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { store.db.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
