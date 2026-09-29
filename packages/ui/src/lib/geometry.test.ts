import { describe, expect, it } from 'vitest';
import { pageRenderSize, regionToPixels, visiblePageWindow } from './geometry';
import { safeHref } from './markdown';

describe('reader helpers', () => {
  it('keeps regions inside the rendered page and bounds the page window', () => {
    expect(pageRenderSize({ width: 100, height: 200 }, 2)).toEqual({ width: 200, height: 400 });
    expect(regionToPixels({ page: 1, x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, { width: 100, height: 200 })).toEqual({
      left: 90,
      top: 180,
      width: 10,
      height: 20,
    });
    expect(visiblePageWindow(1, 3)).toEqual([1, 2]);
  });
  it('only permits HTTP links in rendered markdown', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('https://example.org/paper')).toBe('https://example.org/paper');
  });
});
