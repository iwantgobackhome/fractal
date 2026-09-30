import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import {
  aiSettingsPatchSchema,
  providerIdSchema,
  askPaperSchema,
  explainSchema,
  glossarySchema,
  libraryAskSchema,
  type AiAnswer,
  type AiFeature,
  type AiSseEvent,
  type ModelSelection,
  type HistoryEntry,
} from '@fractal/shared';
import { ZodError } from 'zod';
import { invalidInput, notFound } from '../../store/index';
import { paperInstructions } from '../../chat/paper-text';
import type { AiRouteContext as RouteContext, Result } from './types';
import { SqlitePaperStore } from '../../store/sqlite';
import { persistentGeneration } from '../../ai/history';

const json = (data: unknown): Result => ({ kind: 'json', status: 200, data });
const explainKorean =
  '반드시 간결한 한국어로 답하세요. 수식은 LaTeX로 유지하고 전문 용어는 처음 나올 때 한국어(English)로 쓰세요. 무엇인지, 각 기호의 뜻(해당하는 경우), 이 논문에서 왜 중요한지 설명하고 근거를 [p.N]으로 인용하세요.';
const glossaryKorean =
  'JSON 배열만 반환하세요. 각 definition은 간결한 한국어로 쓰고 전문 용어는 처음 나올 때 한국어(English)로 쓰세요. 정의마다 [p.N] 근거를 포함하세요.';
function answerLanguage(ctx: RouteContext, question?: string): string {
  const prefs = ctx.store instanceof SqlitePaperStore ? ctx.store.getPreferences() : { answerLanguage: 'auto', uiLanguage: 'ko' };
  return prefs.answerLanguage === 'auto'
    ? question
      ? 'the same language as the user question. Answer Korean questions in Korean'
      : prefs.uiLanguage
    : prefs.answerLanguage;
}
async function body(request: IncomingMessage): Promise<unknown> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of request) {
    const chunk = Buffer.from(part);
    size += chunk.length;
    if (size > 5_000_000) throw invalidInput('AI request is too large');
    parts.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
  } catch {
    throw invalidInput('Invalid JSON');
  }
}
function parse<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) throw invalidInput(error.issues.map((i) => i.message).join('; '));
    throw error;
  }
}
function paperKey(raw: string): string {
  let key: string;
  try {
    key = decodeURIComponent(raw);
  } catch {
    throw invalidInput('Invalid paper key');
  }
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(key) || key === '.' || key === '..') throw invalidInput('Invalid paper key');
  return key;
}
function selectedPage(text: string, page: number): string {
  return text.includes(`[p.${page}]`) ? text : `${text.trimEnd()} [p.${page}]`;
}
function extractLatex(text: string): string | undefined {
  return /\$\$([\s\S]+?)\$\$/.exec(text)?.[1]?.trim() ?? /\\\(([\s\S]+?)\\\)/.exec(text)?.[1]?.trim();
}
function glossaryTerms(text: string): { term: string; page: number; definition: string }[] {
  try {
    const value: unknown = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (!Array.isArray(value)) return [];
    return value.filter((v) => v && typeof v.term === 'string' && Number.isInteger(v.page) && v.page > 0 && typeof v.definition === 'string').slice(0, 30);
  } catch {
    return [];
  }
}
const glossaryCache = new Map<string, { text: string; terms: ReturnType<typeof glossaryTerms>; answer: AiAnswer }>();
interface GenerateOptions {
  page?: number;
  equation?: boolean;
  glossaryKey?: string;
  libraryCitation?: string;
  history?: { paperKey: string | null; kind: 'question' | 'explanation'; question: string; requestId?: string; context: HistoryEntry['context'] };
  signal?: AbortSignal;
}
function generate(
  ctx: RouteContext,
  feature: AiFeature,
  system: string,
  question: string,
  selection?: ModelSelection,
  options?: GenerateOptions,
): AsyncIterable<AiSseEvent> {
  if (options?.history && ctx.store instanceof SqlitePaperStore) {
    return persistentGeneration(ctx.store, options.history, (signal) => generateEvents(ctx, feature, system, question, selection, { ...options, signal }));
  }
  return generateEvents(ctx, feature, system, question, selection, options);
}
async function* generateEvents(
  ctx: RouteContext,
  feature: AiFeature,
  system: string,
  question: string,
  selection?: ModelSelection,
  options?: GenerateOptions,
): AsyncIterable<AiSseEvent> {
  const chosen = await ctx.registry.select(feature, selection);
  let text = '',
    inputTokens: number | null = null,
    outputTokens: number | null = null;
  const start = Date.now();
  for await (const delta of ctx.registry.complete(
    feature,
    { system, messages: [{ role: 'user', content: question }], signal: options?.signal },
    chosen.selection,
  )) {
    if (delta.type === 'text') {
      text += delta.text;
      yield { type: 'delta', text: delta.text };
    } else {
      inputTokens = delta.inputTokens;
      outputTokens = delta.outputTokens;
    }
  }
  if (options?.page && !text.includes(`[p.${options.page}]`)) {
    const citation = ` [p.${options.page}]`;
    text = selectedPage(text, options.page);
    yield { type: 'delta', text: citation };
  }
  if (options?.libraryCitation && !/\[paper:[A-Za-z0-9._-]+ p\.\d+\]/.test(text)) {
    const citation = ` ${options.libraryCitation}`;
    text += citation;
    yield { type: 'delta', text: citation };
  }
  const answer: AiAnswer = { text, provider: chosen.provider.id, model: chosen.selection.model, inputTokens, outputTokens, durationMs: Date.now() - start };
  const terms = options?.glossaryKey ? glossaryTerms(text) : undefined;
  if (options?.glossaryKey) glossaryCache.set(options.glossaryKey, { text, terms: terms ?? [], answer });
  yield { type: 'done', answer, ...(options?.equation ? { latex: extractLatex(text) ?? '' } : {}), ...(terms ? { terms } : {}) };
}
export async function handleAi(method: string, segments: string[], request: IncomingMessage, ctx: RouteContext): Promise<Result | undefined> {
  if (segments[0] !== 'api') return undefined;
  if (segments[1] === 'ai') {
    if (ctx.accounts && segments.length === 3 && segments[2] === 'accounts') {
      if (method === 'GET') return json({ accounts: await ctx.accounts.accounts() });
      if (method === 'POST') {
        const input = (await body(request)) as Record<string, unknown>;
        const provider = parse(providerIdSchema, input.provider);
        const label = typeof input.label === 'string' ? input.label.trim() : '';
        if (!label || label.length > 80) throw invalidInput('Invalid account label');
        return { kind: 'json', status: 201, data: await ctx.accounts.create(provider, label) };
      }
    }
    if (ctx.accounts && segments.length === 3 && segments[2] === 'limits' && method === 'GET') return json(await ctx.accounts.limits());
    if (ctx.accounts && segments.length >= 4 && segments[2] === 'accounts') {
      const id = decodeURIComponent(segments[3]!);
      if (segments.length === 5 && segments[4] === 'login') {
        if (method === 'GET') return json(await ctx.accounts.loginProgress(id));
        if (method === 'POST') return json(await ctx.accounts.login(id));
      }
      if (segments.length === 4 && method === 'PATCH') {
        const input = (await body(request)) as Record<string, unknown>;
        const patch: { label?: string; active?: boolean } = {};
        if ('label' in input) {
          if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 80) throw invalidInput('Invalid account label');
          patch.label = input.label.trim();
        }
        if ('active' in input) {
          if (typeof input.active !== 'boolean') throw invalidInput('Invalid active flag');
          patch.active = input.active;
        }
        return json(await ctx.accounts.patch(id, patch));
      }
      if (segments.length === 4 && method === 'DELETE') {
        await ctx.accounts.remove(id);
        return json({ deleted: true });
      }
    }
    if (segments.length === 3 && segments[2] === 'providers' && method === 'GET')
      return json({ providers: await ctx.registry.providersInfo(), settings: await ctx.registry.getSettings() });
    if (ctx.installer && segments.length === 5 && segments[2] === 'providers' && segments[4] === 'install') {
      const provider = parse(providerIdSchema, segments[3]);
      if (method === 'GET') return json(ctx.installer.get(provider));
      if (method === 'POST') return { kind: 'json', status: 202, data: ctx.installer.start(provider) };
    }
    if (segments.length === 3 && segments[2] === 'usage' && method === 'GET') return json(await ctx.registry.usage());
    if (segments.length === 3 && segments[2] === 'settings' && method === 'PUT') {
      const patch = parse(aiSettingsPatchSchema, await body(request));
      const current = await ctx.registry.getSettings();
      return json(await ctx.registry.putSettings({ default: patch.default ?? current.default, overrides: { ...current.overrides, ...patch.overrides } }));
    }
    return undefined;
  }
  if (segments[1] === 'library' && segments[2] === 'ask' && segments.length === 3 && method === 'POST') {
    const input = parse(libraryAskSchema, await body(request));
    const hits = await ctx.librarySearch.searchLibrary(input.question);
    const context = hits.map((h) => `[paper:${h.paperKey} p.${h.page}] ${h.title}\n${h.text}`).join('\n\n');
    return {
      kind: 'sse',
      status: 200,
      events: generate(
        ctx,
        'chat',
        `Answer in ${answerLanguage(ctx, input.question)}.\nAnswer from these library excerpts. Cite claims as [paper:KEY p.N]. If no excerpt supports an answer, say so.\n${context}`,
        input.question,
        input.selection,
        {
          libraryCitation: hits[0] ? `[paper:${hits[0].paperKey} p.${hits[0].page}]` : undefined,
          history: { paperKey: null, kind: 'question', question: input.question, requestId: input.requestId, context: { selection: input.selection } },
        },
      ),
    };
  }
  if (segments[1] !== 'papers' || segments.length !== 4 || method !== 'POST') return undefined;
  const key = paperKey(segments[2]);
  const paper = ctx.store.getPaper(key);
  if (!paper) throw notFound('Paper not found');
  const blocks = ctx.store.listBlocks(key);
  if (segments[3] === 'ask') {
    const input = parse(askPaperSchema, await body(request));
    const question = `${input.question}${input.selectedText ? `\nSelected text: ${input.selectedText}` : ''}${input.page ? `\nCurrent page: ${input.page}` : ''}${input.rect ? `\nSelected box: ${JSON.stringify(input.rect)}` : ''}`;
    return {
      kind: 'sse',
      status: 200,
      events: generate(
        ctx,
        'chat',
        `${paperInstructions(paper, blocks)}\n\nAnswer in ${answerLanguage(ctx, input.question)}.\nCite evidence using [p.N] page markers.`,
        question,
        input.selection,
        {
          page: input.page ?? blocks[0]?.regions[0]?.page,
          history: {
            paperKey: key,
            kind: 'question',
            question: input.question,
            requestId: input.requestId,
            context: { page: input.page, rect: input.rect, selectedText: input.selectedText, selection: input.selection },
          },
        },
      ),
    };
  }
  if (segments[3] === 'explain') {
    const input = parse(explainSchema, await body(request));
    const pageText = blocks
      .filter((b) => b.regions.some((r) => r.page === input.page))
      .map((b) => b.sourceText)
      .join('\n')
      .slice(0, 30000);
    const question = `이 ${input.kind}을 설명하세요. 페이지 ${input.page}, 영역 ${JSON.stringify(input.bbox)}. ${input.kind === 'equation' ? '수식을 $$...$$ 형태의 LaTeX로 포함하세요.' : ''}\n주변 텍스트: ${input.surroundingText ?? ''}`;
    // The CLI adapters currently accept text only. The crop is validated but surrounding page text is used.
    return {
      kind: 'sse',
      status: 200,
      events: generate(
        ctx,
        'explain',
        `${answerLanguage(ctx) === 'ko' ? explainKorean : `Explain concisely in ${answerLanguage(ctx)}. Keep equations in LaTeX. Explain what this is, the symbols where relevant, and why it matters in this paper. Cite [p.N].`}\nPaper: ${paper.title ?? key}\n[page ${input.page}]\n${pageText}\nCite [p.${input.page}].`,
        question,
        input.selection,
        {
          page: input.page,
          equation: input.kind === 'equation',
          history: {
            paperKey: key,
            kind: 'explanation',
            question,
            requestId: input.requestId,
            context: { page: input.page, rect: input.bbox, selectedText: input.surroundingText, explanationKind: input.kind, selection: input.selection },
          },
        },
      ),
    };
  }
  if (segments[3] === 'glossary') {
    const input = parse(glossarySchema, await body(request));
    const digest = createHash('sha256')
      .update(JSON.stringify(blocks.map((b) => [b.sourceHash, b.regions[0]?.page])))
      .digest('hex');
    const cacheKey = `${key}:${input.selection?.provider ?? 'default'}:${input.selection?.model ?? 'default'}:${answerLanguage(ctx)}:${digest}`;
    const cached = glossaryCache.get(cacheKey);
    if (cached)
      return {
        kind: 'sse',
        status: 200,
        events: (async function* () {
          yield { type: 'done', answer: cached.answer, terms: cached.terms } as AiSseEvent;
        })(),
      };
    return {
      kind: 'sse',
      status: 200,
      events: generate(
        ctx,
        'digest',
        `${paperInstructions(paper, blocks)}\n${answerLanguage(ctx) === 'ko' ? glossaryKorean : `Return only a JSON array. Write each concise definition in ${answerLanguage(ctx)} and cite [p.N].`}\nReturn only a JSON array of {"term":string,"page":number,"definition":string}. Use first-occurrence page.`,
        'List up to 20 key terms.',
        input.selection,
        { glossaryKey: cacheKey },
      ),
    };
  }
  return undefined;
}
