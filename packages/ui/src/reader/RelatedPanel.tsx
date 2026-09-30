import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { Paper, RelatedPapersResponse } from '@fractal/shared';
import { locale, t, useLanguage } from '../i18n';
import type { HubApi } from '../shell/hub-api';
import { matchPublication, providerName } from '../shell/publication-model';
import { PublicationActions, PublicationMeta, useCatalog } from '../shell/PublicationControls';
import { SourceStatus, useRetryTime } from '../shell/SourceStatus';

export function RelatedPanel({ hub, paperKey, papers, onOpen }: { hub: HubApi; paperKey: string; papers: Paper[]; onOpen(key: string): void }): JSX.Element {
  const ko = useLanguage() === 'ko',
    say = (en: string, kr: string) => (ko ? kr : en);
  const [result, setResult] = useState<RelatedPapersResponse | null>(() => hub.cachedRelated(paperKey));
  const [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null),
    [loaded, setLoaded] = useState(false);
  const busy = useRef(false),
    generation = useRef(0);
  const records = useCatalog(hub),
    retrySeconds = useRetryTime(result?.providerStatus ?? []);
  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    const current = generation.current;
    try {
      const next = await hub.related(paperKey);
      if (generation.current !== current) return;
      if (!next) throw new Error(say('Related sources are unavailable. Retry later.', '관련 논문 소스를 사용할 수 없습니다. 나중에 다시 시도하세요.'));
      setResult((previous) =>
        !next.items.length && previous?.items.length && next.status === 'unavailable'
          ? { ...next, items: previous.items, status: 'stale', fetchedAt: previous.fetchedAt }
          : next,
      );
      setLoaded(true);
    } catch (cause) {
      if (generation.current === current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoaded(true);
      }
    } finally {
      busy.current = false;
      if (generation.current === current) setLoading(false);
    }
  }, [hub, paperKey, ko]);
  useEffect(() => {
    generation.current += 1;
    setResult(hub.cachedRelated(paperKey));
    setLoaded(false);
    busy.current = false;
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load, hub, paperKey]);
  return (
    <div className="related" aria-busy={loading || undefined}>
      <div className="related__toolbar">
        <p>
          {result?.status === 'stale' || (error && result?.items.length)
            ? say('Retained cached results', '이전 캐시 결과')
            : result?.status === 'partial'
              ? say('Partial source coverage', '일부 소스 결과')
              : loading
                ? say('Loading related papers…', '관련 논문을 불러오는 중…')
                : say('Related research', '관련 연구')}
        </p>
        <button disabled={loading || retrySeconds > 0} onClick={() => void load()}>
          {loading ? say('Refreshing…', '새로 고치는 중…') : retrySeconds ? `${say('Retry in', '재시도까지')} ${retrySeconds}s` : t('related.retry')}
        </button>
      </div>
      {result?.fetchedAt ? (
        <p className="related__source">
          {say('Cache snapshot', '캐시 목록')}: {new Date(result.fetchedAt).toLocaleString(locale())} · {providerName(result.source)}
        </p>
      ) : null}
      <SourceStatus statuses={result?.providerStatus ?? []} />
      {error ? (
        <p role="alert">
          {error} {result?.items.length ? say('Cached papers remain available to save or read.', '캐시된 논문을 계속 저장하거나 읽을 수 있습니다.') : null}
        </p>
      ) : null}
      {loaded && !result?.items.length ? (
        <div className="related__quiet">
          <p>
            {result?.status === 'unavailable' || error
              ? say(
                  'Sources could not provide results. This is not an empty successful search.',
                  '소스 결과를 가져오지 못했습니다. 정상적인 검색의 빈 결과와 다릅니다.',
                )
              : t('related.none')}
          </p>
          <p>{say('Retry when the source is available, or use the discovery desk.', '소스가 복구되면 다시 시도하거나 탐색에서 다른 논문을 찾아보세요.')}</p>
          <a href="#/home">{say('Open discovery', '탐색 열기')}</a>
        </div>
      ) : null}
      {(['similar', 'cites', 'citedBy'] as const).map((relation) => {
        const items = result?.items.filter((item) => (item.relations ?? [item.relation]).includes(relation)) ?? [];
        if (!items.length) return null;
        return (
          <section
            key={relation}
            className="related__group"
            aria-label={t(relation === 'similar' ? 'related.similar' : relation === 'cites' ? 'related.cites' : 'related.citedBy')}
          >
            <h3 className="related__heading">{t(relation === 'similar' ? 'related.similar' : relation === 'cites' ? 'related.cites' : 'related.citedBy')}</h3>
            <ol className="related__list">
              {items.map((item) => {
                const record = matchPublication(item, records),
                  hasPdf = !!record && papers.some((p) => p.paperKey === record.paperKey && !!p.pdfSha256);
                return (
                  <li className="related__item" key={`${relation}:${item.url}`}>
                    <a className="related__title" href={item.url} target="_blank" rel="noreferrer noopener">
                      {item.title}
                    </a>
                    <span className="related__meta">{item.authors.join(', ') || say('Authors unknown', '저자 미상')}</span>
                    <PublicationMeta publication={item.publication} year={item.year} venue={item.venue} source={item.provider} />
                    {item.abstract ? <p className="related__abstract">{item.abstract}</p> : null}
                    {item.citationCount !== undefined ? (
                      <span className="related__meta">{t('related.citations', { count: new Intl.NumberFormat(locale()).format(item.citationCount) })}</span>
                    ) : null}
                    <PublicationActions hub={hub} item={item} record={record} hasPdf={hasPdf} onOpen={onOpen} />
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
