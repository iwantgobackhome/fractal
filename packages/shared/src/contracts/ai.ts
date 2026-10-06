import { z } from 'zod';
import type { AppError } from './common';
import { regionSchema, type Block, type Region } from './library';
import { originalProvenanceSchema, provenanceMatchesPage, contextSourceStatusSchema, type ContextSourceStatus } from './provenance';
import { languageSchema, type Language } from './preferences';

export interface Translation {
  blockId: string;
  sourceHash: string;
  modelId: string;
  promptVersion: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'unsupported';
  text: string | null;
  error: AppError | null;
  completedAt: string | null;
}
export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  limits: Record<string, unknown> | null;
  observedAt: string | null;
}
export type JobState = 'idle' | 'running' | 'paused' | 'completed' | 'completed_with_gaps' | 'failed';
export type PauseReason = null | 'user' | 'auth' | 'quota' | 'network' | 'model_unavailable' | 'interrupted' | 'reextracted';
export interface Job {
  jobId: string;
  paperKey: string;
  modelId: string;
  promptVersion: string;
  generation: number;
  state: JobState;
  pauseReason: PauseReason;
  completedBlocks: number;
  totalTranslatableBlocks: number;
  usage: Usage;
  updatedAt: string;
  currentPage: number | null;
  /** Inclusive physical pages; absent on legacy whole-paper jobs. */
  pageRange?: { start: number; end: number };
}
export interface Connection {
  status: 'missing' | 'signed_out' | 'subscription' | 'api_key' | 'unavailable';
  modelIds: string[];
  defaultModelId: string | null;
  limits: Record<string, unknown> | null;
}
/** App-owned login attempt identifier; never exposes the official login id or credentials. */
export interface LoginAttempt {
  loginId: string;
  status: 'pending' | 'completed' | 'cancelled' | 'expired' | 'failed';
  expiresAt: string;
  error: AppError | null;
}
export interface LoginStartResult {
  attempt: LoginAttempt;
  loginUrl: string;
}
export interface LoginAttemptResult {
  attempt: LoginAttempt;
}
export interface LogoutResult {
  connection: Connection;
}
export interface RestartTranslationRequest {
  modelId: string;
  requestId: string;
  expectedJobId: string;
}
export interface RestartTranslationResult {
  job: Job;
}
export interface TranslationInput {
  block: Block;
  modelId: string;
  context: string;
  targetLanguage?: Language;
  signal?: AbortSignal;
}
export interface TranslationOutput {
  text: string;
  usage: Usage;
}
/** One paragraph inside a page-batch request, tagged with its request-local number so the
 * response can be matched back to it regardless of return order or partial dropout. */
export interface TranslationPageParagraph {
  number: number;
  block: Block;
}
export interface TranslationPageInput {
  paragraphs: TranslationPageParagraph[];
  modelId: string;
  context: string;
  targetLanguage?: Language;
  signal?: AbortSignal;
}
/** One matched-back result. A number missing from the response simply has no entry here —
 * that is not an error, it is a paragraph to retry. */
export interface TranslationPageResultItem {
  number: number;
  text: string;
}
export interface TranslationPageOutput {
  results: TranslationPageResultItem[];
  usage: Usage;
}
export interface Translator {
  connection(): Promise<Connection>;
  translate(input: TranslationInput): Promise<TranslationOutput>;
  /** One request for every translatable paragraph on a page, numbered and matched back by number. */
  translatePage(input: TranslationPageInput): Promise<TranslationPageOutput>;
  disconnect(): Promise<void>;
}

// ------------------------------------------------------------------ paper questions

/** Token counts the official program reported for one answer. A count it did not report stays
 * null — never 0, never a price. `cachedInputTokens` is the part of the input served from the
 * provider's prompt cache (the paper's full text, once warm). */
export interface ChatUsage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
}
/** One entry of a paper's question conversation. An assistant message is 'answering' only while
 * the service is still generating it; its text is then the answer so far. */
export interface ChatMessage {
  messageId: string;
  role: 'user' | 'assistant';
  text: string;
  status: 'completed' | 'answering' | 'failed' | 'canceled';
  /** The model that wrote an assistant message; null for the reader's own questions. */
  modelId: string | null;
  error: AppError | null;
  /** Assistant messages only; null when nothing was reported. */
  usage: ChatUsage | null;
  createdAt: string;
}
/** A paper's single question conversation, as the service holds it. */
export interface Conversation {
  paperKey: string;
  conversationId: string;
  messages: ChatMessage[];
  answering: boolean;
}
export interface AskRequest {
  question: string;
  modelId: string;
  /** Re-ask the last question whose answer failed or was canceled, replacing that exchange
   * instead of appending a duplicate. */
  retry?: boolean;
}
export interface ConversationResult {
  conversation: Conversation;
}
/** One question to the model about one paper revision. */
export interface PaperQuestionInput {
  effort?: z.infer<typeof effortSchema>;
  /** Stable for one conversation; a follow-up with the same id continues the same official
   * thread while it is alive. */
  conversationId: string;
  modelId: string;
  /** The paper's framing and full text, used as the thread's system instructions. Identical for
   * every question about the same revision, so the provider can reuse the cached prefix. */
  instructions: string;
  /** Earlier completed exchanges, oldest first. Replayed only when a new thread has to be opened
   * for an existing conversation (service restart, model change, lost connection). */
  history: { question: string; answer: string }[];
  question: string;
  images?: string[];
  signal?: AbortSignal;
  /** The answer text so far, each time more of it streams in. */
  onText?(text: string): void;
}
export interface PaperQuestionOutput {
  text: string;
  usage: ChatUsage;
}
/** The question path of the official program. Kept apart from Translator: the translation
 * pipeline never receives it, and it never receives account methods. */
export interface PaperChat {
  ask(input: PaperQuestionInput): Promise<PaperQuestionOutput>;
  /** Drop a conversation's official thread (new conversation, deleted paper). */
  forget(conversationId: string): Promise<void>;
}

export const providerIdSchema = z.enum(['codex', 'claude']);
export const effortSchema = z.enum(['low', 'medium', 'high', 'xhigh']);
export const featureSchema = z.enum(['chat', 'translate', 'explain', 'digest']);
export const modelSelectionSchema = z.object({ provider: providerIdSchema, model: z.string().min(1).max(120), effort: effortSchema.optional() });
export const aiSettingsSchema = z.object({
  default: modelSelectionSchema,
  overrides: z.object({
    chat: modelSelectionSchema.optional(),
    translate: modelSelectionSchema.optional(),
    explain: modelSelectionSchema.optional(),
    digest: modelSelectionSchema.optional(),
  }),
});
export const aiSettingsPatchSchema = z.object({ default: modelSelectionSchema.optional(), overrides: aiSettingsSchema.shape.overrides.partial().optional() });
export type ProviderId = z.infer<typeof providerIdSchema>;
export interface AiAccount {
  id: string;
  provider: ProviderId;
  label: string;
  kind: 'system' | 'managed';
  loggedIn: boolean;
  active: boolean;
  email?: string;
  plan?: string;
}
export interface AiLoginProgress {
  state: 'pending' | 'done' | 'failed';
  verificationUrl?: string;
  userCode?: string;
  message?: string;
}
export interface AiLimitWindow {
  usedPercent: number;
  resetsAt: string | null;
}
export interface AiAccountLimits {
  provider: ProviderId;
  accountId: string;
  label: string;
  active: boolean;
  kind: 'system' | 'managed';
  windows: { fiveHour: AiLimitWindow | null; weekly: AiLimitWindow | null };
  plan?: string;
  observedAt: string | null;
  state: 'ok' | 'unavailable' | 'notLoggedIn';
  message?: string;
}
export interface AiLimitsResponse {
  accounts: AiAccountLimits[];
}
export type AiFeature = z.infer<typeof featureSchema>;
export type ModelSelection = z.infer<typeof modelSelectionSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export interface ProviderStatus {
  installCommand?: string;
  id: ProviderId;
  installed: boolean;
  loggedIn: boolean;
  version: string | null;
  detail?: string;
  loginCommand?: string;
}
export interface ProviderModel {
  id: string;
  label: string;
  efforts?: z.infer<typeof effortSchema>[];
}
export interface ProviderInfo {
  status: ProviderStatus;
  models: ProviderModel[];
}
export interface AiInstallProgress {
  state: 'idle' | 'running' | 'done' | 'failed';
  step?: string;
  message?: string;
}
export const aiInstallProgressSchema = z.object({
  state: z.enum(['idle', 'running', 'done', 'failed']),
  step: z.string().optional(),
  message: z.string().optional(),
});
export interface UsageRecord {
  day: string;
  provider: ProviderId;
  model: string;
  requests: number;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
}
export interface AiUsageResponse {
  totals: UsageRecord[];
  limits: Partial<Record<ProviderId, Record<string, unknown> | null>>;
}
export const providerStatusSchema = z.object({
  id: providerIdSchema,
  installed: z.boolean(),
  loggedIn: z.boolean(),
  version: z.string().nullable(),
  detail: z.string().optional(),
  loginCommand: z.string().optional(),
});
export const providerModelSchema = z.object({ id: z.string().min(1), label: z.string(), efforts: z.array(effortSchema).optional() });
export const providerInfoSchema = z.object({ status: providerStatusSchema, models: z.array(providerModelSchema) });
export const providersResponseSchema = z.object({ providers: z.array(providerInfoSchema), settings: aiSettingsSchema });
export const usageRecordSchema = z.object({
  day: z.iso.date(),
  provider: providerIdSchema,
  model: z.string(),
  requests: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  durationMs: z.number().nonnegative(),
});
export const aiUsageResponseSchema = z.object({
  totals: z.array(usageRecordSchema),
  limits: z.object({ codex: z.record(z.string(), z.unknown()).nullable().optional(), claude: z.record(z.string(), z.unknown()).nullable().optional() }),
});
export const bboxSchema = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) })
  .refine((v) => v.x + v.width <= 1 && v.y + v.height <= 1, 'box must fit the page');
/** Geometry only: image bytes are request-local and never persisted in history. */
export const imageAttachmentSchema = z.object({
  page: z.number().int().positive(),
  bbox: bboxSchema,
  kind: z.enum(['figure', 'equation', 'table', 'region']),
  label: z.string().max(200),
});
export type ImageAttachment = z.infer<typeof imageAttachmentSchema>;
export const askPaperSchema = z
  .object({
    provenance: originalProvenanceSchema.optional(),
    answerLanguage: z.union([z.literal('auto'), languageSchema]).optional(),
    question: z.string().trim().min(1).max(4000),
    selectedText: z.string().max(20000).optional(),
    croppedPngBase64: z.string().max(4_000_000).optional(),
    attachment: imageAttachmentSchema.optional(),
    page: z.number().int().positive().optional(),
    rect: bboxSchema.optional(),
    selection: modelSelectionSchema.optional(),
    requestId: z.string().min(1).max(100).optional(),
    /** Groups follow-up turns; the hub answers with the thread's earlier turns as context. */
    threadId: z.string().min(1).max(100).optional(),
  })
  .refine((v) => !v.rect || v.page !== undefined, 'rect requires page')
  .refine((v) => !v.attachment || v.attachment.page === v.page, 'attachment must match physical page')
  .refine(provenanceMatchesPage, 'layoutRange must match the physical page');
export const explainSchema = z
  .object({
    provenance: originalProvenanceSchema.optional(),
    answerLanguage: z.union([z.literal('auto'), languageSchema]).optional(),
    kind: z.enum(['equation', 'figure', 'table', 'text']),
    page: z.number().int().positive(),
    bbox: bboxSchema,
    croppedPngBase64: z.string().max(4_000_000).optional(),
    attachment: imageAttachmentSchema.optional(),
    question: z.string().trim().min(1).max(4000).optional(),
    surroundingText: z.string().max(30000).optional(),
    selection: modelSelectionSchema.optional(),
    requestId: z.string().min(1).max(100).optional(),
    threadId: z.string().min(1).max(100).optional(),
  })
  .refine((v) => !v.attachment || v.attachment.page === v.page, 'attachment must match physical page')
  .refine(provenanceMatchesPage, 'layoutRange must match the physical page');
export const libraryAskSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  selection: modelSelectionSchema.optional(),
  requestId: z.string().min(1).max(100).optional(),
});
export const glossarySchema = z.object({ selection: modelSelectionSchema.optional() });
export interface GlossaryTerm {
  term: string;
  page: number;
  definition: string;
}
export interface AiAnswer {
  citations?: { paperKey: string; page: number; region?: Region }[];
  contextSourceStatus?: ContextSourceStatus;
  imageInput?: 'sent' | 'text_only';
  imageFallbackReason?: string;
  text: string;
  provider: ProviderId;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
}
export type AiSseEvent = (
  { type: 'delta'; text: string } | { type: 'done'; answer: AiAnswer; latex?: string; terms?: GlossaryTerm[] } | { type: 'error'; error: AppError }
) & { historyId?: string };
export const glossaryTermSchema = z.object({ term: z.string().min(1), page: z.number().int().positive(), definition: z.string() });
export const aiAnswerSchema = z.object({
  citations: z
    .array(
      z
        .object({ paperKey: z.string().min(1), page: z.number().int().positive(), region: regionSchema.optional() })
        .refine((value) => !value.region || value.region.page === value.page, 'Citation region must match physical page'),
    )
    .optional(),
  contextSourceStatus: contextSourceStatusSchema.optional(),
  imageInput: z.enum(['sent', 'text_only']).optional(),
  imageFallbackReason: z.string().optional(),
  text: z.string(),
  provider: providerIdSchema,
  model: z.string(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  durationMs: z.number().nonnegative(),
});
export const aiSseEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string(), historyId: z.string().optional() }),
  z.object({
    type: z.literal('done'),
    answer: aiAnswerSchema,
    latex: z.string().optional(),
    terms: z.array(glossaryTermSchema).optional(),
    historyId: z.string().optional(),
  }),
  z.object({
    type: z.literal('error'),
    historyId: z.string().optional(),
    error: z.object({
      code: z.enum([
        'INVALID_INPUT',
        'NOT_FOUND',
        'NETWORK',
        'TOO_LARGE',
        'UNSUPPORTED_PDF',
        'SOURCE_CHANGED',
        'AUTH_REQUIRED',
        'SUBSCRIPTION_REQUIRED',
        'QUOTA',
        'RELATED_RATE_LIMITED',
        'MODEL_UNAVAILABLE',
        'BUSY',
        'INVALID_TRANSLATION',
        'STORAGE',
        'UNSAFE_RUNTIME',
        'INTERNAL',
      ]),
      message: z.string(),
      retryable: z.boolean(),
    }),
  }),
]);
