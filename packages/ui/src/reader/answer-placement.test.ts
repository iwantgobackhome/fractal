import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '@fractal/shared';
import { cardPoint, pagePoint, clampCard, defaultPlacement, mergeLineRegions, threadRoot } from './answer-placement';
describe('answer card placement', () => {
  const page = { left: 50, top: -100, width: 800, height: 1000 };
  it('round trips page and screen coordinates, including scrolling', () => {
    const point = cardPoint(0.25, 0.3, page);
    expect(point).toEqual({ x: 250, y: 200 });
    expect(pagePoint(point.x, point.y, page)).toEqual({ x: 0.25, y: 0.3 });
    expect(cardPoint(0.25, 0.3, { ...page, top: page.top - 60 }).y).toBe(point.y - 60);
  });
  it('keeps the card within the page and handles small pages', () => {
    expect(clampCard({ x: 2, y: -1 }, 420, 560, page)).toEqual({ x: 0.475, y: 0 });
    expect(clampCard({ x: 0.5, y: 0.5 }, 420, 560, { width: 300, height: 400 })).toEqual({ x: 0, y: 0 });
  });
  it('places beside the source and clamps near page edges', () => {
    expect(defaultPlacement({ x: 0.1, y: 0.2, width: 0.1, height: 0.1 }, page)).toEqual({ x: 0.21500000000000002, y: 0.2 });
    const edge = defaultPlacement({ x: 0.9, y: 0.9, width: 0.1, height: 0.1 }, page);
    expect(edge.x).toBeCloseTo(0.475);
    expect(edge.y).toBeCloseTo(0.44);
  });
  it('prefers the entry whose ID equals the thread ID, otherwise the oldest turn', () => {
    const entry = (id: string, date: string) => ({ id, context: { threadId: 'root' }, createdAt: date }) as HistoryEntry;
    const oldest = entry('old', '2026-01-01'),
      root = entry('root', '2026-02-01');
    expect(threadRoot([oldest, root])).toBe(root);
    expect(threadRoot([entry('new', '2026-03-01'), oldest])).toBe(oldest);
    expect(threadRoot([])).toBeUndefined();
  });
});

describe('mergeLineRegions', () => {
  it('joins character boxes on one line and keeps separate lines apart', () => {
    const chars = [0, 0.05, 0.1].map((x) => ({ page: 1, x, y: 0.2, width: 0.04, height: 0.02 }));
    const next = { page: 1, x: 0, y: 0.25, width: 0.04, height: 0.02 };
    const merged = mergeLineRegions([...chars, next]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ x: 0, y: 0.2 });
    expect(merged[0].height).toBeCloseTo(0.02);
    expect(merged[0].width).toBeCloseTo(0.14);
  });
});
