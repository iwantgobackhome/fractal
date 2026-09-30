import { useCallback, useEffect, useState, type JSX } from 'react';
import type { FeedInterests, FeedItem, FeedResponse, Paper } from '@fractal/shared';
import { locale, t } from '../i18n';
import { COMMON_FIELDS, fieldName } from './fields';
import type { HubApi } from './hub-api';
import { authorsLine, paperTitle, sourceLabel } from './paper-format';

interface Props {
  hub: HubApi;
  papers: Paper[];
  onOpen(paperKey: string): void;
  /** Open an item that is not in the library yet (arXiv id, DOI or URL). */
  onOpenExternal(value: string): void;
  onShowLibrary(): void;
}

function weekLabel(week: string): string {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  return match === null ? week : t('home.week', { year: match[1], week: Number(match[2]) });
}

function openTarget(item: FeedItem): string {
  return item.arxivId ?? item.doi ?? item.url;
}

function byline(item: FeedItem): string {
  if (item.kind === 'news') return item.source;
  const people = item.authors.length > 0 ? authorsLine(item.authors) : '';
  return [people, item.arxivId !== null ? `arXiv ${item.arxivId}` : null].filter(Boolean).join(' · ');
}

/** Said in the interface's current language from the hub's reason code; older hubs send only text. */
function readableReason(item: FeedItem): string {
  const params = item.reasonParams ?? {};
  switch (item.reasonCode) {
    case 'followed_author':
      if (params.author !== undefined) return t('home.reasonAuthor', { author: params.author });
      break;
    case 'interest_category':
      if (params.category !== undefined) return t('home.reasonField', { field: fieldName(params.category) });
      break;
    case 'interest_topic':
      if (params.topic !== undefined) return t('home.reasonTopic', { topic: params.topic });
      break;
    case 'similar_library':
      return t('home.reasonSimilar');
    case 'new_this_week':
      return t('home.reasonNew');
  }
  return item.reason;
}

/** Each paper appears once on the page: the first section that carries it keeps it. */
function once(items: FeedItem[], seen: Set<string>, limit: number): FeedItem[] {
  const kept: FeedItem[] = [];
  for (const item of items) {
    if (seen.has(item.id) || kept.length >= limit) continue;
    seen.add(item.id);
    kept.push(item);
  }
  return kept;
}

function relative(iso: string | null): string {
  if (iso === null) return '';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return t('home.justNow');
  if (minutes < 60) return t('home.minutesAgo', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('home.hoursAgo', { count: hours });
  return t('home.daysAgo', { count: Math.round(hours / 24) });
}

/** One paper as a headline: title, byline, why it is here, and a quiet save action. */
function Headline({
  item,
  size,
  onOpen,
  onSave,
  saving,
}: {
  item: FeedItem;
  size: 'lead' | 'normal' | 'compact';
  onOpen(): void;
  onSave(): void;
  saving: boolean;
}): JSX.Element {
  return (
    <article className={`headline headline--${size}`}>
      <button type="button" className="headline__title" onClick={onOpen}>
        {item.title}
      </button>
      {size !== 'compact' && item.abstract !== '' ? <p className="headline__abstract">{item.abstract}</p> : null}
      <p className="headline__meta">
        <span>{byline(item)}</span>
        {item.kind === 'paper' ? <span className="headline__reason">{readableReason(item)}</span> : null}
        {item.kind === 'paper' ? (
          item.inLibrary ? (
            <span className="headline__saved">{t('home.inLibrary')}</span>
          ) : (
            <button type="button" className="text-link" onClick={onSave} disabled={saving}>
              {saving ? t('home.saving') : t('home.save')}
            </button>
          )
        ) : null}
      </p>
    </article>
  );
}

export function InterestPicker({ hub, onSaved, heading = true }: { hub: HubApi; onSaved(): void; heading?: boolean }): JSX.Element {
  const [suggested, setSuggested] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    hub
      .interests()
      .then((result) => {
        if (result === null) return;
        // Fields the library already leans to are chosen to begin with.
        const saved = result.interests.categories;
        setChosen(new Set(saved.length > 0 ? saved : result.suggestions.slice(0, 3).map((s) => s.category)));
        setSuggested(result.suggestions.map((s) => s.category));
      })
      .catch(() => undefined);
  }, [hub]);

  const options = [...new Set([...suggested, ...COMMON_FIELDS])];
  const toggle = (category: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });

  return (
    <section className="interests" aria-labelledby="interests-title">
      {heading ? (
        <>
          <h1 id="interests-title" className="home-front__headline">
            {t('home.pickTitle')}
          </h1>
          <p className="home-front__deck">{t('home.pickDeck')}</p>
        </>
      ) : null}
      <div className="interests__options" role="group" aria-label={t('home.fields')}>
        {options.map((category) => (
          <button key={category} type="button" className="field-toggle" aria-pressed={chosen.has(category)} onClick={() => toggle(category)}>
            <span>{fieldName(category)}</span>
            <span className="field-toggle__code">{category}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="button"
        disabled={chosen.size === 0 || saving}
        onClick={() => {
          setSaving(true);
          const interests: FeedInterests = { categories: [...chosen], topics: [], authors: [] };
          hub
            .saveInterests(interests)
            .then(() => hub.refreshFeed())
            .then(onSaved)
            .catch(() => undefined)
            .finally(() => setSaving(false));
        }}
      >
        {saving ? t('home.gathering') : t('home.start')}
      </button>
    </section>
  );
}

/**
 * The front page: this week's papers and news in the reader's fields, set like a
 * journal's first page, with the reader's own shelf alongside.
 */
export function HomeScreen({ hub, papers, onOpen, onOpenExternal, onShowLibrary }: Props): JSX.Element {
  const [feed, setFeed] = useState<FeedResponse | null | undefined>(undefined);
  const [hasInterests, setHasInterests] = useState<boolean | null>(null);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    hub
      .interests()
      .then((result) => setHasInterests(result === null ? false : result.interests.categories.length + result.interests.topics.length > 0))
      .catch(() => setHasInterests(false));
    hub
      .feed()
      .then(setFeed)
      .catch(() => setFeed(null));
  }, [hub]);

  useEffect(load, [load]);

  const save = (item: FeedItem) => {
    setSaving((s) => new Set(s).add(item.id));
    hub
      .saveFeedItem(item.id)
      .then(() => load())
      .catch(() => undefined)
      .finally(() =>
        setSaving((s) => {
          const next = new Set(s);
          next.delete(item.id);
          return next;
        }),
      );
  };

  const recent = [...papers].filter((p) => p.status === 'ready' || p.status === 'partial').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sections = feed?.sections;
  const seen = new Set<string>();
  const lead = sections === undefined ? [] : once(sections.top, seen, 7);
  const fields = sections === undefined ? [] : sections.byField.map((f) => ({ field: f.field, items: once(f.items, seen, 6) }));
  const recommended = sections === undefined ? [] : once(sections.recommended, seen, 6);
  const empty = sections === undefined || (sections.top.length === 0 && sections.rankings.length === 0 && sections.news.length === 0);
  const headline = (item: FeedItem, size: 'lead' | 'normal' | 'compact') => (
    <Headline
      key={item.id}
      item={item}
      size={size}
      onOpen={() => (item.kind === 'news' ? window.open(item.url, '_blank', 'noopener') : onOpenExternal(openTarget(item)))}
      onSave={() => save(item)}
      saving={saving.has(item.id)}
    />
  );

  return (
    <main className="screen home-front" aria-labelledby="home-date">
      <div className="home-front__masthead">
        <p id="home-date" className="home-front__date">
          {new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}
        </p>
        {feed !== null && feed !== undefined ? <p className="home-front__week">{weekLabel(feed.week)}</p> : null}
      </div>

      {hasInterests === false ? (
        <InterestPicker hub={hub} onSaved={load} />
      ) : feed === undefined ? null : empty || sections === undefined ? (
        <section className="home-front__blank">
          <p className="home-front__deck">{t('home.empty')}</p>
          <button
            type="button"
            className="text-link"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              hub
                .refreshFeed()
                .then(setFeed)
                .catch(() => undefined)
                .finally(() => setRefreshing(false));
            }}
          >
            {refreshing ? t('home.refreshing') : t('home.gatherNow')}
          </button>
        </section>
      ) : (
        <>
          {feed?.digest !== undefined ? (
            <section className="digest" aria-label={t('home.digest')}>
              <h2 className="home-front__kicker">{t('home.digest')}</h2>
              <p className="digest__text">{feed.digest.text}</p>
            </section>
          ) : null}

          <div className="home-front__grid">
            <section className="home-front__lead-column" aria-label={t('home.papers')}>
              {lead[0] !== undefined ? headline(lead[0], 'lead') : null}
              <div className="home-front__secondary">{lead.slice(1).map((item) => headline(item, 'normal'))}</div>
            </section>

            <aside className="home-front__column" aria-label={t('home.aside')}>
              {recent.length > 0 ? (
                <section aria-labelledby="home-shelf">
                  <h2 id="home-shelf" className="home-front__kicker">
                    {t('home.continue')}
                  </h2>
                  <ol className="home-front__list">
                    {recent.slice(0, 3).map((paper) => (
                      <li key={paper.paperKey}>
                        <button type="button" onClick={() => onOpen(paper.paperKey)}>
                          <span className="home-front__item-title">{paperTitle(paper)}</span>
                          <span className="home-front__item-meta">{sourceLabel(paper)}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                  {papers.length > 3 ? (
                    <button type="button" className="text-link" onClick={onShowLibrary}>
                      {t('home.allLibrary')}
                    </button>
                  ) : null}
                </section>
              ) : null}

              {sections.rankings.length > 0 ? (
                <section aria-labelledby="home-rankings">
                  <h2 id="home-rankings" className="home-front__kicker">
                    {t('home.rankings')}
                  </h2>
                  <ol className="ranking">
                    {sections.rankings.slice(0, 10).map((item, index) => (
                      <li key={item.id}>
                        <span className="ranking__n">{index + 1}</span>
                        <button type="button" onClick={() => onOpenExternal(openTarget(item))}>
                          {item.title}
                        </button>
                        <span className="ranking__votes" aria-label={t('home.votes', { count: item.popularity })}>
                          {item.popularity}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

              {sections.news.length > 0 ? (
                <section aria-labelledby="home-news">
                  <h2 id="home-news" className="home-front__kicker">
                    {t('home.news')}
                  </h2>
                  <ul className="news">
                    {sections.news.slice(0, 6).map((item) => (
                      <li key={item.id}>
                        <a href={item.url} target="_blank" rel="noreferrer noopener">
                          {item.title}
                        </a>
                        <span className="news__source">{item.source}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </aside>
          </div>

          {fields.map((section) =>
            section.items.length === 0 ? null : (
              <section key={section.field} className="field-section" aria-label={fieldName(section.field)}>
                <h2 className="field-section__title">
                  {fieldName(section.field)} <span className="field-toggle__code">{section.field}</span>
                </h2>
                <div className="field-section__grid">{section.items.map((item) => headline(item, 'compact'))}</div>
              </section>
            ),
          )}

          {recommended.length > 0 ? (
            <section className="field-section" aria-label={t('home.similar')}>
              <h2 className="field-section__title">{t('home.similar')}</h2>
              <div className="field-section__grid">{recommended.map((item) => headline(item, 'compact'))}</div>
            </section>
          ) : null}

          <p className="home-front__colophon">
            {feed?.generatedAt !== null && feed?.generatedAt !== undefined ? t('home.gathered', { time: relative(feed.generatedAt) }) : ''}
            {' · '}
            <button
              type="button"
              className="text-link"
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true);
                hub
                  .refreshFeed()
                  .then(setFeed)
                  .catch(() => undefined)
                  .finally(() => setRefreshing(false));
              }}
            >
              {refreshing ? t('home.refreshing') : t('home.refresh')}
            </button>
          </p>
        </>
      )}
    </main>
  );
}
