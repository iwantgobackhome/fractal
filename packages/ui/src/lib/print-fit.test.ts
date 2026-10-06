import { describe, expect, it } from 'vitest';
import { CONTINUATION_LABEL_HEIGHT, fitPrintPage, MM_TO_CSS_PX, printDimensions } from './print-fit';

describe('print fitting', () => {
  it('uses the A4 orientation, margins and split gap for layout dimensions', () => {
    expect(printDimensions('split').height).toBeCloseTo(194 * MM_TO_CSS_PX - 1);
    expect(printDimensions('split').columnWidth).toBeCloseTo(137.5 * MM_TO_CSS_PX);
    expect(printDimensions('translation').height).toBeCloseTo(277 * MM_TO_CSS_PX - 1);
    expect(printDimensions('translation').columnWidth).toBeCloseTo(190 * MM_TO_CSS_PX);
  });
  it('never enlarges short or empty translations', () => {
    expect(fitPrintPage(400, 700)).toEqual({ scale: 1, scaledHeight: 400, slices: [{ offset: 0, height: 400 }] });
    expect(fitPrintPage(0, 700).scale).toBe(1);
  });
  it('fits taller translations on exactly one sheet down to the minimum scale', () => {
    expect(fitPrintPage(1000, 700).scale).toBe(0.7);
    expect(fitPrintPage(1000, 600).slices).toEqual([{ offset: 0, height: 600 }]);
  });
  it('covers oversized translations with contiguous labelled continuation slices', () => {
    const result = fitPrintPage(4000, 700);
    expect(result.scale).toBe(0.6);
    expect(result.slices).toHaveLength(4);
    expect(result.slices[0]).toEqual({ offset: 0, height: 700 });
    for (let i = 1; i < result.slices.length; i++) {
      expect(result.slices[i].offset).toBe(result.slices[i - 1].offset + result.slices[i - 1].height);
      expect(result.slices[i].height).toBeLessThanOrEqual(700 - CONTINUATION_LABEL_HEIGHT);
    }
    expect(result.slices.reduce((sum, slice) => sum + slice.height, 0)).toBe(result.scaledHeight);
  });
  it('rejects invalid dimensions and scale bounds', () => {
    expect(() => fitPrintPage(NaN, 700)).toThrow(RangeError);
    expect(() => fitPrintPage(-1, 700)).toThrow(RangeError);
    expect(() => fitPrintPage(1000, 24)).toThrow(RangeError);
    expect(() => fitPrintPage(1000, 700, 0)).toThrow(RangeError);
  });
});
