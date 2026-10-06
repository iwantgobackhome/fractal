export type PrintMode = 'translation' | 'split';

export const MM_TO_CSS_PX = 96 / 25.4;
export const MIN_PRINT_SCALE = 0.6;
export const CONTINUATION_LABEL_HEIGHT = 24;

/** One source of truth for both @page and the measured print layout. */
export function printDimensions(mode: PrintMode) {
  const marginMm = mode === 'split' ? 8 : 10;
  const widthMm = mode === 'split' ? 297 : 210;
  const heightMm = mode === 'split' ? 210 : 297;
  const gap = mode === 'split' ? 6 * MM_TO_CSS_PX : 0;
  const width = (widthMm - 2 * marginMm) * MM_TO_CSS_PX;
  // Leave one CSS pixel for printer rounding at the page boundary.
  const height = (heightMm - 2 * marginMm) * MM_TO_CSS_PX - 1;
  return { marginMm, width, height, gap, columnWidth: (width - gap) / (mode === 'split' ? 2 : 1) };
}

/** Offsets are in scaled CSS pixels; slices cover the entire translated page. */
export function fitPrintPage(height: number, availableHeight: number, minimumScale = MIN_PRINT_SCALE) {
  if (!Number.isFinite(height) || height < 0 || !Number.isFinite(availableHeight) || availableHeight <= CONTINUATION_LABEL_HEIGHT) {
    throw new RangeError('Invalid print page dimensions');
  }
  if (!Number.isFinite(minimumScale) || minimumScale <= 0 || minimumScale > 1) throw new RangeError('Invalid minimum print scale');
  const scale = height === 0 ? 1 : Math.max(minimumScale, Math.min(1, availableHeight / height));
  const scaledHeight = height * scale;
  const slices = [{ offset: 0, height: Math.min(scaledHeight, availableHeight) }];
  const continuationHeight = availableHeight - CONTINUATION_LABEL_HEIGHT;
  for (let offset = availableHeight; offset < scaledHeight - 0.000001; offset += continuationHeight) {
    slices.push({ offset, height: Math.min(continuationHeight, scaledHeight - offset) });
  }
  return { scale, scaledHeight, slices };
}
