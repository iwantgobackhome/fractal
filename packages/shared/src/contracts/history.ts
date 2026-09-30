import { z } from 'zod';
import { aiAnswerSchema, bboxSchema, modelSelectionSchema } from './ai';

const historyErrorSchema = z.object({
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
    'ARTICLE_UNAVAILABLE',
    'QUICK_TRANSLATE_UNAVAILABLE',
    'MODEL_UNAVAILABLE',
    'BUSY',
    'INVALID_TRANSLATION',
    'STORAGE',
    'UNSAFE_RUNTIME',
    'INTERNAL',
  ]),
  message: z.string(),
  retryable: z.boolean(),
});
export const historyChatMessageSchema = z.object({
  messageId: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  status: z.enum(['completed', 'answering', 'failed', 'canceled']),
  modelId: z.string().nullable(),
  error: historyErrorSchema.nullable(),
  createdAt: z.string(),
  usage: z.object({ inputTokens: z.number().nullable(), cachedInputTokens: z.number().nullable(), outputTokens: z.number().nullable() }).nullable(),
});

/** A durable request, independent of whether its stream or panel is open. */
export const historyEntrySchema = z.object({
  id: z.string().min(1),
  paperKey: z.string().min(1).nullable(),
  kind: z.enum(['question', 'explanation', 'conversation']),
  question: z.string(),
  text: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'canceled']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  requestId: z.string().nullable(),
  context: z.object({
    page: z.number().int().positive().optional(),
    rect: bboxSchema.optional(),
    selectedText: z.string().optional(),
    explanationKind: z.enum(['figure', 'equation', 'table', 'text']).optional(),
    selection: modelSelectionSchema.optional(),
  }),
  answer: aiAnswerSchema.nullable(),
  latex: z.string().optional(),
  error: historyErrorSchema.nullable(),
  /** Legacy /chat history keeps the original messages and IDs intact. */
  conversation: z.object({ conversationId: z.string(), messages: z.array(historyChatMessageSchema) }).optional(),
  rev: z.number().int().nonnegative(),
  deviceId: z.string().min(1),
  deleted: z.boolean(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export const historyMutationSchema = z.object({
  entry: historyEntrySchema,
  baseRev: z.number().int().nonnegative(),
  requestId: z.string().min(1).max(100),
});
