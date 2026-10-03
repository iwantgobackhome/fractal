import { useCallback } from 'react';
import type { ModelSelection } from '@fractal/shared';
import type { HubApi } from '../shell/hub-api';
import type { ResearchIntent } from './ResearchPanel';

/** Both reader surfaces use the retained research endpoints and refresh the same history. */
export function useResearchRequest(hub: HubApi, paperKey: string) {
  return useCallback(
    async ({
      context,
      question,
      requestId,
      selection,
      answerLanguage,
      explanation,
      onHistory,
      refresh,
    }: {
      context: ResearchIntent | null;
      question: string;
      requestId: string;
      selection: ModelSelection;
      answerLanguage?: string;
      explanation: boolean;
      onHistory(id: string): void;
      refresh(): Promise<void>;
    }) => {
      const stream =
        explanation && context?.rect
          ? hub.explain(paperKey, {
              kind: context.kind ?? 'text',
              page: context.page,
              bbox: context.rect,
              surroundingText: context.text,
              requestId,
              selection,
              ...(context.provenance ? { provenance: context.provenance } : {}),
              ...(answerLanguage ? { answerLanguage } : {}),
            })
          : hub.ask(paperKey, {
              question: question.trim(),
              requestId,
              selection,
              ...(answerLanguage ? { answerLanguage } : {}),
              ...(context
                ? {
                    page: context.page,
                    selectedText:
                      context.from === 'translation'
                        ? `[Translated text; physical page ${context.page}; no original position mapping]\n${context.text}`
                        : context.text,
                    ...(context.from === 'source' && context.rect ? { rect: context.rect } : {}),
                    ...(context.provenance ? { provenance: context.provenance } : {}),
                  }
                : {}),
            });
      for await (const event of stream) {
        if (event.historyId) onHistory(event.historyId);
        await refresh();
      }
    },
    [hub, paperKey],
  );
}
