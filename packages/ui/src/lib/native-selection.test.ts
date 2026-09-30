import { describe, it, expect } from 'vitest';
import { legalOffset } from './native-selection';
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
});
describe('original sticky constraints', () => {
  it('retains a bounded rectangle when moved or resized beyond page edges', () => {
    expect(boundedRect({ x: -2, y: 2, width: 1.2, height: 0.2 })).toEqual({ x: 0, y: 0.8, width: 1, height: 0.2 });
    expect(boundedRect({ x: 0.95, y: 0.99, width: 0.3, height: -2 })).toEqual({ x: 0.7, y: 0.92, width: 0.3, height: 0.08 });
  });
});
