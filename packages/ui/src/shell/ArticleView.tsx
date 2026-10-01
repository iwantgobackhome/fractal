import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { ArticleBlock } from '@fractal/shared';
import { getLanguage, locale, t } from '../i18n';
import { FeedPicture } from './FeedPicture';
import type { Article, FeedEntry, HubApi } from './hub-api';

type Load = { state: 'loading' } | { state: 'ready'; article: Article } | { state: 'failed'; message: string };
type Translation = { state: 'off' } | { state: 'working' } | { state: 'on'; title: string; blocks: (string | null)[] } | { state: 'failed'; message: string };

const BATCH = 40;

function openOutside(url: string): void {
  window.open(url, '_blank', 'noopener');
}

function when(iso: string | undefined): string | null {
  if (iso === undefined) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

function Block({ hub, block, text }: { hub: HubApi; block: ArticleBlock; text: string | undefined }): JSX.Element | null {
  if (block.type === 'img') {
    if (block.image === undefined) return null;
    return (
      <figure className="article__figure">
        <FeedPicture hub={hub} image={block.image} kind="photo" detail />
        {block.image.alt ? <figcaption>{block.image.alt}</figcaption> : null}
      </figure>
    );
  }
  if (text === undefined || text === '') return null;
  if (block.type === 'h2') return <h2>{text}</h2>;
  if (block.type === 'h3') return <h3>{text}</h3>;
  if (block.type === 'quote') return <blockquote>{text}</blockquote>;
  if (block.type === 'li') return <p className="article__item">{text}</p>;
  return <p>{text}</p>;
}

/**
 * A news story read inside Fractal: the publisher's text without the page around it, with
 * a quick machine translation (not an AI model) and the original site one click away.
 */
export function ArticleView({ hub, item, onClose }: { hub: HubApi; item: FeedEntry; onClose(): void }): JSX.Element {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [translation, setTranslation] = useState<Translation>({ state: 'off' });
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const target = getLanguage();

  useEffect(() => {
    let alive = true;
    setLoad({ state: 'loading' });
    setTranslation({ state: 'off' });
    hub
      .article(item.url)
      .then((article) => alive && setLoad(article === null ? { state: 'failed', message: t('article.unsupported') } : { state: 'ready', article }))
      .catch((reason: unknown) => alive && setLoad({ state: 'failed', message: reason instanceof Error ? reason.message : t('article.failed') }));
    return () => {
      alive = false;
    };
  }, [hub, item.url]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const translate = useCallback(async () => {
    if (load.state !== 'ready') return;
    if (translation.state === 'on') {
      setTranslation({ state: 'off' });
      return;
    }
    setTranslation({ state: 'working' });
    const { article } = load;
    const texts = [article.title, ...article.blocks.map((b) => b.text ?? '')];
    const wanted = texts.map((text, index) => ({ text, index })).filter((entry) => entry.text.trim() !== '');
    const out: (string | null)[] = texts.map(() => null);
    try {
      for (let start = 0; start < wanted.length; start += BATCH) {
        const chunk = wanted.slice(start, start + BATCH);
        const result = await hub.quickTranslate(
          chunk.map((c) => c.text),
          target,
        );
        if (result === null) throw new Error(t('article.translateUnsupported'));
        chunk.forEach((c, i) => (out[c.index] = result[i] ?? null));
      }
      setTranslation({ state: 'on', title: out[0] ?? article.title, blocks: out.slice(1) });
    } catch (reason) {
      setTranslation({ state: 'failed', message: reason instanceof Error ? reason.message : t('article.translateFailed') });
    }
  }, [hub, load, target, translation.state]);

  const article = load.state === 'ready' ? load.article : null;
  const site = article?.siteName ?? item.source.replace(/^news:/, '');
  const date = when(article?.publishedAt ?? item.publishedAt);
  const sameLanguage = article?.lang !== undefined && article.lang.toLowerCase().startsWith(target);

  return (
    <div className="article-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="article-sheet" role="dialog" aria-modal="true" aria-label={article?.title ?? item.title}>
        <header className="article-sheet__bar">
          <button ref={closeRef} type="button" className="text-link text-link--quiet" onClick={onClose}>
            ← {t('article.close')}
          </button>
          <span className="article-sheet__site">{site}</span>
          <span className="article-sheet__actions">
            {article !== null && !sameLanguage ? (
              <button
                type="button"
                className="text-link"
                onClick={() => void translate()}
                disabled={translation.state === 'working'}
                aria-pressed={translation.state === 'on'}
              >
                {translation.state === 'working' ? t('article.translating') : translation.state === 'on' ? t('article.showOriginal') : t('article.translate')}
              </button>
            ) : null}
            <button type="button" className="text-link" onClick={() => openOutside(article?.finalUrl ?? item.url)}>
              {t('article.openSite')} ↗
            </button>
          </span>
        </header>

        <div className="article-sheet__scroll">
          {load.state === 'loading' ? (
            <p className="article__quiet">{t('article.loading')}</p>
          ) : load.state === 'failed' ? (
            <div className="article__quiet">
              <p className="article__title">{item.titleTranslated ?? item.title}</p>
              <p>{load.message}</p>
              <button type="button" className="button" onClick={() => openOutside(item.url)}>
                {t('article.openSite')} ↗
              </button>
            </div>
          ) : (
            <article className="article" lang={translation.state === 'on' ? target : article?.lang}>
              <p className="article__kicker">
                {site}
                {date !== null ? ` · ${date}` : ''}
              </p>
              <h1 className="article__title">{translation.state === 'on' ? translation.title : load.article.title}</h1>
              {translation.state === 'on' ? <p className="article__original-title">{load.article.title}</p> : null}
              {load.article.byline ? <p className="article__byline">{load.article.byline}</p> : null}
              {translation.state === 'failed' ? <p className="settings__warn">{translation.message}</p> : null}
              {translation.state === 'on' ? <p className="article__note">{t('article.machineNote')}</p> : null}
              {load.article.leadImage !== undefined ? (
                <figure className="article__figure article__figure--lead">
                  <FeedPicture hub={hub} image={load.article.leadImage} kind="photo" detail />
                </figure>
              ) : null}
              {load.article.blocks.map((block, index) =>
                block.type === 'img' && block.image?.url === load.article.leadImage?.url ? null : (
                  <Block hub={hub} key={index} block={block} text={translation.state === 'on' ? (translation.blocks[index] ?? block.text) : block.text} />
                ),
              )}
            </article>
          )}
        </div>
      </section>
    </div>
  );
}
