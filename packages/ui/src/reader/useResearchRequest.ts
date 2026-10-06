import { useCallback } from 'react';
import type { ModelSelection } from '@fractal/shared';
import type { HubApi } from '../shell/hub-api';
import { attachmentPng } from './ImageAttachment';
import type { ResearchIntent } from './ResearchPanel';

/** Both reader surfaces use the retained research endpoints and refresh the same history. */
export function useResearchRequest(hub: HubApi, paperKey: string) {
  return useCallback(
    async ({
      context,
      question,
      requestId,
      threadId,
      selection,
      answerLanguage,
      explanation,
      onHistory,
      refresh,
    }: {
      context: ResearchIntent | null;
      question: string;
      requestId: string;
      threadId: string;
      selection: ModelSelection;
      answerLanguage?: string;
      explanation: boolean;
      onHistory(id: string): void;
      refresh(): Promise<void>;
    }) => {
      const croppedPngBase64 = context?.attachment ? await attachmentPng(paperKey, context.attachment).catch(() => undefined) : undefined;
      const imageFields = context?.attachment ? { attachment: context.attachment, ...(croppedPngBase64 ? { croppedPngBase64 } : {}) } : {};
      const stream =
        explanation && context?.rect
          ? hub.explain(paperKey, {
              kind: context.kind ?? 'text',
              page: context.page,
              bbox: context.rect,
              surroundingText: context.surroundingText ?? context.text,
              question: `${context.attachment?.label ?? context.kind ?? 'Selection'} 설명`,
              ...imageFields,
              requestId,
              threadId,
              selection,
              ...(context.provenance ? { provenance: context.provenance } : {}),
              ...(answerLanguage ? { answerLanguage } : {}),
            })
          : hub.ask(paperKey, {
              question: question.trim(),
              ...imageFields,
              requestId,
              threadId,
              selection,
              ...(answerLanguage ? { answerLanguage } : {}),
              ...(context
                ? {
                    page: context.page,
                    selectedText:
                      context.from === 'translation'
                        ? `[Translated text; physical page ${context.page}; no original position mapping]\n${context.text}`
                        : (context.surroundingText ?? context.text),
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
