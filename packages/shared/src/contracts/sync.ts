import { z } from 'zod';

// TODO(sync): replace this placeholder with the sync wire contract owned by the future task.
export const syncPlaceholderSchema = z.object({});
export type SyncPlaceholder = z.infer<typeof syncPlaceholderSchema>;
