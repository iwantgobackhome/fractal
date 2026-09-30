import { createContext, useContext, useState, type JSX, type MouseEvent } from 'react';
import { t } from '../i18n';
import type { FeedEntry } from './hub-api';

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

const BOARD_SHOWN = 8;

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
export function NewsBoard({ items }: { items: FeedEntry[] }): JSX.Element {
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
