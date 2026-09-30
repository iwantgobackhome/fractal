import { z } from 'zod';

/** ISO week, Monday through Sunday, used as the feed snapshot key. */
export const feedWeekSchema = z.string().regex(/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/);
export const feedInterestsSchema = z.object({
  categories: z.array(z.string().regex(/^(?:[a-z-]+\.[A-Za-z-]+|gr-qc|hep-ex|hep-lat|hep-ph|hep-th|math-ph|nucl-ex|nucl-th|quant-ph)$/)).max(30),
  topics: z.array(z.string().trim().min(2).max(100)).max(30),
  authors: z.array(z.string().trim().min(2).max(100)).max(30),
  custom: z
    .array(z.object({ id: z.string().min(1).max(100), label: z.string().trim().min(2).max(100), query: z.string().trim().min(1).max(200) }))
    .max(30)
    .default([]),
});
/** Input type permits legacy callers to omit custom; parsed/stored responses include []. */
export type FeedInterests = z.input<typeof feedInterestsSchema>;
export const feedInterestsInputSchema = feedInterestsSchema.extend({
  custom: z
    .array(z.object({ id: z.string().min(1).max(100).optional(), label: z.string().trim().min(2).max(100), query: z.string().trim().max(200).default('') }))
    .max(30)
    .optional(),
});

export const feedSettingsSchema = z.object({
  sources: z.object({ arxiv: z.boolean(), huggingFace: z.boolean(), news: z.boolean(), recommendations: z.boolean() }),
  customRssFeeds: z.array(z.string().url().startsWith('https://')).max(20),
  digestEnabled: z.boolean(),
  refreshIntervalHours: z.number().int().min(1).max(168),
});
export type FeedSettings = z.infer<typeof feedSettingsSchema>;

export const feedItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['paper', 'news']),
  title: z.string(),
  authors: z.array(z.string()),
  abstract: z.string(),
  source: z.string(),
  url: z.string().url(),
  arxivId: z.string().nullable(),
  doi: z.string().nullable(),
  categories: z.array(z.string()),
  publishedAt: z.string().datetime(),
  score: z.number(),
  reason: z.string(),
  reasonCode: z.enum(['followed_author', 'interest_category', 'interest_topic', 'similar_library', 'new_this_week']),
  reasonParams: z.record(z.string(), z.string()),
  inLibrary: z.boolean(),
  popularity: z.number().nonnegative(),
  image: z
    .object({
      url: z.string().regex(/^\/api\/feed\/images\/[a-f0-9]{64}$/),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      alt: z.string().optional(),
    })
    .nullable()
    .default(null),
});
export type FeedItem = z.infer<typeof feedItemSchema>;

export const feedSourceStatusSchema = z.object({
  source: z.string(),
  state: z.enum(['ok', 'cached', 'error', 'disabled']),
  fetchedAt: z.string().datetime().nullable(),
  message: z.string().optional(),
});
export type FeedSourceStatus = z.infer<typeof feedSourceStatusSchema>;

export const feedDigestSchema = z.object({ week: feedWeekSchema, generatedAt: z.string().datetime(), text: z.string() });
export type FeedDigest = z.infer<typeof feedDigestSchema>;

export const feedResponseSchema = z.object({
  week: feedWeekSchema,
  generatedAt: z.string().datetime().nullable(),
  sections: z.object({
    top: z.array(feedItemSchema),
    byField: z.array(z.object({ field: z.string(), label: z.string().optional(), items: z.array(feedItemSchema) })),
    rankings: z.array(feedItemSchema),
    news: z.array(feedItemSchema),
    newsByField: z.array(z.object({ field: z.string(), label: z.string().optional(), items: z.array(feedItemSchema) })),
    recommended: z.array(feedItemSchema),
  }),
  sourceStatus: z.array(feedSourceStatusSchema),
  digest: feedDigestSchema.optional(),
});
export type FeedResponse = z.infer<typeof feedResponseSchema>;
