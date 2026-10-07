import { useEffect, useRef, useState, type JSX, type RefObject } from 'react';
import type { Job, Paper } from '@fractal/shared';
import { jobLabel, primaryAction, primaryLabel } from './job';
import { t, useLanguage, type MessageKey } from '../i18n';
import { Selector } from '../components/Selector';
import { TRANSLATION_LANGUAGES } from '../shell/preferences';

export type ViewMode = 'source' | 'split' | 'translation';

const VIEW_LABEL: Record<ViewMode, MessageKey> = { source: 'reader.viewSource', split: 'reader.viewSplit', translation: 'reader.viewTranslation' };

export interface ReaderBarProps {
  paper: Paper | null;
  job: Job | null;
  // Pages and zoom
  currentPage: number;
  pageCount: number;
  zoom: number;
  onPage(page: number): void;
  onZoom(delta: number): void;
  onFitWidth(): void;
  // How the paper is shown
  viewMode: ViewMode;
  /** Too narrow for two panes side by side: only 원문 / 번역 are offered. */
  narrow: boolean;
  onViewMode(mode: ViewMode): void;
  // Translation
  modelIds: readonly string[];
  selectedModelId: string;
  canTranslate: boolean;
  disabledReason: string | null;
  sendHint: string;
  onModelChange(modelId: string): void;
  onStart(modelId: string, pageRange?: { start: number; end: number }): void;
  onPause(jobId: string): void;
  onResume(jobId: string): void;
  onRequestReplacement(): void;
  // Side panel and paper menu
  chat: { open: boolean; controls: string; onToggle(): void; buttonRef: RefObject<HTMLButtonElement | null> };
  notes: { open: boolean; onToggle(): void };
  exportLinks: { label: string; href: string; download: string }[];
  /** Save the translation as a PDF, alone or beside the original; absent without a translation. */
  pdf?: { onSave(mode: 'translation' | 'split'): void; note: string | null; busy: boolean };
  onRequestDelete(): void;
  language: string;
  onLanguage(language: string): void;
  saved?: { value: boolean; busy: boolean; onToggle(): void };
}

function progressText(job: Job | null): string | null {
  if (job === null || job.state === 'idle') return null;
  if (job.state === 'running') return t('reader.progress', { done: job.completedBlocks, total: job.totalTranslatableBlocks });
  return jobLabel(job);
}

/** A menu that closes on Escape or a click elsewhere. */
function usePopover(): [boolean, (open: boolean) => void, RefObject<HTMLDivElement | null>] {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return [open, setOpen, ref];
}

/**
 * One quiet line above the paper: where you are, how it is shown, and the one
 * action that matters now. Everything else waits in the ⋯ menu.
 */
export function ReaderBar(props: ReaderBarProps): JSX.Element {
  const ko = useLanguage() === 'ko';
  const { paper, job, currentPage, pageCount, zoom, viewMode, narrow, chat } = props;
  const [menuOpen, setMenuOpen, menuRef] = usePopover();
  const longDocument = pageCount > 300;
  const action = primaryAction(job);
  // After section translations, the primary button widens the job to the whole book.
  const widen = longDocument && job?.pageRange != null && action === 'saved';
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(30);
  const offerRange = (start: number) => {
    setRangeStart(start);
    setRangeEnd(Math.min(pageCount, start + 29));
    setRangeOpen(true);
  };
  const title = paper?.title?.trim() || paper?.paperKey || '';
  const progress = progressText(job);
  const translateDisabled =
    (action === 'saved' && !widen) || (action !== 'pause' && !props.canTranslate) || (action === 'start' && props.selectedModelId.trim() === '');
  const modes: ViewMode[] = narrow ? ['source', 'translation'] : ['source', 'split', 'translation'];

  const runPrimary = () => {
    if (action === 'start' || widen) {
      props.onStart(props.selectedModelId);
    } else if (action === 'pause' && job !== null) {
      props.onPause(job.jobId);
    } else if (action === 'resume' && job !== null) {
      props.onResume(job.jobId);
    }
  };

  return (
    <>
      <div className="reader-heading">
        <h1>{title}</h1>
        <p>
          {paper?.authors.join(' · ') || (ko ? '저자 정보 없음' : 'Authors unavailable')} · {paper?.arxivId ? `arXiv:${paper.arxivId}` : paper?.sourceUrl || ''}
        </p>
      </div>
      <div className="reader-bar" role="toolbar" aria-label={t('reader.toolbar')}>
        <div className="reader-bar__title">
          {progress !== null ? (
            <span className="reader-bar__progress" aria-live="polite">
              {progress}
            </span>
          ) : null}
        </div>

        <div className="reader-bar__group" role="group" aria-label={t('reader.pages')}>
          <button
            type="button"
            className="reader-bar__icon"
            onClick={() => props.onPage(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label={t('reader.prevPage')}
          >
            ‹
          </button>
          <span className="reader-bar__readout" data-testid="page">
            {currentPage} / {pageCount || '–'}
          </span>
          <button
            type="button"
            className="reader-bar__icon"
            onClick={() => props.onPage(currentPage + 1)}
            disabled={pageCount === 0 || currentPage >= pageCount}
            aria-label={t('reader.nextPage')}
          >
            ›
          </button>
        </div>

        <div className="reader-bar__group" role="group" aria-label={t('reader.zoom')}>
          <button type="button" className="reader-bar__icon" onClick={() => props.onZoom(-1)} aria-label={t('reader.zoomOut')}>
            −
          </button>
          <button
            type="button"
            className="reader-bar__readout reader-bar__readout--button"
            onClick={props.onFitWidth}
            title={t('reader.fitWidth')}
            data-testid="zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className="reader-bar__icon" onClick={() => props.onZoom(1)} aria-label={t('reader.zoomIn')}>
            +
          </button>
        </div>

        <div className="segmented reader-bar__views" role="group" aria-label={t('reader.view')}>
          {modes.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={viewMode === mode || (narrow && mode === 'source' && viewMode === 'split')}
              onClick={() => props.onViewMode(mode)}
            >
              {t(VIEW_LABEL[mode])}
            </button>
          ))}
        </div>

        <div className="reader-bar__end">
          {props.saved ? (
            <button type="button" className="reader-bar__action" aria-pressed={props.saved.value} disabled={props.saved.busy} onClick={props.saved.onToggle}>
              {props.saved.value ? (ko ? '저장됨 · 해제' : 'Saved · remove') : ko ? '논문 저장' : 'Save paper'}
            </button>
          ) : null}
          <Selector
            label={t('reader.model')}
            value={props.selectedModelId}
            options={props.modelIds.map((id) => ({ value: id, label: id }))}
            onChange={props.onModelChange}
          />
          <Selector
            label={ko ? '번역 언어' : 'Translation language'}
            value={props.language}
            options={TRANSLATION_LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
            onChange={props.onLanguage}
          />
          {action !== 'saved' || widen ? (
            <button
              type="button"
              className={`reader-bar__action${action === 'start' ? ' is-primary' : ''}`}
              onClick={runPrimary}
              disabled={translateDisabled}
              title={
                action === 'start' || widen
                  ? props.canTranslate
                    ? longDocument
                      ? ko
                        ? `${pageCount}쪽을 한 쪽씩 차례로 번역합니다. 구독 사용량이 많이 들고, 한도에 닿으면 일시정지되어 나중에 이어서 할 수 있습니다.`
                        : `Translates all ${pageCount} pages one at a time. This uses a lot of your subscription; at the limit it pauses and can be resumed later.`
                      : props.sendHint
                    : (props.disabledReason ?? undefined)
                  : undefined
              }
            >
              {longDocument && (action === 'start' || widen) ? (ko ? '전체 번역' : 'Translate whole book') : primaryLabel(job)}
            </button>
          ) : null}
          {longDocument && action !== 'pause' ? (
            <button type="button" className="reader-bar__action" disabled={!props.canTranslate} onClick={() => offerRange(currentPage)}>
              {ko ? '페이지 범위 번역' : 'Translate pages'}
            </button>
          ) : null}
          {longDocument && job?.pageRange && job.state !== 'running' && job.pageRange.end < pageCount ? (
            <button type="button" className="reader-bar__action" disabled={!props.canTranslate} onClick={() => offerRange(job.pageRange!.end + 1)}>
              {ko ? '다음 30쪽 번역' : 'Translate next 30 pages'}
            </button>
          ) : null}
          {rangeOpen ? (
            <div role="dialog" aria-label={ko ? '페이지 범위 번역' : 'Translate page range'}>
              <label>
                {ko ? '시작 쪽' : 'From page'}{' '}
                <input type="number" min={1} max={pageCount} value={rangeStart} onChange={(e) => setRangeStart(Number(e.target.value))} />
              </label>
              <label>
                {ko ? '마지막 쪽' : 'Through page'}{' '}
                <input
                  type="number"
                  min={rangeStart}
                  max={Math.min(pageCount, rangeStart + 29)}
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(Number(e.target.value))}
                />
              </label>
              <button
                type="button"
                disabled={
                  !Number.isInteger(rangeStart) ||
                  !Number.isInteger(rangeEnd) ||
                  rangeStart < 1 ||
                  rangeEnd < rangeStart ||
                  rangeEnd > pageCount ||
                  rangeEnd - rangeStart >= 30
                }
                onClick={() => {
                  props.onStart(props.selectedModelId, { start: rangeStart, end: rangeEnd });
                  setRangeOpen(false);
                }}
              >
                {ko ? '이 범위 번역' : 'Translate this range'}
              </button>
              <button type="button" onClick={() => setRangeOpen(false)}>
                {ko ? '취소' : 'Cancel'}
              </button>
            </div>
          ) : null}
          <button type="button" className="reader-bar__action" aria-expanded={props.notes.open} aria-controls={chat.controls} onClick={props.notes.onToggle}>
            {t('reader.notes')}
          </button>
          <button
            ref={chat.buttonRef}
            type="button"
            className="reader-bar__action"
            aria-expanded={chat.open}
            aria-controls={chat.controls}
            onClick={chat.onToggle}
          >
            {t('reader.questions')}
          </button>
          <div className="reader-bar__menu" ref={menuRef}>
            <button
              type="button"
              className="reader-bar__icon"
              aria-label={t('reader.menu')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="menu" role="menu">
                <div className="menu__section">
                  <label className="menu__field">
                    <span>{t('reader.model')}</span>
                    <span>{props.selectedModelId || t('reader.noModels')}</span>
                  </label>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={job === null || props.selectedModelId.trim() === ''}
                    onClick={() => {
                      setMenuOpen(false);
                      if (longDocument) offerRange(currentPage);
                      else props.onRequestReplacement();
                    }}
                  >
                    {t('reader.retranslate')}
                  </button>
                </div>
                <div className="menu__section">
                  {props.pdf !== undefined ? (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={props.pdf.busy}
                        onClick={() => {
                          setMenuOpen(false);
                          props.pdf?.onSave('translation');
                        }}
                      >
                        {t('reader.pdfTranslation')}
                        {props.pdf.note !== null ? <span className="menu__note">{props.pdf.note}</span> : null}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={props.pdf.busy}
                        onClick={() => {
                          setMenuOpen(false);
                          props.pdf?.onSave('split');
                        }}
                      >
                        {t('reader.pdfSplit')}
                      </button>
                    </>
                  ) : null}
                  {props.exportLinks.map((link) => (
                    <a key={link.label} role="menuitem" href={link.href} download={link.download} onClick={() => setMenuOpen(false)}>
                      {link.label}
                    </a>
                  ))}
                </div>
                <div className="menu__section">
                  <button
                    type="button"
                    role="menuitem"
                    className="menu__danger"
                    onClick={() => {
                      setMenuOpen(false);
                      props.onRequestDelete();
                    }}
                  >
                    {t('reader.deletePaper')}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
