import { createHash } from 'node:crypto';
import type { QuickTranslateRequest } from '@fractal/shared';
import type { SqlitePaperStore } from '../store/sqlite';
import type { ProviderRegistry } from '../ai/registry';
import { appError } from '../store/errors';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const keyFor = (text: string, target: string, source: string) => createHash('sha256').update(JSON.stringify([text, target, source])).digest('hex');
/** Google web requests have practical URL limits; split at sentence boundaries when possible. */
export function splitTranslation(text: string, maxEncoded = 1500): string[] {
  if (encodeURIComponent(text).length <= maxEncoded) return [text];
  const sentences = text.match(/[^.!?。！？\n]+[.!?。！？\n]*|\n/g) ?? [text];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (encodeURIComponent(current + sentence).length <= maxEncoded) { current += sentence; continue; }
    if (current) { chunks.push(current); current = ''; }
    if (encodeURIComponent(sentence).length <= maxEncoded) { current = sentence; continue; }
    for (const word of sentence.match(/\S+\s*|\s+/g) ?? [sentence]) {
      if (encodeURIComponent(current + word).length > maxEncoded && current) { chunks.push(current); current = ''; }
      if (encodeURIComponent(word).length > maxEncoded) {
        for (const char of word) {
          if (encodeURIComponent(current + char).length > maxEncoded && current) { chunks.push(current); current = ''; }
          current += char;
        }
      } else current += word;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export class QuickTranslator {
  private nextRequest = 0;
  private gate = Promise.resolve();
  constructor(private readonly store: SqlitePaperStore, private readonly registry?: ProviderRegistry, private readonly fetcher: typeof fetch = fetch, private readonly pause = wait) {}
  private async pace(): Promise<void> {
    const previous = this.gate;
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const delay = Math.max(0, this.nextRequest - Date.now());
    if (delay) await this.pause(delay);
    this.nextRequest = Date.now() + 200;
    release();
  }
  private async google(text: string, target: string, source: string): Promise<{ translated: string; detected?: string }> {
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.searchParams.set('client', 'gtx'); url.searchParams.set('sl', source); url.searchParams.set('tl', target); url.searchParams.set('dt', 't'); url.searchParams.set('q', text);
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.pace();
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(8000) });
      if (response.status === 429) { await this.pause(400 * 2 ** attempt); continue; }
      if (!response.ok) throw new Error(`Google Translate HTTP ${response.status}`);
      const value = await response.json() as unknown;
      if (!Array.isArray(value) || !Array.isArray(value[0])) throw new Error('Invalid Google Translate response');
      const translated = (value[0] as unknown[]).map((part) => Array.isArray(part) ? part[0] : '').filter((part): part is string => typeof part === 'string').join('');
      if (!translated) throw new Error('Empty Google Translate response');
      return { translated, ...(typeof value[2] === 'string' ? { detected: value[2] } : {}) };
    }
    throw new Error('Google Translate rate limited');
  }
  private async aiFallback(texts: string[], target: string, source: string): Promise<string[]> {
    if (!this.registry) throw new Error('No AI provider');
    let output = '';
    for await (const part of this.registry.complete('translate', {
      system: `Translate each JSON array string from ${source} to ${target}. Return only a JSON array of translated strings in the same order. No explanation.`,
      messages: [{ role: 'user', content: JSON.stringify(texts) }],
    })) if (part.type === 'text') output += part.text;
    const result = JSON.parse(output.trim()) as unknown;
    if (!Array.isArray(result) || result.length !== texts.length || result.some((item) => typeof item !== 'string')) throw new Error('Invalid AI translation');
    return result as string[];
  }
  async translate(input: QuickTranslateRequest): Promise<{ translations: string[]; engine: 'google-web' | 'fallback'; detected?: string }> {
    const output: string[] = Array(input.texts.length);
    let detected: string | undefined;
    try {
      for (const [index, text] of input.texts.entries()) {
        const key = keyFor(text, input.target, input.source);
        const cached = this.store.db.prepare('SELECT translated,detected FROM quick_translations WHERE key=?').get(key) as { translated: string; detected: string | null } | undefined;
        if (cached) { output[index] = cached.translated; detected ??= cached.detected ?? undefined; continue; }
        const parts: string[] = [];
        let textDetected: string | undefined;
        for (const chunk of splitTranslation(text)) {
          const result = await this.google(chunk, input.target, input.source);
          parts.push(result.translated);
          textDetected ??= result.detected;
        }
        detected ??= textDetected;
        output[index] = parts.join('');
        this.store.db.prepare('INSERT INTO quick_translations(key,translated,detected,created_at) VALUES(?,?,?,?)').run(key, output[index]!, textDetected ?? null, new Date().toISOString());
      }
      return { translations: output, engine: 'google-web', ...(detected ? { detected } : {}) };
    } catch {
      if (input.allowAiFallback) {
        try { return { translations: await this.aiFallback(input.texts, input.target, input.source), engine: 'fallback' }; }
        catch { /* Return a stable unavailable response below. */ }
      }
      throw appError('QUICK_TRANSLATE_UNAVAILABLE', 'Quick translation is unavailable. Try again shortly.', true);
    }
  }
}
