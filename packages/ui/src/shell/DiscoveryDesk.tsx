import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { FeedItem, FeedResponse, FeedSettings, FieldTopic, Paper } from '@fractal/shared';
import { locale, t, useLanguage } from '../i18n';
import { Selector } from '../components/Selector';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ArticleView } from './ArticleView';
import { InterestPicker } from './InterestPicker';
import { TopicManager } from './TopicManager';
import { fieldName } from './fields';
import { TRANSLATION_LANGUAGES } from './preferences';
import { PublicationActions, PublicationMeta, useCatalog } from './PublicationControls';
import { matchPublication, providerName, sourceNames, uniqueFeedPapers } from './publication-model';
import { SourceStatus } from './SourceStatus';
import { NewsBoard, ReadContext } from './NewsBoard';
import type { FeedEntry, HubApi, Interests } from './hub-api';

export function DiscoveryDesk({
  hub,
  papers,
  onOpen,
  onEditInterests,
}: {
  hub: HubApi;
  papers: Paper[];
  onOpen(key: string): void;
  onOpenExternal(value: string): void;
  onShowLibrary(): void;
  onEditInterests(): void;
}): JSX.Element {
  const ko = useLanguage() === 'ko',
    say = (en: string, kr: string) => (ko ? kr : en);
  const [feed, setFeed] = useState<FeedResponse | null>(null),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false);
  const [interests, setInterests] = useState<Interests | null>(null),
    [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('papers'),
    [source, setSource] = useState('all'),
    [kind, setKind] = useState('all'),
    [sort, setSort] = useState('relevance'),
    [search, setSearch] = useState('');
  const [field, setField] = useState('all'),
    [topic, setTopic] = useState('all'),
    [topics, setTopics] = useState<FieldTopic[]>([]),
    [topicsLoading, setTopicsLoading] = useState(false);
  const [reading, setReading] = useState<FeedEntry | null>(null),
    [managing, setManaging] = useState(false),
    [sourcesOpen, setSourcesOpen] = useState(false);
  const [settings, setSettings] = useState<FeedSettings | null>(null),
    [settingsPending, setSettingsPending] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [newsLanguage, setNewsLanguage] = useState(ko ? 'ko' : 'en'),
    [translating, setTranslating] = useState(false),
    [translated, setTranslated] = useState<Record<string, string>>({});
  const inFlight = useRef(false),
    alive = useRef(true);
  const records = useCatalog(hub);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [next, configured, options] = await Promise.all([hub.feed(), hub.interests(), hub.feedSettings()]);
      if (!alive.current) return;
      if (!next)
        throw new Error(say('Discovery is unavailable. Retry or edit your interests.', '탐색을 사용할 수 없습니다. 다시 시도하거나 관심 분야를 편집하세요.'));
      setFeed(next);
      setInterests(configured?.interests ?? null);
      setSettings(options);
      setError(null);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [hub, ko]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);
  const refresh = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    setError(null);
    try {
      const next = await hub.refreshFeed();
      if (!next) throw new Error(say('Discovery is unavailable.', '탐색을 사용할 수 없습니다.'));
      if (alive.current) setFeed(next);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      inFlight.current = false;
      if (alive.current) setRefreshing(false);
    }
  };
  const fields = useMemo(() => {
    const values = new Map<string, string>();
    for (const section of feed?.sections.byField ?? []) values.set(section.field, section.label || fieldName(section.field));
    for (const code of interests?.categories ?? []) if (!values.has(code)) values.set(code, fieldName(code));
    for (const custom of interests?.custom ?? []) values.set(`custom:${custom.id}`, custom.label);
    return [...values].map(([value, label]) => ({ value, label }));
  }, [feed, interests, ko]);
  useEffect(() => {
    if (tab !== 'topics' || field === 'all') {
      setTopics([]);
      return;
    }
    let live = true;
    setTopicsLoading(true);
    void hub
      .topics(field)
      .then((rows) => {
        if (live) setTopics(rows ?? []);
      })
      .catch((cause) => {
        if (live) setError(String(cause));
      })
      .finally(() => {
        if (live) setTopicsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [hub, field, tab, managing]);
  const allPapers = useMemo(
    () =>
      feed
        ? uniqueFeedPapers([...feed.sections.top, ...feed.sections.byField.flatMap((s) => s.items), ...feed.sections.rankings, ...feed.sections.recommended])
        : [],
    [feed],
  );
  const availableSources = [...new Set(allPapers.flatMap((item) => sourceNames(item.source)))];
  const topicPapers = allPapers.filter(
    (item) =>
      (field === 'all' || item.categories.includes(field) || feed?.sections.byField.some((s) => s.field === field && s.items.some((p) => p.id === item.id))) &&
      (topic === 'all' || item.topicIds?.includes(topic)),
  );
  const visible = (tab === 'topics' ? topicPapers : allPapers)
    .filter(
      (item) =>
        (source === 'all' || sourceNames(item.source).includes(source)) &&
        (kind === 'all' || (item.publication?.publicationKind ?? 'unknown') === kind) &&
        `${item.title} ${item.authors.join(' ')} ${item.abstract} ${item.publication?.venue ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    )
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title, locale())
        : sort === 'newest'
          ? (b.publication?.publicationDate ?? '').localeCompare(a.publication?.publicationDate ?? '') ||
            (b.publication?.year ?? 0) - (a.publication?.year ?? 0)
          : sort === 'popular'
            ? b.popularity - a.popularity
            : b.score - a.score,
    );
  const newsPool = feed
    ? [
        ...feed.sections.news,
        ...feed.sections.generalNews,
        ...feed.sections.newsByField.flatMap((s) => s.items),
        ...feed.sections.newsByTopic.flatMap((s) => s.items),
      ]
    : [];
  const newsSeen = new Set<string>();
  const news = newsPool
    .filter((item) => {
      if (newsSeen.has(item.id)) return false;
      newsSeen.add(item.id);
      return (
        (field === 'all' || feed?.sections.newsByField.some((s) => s.field === field && s.items.some((p) => p.id === item.id))) &&
        (topic === 'all' ||
          item.topicIds?.includes(topic) ||
          feed?.sections.newsByTopic.some((s) => s.topicId === topic && s.items.some((p) => p.id === item.id)))
      );
    })
    .map((item) => (translated[item.id] ? { ...item, titleTranslated: translated[item.id] } : item));
  const translateTitles = async () => {
    if (translating || !news.length) return;
    setTranslating(true);
    try {
      const values = await hub.quickTranslate(
        news.slice(0, 100).map((n) => n.title),
        newsLanguage,
      );
      if (!values) throw new Error(say('Headline translation unavailable.', '제목 번역을 사용할 수 없습니다.'));
      setTranslated(Object.fromEntries(news.slice(0, 100).map((n, i) => [n.id, values[i] ?? n.title])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTranslating(false);
    }
  };
  const hasInterests = interests && interests.categories.length + interests.topics.length + interests.authors.length + (interests.custom?.length ?? 0) > 0;
  const fieldOptions = [{ value: 'all', label: say('All followed fields', '팔로우한 모든 분야') }, ...fields];
  return (
    <ReadContext.Provider value={setReading}>
      <main className="screen discovery-desk" aria-labelledby="discovery-title">
        <header className="discovery-heading">
          <div>
            <p className="index-eyebrow">{new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())}</p>
            <h1 id="discovery-title">{say('Research & discovery', '연구와 탐색')}</h1>
            <p>{say('Papers, publications and reporting from your followed fields.', '팔로우한 분야의 논문, 출판물과 소식을 살펴보세요.')}</p>
          </div>
          <div className="discovery-heading__actions">
            <button type="button" onClick={onEditInterests}>
              {t('interests.edit')}
            </button>
            <button
              type="button"
              onClick={() => {
                setSourceError(null);
                setSourcesOpen(true);
              }}
            >
              {say('Sources', '소스')}
            </button>
            <button type="button" disabled={refreshing || loading} onClick={() => void refresh()}>
              {refreshing ? t('home.refreshing') : t('home.gatherNow')}
            </button>
          </div>
        </header>
        <div
          className="index-tabs"
          role="tablist"
          aria-label={say('Discovery sections', '탐색 항목')}
          onKeyDown={(event) => {
            const tabs = ['papers', 'news', 'topics'],
              at = tabs.indexOf(tab),
              next =
                event.key === 'ArrowRight' ? (at + 1) % 3 : event.key === 'ArrowLeft' ? (at + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1;
            if (next < 0) return;
            event.preventDefault();
            setTab(tabs[next]);
            (event.currentTarget.children[next] as HTMLElement).focus();
          }}
        >
          {[
            ['papers', say('Papers', '논문')],
            ['news', say('News', '뉴스')],
            ['topics', say('Topics', '주제')],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              tabIndex={tab === value ? 0 : -1}
              onClick={() => {
                setTab(value);
                setTopic('all');
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {loading ? (
          <div className="index-state" role="status" aria-busy="true">
            <h2>{say('Loading your research desk…', '연구 목록을 불러오는 중…')}</h2>
            <p>{say('Stored results will stay visible while sources refresh.', '소스를 새로 고치는 동안 저장된 결과를 유지합니다.')}</p>
            <button onClick={onEditInterests}>{t('interests.edit')}</button>
          </div>
        ) : null}
        {error ? (
          <div className="index-state index-state--error" role="alert">
            <p>{error}</p>
            <button type="button" disabled={loading || refreshing} onClick={() => void load()}>
              {say('Retry loading', '다시 불러오기')}
            </button>
            <button onClick={onEditInterests}>{t('interests.edit')}</button>
          </div>
        ) : null}
        {!loading && !hasInterests && interests ? <InterestPicker hub={hub} onSaved={() => void load()} /> : null}
        <SourceStatus compact statuses={feed?.sourceStatus ?? []} />
        {feed?.generatedAt ? (
          <p className="discovery-cache">
            {say('Snapshot', '목록 갱신')}: {new Date(feed.generatedAt).toLocaleString(locale())}
            {refreshing ? ` · ${say('Refreshing; showing retained results', '새로 고치는 중; 이전 결과 표시')}` : ''}
          </p>
        ) : null}
        {tab !== 'papers' ? (
          <div className="discovery-topics">
            <Selector
              label={say('Field', '분야')}
              value={field}
              options={fieldOptions}
              onChange={(value) => {
                setField(value);
                setTopic('all');
              }}
            />
            {tab === 'topics' ? (
              <>
                <Selector
                  label={say('Topic', '주제')}
                  value={topic}
                  loading={topicsLoading}
                  options={[
                    { value: 'all', label: say('All topics', '모든 주제') },
                    ...topics.map((topic) => ({
                      value: topic.id,
                      label: topic.label,
                      description: topic.followed ? say('Following', '팔로우 중') : say('Not followed', '팔로우 안 함'),
                    })),
                  ]}
                  onChange={setTopic}
                />
                <button disabled={field === 'all'} onClick={() => setManaging(true)}>
                  {t('topics.manage')}
                </button>
                <p>
                  {say(
                    'Topic papers use reported topic associations. Following changes the next gathering.',
                    '주제 논문은 소스가 보고한 주제 연결을 사용합니다. 팔로우 변경은 다음 수집에 반영됩니다.',
                  )}
                </p>
              </>
            ) : (
              <>
                <Selector
                  label={say('Headline language', '뉴스 제목 언어')}
                  value={newsLanguage}
                  options={TRANSLATION_LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
                  onChange={(value) => {
                    setNewsLanguage(value);
                    setTranslated({});
                  }}
                />
                <button disabled={translating || !news.length} onClick={() => void translateTitles()}>
                  {translating ? say('Translating…', '번역 중…') : say('Translate headlines', '제목 번역')}
                </button>
              </>
            )}
          </div>
        ) : null}
        {tab !== 'news' ? (
          <>
            <div className="index-tools">
              <input
                type="search"
                aria-label={say('Search discovered papers', '탐색 논문 검색')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={say('Title, author or venue', '제목, 저자 또는 출판처')}
              />
              <Selector
                label={say('Publication source', '출판물 소스')}
                value={source}
                options={[
                  { value: 'all', label: say('All sources', '모든 소스') },
                  ...availableSources.map((value) => ({ value, label: providerName(value) })),
                ]}
                onChange={setSource}
              />
              <Selector
                label={say('Publication type', '출판 유형')}
                value={kind}
                options={['all', 'journal', 'conference', 'preprint', 'other', 'unknown'].map((value, i) => ({
                  value,
                  label: (ko
                    ? ['모든 출판 유형', '학술지', '학회', '프리프린트', '기타 출판물', '출판 유형 미상']
                    : ['All publication types', 'Journal', 'Conference', 'Preprint', 'Other publication', 'Publication type unknown'])[i],
                }))}
                onChange={setKind}
              />
              <Selector
                label={say('Sort discovered papers', '탐색 논문 정렬')}
                value={sort}
                options={['relevance', 'newest', 'title', 'popular'].map((value, i) => ({
                  value,
                  label: (ko
                    ? ['관련도', '알려진 최신 출판일', '제목', '소스의 인기도']
                    : ['Relevance', 'Known publication date', 'Title', 'Reported popularity'])[i],
                }))}
                onChange={setSort}
              />
            </div>
            {!loading && visible.length === 0 ? (
              <div className="index-state">
                <h2>
                  {allPapers.length
                    ? say('No papers match these filters.', '조건에 맞는 논문이 없습니다.')
                    : say('No papers in this snapshot yet.', '아직 이 목록에 논문이 없습니다.')}
                </h2>
                <p>
                  {say(
                    'Source failures are listed above; an empty list is not a successful source response.',
                    '소스 실패는 위에 표시됩니다. 빈 목록이 소스의 성공을 뜻하지는 않습니다.',
                  )}
                </p>
                <button
                  onClick={() => {
                    setKind('all');
                    setSource('all');
                    setSearch('');
                    setTopic('all');
                    setField('all');
                  }}
                >
                  {say('Clear filters', '필터 초기화')}
                </button>
                <button disabled={refreshing} onClick={() => void refresh()}>
                  {t('home.gatherNow')}
                </button>
              </div>
            ) : null}
            <ol className="research-list" aria-busy={refreshing || undefined}>
              {visible.map((item, index) => {
                const record = matchPublication(item, records),
                  hasPdf = !!record && papers.some((p) => p.paperKey === record.paperKey && !!p.pdfSha256);
                return (
                  <li className="research-entry" key={item.id} data-feed-id={item.id}>
                    <span className="entry-number" aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className="research-entry__body">
                      <PublicationMeta publication={item.publication} source={item.source} />
                      <a className="research-title" href={item.url} target="_blank" rel="noreferrer noopener">
                        {item.title}
                      </a>
                      <p className="research-authors">{item.authors.join(', ') || say('Authors unknown', '저자 미상')}</p>
                      {item.abstract ? <p className="research-summary">{item.abstract}</p> : null}
                      <p className="discovery-reason">
                        {item.reasonCode === 'topic' ? `${say('Followed topic', '팔로우한 주제')}: ${item.reasonParams.topic ?? ''}` : item.reason}
                      </p>
                      {item.dateBasis === 'observed' ? (
                        <p className="entry-quiet">
                          {say('Observed', '소스 관찰')}: {new Date(item.publishedAt).toLocaleDateString(locale())} ·{' '}
                          {say('Publication date unknown', '출판일 미상')}
                        </p>
                      ) : null}
                    </div>
                    <PublicationActions hub={hub} item={item} feedId={item.id} record={record} hasPdf={hasPdf} onOpen={onOpen} />
                  </li>
                );
              })}
            </ol>
          </>
        ) : null}
        {(tab === 'news' || tab === 'topics') && news.length ? <NewsBoard items={news} /> : null}
        {tab === 'news' && !loading && !news.length ? (
          <div className="index-state">
            <h2>{say('No news for this field yet.', '아직 이 분야의 뉴스가 없습니다.')}</h2>
            <button onClick={() => setField('all')}>{say('Show all news', '모든 뉴스 보기')}</button>
            <button disabled={refreshing} onClick={() => void refresh()}>
              {t('home.gatherNow')}
            </button>
          </div>
        ) : null}
        <footer className="index-footer">
          Fractal · {visible.length} {say('papers', '논문')} · {news.length} {say('stories', '소식')}
        </footer>
        {reading ? <ArticleView hub={hub} item={reading} onClose={() => setReading(null)} /> : null}
        {managing && field !== 'all' ? (
          <TopicManager
            hub={hub}
            field={field}
            fieldName={fields.find((f) => f.value === field)?.label ?? field}
            onClose={(changed) => {
              setManaging(false);
              if (changed) void refresh();
            }}
          />
        ) : null}
        {sourcesOpen ? (
          <ConfirmDialog
            title={say('Discovery sources', '탐색 소스')}
            confirmLabel={say('Done', '완료')}
            onConfirm={() => setSourcesOpen(false)}
            onCancel={() => setSourcesOpen(false)}
          >
            <p>
              {say(
                'Changes apply to the next gathering; current results stay available. Saving a publication never downloads a PDF.',
                '변경 사항은 다음 수집에 반영됩니다. 현재 결과는 유지되며 서지 정보 저장은 PDF를 내려받지 않습니다.',
              )}
            </p>
            {settings ? (
              <div className="discovery-source-options">
                {(['arxiv', 'huggingFace', 'openAlex', 'crossref', 'news', 'recommendations'] as const).map((key) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={settings.sources[key] !== false}
                      disabled={settingsPending}
                      onChange={(event) => {
                        const next = { ...settings, sources: { ...settings.sources, [key]: event.target.checked } };
                        setSettingsPending(true);
                        setSettings(next);
                        setSourceError(null);
                        void hub
                          .saveFeedSettings(next)
                          .then((saved) => {
                            if (saved) setSettings(saved);
                            else throw new Error('Source settings unavailable');
                          })
                          .catch((cause) => {
                            setSettings(settings);
                            setSourceError(String(cause));
                          })
                          .finally(() => setSettingsPending(false));
                      }}
                    />
                    {providerName(key)}
                  </label>
                ))}
              </div>
            ) : (
              <div>
                <p>{say('Source settings unavailable.', '소스 설정을 사용할 수 없습니다.')}</p>
                <button
                  type="button"
                  disabled={settingsPending}
                  onClick={() => {
                    setSettingsPending(true);
                    void hub
                      .feedSettings()
                      .then(setSettings)
                      .catch((cause) => setSourceError(String(cause)))
                      .finally(() => setSettingsPending(false));
                  }}
                >
                  {say('Retry source settings', '소스 설정 다시 시도')}
                </button>
              </div>
            )}
            {sourceError ? <p role="alert">{sourceError}</p> : null}
          </ConfirmDialog>
        ) : null}
      </main>
    </ReadContext.Provider>
  );
}
