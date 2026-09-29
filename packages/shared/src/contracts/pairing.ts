import { z } from 'zod';

// TODO(pairing): replace this placeholder with the pairing wire contract owned by the future task.
export const pairingPlaceholderSchema = z.object({});
export type PairingPlaceholder = z.infer<typeof pairingPlaceholderSchema>;
