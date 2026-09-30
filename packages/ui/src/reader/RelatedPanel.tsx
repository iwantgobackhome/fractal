import { useCallback, useEffect, useState, type JSX } from 'react';
import { locale, t, type MessageKey } from '../i18n';
import type { HubApi, RelatedPaper } from '../shell/hub-api';
import { authorsLine } from '../shell/paper-format';

type State = { status: 'loading' } | { status: 'ready'; items: RelatedPaper[] } | { status: 'unavailable' } | { status: 'error'; message: string };

const GROUPS: { relation: RelatedPaper['relation']; label: MessageKey }[] = [
  { relation: 'similar', label: 'related.similar' },
  { relation: 'citedBy', label: 'related.citedBy' },
  { relation: 'cites', label: 'related.cites' },
];

function target(paper: RelatedPaper): string {
  return paper.arxivId ?? paper.doi ?? paper.url;
}

function meta(paper: RelatedPaper): string {
  const people = paper.authors.length > 0 ? authorsLine(paper.authors) : '';
  return [people, paper.year === null ? null : String(paper.year), paper.venue ?? null].filter(Boolean).join(' · ');
}

/**
 * Papers around the open one: ones like it, ones that cite it, and the ones it builds
 * on. Opening one brings it into the library, as opening any arXiv id or DOI does.
 */
export function RelatedPanel({ hub, paperKey, onOpen }: { hub: HubApi; paperKey: string; onOpen(value: string): void }): JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    hub
      .related(paperKey)
      .then((result) => setState(result === null ? { status: 'unavailable' } : { status: 'ready', items: result.items }))
      .catch((reason: unknown) => setState({ status: 'error', message: reason instanceof Error ? reason.message : t('errors.request') }));
  }, [hub, paperKey]);

  useEffect(load, [load]);

  if (state.status === 'loading') return <p className="related__quiet">{t('related.loading')}</p>;
  if (state.status === 'unavailable') return <p className="related__quiet">{t('settings.unavailable')}</p>;
  if (state.status === 'error') {
    return (
      <div className="related__quiet">
        <p>{state.message}</p>
        <button type="button" className="text-link" onClick={load}>
          {t('related.retry')}
        </button>
      </div>
    );
  }
  if (state.items.length === 0) return <p className="related__quiet">{t('related.none')}</p>;

  const number = new Intl.NumberFormat(locale());
  return (
    <div className="related">
      {GROUPS.map(({ relation, label }) => {
        const items = state.items.filter((item) => item.relation === relation);
        if (items.length === 0) return null;
        return (
          <section key={relation} className="related__group" aria-label={t(label)}>
            <h3 className="related__heading">{t(label)}</h3>
            <ol className="related__list">
              {items.map((item) => (
                <li key={`${relation}:${item.url}`} className="related__item">
                  <button type="button" className="related__title" onClick={() => onOpen(target(item))}>
                    {item.title}
                  </button>
                  <span className="related__meta">{meta(item)}</span>
                  <span className="related__meta">
                    {item.citationCount !== undefined ? t('related.citations', { count: number.format(item.citationCount) }) : null}
                    {item.inLibrary ? <span className="related__have">{t('home.inLibrary')}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
      <p className="related__source">{t('related.source')}</p>
    </div>
  );
}
