import { z } from 'zod';
import type { Region } from './library';

export interface Highlight {
  highlightId: string;
  paperKey: string;
  page: number;
  rects: Region[];
  text: string;
  color: 'yellow' | 'green' | 'blue' | 'pink';
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export const annotationBaseSchema = z.object({
  id: z.string().uuid(),
  paperKey: z.string().min(1),
  updatedAt: z.string().datetime(),
  deleted: z.boolean(),
  rev: z.number().int().nonnegative(),
  deviceId: z.string().min(1),
});
export const normalizedRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});
export const memoSchema = annotationBaseSchema.extend({
  kind: z.literal('memo'),
  page: z.number().int().positive(),
  text: z.string(),
  rect: normalizedRectSchema.nullable(),
  quote: z.string().nullable(),
  /** Optional sticky-note appearance; rect remains the normalized page position. */
  collapsed: z.boolean().optional(),
  color: z.enum(['yellow', 'green', 'blue', 'pink']).optional(),
});
export const syncedHighlightSchema = annotationBaseSchema.extend({
  kind: z.literal('highlight'),
  page: z.number().int().positive(),
  text: z.string(),
  color: z.enum(['yellow', 'green', 'blue', 'pink']),
  rects: z.array(normalizedRectSchema),
  note: z.string().nullable(),
});
export type Memo = z.infer<typeof memoSchema>;
export type SyncedHighlight = z.infer<typeof syncedHighlightSchema>;
