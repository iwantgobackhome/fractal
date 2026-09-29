import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { aiSettingsPatchSchema, askPaperSchema, explainSchema, glossarySchema, libraryAskSchema, type AiAnswer, type AiFeature, type AiSseEvent, type ModelSelection } from '@fractal/shared';
import { ZodError } from 'zod';
import { invalidInput, notFound } from '../../store/index';
import { paperInstructions } from '../../chat/paper-text';
import type { AiRouteContext as RouteContext, Result } from './types';

const json = (data: unknown): Result => ({ kind: 'json', status: 200, data });
async function body(request: IncomingMessage): Promise<unknown> {
  const parts: Buffer[] = []; let size = 0;
  for await (const part of request) { const chunk = Buffer.from(part); size += chunk.length; if (size > 5_000_000) throw invalidInput('AI request is too large'); parts.push(chunk); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); } catch { throw invalidInput('Invalid JSON'); }
}
function parse<T>(schema: { parse(value: unknown): T }, value: unknown): T { try { return schema.parse(value); } catch (error) { if (error instanceof ZodError) throw invalidInput(error.issues.map(i => i.message).join('; ')); throw error; } }
function paperKey(raw: string): string { let key: string; try { key = decodeURIComponent(raw); } catch { throw invalidInput('Invalid paper key'); } if (!/^[A-Za-z0-9._-]{1,200}$/.test(key) || key === '.' || key === '..') throw invalidInput('Invalid paper key'); return key; }
function selectedPage(text: string, page: number): string { return text.includes(`[p.${page}]`) ? text : `${text.trimEnd()} [p.${page}]`; }
function extractLatex(text: string): string | undefined { return /\$\$([\s\S]+?)\$\$/.exec(text)?.[1]?.trim() ?? /\\\(([\s\S]+?)\\\)/.exec(text)?.[1]?.trim(); }
function glossaryTerms(text: string): { term: string; page: number; definition: string }[] {
  try { const value: unknown = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); if (!Array.isArray(value)) return []; return value.filter(v => v && typeof v.term === 'string' && Number.isInteger(v.page) && v.page > 0 && typeof v.definition === 'string').slice(0, 30); } catch { return []; }
}
const glossaryCache = new Map<string, { text: string; terms: ReturnType<typeof glossaryTerms>; answer: AiAnswer }>();
async function* generate(ctx: RouteContext, feature: AiFeature, system: string, question: string, selection?: ModelSelection, options?: { page?: number; equation?: boolean; glossaryKey?: string; libraryCitation?: string }): AsyncIterable<AiSseEvent> {
  const chosen = await ctx.registry.select(feature, selection);
  let text = '', inputTokens: number | null = null, outputTokens: number | null = null; const start = Date.now();
  for await (const delta of ctx.registry.complete(feature, { system, messages: [{ role: 'user', content: question }] }, chosen.selection)) {
    if (delta.type === 'text') { text += delta.text; yield { type: 'delta', text: delta.text }; }
    else { inputTokens = delta.inputTokens; outputTokens = delta.outputTokens; }
  }
  if (options?.page && !text.includes(`[p.${options.page}]`)) { const citation = ` [p.${options.page}]`; text = selectedPage(text, options.page); yield { type: 'delta', text: citation }; }
  if (options?.libraryCitation && !/\[paper:[A-Za-z0-9._-]+ p\.\d+\]/.test(text)) { const citation = ` ${options.libraryCitation}`; text += citation; yield { type: 'delta', text: citation }; }
  const answer: AiAnswer = { text, provider: chosen.provider.id, model: chosen.selection.model, inputTokens, outputTokens, durationMs: Date.now() - start };
  const terms = options?.glossaryKey ? glossaryTerms(text) : undefined;
  if (options?.glossaryKey) glossaryCache.set(options.glossaryKey, { text, terms: terms ?? [], answer });
  yield { type: 'done', answer, ...(options?.equation ? { latex: extractLatex(text) ?? '' } : {}), ...(terms ? { terms } : {}) };
}
export async function handleAi(method: string, segments: string[], request: IncomingMessage, ctx: RouteContext): Promise<Result | undefined> {
  if (segments[0] !== 'api') return undefined;
  if (segments[1] === 'ai') {
    if (segments.length === 3 && segments[2] === 'providers' && method === 'GET') return json({ providers: await ctx.registry.providersInfo(), settings: await ctx.registry.getSettings() });
    if (segments.length === 3 && segments[2] === 'usage' && method === 'GET') return json(await ctx.registry.usage());
    if (segments.length === 3 && segments[2] === 'settings' && method === 'PUT') {
      const patch = parse(aiSettingsPatchSchema, await body(request)); const current = await ctx.registry.getSettings();
      return json(await ctx.registry.putSettings({ default: patch.default ?? current.default, overrides: { ...current.overrides, ...patch.overrides } }));
    }
    return undefined;
  }
  if (segments[1] === 'library' && segments[2] === 'ask' && segments.length === 3 && method === 'POST') {
    const input = parse(libraryAskSchema, await body(request)); const hits = await ctx.librarySearch.searchLibrary(input.question);
    const context = hits.map(h => `[paper:${h.paperKey} p.${h.page}] ${h.title}\n${h.text}`).join('\n\n');
    return { kind: 'sse', status: 200, events: generate(ctx, 'chat', `Answer from these library excerpts. Cite claims as [paper:KEY p.N]. If no excerpt supports an answer, say so.\n${context}`, input.question, input.selection, { libraryCitation: hits[0] ? `[paper:${hits[0].paperKey} p.${hits[0].page}]` : undefined }) };
  }
  if (segments[1] !== 'papers' || segments.length !== 4 || method !== 'POST') return undefined;
  const key = paperKey(segments[2]); const paper = ctx.store.getPaper(key); if (!paper) throw notFound('Paper not found');
  const blocks = ctx.store.listBlocks(key);
  if (segments[3] === 'ask') {
    const input = parse(askPaperSchema, await body(request));
    const question = `${input.question}${input.selectedText ? `\nSelected text: ${input.selectedText}` : ''}${input.page ? `\nCurrent page: ${input.page}` : ''}${input.rect ? `\nSelected box: ${JSON.stringify(input.rect)}` : ''}`;
    return { kind: 'sse', status: 200, events: generate(ctx, 'chat', `${paperInstructions(paper, blocks)}\n\nCite evidence using [p.N] page markers.`, question, input.selection, { page: input.page ?? blocks[0]?.regions[0]?.page }) };
  }
  if (segments[3] === 'explain') {
    const input = parse(explainSchema, await body(request));
    const pageText = blocks.filter(b => b.regions.some(r => r.page === input.page)).map(b => b.sourceText).join('\n').slice(0, 30000);
    const question = `Explain this ${input.kind} on page ${input.page}, box ${JSON.stringify(input.bbox)}. ${input.kind === 'equation' ? 'Include its LaTeX in $$...$$.' : ''}\nSurrounding text: ${input.surroundingText ?? ''}`;
    // The CLI adapters currently accept text only. The crop is validated but surrounding page text is used.
    return { kind: 'sse', status: 200, events: generate(ctx, 'explain', `Paper: ${paper.title ?? key}\n[page ${input.page}]\n${pageText}\nCite [p.${input.page}].`, question, input.selection, { page: input.page, equation: input.kind === 'equation' }) };
  }
  if (segments[3] === 'glossary') {
    const input = parse(glossarySchema, await body(request)); const digest = createHash('sha256').update(JSON.stringify(blocks.map(b => [b.sourceHash, b.regions[0]?.page]))).digest('hex'); const cacheKey = `${key}:${input.selection?.provider ?? 'default'}:${input.selection?.model ?? 'default'}:${digest}`;
    const cached = glossaryCache.get(cacheKey);
    if (cached) return { kind: 'sse', status: 200, events: (async function*() { yield { type: 'done', answer: cached.answer, terms: cached.terms } as AiSseEvent; })() };
    return { kind: 'sse', status: 200, events: generate(ctx, 'digest', `${paperInstructions(paper, blocks)}\nReturn only a JSON array of {"term":string,"page":number,"definition":string}. Use first-occurrence page.`, 'List up to 20 key terms.', input.selection, { glossaryKey: cacheKey }) };
  }
  return undefined;
}
