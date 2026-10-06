import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '@fractal/shared';
import { MAX_THREAD_CONTEXT_CHARS, threadContext } from './thread-context';

function entry(id: number, patch: Partial<HistoryEntry> = {}): HistoryEntry {
  const date = new Date(id * 1000).toISOString();
  return {
    id: String(id),
    paperKey: 'paper',
    kind: 'question',
    question: `Question ${id}`,
    text: `Answer ${id}`,
    status: 'completed',
    createdAt: date,
    updatedAt: date,
    completedAt: date,
    requestId: `request-${id}`,
    context: { threadId: 'thread' },
    answer: null,
    error: null,
    rev: 1,
    deviceId: 'hub',
    deleted: false,
    ...patch,
  };
}
describe('thread context', () => {
  it('orders matching completed turns and excludes the current request and unrelated or unsettled entries', () => {
    const entries = [
      entry(2),
      entry(1),
      entry(3, { status: 'failed' }),
      entry(4, { status: 'canceled' }),
      entry(5, { status: 'pending' }),
      entry(6, { status: 'running' }),
      entry(7, { paperKey: 'other' }),
      entry(8, { context: { threadId: 'other' } }),
      entry(9, { deleted: true }),
      entry(10),
      entry(11, { kind: 'conversation' }),
    ];
    expect(threadContext(entries, 'paper', 'thread', 'request-10')).toEqual([
      { role: 'user', content: 'Question 1' },
      { role: 'assistant', content: 'Answer 1' },
      { role: 'user', content: 'Question 2' },
      { role: 'assistant', content: 'Answer 2' },
    ]);
    expect(threadContext(entries, 'paper', undefined)).toEqual([]);
  });
  it('formats explanations and bounded quotes and uses the completed answer', () => {
    const messages = threadContext(
      [
        entry(1, {
          kind: 'explanation',
          context: { threadId: 'thread', explanationKind: 'equation', page: 3, selectedText: 'q'.repeat(1000) },
          answer: { text: 'a'.repeat(5000), provider: 'codex', model: 'test', inputTokens: null, outputTokens: null, durationMs: 1 },
        }),
      ],
      'paper',
      'thread',
    );
    expect(messages[0].content).toBe(`Explain equation on page 3\nSelected text: ${'q'.repeat(799)}…`);
    expect(messages[1].content).toBe(`${'a'.repeat(3999)}…`);
  });
  it('keeps the last six turns and drops oldest pairs to meet the total budget', () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry(i + 1));
    expect(threadContext(entries, 'paper', 'thread')).toHaveLength(12);
    expect(threadContext(entries, 'paper', 'thread')[0].content).toBe('Question 5');
    const long = threadContext(
      entries.map((e) => ({ ...e, text: 'a'.repeat(8000), question: 'q'.repeat(4000) })),
      'paper',
      'thread',
    );
    expect(long.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(MAX_THREAD_CONTEXT_CHARS);
    expect(long).toHaveLength(2);
    expect(long[1].content.endsWith('…')).toBe(true);
  });
});
