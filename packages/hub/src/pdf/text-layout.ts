import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PdfTextLayout, PdfTextPage, PdfTextQuad, PdfTextRun, PdfTextUnit } from '@fractal/shared';

export const TEXT_LAYOUT_VERSION = 'pdfjs6-original-advances-v1';
export const TEXT_LAYOUT_LIMITS = { bytes: 50 * 1024 * 1024, pages: 3000, operators: 200_000, characters: 50_000, runs: 10_000, timeoutMs: 30_000 };
type Item = { str: string; dir: string; width: number; height: number; transform: number[]; fontName: string };
type Font = { ascent?: number; descent?: number; vertical?: boolean };
type Draft = { item: Item; run: PdfTextRun; display: { x: number; y: number; right: number; bottom: number }; index: number };
type Glyph = { start: number; end: number; advance: number | null };
type FontStream = { text: string; glyphs: Glyph[]; cursor: number; starts: Map<number, number>; ends: Set<number> };
type Metrics = Map<string, FontStream>;
const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });
const words = new Intl.Segmenter('und', { granularity: 'word' });

/** Preserve source-order glyph provenance, including multi-character ligatures. A font
 * dictionary cannot distinguish a true fi glyph from f+i emitted elsewhere in that font. */
function glyphMetrics(ops: { fnArray: number[]; argsArray: unknown[][] }): Metrics {
  const metrics: Metrics = new Map();
  const pieces = new Map<string, string[]>();
  let font = '';
  const stack: string[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i],
      args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(font);
    else if (fn === OPS.restore) font = stack.pop() ?? '';
    else if (fn === OPS.setFont) font = String(args[0]);
    else if (fn === OPS.showText && font) {
      const values: FontStream = metrics.get(font) ?? { text: '', glyphs: [], cursor: 0, starts: new Map(), ends: new Set() };
      metrics.set(font, values);
      const strings = pieces.get(font) ?? [];
      pieces.set(font, strings);
      for (const glyph of (args[0] as unknown[]) ?? []) {
        if (!glyph || typeof glyph !== 'object') continue;
        const { unicode, width } = glyph as { unicode?: string; width?: number };
        if (!unicode) continue;
        if (values.glyphs.length >= TEXT_LAYOUT_LIMITS.operators) throw new Error('Too many glyphs');
        const start = values.glyphs.at(-1)?.end ?? 0,
          end = start + unicode.length;
        values.starts.set(start, values.glyphs.length);
        values.ends.add(end);
        values.glyphs.push({ start, end, advance: typeof width === 'number' && Number.isFinite(width) && width >= 0 ? width : null });
        strings.push(unicode);
      }
    }
  }
  for (const [font, stream] of metrics) stream.text = pieces.get(font)!.join('');
  return metrics;
}

function quad(item: Item, font: Font, crop: number[], from = 0, to = 1): PdfTextQuad | null {
  if (!Array.isArray(item.transform) || item.transform.length !== 6) return null;
  const [a, b, c, d, e, f] = item.transform,
    length = Math.hypot(a, b);
  if (!length || ![a, b, c, d, e, f, item.width, item.height, ...crop].every(Number.isFinite) || item.width <= 0 || crop[2] <= crop[0] || crop[3] <= crop[1])
    return null;
  const ascent = font.ascent ?? 0.85,
    descent = font.descent ?? -0.25;
  if (![ascent, descent].every(Number.isFinite) || ascent <= descent || !Math.hypot(c, d)) return null;
  const dx = (a / length) * item.width,
    dy = (b / length) * item.width;
  const at = (t: number, height: number): [number, number] => [
    (e + dx * t + c * height - crop[0]) / (crop[2] - crop[0]),
    (crop[3] - f - dy * t - d * height) / (crop[3] - crop[1]),
  ];
  if (font.vertical) return null; // vertical advance needs vertical font origins, not horizontal math
  return [at(from, descent), at(from, ascent), at(to, ascent), at(to, descent)];
}

function advanceUnits(item: Item, font: Font, crop: number[], metrics?: FontStream): PdfTextUnit[] | null {
  if (!metrics || item.dir !== 'ltr' || font.vertical || !quad(item, font, crop)) return null;
  // PDF.js inserts layout whitespace not painted by an operator; do not consume glyphs
  // from a later real run to give a synthetic gap a fabricated advance.
  if (!item.str.trim()) return null;
  const matchStart = metrics.text.indexOf(item.str, metrics.cursor),
    end = matchStart + item.str.length;
  if (matchStart < 0 || !metrics.starts.has(matchStart) || !metrics.ends.has(end)) return null;
  const glyphs: { start: number; end: number; advance: number }[] = [];
  for (let i = metrics.starts.get(matchStart)!; i < metrics.glyphs.length && metrics.glyphs[i].start < end; i++) {
    const g = metrics.glyphs[i];
    if (g.advance === null || g.end > end) return null;
    glyphs.push({ start: g.start - matchStart, end: g.end - matchStart, advance: g.advance });
  }
  metrics.cursor = end;
  const total = glyphs.reduce((sum, g) => sum + g.advance, 0);
  if (total <= 0) return null;
  const safe = new Set([...graphemes.segment(item.str)].map((s) => s.index + s.segment.length));
  const units: PdfTextUnit[] = [];
  let start = 0,
    cursor = 0,
    previous = 0;
  for (const glyph of glyphs) {
    cursor += glyph.advance;
    if (safe.has(glyph.end)) {
      units.push({ start, end: glyph.end, quad: quad(item, font, crop, previous / total, cursor / total) });
      start = glyph.end;
      previous = cursor;
    }
  }
  return units;
}

function displayBounds(q: PdfTextQuad | null, rotation: number): Draft['display'] {
  const points = (
    q ?? [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]
  ).map(([x, y]) => (rotation === 90 ? [1 - y, x] : rotation === 180 ? [1 - x, 1 - y] : rotation === 270 ? [y, 1 - x] : [x, y]));
  return {
    x: Math.min(...points.map((p) => p[0])),
    y: Math.min(...points.map((p) => p[1])),
    right: Math.max(...points.map((p) => p[0])),
    bottom: Math.max(...points.map((p) => p[1])),
  };
}

/** Column bands, split by spanning headings/captions. This is deterministic geometry
 * ordering, not a semantic claim for tables, marginalia or mathematical expressions. */
function order(drafts: Draft[]): Draft[] {
  const sorted = [...drafts].sort((a, b) => a.display.y - b.display.y || a.display.x - b.display.x || a.index - b.index);
  const left = sorted.filter((r) => r.display.right <= 0.49),
    right = sorted.filter((r) => r.display.x >= 0.51);
  const paired = left.filter((l) => right.some((r) => Math.abs(l.display.y - r.display.y) < 0.04));
  if (left.length < 2 || right.length < 2 || paired.length < 2) return sorted;
  const out: Draft[] = [],
    band: Draft[] = [];
  const flush = () => {
    out.push(...band.filter((r) => (r.display.x + r.display.right) / 2 < 0.5), ...band.filter((r) => (r.display.x + r.display.right) / 2 >= 0.5));
    band.length = 0;
  };
  for (const r of sorted) {
    if (r.item.str.trim() && r.display.x < 0.49 && r.display.right > 0.51) {
      flush();
      out.push(r);
    } else band.push(r);
  }
  flush();
  return out;
}

export function unavailable(
  paperKey: string,
  reason: Extract<PdfTextLayout, { status: 'unavailable' }>['reason'],
  message: string,
  extra: { pdfSha256?: string; pageCount?: number } = {},
): PdfTextLayout {
  return { status: 'unavailable', paperKey, extractionVersion: TEXT_LAYOUT_VERSION, reason, message, retryable: reason === 'timeout', ...extra };
}

/** Retain readable neighbours when individual items lack geometry or a font style. */
export function positionTextPage(
  items: Item[],
  styles: Record<string, Font>,
  crop: number[],
  pageNumber: number,
  rotation: 0 | 90 | 180 | 270,
  userUnit: number,
  metrics: Metrics = new Map(),
  issues = new Set<string>(),
): PdfTextPage {
  if (crop[2] <= crop[0] || crop[3] <= crop[1]) throw new Error('Invalid crop box');
  const drafts = items.map((item, index): Draft => {
    const font = (styles[item.fontName] ?? {}) as Font;
    if (!styles[item.fontName]) issues.add('missing_font_style');
    const q = quad(item, font, crop);
    const units = advanceUnits(item, font, crop, metrics.get(item.fontName));
    if (font.ascent === undefined || font.descent === undefined) issues.add('fallback_font_envelope');
    if (!q) issues.add('unsupported_geometry');
    if (!units && item.str.trim()) issues.add('run_boundary_fallback');
    if (item.str.includes('\ufffd') || item.str.includes('\0')) issues.add('unreliable_unicode');
    if (/\p{M}/u.test(item.str)) issues.add('combining_mark_envelope_approximate');
    const safe = new Set((units ?? []).flatMap((u) => [u.start, u.end]));
    const starts = new Map((units ?? []).map((u) => [u.start, u]));
    const ends = new Map((units ?? []).map((u) => [u.end, u]));
    const wordUnits: PdfTextUnit[] = [];
    if (units)
      for (const word of words.segment(item.str)) {
        const start = word.index,
          end = start + word.segment.length;
        if (!word.isWordLike || !safe.has(start) || !safe.has(end)) continue;
        const first = starts.get(start),
          last = ends.get(end);
        if (first?.quad && last?.quad) wordUnits.push({ start, end, quad: [first.quad[0], first.quad[1], last.quad[2], last.quad[3]] });
      }
    return {
      item,
      index,
      display: displayBounds(q, rotation),
      run: {
        start: 0,
        end: item.str.length,
        quad: q,
        direction: font.vertical ? 'ttb' : item.dir === 'rtl' ? 'rtl' : 'ltr',
        granularity: units ? 'glyph-advance' : 'run',
        confidence: q ? 'approximate' : 'unsupported',
        units: units ?? [{ start: 0, end: item.str.length, quad: q }],
        words: wordUnits,
      },
    };
  });
  let text = '';
  const runs: PdfTextRun[] = [],
    boundaries = new Set<number>([0]);
  for (const { item, run } of order(drafts)) {
    if (text.length) {
      boundaries.add(text.length);
      text += '\n';
      boundaries.add(text.length);
    }
    const offset = text.length;
    text += item.str;
    const move = (u: PdfTextUnit): PdfTextUnit => ({ ...u, start: u.start + offset, end: u.end + offset });
    const shifted = { ...run, start: offset, end: text.length, units: run.units.map(move), words: run.words.map(move) };
    runs.push(shifted);
    for (const unit of shifted.units) {
      boundaries.add(unit.start);
      boundaries.add(unit.end);
    }
  }
  if (!text.trim()) issues.add('no_text_no_ocr');
  issues.add('font_advance_envelopes_not_glyph_outlines');
  const result: PdfTextPage = {
    page: pageNumber,
    cropBox: [crop[0], crop[1], crop[2], crop[3]],
    width: crop[2] - crop[0],
    height: crop[3] - crop[1],
    userUnit,
    rotation,
    text,
    runs,
    boundaries: [...boundaries].sort((a, b) => a - b),
    coverage: !text.trim()
      ? 'no_text'
      : [
            'unsupported_geometry',
            'run_boundary_fallback',
            'unreliable_unicode',
            'operator_metrics_unavailable',
            'missing_font_style',
            'fallback_font_envelope',
          ].some((issue) => issues.has(issue))
        ? 'partial'
        : 'text',
    issues: [...issues].sort(),
    readingOrder: 'geometric-heuristic',
  };
  return result;
}

/** Separate from article ingestion: retain rotated/cropped text and do not mutate blocks. */
export async function extractTextPage(
  bytes: Uint8Array,
  pageNumber: number,
  timeoutMs = TEXT_LAYOUT_LIMITS.timeoutMs,
): Promise<{ pageCount: number; page: PdfTextPage } | Extract<PdfTextLayout, { status: 'unavailable' }>> {
  if (!bytes.length) return unavailable('', 'invalid_pdf', 'Local PDF is empty; reimport a readable PDF') as Extract<PdfTextLayout, { status: 'unavailable' }>;
  if (bytes.length > TEXT_LAYOUT_LIMITS.bytes)
    return unavailable('', 'too_large', 'Local PDF exceeds the 50 MiB geometry limit') as Extract<PdfTextLayout, { status: 'unavailable' }>;
  const task = getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
    maxImageSize: 16 * 1024 * 1024,
    isOffscreenCanvasSupported: false,
  });
  let timer: ReturnType<typeof setTimeout> | undefined,
    timedOut = false;
  try {
    const work = async () => {
      const doc = await task.promise;
      if (doc.numPages > TEXT_LAYOUT_LIMITS.pages)
        return unavailable('', 'page_limit', 'PDF exceeds the 3000-page geometry limit', { pageCount: doc.numPages });
      if (pageNumber > doc.numPages) return unavailable('', 'page_out_of_range', 'Requested physical page does not exist', { pageCount: doc.numPages });
      const page = await doc.getPage(pageNumber);
      try {
        const issues = new Set<string>();
        let metrics: Metrics = new Map();
        try {
          const ops = await page.getOperatorList();
          if (ops.fnArray.length > TEXT_LAYOUT_LIMITS.operators)
            return unavailable('', 'page_limit', 'Page exceeds the 200000-operator geometry limit', { pageCount: doc.numPages });
          metrics = glyphMetrics(ops);
        } catch {
          issues.add('operator_metrics_unavailable');
        }
        const content = await page.getTextContent({ disableNormalization: true });
        const items = content.items.filter((i): i is Item & { hasEOL: boolean } => 'str' in i && i.str.length > 0);
        if (items.length > TEXT_LAYOUT_LIMITS.runs || items.reduce((n, i) => n + i.str.length, 0) > TEXT_LAYOUT_LIMITS.characters)
          return unavailable('', 'page_limit', 'Page exceeds text/run geometry limits', { pageCount: doc.numPages });
        return {
          pageCount: doc.numPages,
          page: positionTextPage(
            items,
            content.styles,
            page.view,
            pageNumber,
            (((page.rotate % 360) + 360) % 360) as 0 | 90 | 180 | 270,
            page.userUnit,
            metrics,
            issues,
          ),
        };
      } finally {
        page.cleanup();
      }
    };
    return (await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          void task.destroy();
          reject(new Error('Extraction timeout'));
        }, timeoutMs);
      }),
    ])) as { pageCount: number; page: PdfTextPage } | Extract<PdfTextLayout, { status: 'unavailable' }>;
  } catch {
    return unavailable(
      '',
      timedOut ? 'timeout' : 'invalid_pdf',
      timedOut ? 'Geometry extraction timed out; retry this page' : 'PDF page could not be decoded; reimport a readable local PDF',
    ) as Extract<PdfTextLayout, { status: 'unavailable' }>;
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}
