import { z } from 'zod';
/** Provider-reported metadata, not a promise that a URL can be downloaded here. */
export const publicationMetadataSchema = z.object({
  year: z.number().int().positive().nullable(),
  venue: z.string().nullable(),
  publicationKind: z.enum(['journal', 'conference', 'preprint', 'other', 'unknown']),
  publicationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value)
    .nullable(),
  sources: z.array(z.enum(['openAlex', 'crossref', 'semanticScholar', 'arxiv', 'huggingFace', 'user'])).optional(),
  oaAvailability: z.enum(['open', 'closed', 'unknown']),
  oaPdfUrl: z.string().url().startsWith('https://').nullable(),
});
export type PublicationMetadata = z.infer<typeof publicationMetadataSchema>;
export const publicationBookmarkSchema = z.object({
  title: z.string().trim().min(1).max(1000),
  authors: z.array(z.string().max(300)).max(200).default([]),
  doi: z.string().nullable().optional(),
  arxivId: z.string().nullable().optional(),
  url: z.string().url().startsWith('https://'),
  abstract: z.string().max(30000).nullable().optional(),
  publication: publicationMetadataSchema.optional(),
});
export type PublicationBookmark = z.infer<typeof publicationBookmarkSchema>;
export interface PublicationBookmarkResult {
  paperKey: string;
  record: import('./library').LibraryRecord;
  hasPdf: boolean;
}
export interface PublicationPdfLinkResult extends PublicationBookmarkResult {
  paper: import('./library').Paper;
}
export type PublicationProvider = 'semanticScholar' | 'openAlex' | 'crossref';
export interface PublicationProviderStatus {
  provider: PublicationProvider;
  state: 'ok' | 'not_found' | 'rate_limited' | 'timeout' | 'error' | 'auth_required' | 'budget_exhausted';
  message?: string;
  httpStatus?: number;
  retryAt?: string;
}
