import type {
  AppError,
  Connection,
  PaperChat,
  PaperQuestionInput,
  PaperQuestionOutput,
  Translator,
  TranslationInput,
  TranslationOutput,
  TranslationPageInput,
  TranslationPageOutput,
  Usage,
} from '@fractal/shared';
import {
  closedFailure,
  CONTEXT_COMPACTION_ITEM,
  failure,
  isKnownSubscriptionPlan,
  isRpcClosed,
  mapRpcError as mapOfficialError,
  TEXT_ONLY_ITEM_TYPES,
  type GenerationRpc,
} from './rpc';
import { openIsolatedThread } from './isolation';
import { startOfficialRpc } from './runtime';
import { CHAT_TURN_TIMEOUT_MS, CodexPaperChat } from './chat';
import {
  decodeTranslationText,
  decodeTranslationPageText,
  translationPrompt,
  translationPagePrompt,
  TRANSLATION_OUTPUT_SCHEMA,
  TRANSLATION_PAGE_OUTPUT_SCHEMA,
} from '../translation/prompt';
export { translationPrompt, translationPagePrompt, TRANSLATION_OUTPUT_SCHEMA, TRANSLATION_PAGE_OUTPUT_SCHEMA } from '../translation/prompt';
export { AccountAuthenticator } from './auth';
export type { AccountAuthenticatorOptions } from './auth';
export { isKnownSubscriptionPlan, isRpcClosed, JsonLineRpc, mapRpcError, TEXT_ONLY_ITEM_TYPES } from './rpc';
export { childEnvironment, restrictedArgs, resolveCodexExecutable, createOfficialRpcFactory } from './runtime';
export { isolatedThreadRequest, assertIsolatedRequest, openIsolatedThread, UNSAFE_THREAD_REASON } from './isolation';
export { CHAT_TURN_TIMEOUT_MS, MAX_CHAT_THREADS, REPLAY_BYTES, chatUsage, questionTurnText } from './chat';

export const runtimeSafety = Object.freeze({
  status: 'proved' as const,
  code: 'UNSAFE_RUNTIME' as const,
  reason:
    '번역과 논문 질문은 environments:[], dynamicTools:[], read-only sandbox, approvalPolicy:never, 빈 임시 작업 폴더를 갖추고 디스크에 남기지 않는 임시 스레드(ephemeral)로 시작한 스레드에서만 생성합니다. 이 조건을 하나라도 갖추지 못하면 생성을 시작하지 않습니다(UNSAFE_RUNTIME).',
});
const empty = (status: Connection['status']): Connection => ({ status, modelIds: [], defaultModelId: null, limits: null });
/** Models the user has explicitly forbidden for this product. Never offered,
 * never defaulted to, and refused at the generation call even if one is passed
 * in directly — a catalogue filter alone could be bypassed. */
export const EXCLUDED_MODEL_MARKERS = ['astra', 'fable'] as const;
export function isExcludedModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return EXCLUDED_MODEL_MARKERS.some((marker) => id.includes(marker));
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function windowLimit(value: unknown): Record<string, number | null> | null {
  const v = object(value);
  if (!v) return null;
  const number = (key: string) => (typeof v[key] === 'number' && Number.isFinite(v[key]) && v[key] >= 0 ? (v[key] as number) : null);
  return { usedPercent: number('usedPercent'), windowDurationMins: number('windowDurationMins'), resetsAt: number('resetsAt') };
}
/** Only quota-window fields, not credits, prices, email, account id, or raw provider data. */
export function observedLimits(value: unknown): Connection['limits'] {
  const v = object(value);
  if (!v) return null;
  return { primary: windowLimit(v.primary), secondary: windowLimit(v.secondary) };
}
/** Late tail of an interrupted turn is absorbed for at most this long (see runTurn). */
const TURN_DRAIN_MS = 30_000;
/** Where late isolation evidence (a tool item after its turn settled) was seen. */
export type LateBreachPath = 'translation' | 'question';
export class CodexTranslator implements Translator, PaperChat {
  /** Told when a tool item arrives after the turn it would have failed has already settled; the
   * process is ended either way. Receives no provider text. Set by the service to log it. */
  onLateBreach: ((path: LateBreachPath) => void) | null = null;
  private rpc: Promise<GenerationRpc> | null = null;
  private activeRpc: GenerationRpc | null = null;
  private detachCloseObserver: (() => void) | null = null;
  /** The question path: same process, same isolation proof, same gate. Never gets account methods. */
  private chat: CodexPaperChat;
  constructor(
    private factory: () => Promise<GenerationRpc> = startOfficialRpc,
    private turnTimeoutMs = 180_000,
    chatTurnTimeoutMs = CHAT_TURN_TIMEOUT_MS,
  ) {
    this.chat = new CodexPaperChat(
      {
        ensureUsable: (modelId, signal) => this.ensureUsableConnection(modelId, signal, 'ask'),
        rpc: () => this.getRpc(),
        disconnect: () => this.disconnect(),
        lateBreach: () => this.reportLateBreach('question'),
      },
      chatTurnTimeoutMs,
    );
  }
  private reportLateBreach(path: LateBreachPath): void {
    try {
      this.onLateBreach?.(path);
    } catch {
      /* a logger cannot keep the process from ending */
    }
  }
  private async getRpc(): Promise<GenerationRpc> {
    const cached = this.rpc;
    if (cached) {
      try {
        const rpc = await cached;
        if (!isRpcClosed(rpc)) {
          this.observeRpc(rpc);
          return rpc;
        }
        this.invalidateRpc(rpc, cached);
      } catch (error) {
        if (this.rpc === cached) this.rpc = null;
        throw error;
      }
    }
    const pending = Promise.resolve().then(this.factory);
    const owned = pending.catch((error) => {
      if (this.rpc === owned) this.rpc = null;
      throw error;
    });
    this.rpc = owned;
    try {
      const rpc = await owned;
      if (isRpcClosed(rpc)) {
        this.invalidateRpc(rpc, owned);
        throw failure('NETWORK', '공식 Codex 연결이 이미 종료되었습니다.', true);
      }
      this.observeRpc(rpc);
      return rpc;
    } catch (error) {
      if (this.rpc === owned) this.rpc = null;
      throw error;
    }
  }
  private observeRpc(rpc: GenerationRpc): void {
    if (this.activeRpc === rpc) return;
    this.detachRpcObserver();
    this.activeRpc = rpc;
    if (rpc.onClose) {
      const onClose = () => {
        // The process's question threads died with it.
        void this.chat.dropConnection(rpc);
        if (this.activeRpc !== rpc) return;
        this.detachRpcObserver();
        const current = this.rpc;
        if (current)
          void current.then(
            (value) => {
              if (this.rpc === current && value === rpc) this.rpc = null;
            },
            () => {
              if (this.rpc === current) this.rpc = null;
            },
          );
      };
      rpc.onClose(onClose);
      this.detachCloseObserver = () => rpc.offClose?.(onClose);
    }
  }
  private detachRpcObserver(): void {
    this.detachCloseObserver?.();
    this.detachCloseObserver = null;
    this.activeRpc = null;
  }
  private invalidateRpc(rpc: GenerationRpc, owned: Promise<GenerationRpc>): void {
    if (this.activeRpc === rpc) this.detachRpcObserver();
    if (this.rpc === owned) this.rpc = null;
  }
  async connection(): Promise<Connection> {
    try {
      const rpc = await this.getRpc();
      const response = object(await rpc.request('account/read', { refreshToken: false }));
      if (!response || !('account' in response)) return empty('unavailable');
      if (response.account === null) return empty('signed_out');
      const account = object(response.account);
      if (account?.type === 'apiKey') return empty('api_key');
      if (account?.type !== 'chatgpt' || !isKnownSubscriptionPlan(account.planType)) return empty('unavailable');
      const models = new Set<string>();
      let providerDefault: string | null = null;
      let cursor: string | null = null;
      const seen = new Set<string>();
      do {
        const page = object(await rpc.request('model/list', { cursor, limit: 100, includeHidden: false }));
        if (!page || !Array.isArray(page.data)) throw failure('MODEL_UNAVAILABLE', '모델 목록을 확인할 수 없습니다.');
        for (const raw of page.data) {
          const m = object(raw);
          if (!m || m.hidden === true || typeof m.model !== 'string' || !m.model.trim()) continue;
          if (isExcludedModel(m.model)) continue;
          models.add(m.model);
          if (m.isDefault === true) providerDefault = m.model;
        }
        cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null;
        if (cursor) {
          if (seen.has(cursor) || seen.size >= 100) throw failure('MODEL_UNAVAILABLE', '모델 목록 페이지를 확인할 수 없습니다.');
          seen.add(cursor);
        }
      } while (cursor);
      // The provider's default can be an excluded model; never hand one back.
      const catalogue = [...models];
      const defaultModelId = providerDefault !== null && !isExcludedModel(providerDefault) ? providerDefault : (catalogue[0] ?? null);
      let limits: Connection['limits'] = null;
      try {
        const r = object(await rpc.request('account/rateLimits/read', {}));
        limits = observedLimits(r?.rateLimits);
      } catch (error) {
        if ((error as { code?: string }).code === 'UNSAFE_RUNTIME' || (error as { code?: string }).code === 'AUTH_REQUIRED') throw error;
      }
      return { status: 'subscription', modelIds: catalogue, defaultModelId, limits };
    } catch (error) {
      const code = (error as { code?: string }).code;
      return empty(code === 'ENOENT' ? 'missing' : code === 'AUTH_REQUIRED' ? 'signed_out' : 'unavailable');
    }
  }
  /** Every generation entry point re-checks the forbidden list and the connection state
   * on its own — a call that never went through the model catalogue must still be refused. */
  private async ensureUsableConnection(modelId: string, signal: AbortSignal | undefined, purpose: 'translate' | 'ask' = 'translate'): Promise<Connection> {
    const canceled = () => failure('NETWORK', purpose === 'ask' ? '질문이 취소되었습니다.' : '번역 요청이 취소되었습니다.', true);
    if (signal?.aborted) throw canceled();
    if (isExcludedModel(modelId)) throw failure('MODEL_UNAVAILABLE', '이 모델은 사용하지 않도록 설정되어 있습니다.');
    const connection = await this.connection();
    if (connection.status === 'missing' || connection.status === 'signed_out') throw failure('AUTH_REQUIRED', '공식 Codex에서 ChatGPT로 로그인해 주세요.');
    if (connection.status === 'api_key')
      throw failure(
        'SUBSCRIPTION_REQUIRED',
        purpose === 'ask'
          ? 'API 키 모드에서는 질문할 수 없습니다. ChatGPT 구독으로 로그인해 주세요.'
          : 'API 키 모드에서는 번역할 수 없습니다. ChatGPT 구독으로 로그인해 주세요.',
      );
    if (connection.status !== 'subscription') throw failure('NETWORK', '구독 연결을 확인할 수 없습니다.', true);
    if (!connection.modelIds.includes(modelId)) throw failure('MODEL_UNAVAILABLE', '선택한 모델을 더 이상 사용할 수 없습니다.');
    if (signal?.aborted) throw canceled();
    return connection;
  }
  /** A question about one paper revision, answered on the conversation's ephemeral isolated
   * thread (see chat.ts). Refuses forbidden models and non-subscription states first. */
  ask(input: PaperQuestionInput): Promise<PaperQuestionOutput> {
    return this.chat.ask(input);
  }
  forget(conversationId: string): Promise<void> {
    return this.chat.forget(conversationId);
  }
  async translate(input: TranslationInput): Promise<TranslationOutput> {
    const connection = await this.ensureUsableConnection(input.modelId, input.signal);
    const rpc = await this.getRpc();
    // openIsolatedThread is the only path that ever unlocks generation; a request missing
    // any isolation condition throws before thread/start and the transport stays locked.
    const thread = await openIsolatedThread(rpc, input.modelId);
    try {
      const turn = await this.runTurn(rpc, thread.threadId, translationPrompt(input), TRANSLATION_OUTPUT_SCHEMA, input.signal);
      const left = await thread.release();
      // A text-only runtime must not have written anything into its scratch directory.
      if (left.length > 0) {
        await this.disconnect();
        throw failure('UNSAFE_RUNTIME', '격리된 작업 폴더에 파일이 생성되었습니다.');
      }
      const decoded = decodeTranslation(turn, input.block.blockId);
      return { text: decoded.text, usage: observedUsage(turn, connection.limits) };
    } catch (error) {
      // Even on a failed turn, anything written into the scratch directory means the
      // proved isolation did not hold; end the connection rather than reuse it.
      const left = await thread.release().catch(() => [] as string[]);
      if (left.length > 0) {
        await this.disconnect();
        throw failure('UNSAFE_RUNTIME', '격리된 작업 폴더에 파일이 생성되었습니다.');
      }
      throw error;
    }
  }
  /** One page, one request: every translatable paragraph on the page goes out numbered in a
   * single turn, and the reply is matched back to blocks by that number — never by position,
   * so a dropped or reordered entry cannot land in the wrong paragraph's slot. */
  async translatePage(input: TranslationPageInput): Promise<TranslationPageOutput> {
    const connection = await this.ensureUsableConnection(input.modelId, input.signal);
    const rpc = await this.getRpc();
    const thread = await openIsolatedThread(rpc, input.modelId);
    try {
      const turn = await this.runTurn(rpc, thread.threadId, translationPagePrompt(input), TRANSLATION_PAGE_OUTPUT_SCHEMA, input.signal);
      const left = await thread.release();
      if (left.length > 0) {
        await this.disconnect();
        throw failure('UNSAFE_RUNTIME', '격리된 작업 폴더에 파일이 생성되었습니다.');
      }
      const numbers = new Set(input.paragraphs.map((p) => p.number));
      const results = decodeTranslationPage(turn, numbers);
      return { results, usage: observedUsage(turn, connection.limits) };
    } catch (error) {
      const left = await thread.release().catch(() => [] as string[]);
      if (left.length > 0) {
        await this.disconnect();
        throw failure('UNSAFE_RUNTIME', '격리된 작업 폴더에 파일이 생성되었습니다.');
      }
      throw error;
    }
  }
  /** Runs exactly one turn, watching every item for a tool the proved isolation should
   * have made impossible, and interrupting instead of keeping partial output on cancel. */
  private async runTurn(rpc: GenerationRpc, threadId: string, promptText: string, outputSchema: object, signal?: AbortSignal): Promise<unknown> {
    let settle: ((outcome: { turn: unknown } | { error: Error }) => void) | null = null;
    const finished = new Promise<{ turn: unknown } | { error: Error }>((resolve) => {
      settle = resolve;
    });
    const done = (outcome: { turn: unknown } | { error: Error }) => {
      settle?.(outcome);
      settle = null;
    };
    let turnStarted = false;
    let ended = false;
    let drainTimer: ReturnType<typeof setTimeout> | null = null;
    const eventHandler = (method: string, params: unknown) => {
      const item = object(object(params)?.item);
      const threadOf = object(params)?.threadId;
      if (item && typeof item.type === 'string' && !TEXT_ONLY_ITEM_TYPES.has(item.type)) {
        // A question thread's context compaction is that question's own failure (chat.ts), not a
        // tool; on a translation thread, or one no question listens on, it is a tool like the rest.
        if (item.type === CONTEXT_COMPACTION_ITEM && typeof threadOf === 'string' && threadOf !== threadId && this.chat.listensTo(threadOf)) return;
        // Never wait for the turn: an unexpected tool item, from ANY thread on this process,
        // ends the connection immediately — also after this turn has settled.
        if (settle) {
          done({ error: failure('UNSAFE_RUNTIME', '격리된 스레드에서 도구 실행 항목을 감지했습니다.') });
        } else {
          this.reportLateBreach('translation');
          void this.disconnect();
        }
        return;
      }
      // Question turns share the process: another thread's completion is not this turn's.
      if (typeof threadOf === 'string' && threadOf !== threadId) return;
      if (method === 'turn/completed' || method === 'turn/failed') {
        ended = true;
        if (!settle) {
          detachEvent();
          return;
        } // the interrupted turn's tail has arrived
      }
      if (method === 'turn/completed') {
        done({ turn: object(params)?.turn ?? null });
      } else if (method === 'turn/failed') {
        const turn = object(object(params)?.turn);
        done({ error: turn?.error ? mapOfficialError(turn.error) : failure('NETWORK', '번역 턴이 실패했습니다.', true) });
      }
    };
    let detachEvent: () => void = () => {};
    if (rpc.onGenerationEvent) {
      rpc.onGenerationEvent(eventHandler);
      detachEvent = () => {
        if (drainTimer) clearTimeout(drainTimer);
        rpc.offGenerationEvent?.(eventHandler);
      };
    } else if (rpc.onEvent) {
      // Older test transports expose only the legacy generation subscription.
      rpc.onEvent(eventHandler);
      detachEvent = () => {
        if (drainTimer) clearTimeout(drainTimer);
        rpc.offEvent?.(eventHandler);
      };
    }
    // The transport clears every listener when it stops, so turn/completed can never come: fail
    // at once with the stop's real reason instead of waiting out the turn timeout.
    const onClose = (reason?: Error) => done({ error: closedFailure(reason, '공식 프로그램 연결이 끊겼습니다.') });
    rpc.onClose?.(onClose);
    let onAbort: (() => void) | null = null;
    const timer = setTimeout(() => done({ error: failure('NETWORK', '번역 응답 시간이 초과되었습니다.', true) }), this.turnTimeoutMs);
    try {
      const started = object(await rpc.request('turn/start', { threadId, input: [{ type: 'text', text: promptText }], outputSchema }));
      turnStarted = true;
      const turnId = object(started?.turn)?.id;
      if (signal) {
        onAbort = () => done({ error: failure('NETWORK', '번역 요청이 취소되었습니다.', true) });
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }
      const outcome = await finished;
      if ('error' in outcome) {
        // Discard anything in flight: interrupt first, then surface the reason.
        await rpc.request('turn/interrupt', typeof turnId === 'string' ? { threadId, turnId } : { threadId }).catch(() => {
          /* connection may already be stopping */
        });
        if ((outcome.error as Partial<AppError>).code === 'UNSAFE_RUNTIME') await this.disconnect();
        throw outcome.error;
      }
      return outcome.turn;
    } finally {
      clearTimeout(timer);
      if (onAbort && signal) signal.removeEventListener('abort', onAbort);
      rpc.offClose?.(onClose);
      settle = null;
      // An interrupted turn still ends with its own turn/completed. Keep listening (tool check
      // included) until it arrives, so that tail never reaches a transport with no generation
      // listener — which fails closed and would take down every thread on the shared process.
      if (!turnStarted || ended || isRpcClosed(rpc)) {
        detachEvent();
      } else {
        drainTimer = setTimeout(detachEvent, TURN_DRAIN_MS);
        (drainTimer as { unref?: () => void }).unref?.();
      }
    }
  }
  async disconnect(): Promise<void> {
    const rpcPromise = this.rpc;
    this.rpc = null;
    this.detachRpcObserver();
    if (rpcPromise)
      try {
        await (await rpcPromise).close();
      } catch {
        /* already stopped */
      }
    // Question threads lived in that process; their scratch directories go too.
    await this.chat.dropAll();
  }
}
/** Parser for the verified text-only runtime, not a generation permission switch. */
export function decodeTranslation(value: unknown, blockId: string): TranslationOutput {
  const turn = object(value);
  const invalid = () => failure('INVALID_TRANSLATION', '완료된 문단 번역 형식을 확인할 수 없습니다.');
  if (turn?.status !== 'completed' || !Array.isArray(turn.items) || turn.error) throw invalid();
  const finals = turn.items.map(object).filter((item) => item?.type === 'agentMessage' && item.phase === 'final_answer');
  if (finals.length !== 1 || turn.items.some((item) => object(item)?.type === 'refusal')) throw invalid();
  try {
    const final = finals[0]!;
    if (typeof final.text !== 'string') throw invalid();
    return decodeTranslationText(final.text, blockId);
  } catch {
    throw invalid();
  }
}
/** The page envelope stays Codex-specific; its JSON body uses the shared validator. */
export function decodeTranslationPage(value: unknown, expectedNumbers: ReadonlySet<number>): { number: number; text: string }[] {
  const turn = object(value);
  const invalid = () => failure('INVALID_TRANSLATION', '완료된 쪽 번역 형식을 확인할 수 없습니다.');
  if (turn?.status !== 'completed' || !Array.isArray(turn.items) || turn.error) throw invalid();
  const finals = turn.items.map(object).filter((item) => item?.type === 'agentMessage' && item.phase === 'final_answer');
  if (finals.length !== 1 || turn.items.some((item) => object(item)?.type === 'refusal')) throw invalid();
  try {
    const final = finals[0]!;
    if (typeof final.text !== 'string') throw invalid();
    return decodeTranslationPageText(final.text, expectedNumbers);
  } catch {
    throw invalid();
  }
}
function countedTokens(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
/** Only counts the official program actually reported. Missing stays null: never 0, and
 * never a price — PaperRead does not convert subscription usage into money. */
export function observedUsage(turn: unknown, limits: Connection['limits'] = null): Usage {
  const usage = object(object(turn)?.usage);
  const inputTokens = countedTokens(usage?.inputTokens ?? usage?.input_tokens);
  const outputTokens = countedTokens(usage?.outputTokens ?? usage?.output_tokens);
  const observed = inputTokens !== null || outputTokens !== null || limits !== null;
  return { inputTokens, outputTokens, limits, observedAt: observed ? new Date().toISOString() : null };
}
