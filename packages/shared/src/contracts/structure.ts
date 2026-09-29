import { z } from 'zod';

/** All boxes use top-left page coordinates, normalised to [0, 1]. */
export const structureBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).refine((box) => box.x + box.width <= 1.000001 && box.y + box.height <= 1.000001);
export type StructureBox = z.infer<typeof structureBoxSchema>;

export const structureItemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['figure', 'table', 'equation']),
  page: z.number().int().positive(),
  bbox: structureBoxSchema,
  label: z.string(),
  caption: z.string(),
  confidence: z.number().min(0).max(1),
  latex: z.string().optional(),
  sourceLabel: z.string().optional(),
});
export type StructureItem = z.infer<typeof structureItemSchema>;

export const referenceEntrySchema = z.object({
  n: z.string().min(1),
  raw: z.string().min(1),
  title: z.string().optional(),
  authors: z.string().optional(),
  year: z.number().int().optional(),
  doi: z.string().optional(),
  arxivId: z.string().optional(),
});
export type ReferenceEntry = z.infer<typeof referenceEntrySchema>;

export const citationMarkerSchema = z.object({
  id: z.string().min(1),
  page: z.number().int().positive(),
  bbox: structureBoxSchema,
  text: z.string(),
  references: z.array(z.string()),
});
export type CitationMarker = z.infer<typeof citationMarkerSchema>;

export const structureStatusSchema = z.enum(['pending', 'running', 'ready', 'failed']);
export type StructureStatus = z.infer<typeof structureStatusSchema>;
export const paperStructureSchema = z.object({
  version: z.string(),
  status: structureStatusSchema,
  items: z.array(structureItemSchema),
  references: z.array(referenceEntrySchema),
  markers: z.array(citationMarkerSchema),
});
export type PaperStructure = z.infer<typeof paperStructureSchema>;

export const referenceEnrichmentSchema = z.object({
  title: z.string().nullable(),
  abstract: z.string().nullable(),
  year: z.number().int().nullable(),
  venue: z.string().nullable(),
  externalIds: z.record(z.string(), z.string()),
  citationCount: z.number().int().nonnegative().nullable(),
  openAccessPdf: z.string().url().nullable(),
  provider: z.enum(['semantic-scholar', 'openalex']),
});
export type ReferenceEnrichment = z.infer<typeof referenceEnrichmentSchema>;
