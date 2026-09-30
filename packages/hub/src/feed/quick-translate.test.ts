import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlitePaperStore } from '../store/sqlite';
import { QuickTranslator, splitTranslation } from './quick-translate';
import type { ProviderRegistry } from '../ai/registry';

describe('quick translation', () => {
  it('splits long text at sentence boundaries within URL limits', () => {
    const original = 'One sentence. Two sentences! ' + 'Longword '.repeat(40);
    const chunks = splitTranslation(original, 80);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.join('')).toBe(original);
    expect(chunks.every((chunk) => encodeURIComponent(chunk).length <= 80)).toBe(true);
  });
  it('batches text, caches results, throttles and retries 429', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fractal-quick-'));
    const store = new SqlitePaperStore(root);
    const calls: string[] = [];
    let hits = 0;
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(String(raw));
      calls.push(url.searchParams.get('q')!);
      hits++;
      if (hits === 1) return new Response('', { status: 429 });
      return new Response(JSON.stringify([[[`번역:${url.searchParams.get('q')}`, url.searchParams.get('q')]], null, 'en']), { status: 200 });
    }) as unknown as typeof fetch;
    const pauses: number[] = [];
    const pause = async (ms: number) => {
      pauses.push(ms);
    };
    try {
      const translator = new QuickTranslator(store, undefined, fetcher, pause);
      const input = { texts: ['Hello world.', 'Another sentence.'], target: 'ko', source: 'auto' as const, allowAiFallback: false };
      expect(await translator.translate(input)).toEqual({
        translations: ['번역:Hello world.', '번역:Another sentence.'],
        engine: 'google-web',
        detected: 'en',
      });
      expect(calls).toEqual(['Hello world.', 'Hello world.', 'Another sentence.']);
      expect(pauses.some((ms) => ms >= 400)).toBe(true);
      expect(await translator.translate(input)).toMatchObject({ engine: 'google-web' });
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      store.db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('uses AI only when explicitly allowed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fractal-quick-fallback-'));
    const store = new SqlitePaperStore(root);
    const fetcher = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    const complete = vi.fn(async function* () {
      yield { type: 'text' as const, text: '["안녕하세요"]' };
    });
    const translator = new QuickTranslator(store, { complete } as unknown as ProviderRegistry, fetcher);
    try {
      const input = { texts: ['Hello'], target: 'ko', source: 'auto' as const, allowAiFallback: false };
      await expect(translator.translate(input)).rejects.toMatchObject({ error: { code: 'QUICK_TRANSLATE_UNAVAILABLE' } });
      expect(complete).not.toHaveBeenCalled();
      expect(await translator.translate({ ...input, allowAiFallback: true })).toEqual({ translations: ['안녕하세요'], engine: 'fallback' });
      expect(complete).toHaveBeenCalledTimes(1);
    } finally {
      store.db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
