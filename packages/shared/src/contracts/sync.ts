import { z } from 'zod';

import { memoSchema, syncedHighlightSchema } from './annotations';
import { inkStrokeSchema } from './ink';
import { libraryRecordSchema, collectionSchema, libraryMutationSchema, folderMutationSchema } from './library';
import { historyEntrySchema, historyMutationSchema } from './history';
export const annotationSchema = z.discriminatedUnion('kind', [memoSchema, syncedHighlightSchema, inkStrokeSchema]);
export type Annotation = z.infer<typeof annotationSchema>;
/** Cursor is an append-only local sequence number, encoded as decimal text. */
export const syncPullSchema = z.object({
  cursor: z.string().regex(/^\d+$/),
  papers: z.array(libraryRecordSchema),
  annotations: z.array(annotationSchema),
  folders: z.array(collectionSchema).optional(),
  history: z.array(historyEntrySchema).optional(),
  deletedPapers: z.array(z.string()).optional(),
});
export type SyncPull = z.infer<typeof syncPullSchema>;
export const syncPushSchema = z.object({
  annotations: z.array(annotationSchema).max(1000).default([]),
  papers: z.array(libraryMutationSchema).max(1000).optional(),
  folders: z.array(folderMutationSchema).max(1000).optional(),
  history: z.array(historyMutationSchema).max(1000).optional(),
});
export type SyncPush = z.infer<typeof syncPushSchema>;
export const syncPushResultSchema = z.object({
  results: z.array(z.object({ id: z.string().uuid(), applied: z.boolean(), rev: z.number().int().nonnegative() })),
  cursor: z.string(),
  /** Server head only: clients must only advance their checkpoint from a consumed pull. */
  serverHead: z.string().optional(),
  metadataResults: z
    .array(
      z.object({
        kind: z.enum(['paper', 'folder', 'history']),
        id: z.string(),
        applied: z.boolean(),
        rev: z.number().int().nonnegative(),
        conflict: z.boolean(),
        current: z.union([libraryRecordSchema, collectionSchema, historyEntrySchema]).nullable(),
      }),
    )
    .optional(),
});
export type SyncPushResult = z.infer<typeof syncPushResultSchema>;
