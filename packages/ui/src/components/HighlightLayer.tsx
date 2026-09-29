import { useState, type JSX } from 'react';
import type { Highlight } from '@fractal/shared';

const COLOR_VALUES: Record<Highlight['color'], string> = {
  yellow: 'color-mix(in srgb, var(--c-hl-yellow) 75%, transparent)',
  green: 'color-mix(in srgb, var(--c-hl-green) 75%, transparent)',
  blue: 'color-mix(in srgb, var(--c-hl-blue) 75%, transparent)',
  pink: 'color-mix(in srgb, var(--c-hl-pink) 75%, transparent)',
};

export const HIGHLIGHT_COLORS: readonly Highlight['color'][] = ['yellow', 'green', 'blue', 'pink'];

interface HighlightBoxProps {
  highlight: Highlight;
  onOpen(highlight: Highlight): void;
}

/** One saved highlight, painted as a ratio-positioned colored rectangle per rect. */
function HighlightBox({ highlight, onOpen }: HighlightBoxProps): JSX.Element {
  return (
    <>
      {highlight.rects.map((rect, index) => (
        <button
          key={`${highlight.highlightId}-${index}`}
          type="button"
          className="highlight-box"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
            backgroundColor: COLOR_VALUES[highlight.color],
          }}
          aria-label={`하이라이트: ${highlight.text.slice(0, 40)}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(highlight);
          }}
        >
          {index === 0 && highlight.note !== null ? <span className="highlight-note-dot" aria-hidden="true" /> : null}
        </button>
      ))}
    </>
  );
}

export interface HighlightPopoverProps {
  highlight: Highlight;
  onSave(note: string, color: Highlight['color']): void;
  onDelete(): void;
  onClose(): void;
  /** Quote the highlighted passage into a question about the paper. */
  onAsk?(text: string): void;
}

/** The small editor that opens when a highlight is clicked: excerpt, note, color, save/delete/close. */
export function HighlightPopover({ highlight, onSave, onDelete, onClose, onAsk }: HighlightPopoverProps): JSX.Element {
  const [note, setNote] = useState(highlight.note ?? '');
  const [color, setColor] = useState<Highlight['color']>(highlight.color);
  // An unsaved note keeps the editor open; otherwise asking moves the reader on to the question.
  const edited = note !== (highlight.note ?? '') || color !== highlight.color;

  return (
    <div
      className="highlight-popover"
      role="dialog"
      aria-label="하이라이트 메모"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="highlight-excerpt">{highlight.text.slice(0, 200)}</p>
      <textarea
        aria-label="메모"
        placeholder="메모"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        maxLength={5000}
        autoFocus
      />
      <div className="highlight-popover-row">
        <div className="highlight-colors" role="group" aria-label="색">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`highlight-color-swatch${c === color ? ' selected' : ''}`}
              style={{ backgroundColor: COLOR_VALUES[c] }}
              aria-label={`색 ${c}`}
              aria-pressed={c === color}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <div className="highlight-popover-actions">
          {onAsk !== undefined ? (
            <button
              type="button"
              onClick={() => {
                onAsk(highlight.text);
                if (!edited) onClose();
              }}
            >
              질문
            </button>
          ) : null}
          <button type="button" onClick={onDelete}>
            삭제
          </button>
          <button type="button" className="is-primary" onClick={() => onSave(note.trim().length === 0 ? '' : note, color)}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

export interface HighlightLayerProps {
  highlights: Highlight[];
  onOpen(highlight: Highlight): void;
}

/** All saved highlights for one page, absolutely positioned over the page box. */
export function HighlightLayer({ highlights, onOpen }: HighlightLayerProps): JSX.Element {
  return (
    <div className="highlight-layer">
      {highlights.map((highlight) => (
        <HighlightBox key={highlight.highlightId} highlight={highlight} onOpen={onOpen} />
      ))}
    </div>
  );
}

export default HighlightLayer;
