import { useEffect, useRef, useState, type JSX } from 'react';
import type { InkStroke } from '@fractal/shared';
import { isHighlighter, strokeHits, strokeOutline, type InkPoint } from './ink';

interface Props {
  enabled?: boolean;
  page: number;
  strokes: InkStroke[];
  /** Ink colour for new strokes (a CSS colour; the theme's ink by default). */
  color: string;
  onCreate(page: number, points: InkPoint[], color: string): void;
  onErase(stroke: InkStroke): void;
}

/** Stroke width for desktop pen input, relative to the page width. */
export const DESKTOP_PEN_WIDTH = 0.0022;
const ERASER_RADIUS = 0.012;

/**
 * Handwriting over one PDF page. Strokes from the tablet are drawn here as they sync;
 * a pen on the desktop (Surface, Wacom) writes directly, and its eraser end or barrel
 * button erases. The mouse keeps selecting text: only `pointerType === 'pen'` is taken.
 */
export function InkLayer({ page, strokes, color, onCreate, onErase, enabled = true }: Props): JSX.Element {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [live, setLive] = useState<InkPoint[] | null>(null);
  const latest = useRef({ strokes, onCreate, onErase, color, enabled });
  latest.current = { strokes, onCreate, onErase, color, enabled };

  // The layer is sized by its page; redraw at the page's current pixel size.
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  // Pen input is taken on the page element, so mouse text selection underneath keeps working.
  useEffect(() => {
    const host = svgRef.current?.parentElement;
    if (host === null || host === undefined) return;
    let points: InkPoint[] | null = null;
    let erasing = false;
    let started = 0;

    const locate = (event: PointerEvent): [number, number] => {
      const box = host.getBoundingClientRect();
      return [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height];
    };
    const eraseAt = (event: PointerEvent) => {
      const box = host.getBoundingClientRect();
      const [x, y] = locate(event);
      for (const stroke of latest.current.strokes) {
        if (strokeHits(stroke, x, y, ERASER_RADIUS, box.height / box.width)) latest.current.onErase(stroke);
      }
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType !== 'pen' || !latest.current.enabled) return;
      if (event.target instanceof Element && event.target.closest('button,textarea,.sticky-note')) return;
      event.preventDefault();
      try {
        host.setPointerCapture(event.pointerId);
      } catch {
        /* a synthetic or already-released pointer: drawing still works without capture */
      }
      // Eraser end (button 5) or the barrel button held (buttons & 2 / & 32) erases.
      erasing = event.button === 5 || (event.buttons & 32) !== 0 || (event.buttons & 2) !== 0;
      if (erasing) {
        eraseAt(event);
        return;
      }
      started = event.timeStamp;
      const [x, y] = locate(event);
      points = [[x, y, event.pressure, 0]];
      setLive(points);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'pen') return;
      if (erasing) {
        eraseAt(event);
        return;
      }
      if (points === null) return;
      const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
      for (const sample of samples.length > 0 ? samples : [event]) {
        const [x, y] = locate(sample);
        points.push([Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)), sample.pressure, Math.round(sample.timeStamp - started)]);
      }
      setLive([...points]);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerType !== 'pen') return;
      if (points !== null && points.length > 1) latest.current.onCreate(page, points, latest.current.color);
      points = null;
      erasing = false;
      setLive(null);
    };
    host.addEventListener('pointerdown', down);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', up);
    return () => {
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      host.removeEventListener('pointercancel', up);
    };
  }, [page]);

  const width = size?.width ?? 0;
  const height = size?.height ?? 0;
  const under = strokes.filter(isHighlighter);
  const over = strokes.filter((s) => !isHighlighter(s));

  return (
    <svg ref={svgRef} className="ink-layer" aria-hidden="true" width="100%" height="100%">
      {width > 0 ? (
        <>
          <g className="ink-layer__highlighter">
            {under.map((s) => (
              <path key={s.id} d={strokeOutline(s, width, height)} fill={s.color} />
            ))}
          </g>
          <g>
            {over.map((s) => (
              <path key={s.id} d={strokeOutline(s, width, height)} fill={s.color} />
            ))}
            {live !== null ? <path d={strokeOutline({ points: live, width: DESKTOP_PEN_WIDTH }, width, height)} fill={color} /> : null}
          </g>
        </>
      ) : null}
    </svg>
  );
}
