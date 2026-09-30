import { describe, expect, it } from 'vitest';
import { pdfTextLayoutSchema, type PdfTextLayout } from './pdf-text';

const fixture: Extract<PdfTextLayout, { status: 'ready' }> = {
  status: 'ready',
  paperKey: 'fixture',
  pdfSha256: 'a'.repeat(64),
  extractionVersion: 'v1',
  pageCount: 1,
  page: {
    page: 1,
    cropBox: [10, 20, 210, 320],
    width: 200,
    height: 300,
    userUnit: 1,
    rotation: 90,
    text: '😀',
    runs: [
      {
        start: 0,
        end: 2,
        quad: [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
        ],
        direction: 'ltr',
        granularity: 'glyph-advance',
        confidence: 'approximate',
        units: [
          {
            start: 0,
            end: 2,
            quad: [
              [0, 0],
              [0, 1],
              [1, 1],
              [1, 0],
            ],
          },
        ],
        words: [],
      },
    ],
    boundaries: [0, 2],
    coverage: 'text',
    issues: [],
    readingOrder: 'geometric-heuristic',
  },
};
describe('offline PDF selection contract', () => {
  it('accepts approximate crop-relative quads and rejects unusable range offsets', () => {
    expect(pdfTextLayoutSchema.safeParse(fixture).success).toBe(true);
    for (const boundaries of [
      [0, 1, 2],
      [0, 2, 2],
      [0, 3],
      [2, 0],
    ])
      expect(pdfTextLayoutSchema.safeParse({ ...fixture, page: { ...fixture.page, boundaries } }).success).toBe(false);
    expect(pdfTextLayoutSchema.safeParse({ ...fixture, page: { ...fixture.page, width: 201 } }).success).toBe(false);
    expect(pdfTextLayoutSchema.safeParse({ ...fixture, page: { ...fixture.page, runs: [{ ...fixture.page.runs[0], confidence: 'exact' }] } }).success).toBe(
      false,
    );
    expect(pdfTextLayoutSchema.safeParse({ ...fixture, page: { ...fixture.page, runs: [{ ...fixture.page.runs[0], units: [] }] } }).success).toBe(false);
  });
  it('accepts actionable missing-PDF and unsupported run states for old clients', () => {
    expect(
      pdfTextLayoutSchema.safeParse({
        status: 'unavailable',
        paperKey: 'metadata',
        extractionVersion: 'v1',
        reason: 'no_pdf',
        message: 'Import the PDF first',
        retryable: false,
      }).success,
    ).toBe(true);
    expect(
      pdfTextLayoutSchema.safeParse({
        ...fixture,
        page: {
          ...fixture.page,
          coverage: 'partial',
          runs: [{ ...fixture.page.runs[0], quad: null, confidence: 'unsupported', granularity: 'run', units: [{ start: 0, end: 2, quad: null }] }],
        },
      }).success,
    ).toBe(true);
  });
});
