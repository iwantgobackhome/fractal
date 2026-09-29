import type { JSX } from 'react';
import type { Paper } from '@fractal/shared';
import { authorsLine, paperTitle, sourceLabel } from './paper-format';

interface Props {
  papers: Paper[];
  onOpen: (paperKey: string) => void;
  onShowLibrary: () => void;
}

const today = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

/**
 * The front page. For now it carries the reader's own shelf; the weekly feed
 * (new papers, rankings, field news) takes the lead column once the hub serves it.
 */
export function HomeScreen({ papers, onOpen, onShowLibrary }: Props): JSX.Element {
  const readable = papers.filter((p) => p.status === 'ready' || p.status === 'partial');
  const recent = [...readable].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [lead, ...rest] = recent;

  return (
    <main className="screen home-front" aria-labelledby="home-date">
      <p id="home-date" className="home-front__date">
        {today.format(new Date())}
      </p>

      {lead === undefined ? (
        <section className="home-front__blank">
          <h1 className="home-front__headline">읽을 논문을 가져오세요.</h1>
          <p className="home-front__deck">위 입력창에 arXiv 번호, DOI, 논문 주소를 넣거나 PDF를 이 창에 끌어다 놓으면 보관함에 들어옵니다.</p>
        </section>
      ) : (
        <div className="home-front__grid">
          <article className="home-front__lead">
            <h2 className="home-front__kicker">최근에 가져온 논문</h2>
            <button type="button" className="home-front__lead-title" onClick={() => onOpen(lead.paperKey)}>
              {paperTitle(lead)}
            </button>
            <p className="home-front__byline">
              {authorsLine(lead.authors, 3)} · {sourceLabel(lead)}
            </p>
          </article>

          {rest.length > 0 ? (
            <section className="home-front__column" aria-labelledby="home-shelf">
              <h2 id="home-shelf" className="home-front__kicker">
                보관함에서
              </h2>
              <ol className="home-front__list">
                {rest.slice(0, 6).map((paper) => (
                  <li key={paper.paperKey}>
                    <button type="button" onClick={() => onOpen(paper.paperKey)}>
                      <span className="home-front__item-title">{paperTitle(paper)}</span>
                      <span className="home-front__item-meta">{authorsLine(paper.authors)}</span>
                    </button>
                  </li>
                ))}
              </ol>
              {readable.length > 7 ? (
                <button type="button" className="text-link" onClick={onShowLibrary}>
                  보관함 전체 보기
                </button>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}
