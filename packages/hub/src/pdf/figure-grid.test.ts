import { describe, expect, it, vi } from 'vitest';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPdf } from './index';

// A textbook figure (Szeliski, Figure 3.18): two rows of four photos labelled (a)–(h), with a
// caption whose bold "Figure 3.18" is set off from the italic text by a wide space.
const view = [0, 0, 612, 792];
const item = (str: string, x: number, y: number, size: number, fontName = 'F1') => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width: str.length * size * 0.5,
  height: size,
  fontName,
});
const images: [number, unknown[]][] = [];
const items = [item('3.3 More neighborhood operators', 72, 740, 10)];
for (const [row, top] of [
  [0, 700],
  [1, 590],
] as const)
  for (let col = 0; col < 4; col++) {
    const x = 72 + col * 120;
    images.push([OPS.save, []], [OPS.transform, [100, 0, 0, 80, x, top - 80]], [OPS.paintImageXObject, ['img']], [OPS.restore, []]);
    items.push(item(`(${'abcdefgh'[row * 4 + col]})`, x + 45, top - 95, 9));
  }
items.push(item('Figure 3.18', 72, 470, 10, 'B'));
items.push(item('Median and bilateral filtering: (a) original image with Gaussian noise; (b)', 150, 470, 10, 'I'));
items.push(item('Gaussian filtered; (c) median filtered; (d) bilaterally filtered; (e) original image', 72, 457, 10, 'I'));
items.push(item('with shot noise; (f) Gaussian filtered; (g) median filtered; (h) bilaterally filtered.', 72, 444, 10, 'I'));
for (let i = 0; i < 6; i++)
  items.push(item('More commonly, however, IIR filters are used inside one-dimensional separable filtering stages.', 72, 400 - i * 13, 10));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', async (original) => ({
  ...(await original<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>()),
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        view,
        commonObjs: { has: (id: string) => id === 'B', get: () => ({ bold: true }) },
        getOperatorList: async () => ({ fnArray: images.map(([op]) => op), argsArray: images.map(([, args]) => args) }),
        getTextContent: async () => ({ items, styles: {} }),
        cleanup: () => {},
      }),
    }),
    destroy: async () => {},
  }),
}));

describe('figure grids', () => {
  it('keeps every panel of a captioned grid in one figure crop', async () => {
    const { blocks } = await extractPdf(Buffer.from('%PDF-1.7\n%%EOF'), 'book');
    const figures = blocks.filter((b) => b.kind === 'figure');
    expect(figures).toHaveLength(1);
    expect(blocks.find((b) => b.kind === 'caption')?.sourceText).toMatch(/^Figure 3.18 Median and bilateral filtering/);
    const [region] = figures[0].regions;
    expect(region.x).toBeLessThanOrEqual(72 / 612);
    expect(region.x + region.width).toBeGreaterThanOrEqual(532 / 612);
    expect(region.y).toBeLessThanOrEqual((792 - 700) / 792);
    expect(region.y + region.height).toBeGreaterThan((792 - 510) / 792);
  });
});
