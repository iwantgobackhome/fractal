import type { HistoryEntry, StructureBox } from '@fractal/shared';
import { threadKey } from './research-state';
export function threadRoot(rows: HistoryEntry[]): HistoryEntry | undefined {
  return rows.find((e) => e.id === threadKey(e)) ?? [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
}
export function pagePoint(x: number, y: number, page: { left: number; top: number; width: number; height: number }) {
  return { x: (x - page.left) / page.width, y: (y - page.top) / page.height };
}
export function cardPoint(x: number, y: number, page: { left: number; top: number; width: number; height: number }) {
  return { x: page.left + x * page.width, y: page.top + y * page.height };
}
export function clampCard(point: { x: number; y: number }, width: number, height: number, page: { width: number; height: number }) {
  return { x: Math.max(0, Math.min(Math.max(0, 1 - width / page.width), point.x)), y: Math.max(0, Math.min(Math.max(0, 1 - height / page.height), point.y)) };
}
export function defaultPlacement(rect: StructureBox | undefined, page: { width: number; height: number }) {
  return clampCard({ x: rect ? rect.x + rect.width + 12 / page.width : 0.1, y: rect?.y ?? 0.1 }, Math.min(420, page.width), Math.min(560, page.height), page);
}

type Box = { x: number; y: number; width: number; height: number };
/** Character boxes of one selection, merged into one box per text line so the highlight reads as a passage. */
export function mergeLineRegions<T extends Box>(boxes: T[]): T[] {
  const lines: T[] = [];
  for (const box of [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y + l.height / 2 - (box.y + box.height / 2)) < Math.min(l.height, box.height) / 2);
    if (!line) {
      lines.push({ ...box });
      continue;
    }
    const right = Math.max(line.x + line.width, box.x + box.width),
      bottom = Math.max(line.y + line.height, box.y + box.height);
    line.x = Math.min(line.x, box.x);
    line.y = Math.min(line.y, box.y);
    line.width = right - line.x;
    line.height = bottom - line.y;
  }
  return lines;
}
