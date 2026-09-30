import { describe, expect, it } from 'vitest';
import { originalProvenanceSchema, originalPointToRendered, checkOriginalProvenance } from './provenance';
import { askPaperSchema, explainSchema } from './ai';
import { memoSchema } from './annotations';

const hash = 'a'.repeat(64);
describe('optional coordinate provenance', () => {
  it('keeps old requests untagged and supports BCP47 request language without global mutation', () => {
    expect(askPaperSchema.parse({ question: 'Why?', page: 2 })).toEqual({ question: 'Why?', page: 2 });
    expect(askPaperSchema.parse({ question: 'Why?', answerLanguage: 'zh-Hant' }).answerLanguage).toBe('zh-Hant');
    expect(askPaperSchema.safeParse({ question: 'Why?', answerLanguage: 'not_a_language' }).success).toBe(false);
  });
  it('binds UTF16 layout ranges to original source and one physical page', () => {
    const provenance = { textSource: 'original', pdfSha256: hash, layoutRange: { page: 2, extractionVersion: 'layout-v1', start: 0, end: 2 } };
    expect(askPaperSchema.safeParse({ question: 'Why?', page: 2, provenance }).success).toBe(true);
    for (const page of [undefined, 1]) expect(askPaperSchema.safeParse({ question: 'Why?', page, provenance }).success).toBe(false);
    for (const textSource of ['translated', 'unknown', undefined])
      expect(originalProvenanceSchema.safeParse({ ...provenance, textSource }).success).toBe(false);
    expect(originalProvenanceSchema.safeParse({ ...provenance, pdfSha256: undefined }).success).toBe(false);
    expect(explainSchema.safeParse({ kind: 'text', page: 1, bbox: { x: 0, y: 0, width: 1, height: 1 }, provenance }).success).toBe(false);
    const memo = {
      kind: 'memo',
      id: 'd739c2ac-11fa-4fc9-bb8a-0c1ef23e9037',
      paperKey: 'paper',
      page: 2,
      text: 'Keep',
      rect: null,
      quote: null,
      rev: 0,
      deviceId: 'test',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deleted: false,
      provenance,
    };
    expect(memoSchema.parse(memo).provenance).toEqual(provenance);
  });
  it.each([0, 90, 180, 270] as const)('rotates only newly declared crop points once for %i degrees', (rotation) => {
    const point: [number, number] = [0.2, 0.3];
    const expected = { 0: [0.2, 0.3], 90: [0.7, 0.2], 180: [0.8, 0.7], 270: [0.3, 0.8] }[rotation];
    expect(originalPointToRendered(point, { coordinateSpace: 'unrotated-crop-normalized-v1' }, rotation)).toEqual(expected);
    expect(originalPointToRendered(point, undefined, rotation)).toEqual(point);
    expect(originalPointToRendered(point, { coordinateSpace: 'rendered-page-normalized-v1' }, rotation)).toEqual(point);
  });
  it('reports actionable identity and boundary mismatches without mutating the anchor', () => {
    const provenance = originalProvenanceSchema.parse({
      pdfSha256: hash,
      textSource: 'original',
      layoutRange: { page: 2, extractionVersion: 'layout', start: 0, end: 2 },
    });
    const before = JSON.stringify(provenance);
    expect(checkOriginalProvenance(provenance, { pdfSha256: null })).toBe('unavailable');
    expect(checkOriginalProvenance(provenance, { pdfSha256: 'b'.repeat(64) })).toBe('pdf_changed');
    expect(checkOriginalProvenance(provenance, { pdfSha256: hash, layout: { page: 2, extractionVersion: 'blocks', boundaries: [0, 2] } })).toBe(
      'layout_changed',
    );
    expect(checkOriginalProvenance(provenance, { pdfSha256: hash, layout: { page: 2, extractionVersion: 'layout', boundaries: [0, 3] } })).toBe(
      'range_invalid',
    );
    expect(checkOriginalProvenance(provenance, { pdfSha256: hash, layout: { page: 2, extractionVersion: 'layout', boundaries: [0, 2] } })).toBe('current');
    expect(checkOriginalProvenance(provenance, { pdfSha256: hash, layout: { page: 1, extractionVersion: 'layout', boundaries: [0, 2] } })).toBe(
      'range_invalid',
    );
    expect(JSON.stringify(provenance)).toBe(before);
  });
});
