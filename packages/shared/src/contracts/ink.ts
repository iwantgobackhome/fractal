import { z } from 'zod';

// TODO(ink): replace this placeholder with the ink wire contract owned by the future task.
export const inkPlaceholderSchema = z.object({});
export type InkPlaceholder = z.infer<typeof inkPlaceholderSchema>;
