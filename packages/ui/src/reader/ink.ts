import { getStroke } from 'perfect-freehand';
import type { InkStroke } from '@fractal/shared';

/** A point as stored: page-normalised x and y (0..1), pressure (0..1), milliseconds since the stroke began. */
export type InkPoint = [number, number, number, number];

/** Brushes the tablet writes with; the hub contract's `tool` is the coarse fallback. */
type Brush = 'ballpoint' | 'fountain' | 'pencil' | 'highlighter' | 'shape';

function brushOf(stroke: InkStroke): Brush {
  const extra = (stroke as InkStroke & { brush?: Brush }).brush;
  if (extra !== undefined) return extra;
  return stroke.tool === 'highlighter' ? 'highlighter' : 'ballpoint';
}

/**
 * The SVG outline of a stroke on a page drawn `width` × `height` pixels. Widths are
 * stored relative to the page width, so a stroke keeps its weight at every zoom.
 */
export function strokeOutline(stroke: Pick<InkStroke, 'points' | 'width'> & Partial<InkStroke>, width: number, height: number): string {
  const brush = stroke.tool === undefined ? 'ballpoint' : brushOf(stroke as InkStroke);
  const size = Math.max(0.6, stroke.width * width);
  const input = stroke.points.map(([x, y, p]) => [x * width, y * height, p] as [number, number, number]);
  const outline = getStroke(input, {
    size,
    thinning: brush === 'fountain' ? 0.6 : brush === 'pencil' ? 0.35 : brush === 'highlighter' || brush === 'shape' ? 0 : 0.15,
    smoothing: 0.55,
    streamline: 0.4,
    simulatePressure: input.every(([, , p]) => p === 0 || p === 0.5),
    last: true,
  });
  if (outline.length === 0) return '';
  const [first, ...rest] = outline;
  return `M${first[0].toFixed(2)},${first[1].toFixed(2)}${rest.map(([x, y]) => `L${x.toFixed(2)},${y.toFixed(2)}`).join('')}Z`;
}

export function isHighlighter(stroke: InkStroke): boolean {
  return brushOf(stroke) === 'highlighter';
}

/** True when any stored point of the stroke lies within `radius` (page-normalised) of (x, y). */
export function strokeHits(stroke: InkStroke, x: number, y: number, radius: number, aspect: number): boolean {
  return stroke.points.some(([px, py]) => Math.hypot(px - x, (py - y) * aspect) <= radius);
}

/** Snapped shape vertices are already explicit geometry; keep corners and arrow wings exact. */
export function shapePath(stroke: Pick<InkStroke, 'points'>, width: number, height: number): string {
  return stroke.points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(x * width).toFixed(2)},${(y * height).toFixed(2)}`).join('');
}
