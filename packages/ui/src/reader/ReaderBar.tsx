import { useEffect, useRef, useState, type JSX, type RefObject } from 'react';
import type { Job, Paper } from '@fractal/shared';
import { jobLabel, primaryAction, primaryLabel } from '../components/ReaderToolbar';

export type ViewMode = 'source' | 'split' | 'translation';

const VIEW_LABEL: Record<ViewMode, string> = { source: '원문', split: '나란히', translation: '번역' };

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
  onStart(modelId: string): void;
  onPause(jobId: string): void;
  onResume(jobId: string): void;
  onRequestReplacement(): void;
  // Side panel and paper menu
  chat: { open: boolean; controls: string; onToggle(): void; buttonRef: RefObject<HTMLButtonElement | null> };
  notes: { open: boolean; onToggle(): void };
  exportLinks: { label: string; href: string; download: string }[];
  onRequestDelete(): void;
}

function progressText(job: Job | null): string | null {
  if (job === null || job.state === 'idle') return null;
  if (job.state === 'running') return `번역 ${job.completedBlocks}/${job.totalTranslatableBlocks}쪽`;
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
  const { paper, job, currentPage, pageCount, zoom, viewMode, narrow, chat } = props;
  const [menuOpen, setMenuOpen, menuRef] = usePopover();
  const action = primaryAction(job);
  const title = paper?.title?.trim() || paper?.paperKey || '';
  const progress = progressText(job);
  const translateDisabled = action === 'saved' || (action !== 'pause' && !props.canTranslate) || (action === 'start' && props.selectedModelId.trim() === '');
  const modes: ViewMode[] = narrow ? ['source', 'translation'] : ['source', 'split', 'translation'];

  const runPrimary = () => {
    if (action === 'start') {
      props.onStart(props.selectedModelId);
    } else if (action === 'pause' && job !== null) {
      props.onPause(job.jobId);
    } else if (action === 'resume' && job !== null) {
      props.onResume(job.jobId);
    }
  };

  return (
    <div className="reader-bar" role="toolbar" aria-label="읽기 도구">
      <div className="reader-bar__title">
        <h1 title={title}>{title}</h1>
        {progress !== null ? (
          <span className="reader-bar__progress" aria-live="polite">
            {progress}
          </span>
        ) : null}
      </div>

      <div className="reader-bar__group" role="group" aria-label="쪽 이동">
        <button type="button" className="reader-bar__icon" onClick={() => props.onPage(currentPage - 1)} disabled={currentPage <= 1} aria-label="이전 쪽">
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
          aria-label="다음 쪽"
        >
          ›
        </button>
      </div>

      <div className="reader-bar__group" role="group" aria-label="확대">
        <button type="button" className="reader-bar__icon" onClick={() => props.onZoom(-1)} aria-label="축소">
          −
        </button>
        <button type="button" className="reader-bar__readout reader-bar__readout--button" onClick={props.onFitWidth} title="폭에 맞추기" data-testid="zoom">
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="reader-bar__icon" onClick={() => props.onZoom(1)} aria-label="확대">
          +
        </button>
      </div>

      <div className="segmented reader-bar__views" role="group" aria-label="보기">
        {modes.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={viewMode === mode || (narrow && mode === 'source' && viewMode === 'split')}
            onClick={() => props.onViewMode(mode)}
          >
            {VIEW_LABEL[mode]}
          </button>
        ))}
      </div>

      <div className="reader-bar__end">
        {action !== 'saved' ? (
          <button
            type="button"
            className={`reader-bar__action${action === 'start' ? ' is-primary' : ''}`}
            onClick={runPrimary}
            disabled={translateDisabled}
            title={action === 'start' ? (props.canTranslate ? props.sendHint : (props.disabledReason ?? undefined)) : undefined}
          >
            {primaryLabel(job)}
          </button>
        ) : null}
        <button type="button" className="reader-bar__action" aria-expanded={props.notes.open} aria-controls={chat.controls} onClick={props.notes.onToggle}>
          노트
        </button>
        <button
          ref={chat.buttonRef}
          type="button"
          className="reader-bar__action"
          aria-expanded={chat.open}
          aria-controls={chat.controls}
          onClick={chat.onToggle}
        >
          질문
        </button>
        <div className="reader-bar__menu" ref={menuRef}>
          <button
            type="button"
            className="reader-bar__icon"
            aria-label="논문 메뉴"
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
                  <span>번역 모델</span>
                  <select value={props.selectedModelId} onChange={(event) => props.onModelChange(event.target.value)} disabled={props.modelIds.length === 0}>
                    {props.modelIds.length === 0 ? <option value="">사용 가능한 모델 없음</option> : null}
                    {props.modelIds.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  role="menuitem"
                  disabled={job === null || props.selectedModelId.trim() === ''}
                  onClick={() => {
                    setMenuOpen(false);
                    props.onRequestReplacement();
                  }}
                >
                  이 모델로 새로 번역
                </button>
              </div>
              <div className="menu__section">
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
                  보관함에서 삭제
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
