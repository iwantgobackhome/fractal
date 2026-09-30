import type { JSX } from 'react';
import type { Highlight, Memo } from '@fractal/shared';
import { t, useLanguage } from '../i18n';

interface Props {
  highlights: Highlight[];
  onOpen(highlight: Highlight): void;
  memos?: Memo[];
  onMemo?(memo: Memo): void;
  onCreate?(): void;
}

/** Page order, then top to bottom on the page. */
function readingOrder(a: Highlight, b: Highlight): number {
  if (a.page !== b.page) return a.page - b.page;
  return (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0);
}

/**
 * Everything the reader marked in this paper, in reading order: the quoted passage
 * in the serif, the note under it. Choosing one goes to the spot and opens it.
 */
export function NotesPanel({ highlights, onOpen, memos = [], onMemo, onCreate }: Props): JSX.Element {
  const ko = useLanguage() === 'ko';
  const ordered = [...highlights].sort(readingOrder);
  return (
    <ol className="notes">
      <li>
        <button onClick={onCreate}>{ko ? '원본 페이지에 메모 추가' : 'Add note to original page'}</button>
      </li>
      {[...memos]
        .sort((a, b) => a.page - b.page || (a.rect?.y ?? 0) - (b.rect?.y ?? 0))
        .map((memo) => (
          <li key={memo.id}>
            <button className="note" onClick={() => onMemo?.(memo)}>
              <span className="note__page">
                p.{memo.page} · {memo.collapsed ? (ko ? '접힘' : 'Collapsed') : ko ? '열림' : 'Open'}
              </span>
              {memo.quote ? <span className="note__quote">{memo.quote}</span> : null}
              <span className="note__text">{memo.text || (ko ? '빈 메모 · 열어서 작성' : 'Empty note · open to write')}</span>
            </button>
          </li>
        ))}
      {!ordered.length && !memos.length ? <li className="notes__empty">{t('reader.noNotes')}</li> : null}
      {ordered.map((h) => (
        <li key={h.highlightId}>
          <button type="button" className="note" onClick={() => onOpen(h)}>
            <span className="note__page">p.{h.page}</span>
            <span className={`note__quote hl-rule-${h.color}`}>{h.text}</span>
            {h.note !== null && h.note.trim() !== '' ? <span className="note__text">{h.note}</span> : null}
          </button>
        </li>
      ))}
    </ol>
  );
}
