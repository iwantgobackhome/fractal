import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react';
import type { ReferenceEnrichment, ReferenceEntry, StructureItem } from '@fractal/shared';
import { Markdown } from '../components/Markdown';
import { renderTex } from '../lib/tex';
import { locale, t } from '../i18n';
import { itemLabel } from './StructureLayer';

/** A card beside what it is about: to its right when there is room, otherwise below. */
export function FloatingCard({
  anchor,
  onClose,
  label,
  children,
  className = '',
  managed,
}: {
  anchor: DOMRect;
  onClose(): void;
  label: string;
  children: ReactNode;
  className?: string;
  /** Interactive answer cards manage dragging, collapse, placement, and dismissal themselves. */
  managed?: { ref: RefObject<HTMLDivElement | null>; position: { left: number; top: number } };
}): JSX.Element {
  const localRef = useRef<HTMLDivElement | null>(null);
  const ref = managed?.ref ?? localRef;
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  // Placed again whenever the card grows (a streaming answer), so it never runs off the screen.
  useLayoutEffect(() => {
    if (managed) return;
    const card = ref.current;
    if (card === null) return;
    const place = () => {
      const { width, height } = card.getBoundingClientRect();
      const roomRight = window.innerWidth - anchor.right;
      const beside = roomRight > width + 24;
      const left = beside ? anchor.right + 12 : Math.min(Math.max(12, anchor.left), window.innerWidth - width - 12);
      const preferred = beside ? anchor.top : anchor.bottom + 8;
      const top = Math.max(60, Math.min(preferred, window.innerHeight - height - 12));
      setPosition((current) => (current !== null && current.left === left && current.top === top ? current : { left, top }));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(card);
    return () => observer.disconnect();
  }, [anchor, managed]);

  useEffect(() => {
    if (managed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onDown = (event: PointerEvent) => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose, managed]);

  const placed = managed?.position ?? position;
  return (
    <div
      ref={ref}
      className={`float-card ${className}`}
      role="dialog"
      aria-label={label}
      style={placed === null ? { visibility: 'hidden', left: 0, top: 0 } : placed}
    >
      {children}
    </div>
  );
}

export interface ExplainState {
  item: StructureItem;
  anchor: DOMRect;
  text: string;
  latex: string | null;
  done: boolean;
  error: string | null;
}

export function ExplainCard({ state, onClose }: { state: ExplainState; onClose(): void }): JSX.Element {
  const { item } = state;
  const latex = state.latex ?? item.latex ?? null;
  return (
    <FloatingCard anchor={state.anchor} onClose={onClose} label={t('reader.explainOf', { label: itemLabel(item) })}>
      <p className="float-card__kicker">
        {itemLabel(item)} · p.{item.page}
      </p>
      {latex !== null && latex.trim() !== '' ? <div className="float-card__latex" dangerouslySetInnerHTML={{ __html: renderTex(latex, true) }} /> : null}
      {item.caption !== '' && item.kind !== 'equation' ? <p className="float-card__caption">{item.caption}</p> : null}
      {state.error !== null ? (
        <p className="float-card__error">{state.error}</p>
      ) : state.text === '' ? (
        <p className="float-card__muted">{t('reader.reading')}</p>
      ) : (
        <Markdown text={state.text} caret={!state.done} className="float-card__body" />
      )}
    </FloatingCard>
  );
}

export interface CitationState {
  anchor: DOMRect;
  entries: { entry: ReferenceEntry; enrichment: ReferenceEnrichment | null }[] | null;
  error: string | null;
  added: Set<string>;
}

export function CitationCard({
  state,
  onClose,
  onAdd,
  onOpenUrl,
}: {
  state: CitationState;
  onClose(): void;
  onAdd(n: string): void;
  onOpenUrl(url: string): void;
}): JSX.Element {
  return (
    <FloatingCard anchor={state.anchor} onClose={onClose} label={t('reader.references')}>
      {state.error !== null ? <p className="float-card__error">{state.error}</p> : null}
      {state.entries === null && state.error === null ? <p className="float-card__muted">{t('reader.finding')}</p> : null}
      {(state.entries ?? []).map(({ entry, enrichment }) => {
        const title = enrichment?.title ?? entry.title ?? entry.raw;
        const year = enrichment?.year ?? entry.year ?? null;
        const doi = entry.doi ?? enrichment?.externalIds.DOI;
        const arxiv = entry.arxivId ?? enrichment?.externalIds.ArXiv;
        return (
          <article key={entry.n} className="reference">
            <p className="float-card__kicker">[{entry.n}]</p>
            <h3 className="reference__title">{title}</h3>
            <p className="reference__meta">
              {[entry.authors, enrichment?.venue, year].filter((v) => v !== undefined && v !== null && v !== '').join(' · ')}
              {enrichment?.citationCount !== null && enrichment?.citationCount !== undefined
                ? ` · ${t('reader.citations', { count: enrichment.citationCount.toLocaleString(locale()) })}`
                : ''}
            </p>
            {enrichment?.abstract !== null && enrichment?.abstract !== undefined ? <p className="reference__abstract">{enrichment.abstract}</p> : null}
            <p className="reference__actions">
              {state.added.has(entry.n) ? (
                <span className="float-card__muted">{t('reader.added')}</span>
              ) : doi !== undefined || arxiv !== undefined || enrichment?.openAccessPdf ? (
                <button type="button" className="text-link" onClick={() => onAdd(entry.n)}>
                  {t('home.save')}
                </button>
              ) : null}
              {arxiv !== undefined ? (
                <button type="button" className="text-link text-link--quiet" onClick={() => onOpenUrl(`https://arxiv.org/abs/${arxiv}`)}>
                  arXiv
                </button>
              ) : doi !== undefined ? (
                <button type="button" className="text-link text-link--quiet" onClick={() => onOpenUrl(`https://doi.org/${doi}`)}>
                  DOI
                </button>
              ) : null}
            </p>
          </article>
        );
      })}
    </FloatingCard>
  );
}
