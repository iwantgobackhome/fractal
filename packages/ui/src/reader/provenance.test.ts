import { describe, expect, it } from 'vitest';
import { renderedRegion } from './useReaderProvenance';
describe('original provenance presentation', () => {
  const region = { page: 2, x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
  it('preserves historical and rendered coordinates even on intrinsically rotated pages', () => {
    expect(renderedRegion(region, undefined, 90)).toBe(region);
    expect(renderedRegion(region, { coordinateSpace: 'rendered-page-normalized-v1' }, 90)).toBe(region);
  });
  it('rotates an explicitly unrotated rectangle once and reverses edits in its declared frame', () => {
    const p = { coordinateSpace: 'unrotated-crop-normalized-v1' } as const;
    const shown = renderedRegion(region, p, 90);
    expect(shown.x).toBeCloseTo(0.4);
    expect(shown.y).toBeCloseTo(0.1);
    expect(shown.width).toBeCloseTo(0.4);
    expect(shown.height).toBeCloseTo(0.3);
    const restored = renderedRegion(shown, p, 270);
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(restored[key]).toBeCloseTo(region[key]);
    expect(region).toEqual({ page: 2, x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
  });
});
