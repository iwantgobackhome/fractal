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
