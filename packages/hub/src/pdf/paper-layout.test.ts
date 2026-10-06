import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Block } from '@fractal/shared';
import { extractPdf, textItemRegion } from './index';

// Derived pdf.js text and painted bounds from arXiv:2501.04329v1, not the PDF.
// Path payloads, embedded fonts/images, annotations and rotated stamps are unnecessary.
interface PageFixture {
  view: number[];
  items: { str: string; transform: number[]; width: number; height: number; fontName: string }[];
  styles: Record<string, { ascent?: number; descent?: number; vertical?: boolean; fontFamily?: string }>;
  fonts: Record<string, { bold?: boolean; name?: string }>;
  operations: [number, unknown[]][];
}
const pages: PageFixture[] = Array.from({ length: 10 }, (_, i) =>
  JSON.parse(gunzipSync(readFileSync(new URL(`./paper-page${i + 1}.fixture.json.gz`, import.meta.url))).toString()),
);
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', async (original) => ({
  ...(await original<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>()),
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: async (n: number) => ({
        view: pages[n - 1].view,
        commonObjs: { has: (id: string) => id in pages[n - 1].fonts, get: (id: string) => pages[n - 1].fonts[id] },
        getOperatorList: async () => ({ fnArray: pages[n - 1].operations.map(([op]) => op), argsArray: pages[n - 1].operations.map(([, args]) => args) }),
        getTextContent: async () => ({ items: pages[n - 1].items, styles: pages[n - 1].styles }),
        cleanup: () => {},
      }),
    }),
    destroy: async () => {},
  }),
}));
let blocks: Block[];
const onPage = (n: number) => blocks.filter((b) => b.regions[0]?.page === n);
beforeAll(async () => {
  blocks = (await extractPdf(Buffer.from('%PDF-1.7\n%%EOF'), 'paper')).blocks;
});
describe('IEEE two-column paper extraction', () => {
  it('merges the title, bold abstract and Index Terms without losing column continuations', () => {
    const page = onPage(1);
    expect(page.filter((b) => b.kind === 'heading' && b.fontSize > 0.02)).toHaveLength(1);
    expect(page.find((b) => b.sourceText.startsWith('An Efficient'))?.sourceText).toContain('Human Perception and Machine Vision Tasks');
    const abstract = page.find((b) => b.sourceText.startsWith('Abstract'))!;
    expect(abstract.kind).toBe('paragraph');
    expect(abstract.sourceText).toContain('maintaining the quality of human vision.');
    expect(abstract.regions.length).toBeGreaterThan(20);
    expect(page.find((b) => b.sourceText.startsWith('Index Terms'))?.sourceText).toContain('Video Compression.');
    const continuation = page.find((b) => b.sourceText.startsWith('Recently,'))!;
    expect(continuation.translatable).toBe(true);
    expect(continuation.sourceText).toContain('codecs in these methods are merely optimized');
    expect(continuation.regions.some((r) => r.x > 0.5)).toBe(true);
  });
  it('keeps vector paths and all labels together, separate from captions and neighbouring figures', () => {
    expect(onPage(3).filter((b) => b.kind === 'figure')).toHaveLength(1);
    expect(onPage(4).filter((b) => b.kind === 'figure')).toHaveLength(2);
    expect(onPage(7).filter((b) => b.kind === 'figure')).toHaveLength(3);
    expect(onPage(8).filter((b) => b.kind === 'table')).toHaveLength(3);
    expect(onPage(8).filter((b) => b.kind === 'figure')).toHaveLength(1);
    for (const n of [3, 4]) {
      const prose = onPage(n)
        .filter((b) => b.translatable)
        .map((b) => b.sourceText)
        .join(' ');
      expect(prose).not.toMatch(/^(?:Encoder|Decoder|Partitioning|Transmission)$/m);
      expect(onPage(n).filter((b) => b.kind === 'caption')).toHaveLength(n === 3 ? 1 : 2);
    }
    const figure = onPage(4).filter((b) => b.kind === 'figure')[1].regions[0];
    expect(figure.x).toBeGreaterThan(0.5);
    expect(figure.y + figure.height).toBeLessThan(0.3);
  });
  it('normalizes separated accents and keeps inline sequence math in prose', () => {
    const text = blocks.map((b) => b.sourceText).join(' ');
    expect(text).toContain('Ballé2018');
    expect(text).toContain('ŷ');
    expect(text).not.toContain('Ball´ e');
    const sequence = blocks.find((b) => b.sourceText.includes('producing compressed sequences'))!;
    expect(sequence.kind).toBe('paragraph');
    expect(sequence.sourceText).toContain('respectively. Similar');
    expect(sequence.sourceText).toContain('X̂');
    expect(blocks.some((b) => b.kind === 'equation' && b.sourceText.includes('sequences'))).toBe(false);
  });
  it('attaches raised accents while preserving a real baseline caret operator', async () => {
    const item = (str: string, x: number, y: number) => ({ str, transform: [10, 0, 0, 10, x, y], width: str.length * 5, height: 10, fontName: 'body' });
    const synthetic: PageFixture = {
      view: [0, 0, 600, 800],
      styles: { body: { ascent: 0.8, descent: -0.2 } },
      fonts: { body: { name: 'Times-Roman' } },
      operations: [],
      items: [
        item('The mean is', 60, 650),
        item('x', 120, 650),
        item('¯', 120, 654),
        item('and the hat is', 130, 650),
        item('y', 200, 650),
        item('^', 200, 654),
        item('in this sentence.', 210, 650),
        item('The expression uses a', 60, 630),
        item('^', 170, 630),
        item('b as an operator.', 180, 630),
      ],
    };
    const saved = pages.splice(0, pages.length, synthetic);
    try {
      const text = (await extractPdf(Buffer.from('%PDF-1.7\n%%EOF'), 'accents')).blocks.map((b) => b.sourceText).join(' ');
      expect(text).toContain('x\u0304');
      expect(text).toContain('ŷ');
      expect(text).toContain('a ^ b');
    } finally {
      pages.splice(0, pages.length, ...saved);
    }
  });
  it('accounts for every horizontal body-text item on all ten pages', () => {
    for (const [index, page] of pages.entries())
      for (const item of page.items) {
        if (!/[\p{L}]/u.test(item.str)) continue;
        const [a, b, c, d] = item.transform;
        if (Math.abs(b) > Math.abs(a) * 0.02 || Math.abs(c) > Math.abs(d) * 0.02) continue;
        const region = textItemRegion(item, page.view, index + 1, page.styles[item.fontName] ?? {});
        if (region.y < 0.04 || region.y + region.height > 0.96) continue;
        const cx = region.x + region.width / 2,
          cy = region.y + region.height / 2;
        // Long sentence runs must survive as text, not merely lie inside an accidental crop.
        if (item.str.split(/\s+/).filter((w) => /[a-z]{2,}/i.test(w)).length >= 8) {
          const compact = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f´`ˆ˜¨¯˙ˇ\s]/g, '');
          expect(
            blocks.some((block) => compact(block.sourceText).includes(compact(item.str))),
            `body text on page ${index + 1}: ${item.str}`,
          ).toBe(true);
        }
        expect(
          blocks.some((block) =>
            block.regions.some(
              (r) => r.page === index + 1 && cx >= r.x - 0.001 && cx <= r.x + r.width + 0.001 && cy >= r.y - 0.001 && cy <= r.y + r.height + 0.001,
            ),
          ),
          `page ${index + 1}: ${item.str}`,
        ).toBe(true);
      }
  });
});
