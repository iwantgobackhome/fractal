import { describe, expect, it, vi } from 'vitest';
import type { HubApi } from '../shell/hub-api';
vi.mock('react', () => ({ useCallback: (callback: unknown) => callback }));
import { useResearchRequest } from './useResearchRequest';
describe('thread requests', () => {
  it('sends a plain follow-up with threadId and omits an unset answer preference', async () => {
    const ask = vi.fn(async function* () {
      yield { historyId: 'turn' };
    });
    const request = useResearchRequest({ ask } as unknown as HubApi, 'paper');
    const onHistory = vi.fn(),
      refresh = vi.fn(async () => {});
    await request({
      context: null,
      question: 'Follow-up',
      requestId: 'request',
      threadId: 'thread',
      selection: { provider: 'codex', model: 'test' },
      explanation: false,
      onHistory,
      refresh,
    });
    expect(ask).toHaveBeenCalledWith('paper', {
      question: 'Follow-up',
      requestId: 'request',
      threadId: 'thread',
      selection: { provider: 'codex', model: 'test' },
    });
    expect(onHistory).toHaveBeenCalledWith('turn');
  });
  it('sends threadId and the Settings preference for region explanations', async () => {
    const explain = vi.fn(async function* () {});
    const request = useResearchRequest({ explain } as unknown as HubApi, 'paper');
    const rect = { x: 0, y: 0, width: 0.5, height: 0.5 };
    await request({
      context: { id: 1, page: 3, text: 'caption', from: 'source', kind: 'figure', rect },
      question: '',
      requestId: 'request',
      threadId: 'thread',
      selection: { provider: 'codex', model: 'test' },
      answerLanguage: 'zh-Hant',
      explanation: true,
      onHistory: () => {},
      refresh: async () => {},
    });
    expect(explain.mock.calls[0]).toEqual([
      'paper',
      {
        kind: 'figure',
        page: 3,
        bbox: rect,
        surroundingText: 'caption',
        requestId: 'request',
        threadId: 'thread',
        selection: { provider: 'codex', model: 'test' },
        answerLanguage: 'zh-Hant',
      },
    ]);
  });
});
