import { z } from 'zod';

/** ISO week, Monday through Sunday, used as the feed snapshot key. */
export const feedWeekSchema = z.string().regex(/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/);
export const feedInterestsSchema = z.object({
  categories: z.array(z.string().regex(/^[a-z-]+\.[A-Za-z-]{2,}$/)).max(30),
  topics: z.array(z.string().trim().min(2).max(100)).max(30),
  authors: z.array(z.string().trim().min(2).max(100)).max(30),
});
export type FeedInterests = z.infer<typeof feedInterestsSchema>;

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
    byField: z.array(z.object({ field: z.string(), items: z.array(feedItemSchema) })),
    rankings: z.array(feedItemSchema),
    news: z.array(feedItemSchema),
    recommended: z.array(feedItemSchema),
  }),
  sourceStatus: z.array(feedSourceStatusSchema),
  digest: feedDigestSchema.optional(),
});
export type FeedResponse = z.infer<typeof feedResponseSchema>;
