import { useEffect, useRef, type JSX } from 'react';
import type { LibraryRecord } from '@fractal/shared';
import { useLanguage } from '../i18n';
import type { FeedEntry, HubApi } from './hub-api';
import { FeedPicture } from './FeedPicture';
import { PublicationActions, PublicationMeta } from './PublicationControls';

export function PublicationDossier({ hub, item, record, hasPdf, onOpen, onClose }: {
  hub: HubApi; item: FeedEntry; record: LibraryRecord | null; hasPdf: boolean;
  onOpen(key: string): void; onClose(): void;
}): JSX.Element {
  const ko = useLanguage() === 'ko';
  const close = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="article-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={sheet} className="article-sheet" role="dialog" aria-modal="true" aria-label={item.title} onKeyDown={(event) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const nodes = sheet.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)');
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <header className="article-sheet__bar"><button ref={close} type="button" className="text-link" onClick={onClose}>← {ko ? '닫기' : 'Close'}</button>
        <span>{ko ? '논문 상세' : 'Paper dossier'}</span></header>
      <div className="article-sheet__scroll"><article className="article publication-dossier">
        <PublicationMeta publication={item.publication} source={item.source} />
        <h1 className="article__title">{item.title}</h1>
        <p className="research-authors">{item.authors.join(', ') || (ko ? '저자 미상' : 'Authors unknown')}</p>
        <PublicationActions hub={hub} item={item} feedId={item.id} record={record} hasPdf={hasPdf} onOpen={onOpen} />
        <FeedPicture hub={hub} image={item.image} detail />
        {item.abstract ? <p>{item.abstract}</p> : null}
        {item.doi ? <p>DOI · {item.doi}</p> : null}
        {item.arxivId ? <p>arXiv · {item.arxivId}</p> : null}
        <p className="entry-quiet">{item.reason}</p>
        <a href={item.url} target="_blank" rel="noreferrer noopener">{ko ? '출판물 페이지' : 'Publication page'} ↗</a>
      </article></div>
    </section>
  </div>;
}
