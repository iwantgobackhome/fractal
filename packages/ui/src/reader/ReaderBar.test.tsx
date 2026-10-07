import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Job } from '@fractal/shared';
import { ReaderBar, type ReaderBarProps } from './ReaderBar';

const job = (patch: Partial<Job>): Job => ({
  jobId: 'job',
  paperKey: 'book',
  modelId: 'model',
  promptVersion: 'v',
  generation: 1,
  state: 'completed',
  pauseReason: null,
  completedBlocks: 30,
  totalTranslatableBlocks: 30,
  usage: { inputTokens: null, outputTokens: null, limits: null, observedAt: null },
  updatedAt: new Date(0).toISOString(),
  currentPage: null,
  ...patch,
});

const render = (pageCount: number, current: Job | null) =>
  renderToStaticMarkup(
    <ReaderBar
      {...({
        paper: null,
        job: current,
        currentPage: 1,
        pageCount,
        zoom: 1,
        onPage: () => {},
        onZoom: () => {},
        onFitWidth: () => {},
        viewMode: 'split',
        narrow: false,
        onViewMode: () => {},
        modelIds: ['model'],
        selectedModelId: 'model',
        canTranslate: true,
        disabledReason: null,
        sendHint: '',
        onModelChange: () => {},
        onStart: () => {},
        onPause: () => {},
        onResume: () => {},
        onRequestReplacement: () => {},
        chat: { open: false, controls: 'chat', onToggle: () => {}, buttonRef: { current: null } },
        notes: { open: false, onToggle: () => {} },
        exportLinks: [],
        onRequestDelete: () => {},
        language: 'ko',
        onLanguage: () => {},
      } as ReaderBarProps)}
    />,
  );

describe('reader bar on long books', () => {
  it('offers the whole book alongside a page range', () => {
    const html = render(1232, null);
    expect(html).toContain('전체 번역');
    expect(html).toContain('페이지 범위 번역');
  });
  it('widens a finished section to the whole book', () => {
    expect(render(1232, job({ pageRange: { start: 1, end: 30 } }))).toContain('전체 번역');
    expect(render(1232, job({}))).not.toContain('전체 번역');
  });
  it('keeps short papers on the usual start button', () => {
    const html = render(12, null);
    expect(html).not.toContain('전체 번역');
    expect(html).not.toContain('페이지 범위 번역');
  });
});
