import { useMemo, useState, type JSX } from 'react';
import type { Paper } from '@fractal/shared';
import { paperStatusLabel } from '../lib/status';
import type { HubApi } from './hub-api';
import { addedLabel, authorsLine, isProcessing, paperTitle, sourceLabel } from './paper-format';

type Shelf = 'all' | 'ready' | 'processing';
type Sort = 'added' | 'title';

interface Props {
  papers: Paper[];
  query: string;
  onQueryChange: (query: string) => void;
  onOpen: (paperKey: string) => void;
  onRequestDelete: (paperKey: string) => void;
  hub: HubApi;
}

function matches(paper: Paper, query: string): boolean {
  if (query.trim() === '') return true;
  const haystack = `${paper.title ?? ''} ${paper.authors.join(' ')} ${paper.arxivId ?? ''} ${paper.sourceUrl}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .every((w) => haystack.includes(w));
}

export function LibraryScreen({ papers, query, onQueryChange, onOpen, onRequestDelete, hub }: Props): JSX.Element {
  const [shelf, setShelf] = useState<Shelf>('all');
  const [sort, setSort] = useState<Sort>('added');

  const counts = useMemo(
    () => ({
      all: papers.length,
      ready: papers.filter((p) => p.status === 'ready' || p.status === 'partial').length,
      processing: papers.filter(isProcessing).length,
    }),
    [papers],
  );

  const visible = useMemo(() => {
    const list = papers.filter((p) => {
      if (shelf === 'ready' && !(p.status === 'ready' || p.status === 'partial')) return false;
      if (shelf === 'processing' && !isProcessing(p)) return false;
      return matches(p, query);
    });
    return list.sort((a, b) => (sort === 'title' ? paperTitle(a).localeCompare(paperTitle(b)) : b.createdAt.localeCompare(a.createdAt)));
  }, [papers, shelf, sort, query]);

  const shelves: { id: Shelf; label: string }[] = [
    { id: 'all', label: '모든 논문' },
    { id: 'ready', label: '읽을 수 있음' },
    { id: 'processing', label: '가져오는 중' },
  ];

  return (
    <main className="screen library" aria-labelledby="library-title">
      <aside className="library__shelves" aria-label="분류">
        <ul>
          {shelves.map((s) => (
            <li key={s.id}>
              <button type="button" className="shelf" aria-current={shelf === s.id ? 'true' : undefined} onClick={() => setShelf(s.id)}>
                <span>{s.label}</span>
                <span className="shelf__count">{counts[s.id]}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="library__export">
          <span className="library__export-label">내보내기</span>
          <a href={hub.exportUrl('bibtex')} download="fractal-library.bib">
            BibTeX
          </a>
          <a href={hub.exportUrl('csl-json')} download="fractal-library.json">
            CSL-JSON
          </a>
        </div>
      </aside>

      <section className="library__main">
        <div className="library__head">
          <h1 id="library-title" className="screen__title">
            보관함
          </h1>
          <div className="library__tools">
            {query !== '' ? (
              <button type="button" className="chip" onClick={() => onQueryChange('')} aria-label={`검색어 ${query} 지우기`}>
                “{query}” <span aria-hidden="true">×</span>
              </button>
            ) : null}
            <div className="segmented" role="group" aria-label="정렬">
              <button type="button" aria-pressed={sort === 'added'} onClick={() => setSort('added')}>
                최근 추가
              </button>
              <button type="button" aria-pressed={sort === 'title'} onClick={() => setSort('title')}>
                제목
              </button>
            </div>
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="library__empty">
            {papers.length === 0 ? '보관함이 비어 있습니다. 위 입력창에 arXiv 번호나 DOI를 넣거나, PDF를 이 창에 끌어다 놓으세요.' : '조건에 맞는 논문이 없습니다.'}
          </p>
        ) : (
          <ol className="paper-list">
            {visible.map((paper) => (
              <li key={paper.paperKey} className="paper-row">
                <button type="button" className="paper-row__open" onClick={() => onOpen(paper.paperKey)}>
                  <span className="paper-row__title">{paperTitle(paper)}</span>
                  <span className="paper-row__authors">{authorsLine(paper.authors)}</span>
                  <span className="paper-row__meta">
                    <span>{sourceLabel(paper)}</span>
                    {paper.pageCount !== null ? <span>{paper.pageCount}쪽</span> : null}
                    <span>{addedLabel(paper.createdAt)}</span>
                    {paper.status !== 'ready' && paper.status !== 'partial' ? <span className="paper-row__status">{paperStatusLabel(paper)}</span> : null}
                  </span>
                </button>
                <button type="button" className="paper-row__delete" onClick={() => onRequestDelete(paper.paperKey)} aria-label={`${paperTitle(paper)} 삭제`}>
                  삭제
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
