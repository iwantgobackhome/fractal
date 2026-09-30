import { createContext, useCallback, useContext, useEffect, useState, type JSX, type MouseEvent } from 'react';
import type { FeedItem, FeedResponse, Paper } from '@fractal/shared';
import { locale, t } from '../i18n';
import { fieldName } from './fields';
import type { FeedEntry, FeedSection, HubApi } from './hub-api';
import { ArticleView } from './ArticleView';
import { InterestPicker } from './InterestPicker';
import { TopicManager } from './TopicManager';
import { authorsLine, paperTitle, sourceLabel } from './paper-format';

interface Props {
  hub: HubApi;
  papers: Paper[];
  onOpen(paperKey: string): void;
  /** Open an item that is not in the library yet (arXiv id, DOI or URL). */
  onOpenExternal(value: string): void;
  onShowLibrary(): void;
  onEditInterests(): void;
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
      return params.basedOn !== undefined ? t('home.reasonSimilarTo', { title: params.basedOn }) : t('home.reasonSimilar');
    case 'new_this_week':
      return t('home.reasonNew');
  }
  return item.reason;
}

/** Each item appears once on the page: the first section that carries it keeps it. */
function once<T extends FeedItem>(items: T[], seen: Set<string>, limit: number): T[] {
  const kept: T[] = [];
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

/** A paper's first figure or a story's picture, if the hub found one; nothing otherwise. */
function Picture({ item, kind }: { item: FeedEntry; kind: 'figure' | 'photo' }): JSX.Element | null {
  const [failed, setFailed] = useState(false);
  const image = item.image;
  if (image === undefined || image === null || failed) return null;
  return (
    <span className={`picture picture--${kind}`}>
      <img src={image.url} alt={image.alt ?? ''} width={image.width} height={image.height} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    </span>
  );
}

const hasImage = (item: FeedEntry): boolean => item.image !== undefined && item.image !== null;

/** One paper as a headline: its first figure, title, byline, why it is here, and a quiet save action. */
function Headline({
  item,
  size,
  onOpen,
  onSave,
  saving,
}: {
  item: FeedEntry;
  size: 'lead' | 'normal' | 'compact';
  onOpen(): void;
  onSave(): void;
  saving: boolean;
}): JSX.Element {
  return (
    <article className={`headline headline--${size}`} data-picture={hasImage(item)}>
      {hasImage(item) ? (
        <button type="button" className="headline__figure" onClick={onOpen} tabIndex={-1} aria-hidden="true">
          <Picture item={item} kind="figure" />
        </button>
      ) : null}
      <div className="headline__body">
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
      </div>
    </article>
  );
}

/** Opens a story in the reading sheet; a modified click (new tab, window) still goes to the site. */
const ReadContext = createContext<(item: FeedEntry) => void>(() => undefined);

function useReader(item: FeedEntry): (event: MouseEvent<HTMLAnchorElement>) => void {
  const open = useContext(ReadContext);
  return (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open(item);
  };
}

/** A headline in the reader's language when the hub translated it, the original a hover away. */
function NewsTitle({ item, className }: { item: FeedEntry; className: string }): JSX.Element {
  // Some feeds leave markup such as <br> in headlines.
  const clean = (value: string) =>
    value
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const translated = item.titleTranslated !== undefined && item.titleTranslated !== item.title;
  return (
    <span className={className} title={translated ? item.title : undefined}>
      {clean(translated ? (item.titleTranslated ?? item.title) : item.title)}
    </span>
  );
}

/** A news story: picture, headline, outlet and age. Opens inside Fractal. */
function Story({ item, withPicture }: { item: FeedEntry; withPicture: boolean }): JSX.Element {
  const read = useReader(item);
  return (
    <li className="story" data-picture={withPicture && hasImage(item)}>
      <a href={item.url} target="_blank" rel="noreferrer noopener" className="story__link" onClick={read}>
        {withPicture ? <Picture item={item} kind="photo" /> : null}
        <NewsTitle item={item} className="story__title" />
      </a>
      <span className="story__meta">
        {item.source.replace(/^news:/, '')}
        {' · '}
        {relative(item.publishedAt)}
      </span>
    </li>
  );
}

const FIELD_NEWS_SHOWN = 6;
const BOARD_SHOWN = 8;

/** A field's stories: the first few, and the rest a click away. */
function FieldNews({ items, topics, onManage }: { items: FeedEntry[]; topics: TopicNews[]; onManage(): void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState<string | null>(null);
  const chosen = topic === null ? undefined : topics.find((entry) => entry.topicId === topic);
  const list = chosen !== undefined ? chosen.items : items;
  const shown = open ? list : list.slice(0, FIELD_NEWS_SHOWN);
  return (
    <div className="field-section__news">
      <div className="field-news__head">
        <h3 className="home-front__kicker">{t('home.fieldNews')}</h3>
        <button type="button" className="text-link text-link--quiet field-news__manage" onClick={onManage}>
          {t('topics.manage')}
        </button>
      </div>
      {topics.length > 0 ? (
        <div className="topic-filter" role="group" aria-label={t('topics.filter')}>
          <button type="button" aria-pressed={topic === null} onClick={() => setTopic(null)}>
            {t('topics.all')}
          </button>
          {topics.map((entry) => (
            <button key={entry.topicId} type="button" aria-pressed={topic === entry.topicId} onClick={() => setTopic(entry.topicId)}>
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}
      <ul className="stories">
        {shown.map((item) => (
          <Story key={item.id} item={item} withPicture />
        ))}
      </ul>
      {list.length > FIELD_NEWS_SHOWN ? (
        <button type="button" className="text-link stories__more" onClick={() => setOpen(!open)}>
          {open ? t('home.fewerNews') : t('home.moreNewsCount', { count: list.length - FIELD_NEWS_SHOWN })}
        </button>
      ) : null}
    </div>
  );
}

/** One story on the news board: picture on top when there is one. */
function NewsCard({ item }: { item: FeedEntry }): JSX.Element {
  const read = useReader(item);
  return (
    <article className="news-card" data-picture={hasImage(item)}>
      <a href={item.url} target="_blank" rel="noreferrer noopener" className="news-card__link" onClick={read}>
        <Picture item={item} kind="photo" />
        <NewsTitle item={item} className="news-card__title" />
      </a>
      <span className="story__meta">
        {item.source.replace(/^news:/, '')}
        {' · '}
        {relative(item.publishedAt)}
      </span>
    </article>
  );
}

/** Science and technology news beyond the reader's fields. */
function NewsBoard({ items }: { items: FeedEntry[] }): JSX.Element {
  const [open, setOpen] = useState(false);
  const cards = items.slice(0, BOARD_SHOWN);
  const rest = items.slice(BOARD_SHOWN);
  return (
    <section className="field-section news-board" aria-labelledby="home-general-news">
      <h2 id="home-general-news" className="field-section__title">
        {t('home.generalNews')}
      </h2>
      <div className="news-board__grid">
        {cards.map((item) => (
          <NewsCard key={item.id} item={item} />
        ))}
      </div>
      {rest.length > 0 ? (
        <>
          {open ? (
            <ul className="stories news-board__rest">
              {rest.map((item) => (
                <Story key={item.id} item={item} withPicture />
              ))}
            </ul>
          ) : null}
          <button type="button" className="text-link stories__more" onClick={() => setOpen(!open)}>
            {open ? t('home.fewerNews') : t('home.moreNewsCount', { count: rest.length })}
          </button>
        </>
      ) : null}
    </section>
  );
}

type TopicNews = { field: string; topicId: string; label: string; items: FeedEntry[] };

function sectionTitle(section: FeedSection): { name: string; code: string | null } {
  if (section.field.startsWith('custom:')) return { name: section.label ?? section.field.slice(7), code: null };
  return { name: section.label ?? fieldName(section.field), code: section.field };
}

/**
 * The front page: this week's papers and news in the reader's fields, set like a
 * journal's first page, with the reader's own shelf alongside.
 */
export function HomeScreen({ hub, papers, onOpen, onOpenExternal, onShowLibrary, onEditInterests }: Props): JSX.Element {
  const [feed, setFeed] = useState<FeedResponse | null | undefined>(undefined);
  const [hasInterests, setHasInterests] = useState<boolean | null>(null);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [reading, setReading] = useState<FeedEntry | null>(null);
  const [managing, setManaging] = useState<{ field: string; name: string } | null>(null);

  const load = useCallback(() => {
    hub
      .interests()
      .then((result) =>
        setHasInterests(
          result === null ? false : result.interests.categories.length + result.interests.topics.length + (result.interests.custom?.length ?? 0) > 0,
        ),
      )
      .catch(() => setHasInterests(false));
    hub
      .feed()
      .then(setFeed)
      .catch(() => setFeed(null));
  }, [hub]);

  useEffect(load, [load]);

  const refresh = () => {
    setRefreshing(true);
    hub
      .refreshFeed()
      .then(setFeed)
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  };

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
  const sections = feed?.sections as
    (FeedResponse['sections'] & { newsByField?: FeedSection[]; generalNews?: FeedEntry[]; newsByTopic?: TopicNews[] }) | undefined;
  const seen = new Set<string>();
  const lead: FeedEntry[] = sections === undefined ? [] : once(sections.top, seen, 7);
  const recommended: FeedEntry[] = sections === undefined ? [] : once(sections.recommended, seen, 6);
  const newsByField = new Map((sections?.newsByField ?? []).map((s) => [s.field, s]));
  const fields =
    sections === undefined
      ? []
      : (sections.byField as FeedSection[]).map((section) => ({
          section,
          items: once(section.items, seen, 6),
          news: once(newsByField.get(section.field)?.items ?? [], seen, 30),
          topics: (sections.newsByTopic ?? []).filter((entry) => entry.field === section.field && entry.items.length > 0),
        }));
  // Stories that belong to no field: general lab news, or everything from a hub without field news.
  const otherNews: FeedEntry[] = sections === undefined ? [] : once(sections.news, seen, 6);
  const generalNews: FeedEntry[] = sections === undefined ? [] : once(sections.generalNews ?? [], seen, 40);
  const empty =
    sections === undefined ||
    (sections.top.length === 0 &&
      sections.rankings.length === 0 &&
      sections.byField.every((section) => section.items.length === 0) &&
      (sections.newsByField?.every((section) => section.items.length === 0) ?? true) &&
      (sections.generalNews?.length ?? sections.news.length) === 0);
  const headline = (item: FeedEntry, size: 'lead' | 'normal' | 'compact') => (
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
    <ReadContext.Provider value={setReading}>
      <main className="screen home-front" aria-labelledby="home-date">
        <div className="home-front__masthead">
          <p id="home-date" className="home-front__date">
            {new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}
          </p>
          {feed !== null && feed !== undefined ? <p className="home-front__week">{weekLabel(feed.week)}</p> : null}
          {hasInterests === true ? (
            <button type="button" className="text-link text-link--quiet home-front__edit" onClick={onEditInterests}>
              {t('interests.edit')}
            </button>
          ) : null}
        </div>

        {hasInterests === false ? (
          <InterestPicker hub={hub} onSaved={load} />
        ) : feed === undefined ? null : empty || sections === undefined ? (
          <section className="home-front__blank">
            <p className="home-front__deck">{t('home.empty')}</p>
            <button type="button" className="text-link" disabled={refreshing} onClick={refresh}>
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

                {otherNews.length > 0 ? (
                  <section aria-labelledby="home-news">
                    <h2 id="home-news" className="home-front__kicker">
                      {t('home.generalNews')}
                    </h2>
                    <ul className="stories stories--column">
                      {otherNews.map((item) => (
                        <Story key={item.id} item={item} withPicture={false} />
                      ))}
                    </ul>
                  </section>
                ) : null}
              </aside>
            </div>

            {recommended.length > 0 ? (
              <section className="field-section field-section--recommended" aria-labelledby="home-similar">
                <h2 id="home-similar" className="field-section__title">
                  {t('home.similar')}
                </h2>
                <p className="field-section__deck">{t('home.similarDeck')}</p>
                <div className="field-section__grid">{recommended.map((item) => headline(item, 'compact'))}</div>
              </section>
            ) : null}

            {generalNews.length > 0 ? <NewsBoard items={generalNews} /> : null}

            {fields.map(({ section, items, news, topics }) => {
              if (items.length === 0 && news.length === 0 && topics.length === 0) return null;
              const title = sectionTitle(section);
              return (
                <section key={section.field} className="field-section" data-news={news.length > 0 || topics.length > 0} aria-label={title.name}>
                  <h2 className="field-section__title">
                    {title.name} {title.code !== null ? <span className="field-toggle__code">{title.code}</span> : null}
                  </h2>
                  <div className="field-section__body">
                    {items.length > 0 ? <div className="field-section__grid">{items.map((item) => headline(item, 'compact'))}</div> : null}
                    {news.length > 0 || topics.length > 0 ? (
                      <FieldNews items={news} topics={topics} onManage={() => setManaging({ field: section.field, name: title.name })} />
                    ) : null}
                  </div>
                </section>
              );
            })}

            <p className="home-front__colophon">
              {feed?.generatedAt !== null && feed?.generatedAt !== undefined ? t('home.gathered', { time: relative(feed.generatedAt) }) : ''}
              {' · '}
              <button type="button" className="text-link" disabled={refreshing} onClick={refresh}>
                {refreshing ? t('home.refreshing') : t('home.refresh')}
              </button>
            </p>
          </>
        )}
        {reading !== null ? <ArticleView hub={hub} item={reading} onClose={() => setReading(null)} /> : null}
        {managing !== null ? (
          <TopicManager
            hub={hub}
            field={managing.field}
            fieldName={managing.name}
            onClose={(changed) => {
              setManaging(null);
              if (changed) refresh();
            }}
          />
        ) : null}
      </main>
    </ReadContext.Provider>
  );
}
