import { z } from 'zod';

// TODO(structure): replace this placeholder with the structure wire contract owned by the future task.
export const structurePlaceholderSchema = z.object({});
export type StructurePlaceholder = z.infer<typeof structurePlaceholderSchema>;
