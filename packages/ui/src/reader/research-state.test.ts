import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '@fractal/shared';
import { clampPanelWidth, groupThreads, reduceDraft, threadKey, type ResearchDraft } from './research-state';
const entry = (id: string, threadId?: string, date = '2026-10-06T01:00:00Z'): HistoryEntry =>
  ({
    id,
    paperKey: 'paper',
    kind: 'question',
    question: id,
    text: 'answer',
    context: threadId ? { threadId } : {},
    status: 'completed',
    createdAt: date,
    updatedAt: date,
  }) as HistoryEntry;
describe('research threads', () => {
  it('groups shared thread IDs in chronological order and preserves distinct legacy turns', () => {
    const groups = groupThreads([entry('second', 'thread', '2026-10-06T02:00:00Z'), entry('legacy'), entry('other'), entry('first', 'thread')]);
    expect(groups.map((rows) => rows.map((e) => e.id))).toEqual([['first', 'second'], ['legacy'], ['other']]);
  });
  it('joins a legacy entry to follow-ups addressed by its entry ID', () => {
    expect(threadKey(entry('legacy'))).toBe('legacy');
    expect(groupThreads([entry('legacy'), entry('follow-up', 'legacy')])[0].map((e) => e.id)).toEqual(['legacy', 'follow-up']);
  });
});
describe('draft retention', () => {
  const draft: ResearchDraft = { threadId: 'thread', text: 'question', model: 'codex:model', context: { id: 1, page: 3, text: 'quote', from: 'translation' } };
  it('sending clears input and attachment while retaining the selected conversation', () => {
    expect(reduceDraft(draft, { type: 'sent' })).toEqual({ ...draft, text: '', context: null });
  });
  it('input edits and attachment removal keep the thread visible', () => {
    const edit = reduceDraft(draft, { type: 'text', text: '' });
    expect(edit.threadId).toBe('thread');
    expect(edit.context).toEqual(draft.context);
    expect(reduceDraft(edit, { type: 'removeAttachment' })).toEqual({ ...edit, context: null });
  });
  it('only new question creates a new conversation', () => {
    expect(reduceDraft(draft, { type: 'new', threadId: 'new' })).toEqual({ ...draft, threadId: 'new', text: '', context: null });
  });
});
describe('panel width', () => {
  it('clamps to 300px minimum and 60 percent viewport maximum', () => {
    expect(clampPanelWidth(100, 1200)).toBe(300);
    expect(clampPanelWidth(900, 1200)).toBe(720);
    expect(clampPanelWidth(500, 1200)).toBe(500);
  });
  it('recovers from invalid saved widths and small viewports', () => {
    expect(clampPanelWidth(NaN, 1200)).toBe(380);
    expect(clampPanelWidth(500, 400)).toBe(300);
  });
});
