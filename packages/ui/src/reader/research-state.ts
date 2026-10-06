import type { HistoryEntry } from '@fractal/shared';
import type { ResearchIntent } from './ResearchPanel';
export interface ResearchDraft {
  threadId: string;
  text: string;
  context: ResearchIntent | null;
  model: string;
}
export function threadKey(entry: HistoryEntry): string {
  return entry.context.threadId ?? entry.id;
}
export function groupThreads(entries: HistoryEntry[]): HistoryEntry[][] {
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const key = threadKey(entry);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()]
    .map((rows) => rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    .sort((a, b) => b[b.length - 1].createdAt.localeCompare(a[a.length - 1].createdAt));
}
export type DraftAction = { type: 'text'; text: string } | { type: 'removeAttachment' } | { type: 'sent' } | { type: 'new'; threadId: string };
export function reduceDraft(draft: ResearchDraft, action: DraftAction): ResearchDraft {
  switch (action.type) {
    case 'text':
      return { ...draft, text: action.text };
    case 'removeAttachment':
      return { ...draft, context: null };
    case 'sent':
      return { ...draft, text: '', context: null };
    case 'new':
      return { ...draft, threadId: action.threadId, text: '', context: null };
  }
}
export function clampPanelWidth(width: number, viewport: number): number {
  return Math.min(Math.max(300, viewport * 0.6), Math.max(300, Number.isFinite(width) ? width : 380));
}
