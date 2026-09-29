import { z } from 'zod';

// TODO(feed): replace this placeholder with the feed wire contract owned by the future task.
export const feedPlaceholderSchema = z.object({});
export type FeedPlaceholder = z.infer<typeof feedPlaceholderSchema>;
