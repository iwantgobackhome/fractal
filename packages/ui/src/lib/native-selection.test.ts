import { describe, it, expect } from 'vitest';
import { legalOffset, nativeTextBoundaries } from './native-selection';
import type { PdfTextPage, PdfTextRun } from '@fractal/shared';
import { boundedRect } from '../reader/StickyLayer';
describe('legal original text endpoints', () => {
  it('does not split surrogate pairs or combining graphemes', () => {
    const text = 'A😀e\u0301Z';
    expect(legalOffset(text, 2, false)).toBe(1);
    expect(legalOffset(text, 2, true)).toBe(3);
    expect(legalOffset(text, 4, false)).toBe(3);
    expect(legalOffset(text, 4, true)).toBe(5);
  });
  it('honors authoritative indivisible ligature boundaries', () => {
    expect(legalOffset('fi', 1, false, [0, 2])).toBe(0);
    expect(legalOffset('fi', 1, true, [0, 2])).toBe(2);
  });
  it('keeps characters within a long run whose geometry has only start/end boundaries', () => {
    const text = 'The dominant sequence transduction models use attention mechanisms.';
    const run = { start: 0, end: text.length, granularity: 'run' } as PdfTextRun;
    const layout = { text, boundaries: [0, text.length] } as PdfTextPage;
    const boundaries = nativeTextBoundaries(layout, run);
    expect(boundaries).toBeUndefined();
    const start = text.indexOf('sequence'),
      end = start + 'sequence'.length;
    expect(text.slice(legalOffset(text, start, false, boundaries), legalOffset(text, end, true, boundaries))).toBe('sequence');
    expect(text.slice(legalOffset(text, start + 2, false, boundaries), legalOffset(text, end - 2, true, boundaries))).toBe('quen');
    // Backend legality remains coarse; exact native offsets must not be invented there.
    expect(layout.boundaries).toEqual([0, text.length]);
  });
  it('retains known glyph ligatures and grapheme safety independently of fallback geometry', () => {
    const run = { start: 4, end: 6, granularity: 'glyph-advance' } as PdfTextRun;
    const layout = { boundaries: [0, 4, 6, 10] } as PdfTextPage;
    expect(nativeTextBoundaries(layout, run)).toEqual([0, 2]);
    expect(legalOffset('fi', 1, false, nativeTextBoundaries(layout, run))).toBe(0);
    expect(legalOffset('e\u0301', 1, true, [0, 1, 2])).toBe(2);
  });
});
describe('original sticky constraints', () => {
  it('retains a bounded rectangle when moved or resized beyond page edges', () => {
    expect(boundedRect({ x: -2, y: 2, width: 1.2, height: 0.2 })).toEqual({ x: 0, y: 0.8, width: 1, height: 0.2 });
    expect(boundedRect({ x: 0.95, y: 0.99, width: 0.3, height: -2 })).toEqual({ x: 0.7, y: 0.92, width: 0.3, height: 0.08 });
  });
});
