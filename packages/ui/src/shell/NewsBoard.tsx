import { createContext, useContext, useState, type JSX, type MouseEvent } from 'react';
import { t } from '../i18n';
import { FeedPicture } from './FeedPicture';
import { feedImagePath } from './feed-images';
import type { FeedEntry, HubApi } from './hub-api';

function relative(iso: string | null): string {
  if (iso === null) return '';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return t('home.justNow');
  if (minutes < 60) return t('home.minutesAgo', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('home.hoursAgo', { count: hours });
  return t('home.daysAgo', { count: Math.round(hours / 24) });
}

const hasImage = (item: FeedEntry): boolean => !!feedImagePath(item.image?.url);

/** Opens a story in the reading sheet; a modified click (new tab, window) still goes to the site. */
export const ReadContext = createContext<(item: FeedEntry) => void>(() => undefined);

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

/** A news story: picture, headline, outlet and age. Opens inside News Papers. */
function Story({ hub, item, withPicture }: { hub: HubApi; item: FeedEntry; withPicture: boolean }): JSX.Element {
  const read = useReader(item);
  return (
    <li className="story" data-picture={withPicture && hasImage(item)}>
      <a href={item.url} target="_blank" rel="noreferrer noopener" className="story__link" onClick={read}>
        {withPicture ? <FeedPicture hub={hub} image={item.image} kind="photo" /> : null}
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

const BOARD_SHOWN = 8;

/** One story on the news board: picture on top when there is one. */
function NewsCard({ hub, item }: { hub: HubApi; item: FeedEntry }): JSX.Element {
  const read = useReader(item);
  return (
    <article className="news-card" data-picture={hasImage(item)}>
      <a href={item.url} target="_blank" rel="noreferrer noopener" className="news-card__link" onClick={read}>
        <FeedPicture hub={hub} image={item.image} kind="photo" />
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
export function NewsBoard({ hub, items }: { hub: HubApi; items: FeedEntry[] }): JSX.Element {
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
          <NewsCard hub={hub} key={item.id} item={item} />
        ))}
      </div>
      {rest.length > 0 ? (
        <>
          {open ? (
            <ul className="stories news-board__rest">
              {rest.map((item) => (
                <Story hub={hub} key={item.id} item={item} withPicture />
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
