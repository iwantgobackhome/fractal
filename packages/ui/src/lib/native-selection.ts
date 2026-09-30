import type { PdfTextLayout, PdfTextPage, Region } from '@fractal/shared';
import type { PendingSelection } from '../reader/SelectionMenu';

/** Native ranges measure the actual PDF.js font advances, including transforms. */
export function legalOffset(text: string, offset: number, end: boolean, boundaries?: number[]): number {
  const legal = boundaries ?? [0, ...Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.index + s.segment.length)];
  return end ? (legal.find((n) => n >= offset) ?? text.length) : (legal.filter((n) => n <= offset).at(-1) ?? 0);
}

/** Same display-column heuristic as the accepted positional contract; no font geometry is altered. */
export function orderTextSpans(container: HTMLElement, layout?: PdfTextPage): void {
  const box = container.getBoundingClientRect();
  const spans = Array.from(container.querySelectorAll<HTMLElement>('span')).filter((s) => s.firstChild?.nodeType === Node.TEXT_NODE);
  const bounds = (s: HTMLElement) => {
    const r = s.getBoundingClientRect();
    return { x: (r.left - box.left) / box.width, y: (r.top - box.top) / box.height, right: (r.right - box.left) / box.width };
  };
  let ordered = [...spans].sort((a, b) => bounds(a).y - bounds(b).y || bounds(a).x - bounds(b).x);
  const left = ordered.filter((s) => bounds(s).right <= 0.49),
    right = ordered.filter((s) => bounds(s).x >= 0.51);
  if (left.length >= 2 && right.length >= 2 && left.filter((l) => right.some((r) => Math.abs(bounds(l).y - bounds(r).y) < 0.04)).length >= 2) {
    const result: HTMLElement[] = [],
      band: HTMLElement[] = [];
    const flush = () => {
      result.push(...band.filter((s) => (bounds(s).x + bounds(s).right) / 2 < 0.5), ...band.filter((s) => (bounds(s).x + bounds(s).right) / 2 >= 0.5));
      band.length = 0;
    };
    for (const s of ordered) {
      const r = bounds(s);
      if (s.textContent?.trim() && r.x < 0.49 && r.right > 0.51) {
        flush();
        result.push(s);
      } else band.push(s);
    }
    flush();
    ordered = result;
  }
  // Link native nodes to authoritative Unicode boundaries when the exact run exists.
  const unused = new Set(layout?.runs ?? []);
  for (const [index, s] of ordered.entries()) {
    s.dataset.textRun = String(index);
    const run = [...unused].find((r) => layout?.text.slice(r.start, r.end) === s.textContent);
    if (run && layout) {
      unused.delete(run);
      s.dataset.boundaries = JSON.stringify(layout.boundaries.filter((n) => n >= run.start && n <= run.end).map((n) => n - run.start));
    }
    container.append(s);
  }
  container.querySelectorAll('br').forEach((br) => br.remove());
}

function wholePageRegions(layout: PdfTextPage): Region[] {
  return layout.runs.flatMap((r) => {
    if (!r.quad) return [];
    const points = r.quad.map(([x, y]) =>
      layout.rotation === 90 ? [1 - y, x] : layout.rotation === 180 ? [1 - x, 1 - y] : layout.rotation === 270 ? [y, 1 - x] : [x, y],
    );
    const x = Math.max(0, Math.min(...points.map((p) => p[0]))),
      y = Math.max(0, Math.min(...points.map((p) => p[1])));
    const width = Math.min(1, Math.max(...points.map((p) => p[0]))) - x,
      height = Math.min(1, Math.max(...points.map((p) => p[1]))) - y;
    return width > 0 && height > 0 ? [{ page: layout.page, x, y, width, height }] : [];
  });
}

export async function nativeSelection(root: HTMLElement, getLayout?: (page: number) => Promise<PdfTextLayout | null>): Promise<PendingSelection | null> {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0).cloneRange();
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  for (const end of [false, true]) {
    const node = end ? range.endContainer : range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const span = node.parentElement;
    const boundaries = span?.dataset.boundaries ? (JSON.parse(span.dataset.boundaries) as number[]) : undefined;
    const offset = legalOffset(node.textContent ?? '', end ? range.endOffset : range.startOffset, end, boundaries);
    if (end) range.setEnd(node, offset);
    else range.setStart(node, offset);
  }
  const backwards = selection.anchorNode === selection.getRangeAt(0).endContainer && selection.anchorOffset === selection.getRangeAt(0).endOffset;
  selection.setBaseAndExtent(
    backwards ? range.endContainer : range.startContainer,
    backwards ? range.endOffset : range.startOffset,
    backwards ? range.startContainer : range.endContainer,
    backwards ? range.startOffset : range.endOffset,
  );
  const startPage = range.startContainer.parentElement?.closest<HTMLElement>('[data-page]')?.dataset.page;
  const endPage = range.endContainer.parentElement?.closest<HTMLElement>('[data-page]')?.dataset.page;
  if (!startPage || !endPage) return null;
  const regions: Region[] = [],
    chunks: string[] = [];
  const pageTexts: Record<number, string> = {};
  for (let page = Number(startPage); page <= Number(endPage); page++) {
    const chunkStart = chunks.length;
    const node = root.querySelector<HTMLElement>(`[data-page="${page}"]`);
    const spans = node?.querySelectorAll<HTMLElement>('.textLayer span');
    if (!node) continue;
    const box = node.getBoundingClientRect();
    if (!spans?.length && page > Number(startPage) && page < Number(endPage) && getLayout) {
      const layout = await getLayout(page);
      if (layout?.status === 'ready') {
        chunks.push(layout.page.text);
        pageTexts[page] = layout.page.text;
        regions.push(...wholePageRegions(layout.page));
      }
      continue;
    }
    for (const span of spans ?? []) {
      const text = span.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE || !range.intersectsNode(text)) continue;
      const full = text.textContent ?? '';
      const boundaries = span.dataset.boundaries ? (JSON.parse(span.dataset.boundaries) as number[]) : undefined;
      const start = legalOffset(full, range.startContainer === text ? range.startOffset : 0, false, boundaries);
      const end = legalOffset(full, range.endContainer === text ? range.endOffset : full.length, true, boundaries);
      if (start >= end) continue;
      const part = document.createRange();
      part.setStart(text, start);
      part.setEnd(text, end);
      chunks.push(full.slice(start, end));
      for (const rect of part.getClientRects()) {
        const x = Math.max(0, (rect.left - box.left) / box.width),
          y = Math.max(0, (rect.top - box.top) / box.height);
        const width = Math.min(1 - x, rect.width / box.width),
          height = Math.min(1 - y, rect.height / box.height);
        if (width > 0 && height > 0) regions.push({ page, x, y, width, height });
      }
    }
    pageTexts[page] = chunks.slice(chunkStart).join('\n');
  }
  const text = (
    Number(startPage) === Number(endPage)
      ? chunks.join('\n')
      : Object.entries(pageTexts)
          .map(([page, body]) => `[p.${page}] ${body}`)
          .join('\n')
  )
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim();
  if (!text || !regions.length) return null;
  const rect = range.getBoundingClientRect();
  return {
    page: Number(startPage),
    regions,
    text,
    pageTexts,
    anchor: { x: Math.min(innerWidth - 130, Math.max(130, rect.left + rect.width / 2)), y: Math.max(48, rect.top) },
  };
}
