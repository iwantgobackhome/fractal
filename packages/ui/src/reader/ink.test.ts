import { describe, expect, it } from 'vitest';
import type { InkStroke } from '@fractal/shared';
import { isHighlighter, strokeHits, strokeOutline } from './ink';

const stroke = (extra: Partial<InkStroke> = {}): InkStroke => ({
  kind: 'ink',
  id: '11111111-1111-4111-8111-111111111111',
  paperKey: 'k',
  page: 1,
  tool: 'pen',
  color: '#000000',
  width: 0.004,
  points: [
    [0.1, 0.1, 0.5, 0],
    [0.2, 0.1, 0.5, 10],
    [0.3, 0.12, 0.5, 20],
  ],
  updatedAt: '2026-09-30T00:00:00.000Z',
  deleted: false,
  rev: 0,
  deviceId: 'd',
  ...extra,
});

describe('ink', () => {
  it('draws a closed outline in page pixels', () => {
    const d = strokeOutline(stroke(), 800, 1000);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    const xs = [...d.matchAll(/[ML]([\d.]+),/g)].map((m) => Number(m[1]));
    expect(Math.min(...xs)).toBeGreaterThan(60);
    expect(Math.max(...xs)).toBeLessThan(260);
  });

  it('treats the tablet brush field before the coarse tool', () => {
    expect(isHighlighter(stroke({ tool: 'highlighter' }))).toBe(true);
    expect(isHighlighter({ ...stroke(), brush: 'highlighter' } as InkStroke)).toBe(true);
    expect(isHighlighter(stroke())).toBe(false);
  });

  it('hits strokes near a point, respecting the page aspect', () => {
    expect(strokeHits(stroke(), 0.2, 0.105, 0.012, 1.3)).toBe(true);
    expect(strokeHits(stroke(), 0.2, 0.2, 0.012, 1.3)).toBe(false);
  });
});
