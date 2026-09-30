import { z } from 'zod';

/** Optional declarations for NEW geometry. Absence never implies a coordinate frame. */
export const originalProvenanceSchema = z
  .object({
    coordinateSpace: z.enum(['rendered-page-normalized-v1', 'unrotated-crop-normalized-v1']).optional(),
    textSource: z.enum(['original', 'translated', 'unknown']).optional(),
    pdfSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    layoutRange: z
      .object({
        page: z.number().int().positive(),
        extractionVersion: z.string().min(1),
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
      })
      .optional(),
    blockExtractionVersion: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.layoutRange || value.blockExtractionVersion) && !value.pdfSha256)
      ctx.addIssue({ code: 'custom', message: 'Extraction provenance requires the actual PDF hash' });
    if (value.layoutRange && (value.textSource !== 'original' || value.layoutRange.end <= value.layoutRange.start))
      ctx.addIssue({ code: 'custom', message: 'layoutRange requires original text and an increasing UTF-16 range' });
  });
export type OriginalProvenance = z.infer<typeof originalProvenanceSchema>;
export const provenanceMatchesPage = (value: { page?: number; provenance?: OriginalProvenance }): boolean =>
  !value.provenance?.layoutRange || value.page === value.provenance.layoutRange.page;
export const contextSourceStatusSchema = z.enum(['current', 'unknown', 'pdf_changed', 'layout_changed', 'range_invalid', 'unavailable']);
export type ContextSourceStatus = z.infer<typeof contextSourceStatusSchema>;

/** Check before using an anchor; keep user text/geometry intact on any mismatch. */
export function checkOriginalProvenance(
  provenance: OriginalProvenance | undefined,
  source: {
    pdfSha256: string | null;
    blockExtractionVersion?: string | null;
    layout?: { page: number; extractionVersion: string; boundaries: number[] };
  },
): ContextSourceStatus {
  if (!provenance?.pdfSha256) return 'unknown';
  if (!source.pdfSha256) return 'unavailable';
  if (source.pdfSha256 !== provenance.pdfSha256) return 'pdf_changed';
  if (provenance.blockExtractionVersion) {
    if (!source.blockExtractionVersion) return 'unavailable';
    if (source.blockExtractionVersion !== provenance.blockExtractionVersion) return 'layout_changed';
  }
  if (provenance.layoutRange) {
    if (!source.layout) return 'unavailable';
    if (source.layout.extractionVersion !== provenance.layoutRange.extractionVersion) return 'layout_changed';
    if (source.layout.page !== provenance.layoutRange.page) return 'range_invalid';
    if (!source.layout.boundaries.includes(provenance.layoutRange.start) || !source.layout.boundaries.includes(provenance.layoutRange.end))
      return 'range_invalid';
  }
  return 'current';
}

/** Rotate a declared unrotated crop ratio clockwise exactly once. Legacy/display points pass through. */
export function originalPointToRendered(point: [number, number], provenance: OriginalProvenance | undefined, rotation: 0 | 90 | 180 | 270): [number, number] {
  if (provenance?.coordinateSpace !== 'unrotated-crop-normalized-v1') return [...point];
  const [x, y] = point;
  switch (rotation) {
    case 90:
      return [1 - y, x];
    case 180:
      return [1 - x, 1 - y];
    case 270:
      return [y, 1 - x];
    default:
      return [...point];
  }
}
