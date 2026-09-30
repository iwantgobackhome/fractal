import type { JSX } from 'react';
import type { Highlight } from '@fractal/shared';
import { t } from '../i18n';

interface Props {
  highlights: Highlight[];
  onOpen(highlight: Highlight): void;
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
export function NotesPanel({ highlights, onOpen }: Props): JSX.Element {
  const ordered = [...highlights].sort(readingOrder);
  if (ordered.length === 0) {
    return <p className="notes__empty">{t('reader.noNotes')}</p>;
  }
  return (
    <ol className="notes">
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
