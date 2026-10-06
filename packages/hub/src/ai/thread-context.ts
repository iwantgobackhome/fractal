import type { HistoryEntry } from '@fractal/shared';
import type { AiMessage } from './provider';

export const MAX_THREAD_CONTEXT_CHARS = 12_000;
const truncate = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

/** Settled turns only, in chronological order; retain the newest complete pairs. */
export function threadContext(entries: readonly HistoryEntry[], paperKey: string, threadId: string | undefined, currentRequestId?: string): AiMessage[] {
  if (!threadId) return [];
  const turns = entries
    .filter(
      (entry) =>
        entry.paperKey === paperKey &&
        entry.context.threadId === threadId &&
        entry.status === 'completed' &&
        !entry.deleted &&
        (entry.kind === 'question' || entry.kind === 'explanation') &&
        (!currentRequestId || entry.requestId !== currentRequestId),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .slice(-6)
    .map((entry): AiMessage[] => {
      const question =
        entry.kind === 'explanation'
          ? `Explain ${entry.context.explanationKind ?? 'text'} on page ${entry.context.page ?? 'unknown'}`
          : truncate(entry.question, 4000);
      const quote = entry.context.selectedText ? `\nSelected text: ${truncate(entry.context.selectedText, 800)}` : '';
      return [
        { role: 'user', content: question + quote },
        { role: 'assistant', content: truncate(entry.answer?.text ?? entry.text, 4000) },
      ];
    });
  let size = turns.reduce((sum, pair) => sum + pair.reduce((n, message) => n + message.content.length, 0), 0);
  while (size > MAX_THREAD_CONTEXT_CHARS && turns.length) {
    size -= turns.shift()!.reduce((sum, message) => sum + message.content.length, 0);
  }
  return turns.flat();
}
