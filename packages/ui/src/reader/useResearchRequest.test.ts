import { describe, expect, it, vi } from 'vitest';
import type { HubApi } from '../shell/hub-api';
vi.mock('react', () => ({ useCallback: (callback: unknown) => callback }));
vi.mock('./ImageAttachment', () => ({ attachmentPng: vi.fn(async () => 'png') }));
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
    const explain = vi.fn(async function* (..._args: unknown[]) {});
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
        question: 'figure 설명',
        requestId: 'request',
        threadId: 'thread',
        selection: { provider: 'codex', model: 'test' },
        answerLanguage: 'zh-Hant',
      },
    ]);
  });
});

it('sends a crop plus hidden context and a short label for figure explanations', async () => {
  const explain = vi.fn(async function* (..._args: unknown[]) {});
  const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
  const attachment = { page: 5, bbox: rect, kind: 'figure' as const, label: 'Figure 3' };
  await useResearchRequest(
    { explain } as unknown as HubApi,
    'paper',
  )({
    context: { id: 2, page: 5, text: 'Figure 3', surroundingText: 'Caption and short excerpt', from: 'source', kind: 'figure', rect, attachment },
    question: '',
    requestId: 'request',
    threadId: 'thread',
    selection: { provider: 'codex', model: 'test' },
    explanation: true,
    onHistory: () => {},
    refresh: async () => {},
  });
  expect(explain.mock.calls[0][1]).toMatchObject({
    question: 'Figure 3 설명',
    attachment,
    croppedPngBase64: 'png',
    surroundingText: 'Caption and short excerpt',
  });
});
it('sends the deliberate region image with the user typed question', async () => {
  const ask = vi.fn(async function* (..._args: unknown[]) {});
  const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
  await useResearchRequest(
    { ask } as unknown as HubApi,
    'paper',
  )({
    context: { id: 3, page: 1, text: '', from: 'source', rect, attachment: { page: 1, bbox: rect, kind: 'region', label: 'Selected region' } },
    question: 'Why?',
    requestId: 'request',
    threadId: 'thread',
    selection: { provider: 'codex', model: 'test' },
    explanation: false,
    onHistory: () => {},
    refresh: async () => {},
  });
  expect(ask.mock.calls[0][1]).toMatchObject({ question: 'Why?', croppedPngBase64: 'png', attachment: { kind: 'region' } });
});
