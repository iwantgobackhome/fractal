import { z } from 'zod';

import { memoSchema, syncedHighlightSchema } from './annotations';
import { inkStrokeSchema } from './ink';
import { libraryRecordSchema } from './library';
export const annotationSchema = z.discriminatedUnion('kind', [memoSchema, syncedHighlightSchema, inkStrokeSchema]);
export type Annotation = z.infer<typeof annotationSchema>;
/** Cursor is an append-only local sequence number, encoded as decimal text. */
export const syncPullSchema = z.object({ cursor: z.string().regex(/^\d+$/), papers: z.array(libraryRecordSchema), annotations: z.array(annotationSchema) });
export type SyncPull = z.infer<typeof syncPullSchema>;
export const syncPushSchema = z.object({ annotations: z.array(annotationSchema).max(1000) });
export type SyncPush = z.infer<typeof syncPushSchema>;
export const syncPushResultSchema = z.object({
  results: z.array(z.object({ id: z.string().uuid(), applied: z.boolean(), rev: z.number().int().nonnegative() })),
  cursor: z.string(),
});
export type SyncPushResult = z.infer<typeof syncPushResultSchema>;
