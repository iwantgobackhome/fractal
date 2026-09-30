import { z } from 'zod';

const point = z.tuple([z.number().finite(), z.number().finite()]);
/** Crop-relative, top-left, UNROTATED normalized geometry. Points may lie outside the
 * crop; clients clip at the crop boundary. Quad order: baseline-start descent,
 * baseline-start ascent, baseline-end ascent, baseline-end descent. */
export const pdfTextQuadSchema = z.tuple([point, point, point, point]);
export const pdfTextUnitSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  quad: pdfTextQuadSchema.nullable(),
});
export const pdfTextRunSchema = pdfTextUnitSchema.extend({
  direction: z.enum(['ltr', 'rtl', 'ttb']),
  granularity: z.enum(['glyph-advance', 'run']),
  confidence: z.enum(['approximate', 'unsupported']),
  units: z.array(pdfTextUnitSchema),
  words: z.array(pdfTextUnitSchema),
});
export const pdfTextPageSchema = z
  .object({
    page: z.number().int().positive(), // physical page, one-based; unrelated to Block.pageOrdinal
    cropBox: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
    width: z.number().positive(), // unrotated crop width/height in PDF user-space points
    height: z.number().positive(),
    userUnit: z.number().positive(), // multiply PDF user-space points by this for physical points
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
    text: z.string(), // original PDF.js Unicode, disableNormalization; offsets are UTF-16
    runs: z.array(pdfTextRunSchema), // deterministic heuristic DISPLAY reading order
    boundaries: z.array(z.number().int().nonnegative()), // only these offsets are legal range endpoints
    coverage: z.enum(['text', 'partial', 'no_text']),
    issues: z.array(z.string()),
    readingOrder: z.literal('geometric-heuristic'),
  })
  .superRefine((page, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (Math.abs(page.width - (page.cropBox[2] - page.cropBox[0])) > 0.000001 || Math.abs(page.height - (page.cropBox[3] - page.cropBox[1])) > 0.000001)
      fail('Crop dimensions do not match');
    const legal = new Set(page.boundaries);
    if (page.boundaries[0] !== 0 || page.boundaries.at(-1) !== page.text.length) fail('Boundary endpoints must cover page text');
    for (let i = 0; i < page.boundaries.length; i++) {
      const offset = page.boundaries[i];
      if (offset > page.text.length || (i > 0 && offset <= page.boundaries[i - 1])) fail('Boundaries must be sorted unique valid offsets');
      const before = page.text.charCodeAt(offset - 1),
        after = page.text.charCodeAt(offset);
      if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) fail('A boundary splits a surrogate pair');
    }
    let previousEnd = 0;
    for (const run of page.runs) {
      if (run.start < previousEnd || run.end <= run.start || run.end > page.text.length || !legal.has(run.start) || !legal.has(run.end))
        fail('Invalid run range');
      previousEnd = run.end;
      let cursor = run.start;
      for (const unit of run.units) {
        if (unit.start !== cursor || unit.end <= unit.start || unit.end > run.end || !legal.has(unit.start) || !legal.has(unit.end))
          fail('Invalid selection unit');
        cursor = unit.end;
      }
      if (cursor !== run.end) fail('Selection units must cover the run');
      for (const word of run.words)
        if (word.start < run.start || word.end <= word.start || word.end > run.end || !legal.has(word.start) || !legal.has(word.end))
          fail('Invalid word range');
    }
  });
export const pdfTextLayoutSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    paperKey: z.string(),
    pdfSha256: z.string().regex(/^[a-f0-9]{64}$/),
    extractionVersion: z.string(),
    pageCount: z.number().int().positive(),
    page: pdfTextPageSchema,
  }),
  z.object({
    status: z.literal('unavailable'),
    paperKey: z.string(),
    extractionVersion: z.string(),
    reason: z.enum(['no_pdf', 'too_large', 'invalid_pdf', 'page_out_of_range', 'timeout', 'page_limit']),
    message: z.string(),
    retryable: z.boolean(),
    pdfSha256: z.string().optional(),
    pageCount: z.number().int().positive().optional(),
  }),
]);
export type PdfTextQuad = z.infer<typeof pdfTextQuadSchema>;
export type PdfTextUnit = z.infer<typeof pdfTextUnitSchema>;
export type PdfTextRun = z.infer<typeof pdfTextRunSchema>;
export type PdfTextPage = z.infer<typeof pdfTextPageSchema>;
export type PdfTextLayout = z.infer<typeof pdfTextLayoutSchema>;
