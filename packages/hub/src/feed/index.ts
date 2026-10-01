import type { FeedDigest, FeedInterests, FeedItem, FeedResponse, FeedSettings, FeedSourceStatus, QuickTranslateRequest } from '@fractal/shared';
import { feedWeekSchema } from '@fractal/shared';
import { arxivCategories, type ArxivCategory } from '@fractal/shared';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { ProviderRegistry } from '../ai/registry';
import type { SqlitePaperStore } from '../store/sqlite';
import { invalidInput, notFound } from '../store/errors';
import { bookmark } from '../scholarly/bookmarks';
import { ProviderFailure } from '../scholarly/client';
import { openAlexSource, crossrefSource } from './scholarly-sources';
import type { PaperAcquirer } from '../api/index';
import { CachedFetcher, arxivSource, huggingFaceSource, newsSource, recommendationSource, parseArxivAtom, type FeedSource, type RawItem } from './sources';
import { rankItems } from './ranking';
import { FeedImageStore, dropSharedImages } from './images';
import { TopicService } from './topics';
import { ArticleReader } from './article';
import { QuickTranslator } from './quick-translate';

const DEFAULT_INTERESTS: FeedInterests = { categories: [], topics: [], authors: [], custom: [] };
const DEFAULT_SETTINGS: FeedSettings = {
  sources: { arxiv: true, huggingFace: true, news: true, recommendations: true, openAlex: true, crossref: true },
  customRssFeeds: [],
  digestEnabled: false,
  refreshIntervalHours: 6,
  translateNewsTitles: true,
};
const SOURCES = [arxivSource, huggingFaceSource, newsSource, recommendationSource, openAlexSource, crossrefSource];

/** Preserve each selected field's news allowance independently of the general pool. */
export function retainNewsByField(items: FeedItem[], interests: FeedInterests): FeedItem[] {
  const fields = [...interests.categories, ...(interests.custom ?? []).map((item) => `custom:${item.id}`)];
  const news = items.filter((item) => item.kind === 'news');
  const selected = new Set<string>();
  for (const field of fields) for (const item of news.filter((candidate) => candidate.categories.includes(field)).slice(0, 30)) selected.add(item.id);
  for (const item of news
    .filter((candidate) => !fields.some((field) => candidate.categories.includes(field)) && !(candidate as FeedItem & { topicIds?: string[] }).topicIds?.length)
    .slice(0, 40))
    selected.add(item.id);
  const topicIds = new Set(news.flatMap((item) => (item as FeedItem & { topicIds?: string[] }).topicIds ?? []));
  for (const topicId of topicIds)
    for (const item of news.filter((candidate) => (candidate as FeedItem & { topicIds?: string[] }).topicIds?.includes(topicId)).slice(0, 15))
      selected.add(item.id);
  return news.filter((item) => selected.has(item.id));
}

export function isoWeek(now: Date): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const first = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const number = Math.ceil(((day.getTime() - first.getTime()) / 86400000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(number).padStart(2, '0')}`;
}

export function isStale(last: string | null, now: Date, hours: number): boolean {
  return !last || now.getTime() - Date.parse(last) > hours * 3600000 || !Number.isFinite(Date.parse(last));
}

interface MetaRow {
  data: string;
}
export class FeedService {
  private readonly cache: CachedFetcher;
  private readonly images: FeedImageStore | null;
  readonly topics: TopicService;
  private readonly articleReader: ArticleReader;
  private readonly quick: QuickTranslator;
  private readonly shutdown = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<FeedResponse> | null = null;
  private stopped = false;

  constructor(
    private readonly store: SqlitePaperStore,
    private readonly acquirer: PaperAcquirer,
    private readonly registry?: ProviderRegistry,
    fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly sources: FeedSource[] = SOURCES,
    imageRoot?: string,
  ) {
    const scopedFetch: typeof fetch = (input, init) =>
      fetcher(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, this.shutdown.signal]) : this.shutdown.signal });
    this.cache = new CachedFetcher(store, scopedFetch);
    this.images = imageRoot ? new FeedImageStore(store, imageRoot, fetcher, this.shutdown.signal) : null;
    this.topics = new TopicService(store, registry);
    this.articleReader = new ArticleReader(store, this.images, fetcher, lookup, this.shutdown.signal);
    this.quick = new QuickTranslator(store, registry, scopedFetch);
  }
  async image(hash: string): Promise<{ body: Buffer; contentType: string } | null> {
    return this.images?.get(hash) ?? null;
  }
  article(url: string) {
    return this.articleReader.get(url);
  }
  quickTranslate(input: QuickTranslateRequest) {
    return this.quick.translate(input);
  }

  private meta<T>(key: string, fallback: T): T {
    const row = this.store.db.prepare('SELECT data FROM feed_meta WHERE key=?').get(key) as MetaRow | undefined;
    return row ? (JSON.parse(row.data) as T) : fallback;
  }

  private putMeta(key: string, value: unknown): void {
    this.store.db.prepare('INSERT INTO feed_meta(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(key, JSON.stringify(value));
  }

  interests(): FeedInterests {
    return { ...DEFAULT_INTERESTS, ...this.meta('interests', DEFAULT_INTERESTS) };
  }
  categories(query = ''): ArxivCategory[] {
    const q = query.trim().toLocaleLowerCase();
    return q
      ? arxivCategories.filter((item) => [item.code, item.name.en, item.name.ko].some((value) => value.toLocaleLowerCase().includes(q)))
      : arxivCategories;
  }
  settings(): FeedSettings {
    const settings = this.meta('settings', DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...settings, sources: { ...DEFAULT_SETTINGS.sources, ...settings.sources } };
  }
  putInterests(value: Omit<FeedInterests, 'custom'> & { custom?: { id?: string; label: string; query?: string }[] }): FeedInterests {
    const custom = (value.custom ?? []).map((item) => ({ id: item.id ?? randomUUID(), label: item.label, query: item.query?.trim() || item.label }));
    const result: FeedInterests = { categories: value.categories, topics: value.topics, authors: value.authors, custom };
    this.putMeta('interests', result);
    return result;
  }
  putSettings(value: FeedSettings): FeedSettings {
    this.putMeta('settings', value);
    this.schedule();
    return value;
  }

  suggestions(): Array<{ category: string; count: number }> {
    const library = this.store.listLibrary();
    const ids = new Set(library.map((item) => item.arxivId?.replace(/v\d+$/, '')).filter(Boolean));
    const counts = new Map<string, number>();
    const known = this.meta<Record<string, string[]>>('libraryCategories', {});
    const cached = new Map<string, string[]>();
    for (const row of this.store.db.prepare('SELECT data FROM feed_items').all()) {
      const item = JSON.parse(String(row.data)) as FeedItem;
      if (!item.arxivId || !ids.has(item.arxivId.replace(/v\d+$/, ''))) continue;
      cached.set(item.arxivId.replace(/v\d+$/, ''), item.categories);
    }
    for (const id of ids) {
      if (!id) continue;
      const legacy = /^([a-z-]+\.[A-Z]{2})\//.exec(id)?.[1];
      for (const category of known[id] ?? cached.get(id) ?? (legacy ? [legacy] : [])) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }
    return [...counts]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
      .slice(0, 12);
  }

  private rawForWeek(week: string): RawItem[] {
    return this.store.db
      .prepare('SELECT data FROM feed_items WHERE week=?')
      .all(week)
      .map((row) => JSON.parse(String(row.data)) as FeedItem)
      .map(({ score: _score, reason: _reason, reasonCode: _reasonCode, reasonParams: _reasonParams, inLibrary: _inLibrary, ...item }) => item);
  }

  private status(): FeedSourceStatus[] {
    const language = this.store.getPreferences().uiLanguage;
    return this.meta<FeedSourceStatus[]>('sourceStatus', []).map((status) =>
      status.message && !status.errorCode ? { ...status, message: language === 'ko' ? '소스를 가져오지 못했습니다.' : 'Could not fetch source.' } : status,
    );
  }

  read(week = isoWeek(this.now())): FeedResponse {
    if (!feedWeekSchema.safeParse(week).success) throw invalidInput('주차 형식은 YYYY-Www이어야 합니다.');
    const items = rankItems(this.rawForWeek(week), this.interests(), this.store.listLibrary(), this.now(), this.store.getPreferences().uiLanguage);
    const papers = items.filter((item) => item.kind === 'paper');
    const interests = this.interests();
    const fields = [
      ...interests.categories.map((field) => ({ field })),
      ...(interests.custom ?? []).map((interest) => ({ field: `custom:${interest.id}`, label: interest.label })),
    ];
    const byField = fields.map((entry) => ({ ...entry, items: papers.filter((item) => item.categories.includes(entry.field)).slice(0, 20) }));
    const newsByField = fields.map((entry) => ({
      ...entry,
      items: items.filter((item) => item.kind === 'news' && item.categories.includes(entry.field)).slice(0, 30),
    }));
    const generalNews = items.filter((item) => item.kind === 'news' && !fields.some((field) => item.categories.includes(field.field))).slice(0, 40);
    const newsByTopic = this.topics.followed(fields.map((item) => item.field)).map((topic) => ({
      field: topic.field,
      topicId: topic.id,
      label: topic.label,
      items: items.filter((item) => item.kind === 'news' && (item as FeedItem & { topicIds?: string[] }).topicIds?.includes(topic.id)).slice(0, 15),
    }));
    const prefs = this.store.getPreferences();
    const digestLanguage = prefs.answerLanguage === 'auto' ? prefs.uiLanguage : prefs.answerLanguage;
    const digest = this.store.db.prepare('SELECT data FROM feed_digests WHERE week=?').get(`${week}:${digestLanguage}`) as MetaRow | undefined;
    return {
      week,
      generatedAt: this.meta(`generated:${week}`, null),
      sections: {
        top: papers.slice(0, 20),
        byField,
        rankings: papers
          .filter((item) => item.source.includes('huggingFace'))
          .sort((a, b) => b.popularity - a.popularity)
          .slice(0, 30),
        news: items.filter((item) => item.kind === 'news').slice(0, 30),
        newsByField,
        generalNews,
        newsByTopic,
        recommended: papers.filter((item) => item.source.includes('recommendations') && !item.inLibrary).slice(0, 30),
      },
      sourceStatus: week === isoWeek(this.now()) ? this.status() : [],
      ...(digest && this.settings().digestEnabled ? { digest: JSON.parse(digest.data) as FeedDigest } : {}),
    };
  }

  async save(id: string) {
    const item = this.rawForWeek(isoWeek(this.now())).find((candidate) => candidate.id === id);
    if (!item || item.kind !== 'paper') throw notFound('Paper not found in the current feed');
    return bookmark(this.store, {
      title: item.title,
      authors: item.authors,
      doi: item.doi,
      arxivId: item.arxivId,
      url: item.url,
      abstract: item.abstract || null,
      publication: item.publication,
    });
  }

  async refresh(): Promise<FeedResponse> {
    this.shutdown.signal.throwIfAborted();
    if (this.running) return this.running;
    this.running = this.refreshOnce().finally(() => {
      this.running = null;
      this.schedule();
    });
    return this.running;
  }

  private async refreshOnce(): Promise<FeedResponse> {
    const now = this.now();
    const week = isoWeek(now);
    const settings = this.settings();
    const library = this.store.listLibrary();
    const statuses: FeedSourceStatus[] = [];
    const previousStatuses = this.meta<FeedSourceStatus[]>('sourceStatus', []);
    const context = {
      interests: this.interests(),
      uiLanguage: this.store.getPreferences().uiLanguage,
      libraryArxivIds: library.map((item) => item.arxivId).filter((id): id is string => !!id),
      libraryTitles: Object.fromEntries(library.filter((item) => item.arxivId && item.title).map((item) => [item.arxivId!, item.title!])),
      rssFeeds: settings.customRssFeeds,
      get: this.cache.get.bind(this.cache),
      now,
      report: (status: FeedSourceStatus) => statuses.push(status),
      followedTopics: this.topics.followed([...this.interests().categories, ...(this.interests().custom ?? []).map((item) => `custom:${item.id}`)]),
    };
    await this.updateLibraryCategories(context.libraryArxivIds).catch(() => undefined);
    const old = this.rawForWeek(week);
    const newItems: RawItem[] = [];
    for (const source of this.sources) {
      this.shutdown.signal.throwIfAborted();
      if (!settings.sources[source.id as keyof FeedSettings['sources']]) {
        statuses.push({ source: source.id, state: 'disabled', fetchedAt: null });
        continue;
      }
      try {
        const items = await source.load(context);
        newItems.push(...items);
        if (!statuses.some((s) => s.source === source.id && s.state === 'error'))
          statuses.push({ source: source.id, state: 'ok', fetchedAt: now.toISOString() });
      } catch (error) {
        const failure = error instanceof ProviderFailure ? error.status : undefined;
        const cached = old.filter((item) => item.source.split(',').includes(source.id));
        newItems.push(...cached);
        statuses.push({
          source: source.id,
          state: cached.length ? 'cached' : 'error',
          fetchedAt: cached.length ? (previousStatuses.find((s) => s.source === source.id)?.fetchedAt ?? null) : null,
          message: failure?.message ?? (this.store.getPreferences().uiLanguage === 'ko' ? '소스를 가져오지 못했습니다.' : 'Could not fetch source.'),
          ...(failure ? { errorCode: failure.state === 'ok' ? undefined : failure.state, retryAt: failure.retryAt } : {}),
        });
      }
    }
    this.shutdown.signal.throwIfAborted();
    const ranked = rankItems(newItems, context.interests, library, now, context.uiLanguage);
    for (const item of ranked) {
      const topicId = (item as FeedItem & { topicIds?: string[] }).topicIds?.[0];
      const topic = context.followedTopics.find((candidate) => candidate.id === topicId);
      if (topic) {
        item.reasonCode = 'topic';
        item.reasonParams = { topic: topic.label };
        item.reason = context.uiLanguage === 'ko' ? `팔로우한 주제 ${topic.label}` : `Followed topic ${topic.label}`;
      }
    }
    const retainedNews = retainNewsByField(ranked, context.interests);
    const retainedIds = new Set(retainedNews.map((item) => item.id));
    const retained = ranked.filter((item) => item.kind !== 'news' || retainedIds.has(item.id));
    if (settings.translateNewsTitles) {
      const candidates = retained.filter(
        (item) =>
          item.kind === 'news' && (context.uiLanguage === 'ko' ? /[A-Za-z]{3}/.test(item.title) && !/[가-힣]/.test(item.title) : /[가-힣]/.test(item.title)),
      );
      for (let offset = 0; offset < candidates.length; offset += 100) {
        this.shutdown.signal.throwIfAborted();
        const batch = candidates.slice(offset, offset + 100);
        try {
          const result = await this.quick.translate({
            texts: batch.map((item) => item.title),
            target: context.uiLanguage,
            source: 'auto',
            allowAiFallback: false,
          });
          batch.forEach((item, index) => {
            if (result.translations[index] && result.translations[index] !== item.title) item.titleTranslated = result.translations[index];
          });
        } catch {
          break; /* Title translation is optional during a feed refresh. */
        }
      }
    }
    if (this.images) {
      const fields = [...context.interests.categories, ...(context.interests.custom ?? []).map((item) => `custom:${item.id}`)];
      const newsImages = new Set<string>();
      for (const field of fields)
        for (const item of retainedNews.filter((candidate) => candidate.categories.includes(field)).slice(0, 8)) newsImages.add(item.id);
      for (const item of retainedNews.filter((candidate) => !fields.some((field) => candidate.categories.includes(field))).slice(0, 12))
        newsImages.add(item.id);
      const papers = retained.filter((item) => item.kind === 'paper').slice(0, 30);
      const news = retainedNews.filter((item) => newsImages.has(item.id)).slice(0, 40);
      const selected = Array.from({ length: Math.max(papers.length, news.length) }, (_, index) => [papers[index], news[index]])
        .flat()
        .filter((item): item is FeedItem => !!item);
      const fingerprints = new Map<string, string>();
      // Optional enrichment has one refresh-wide budget; it never downloads PDFs.
      const imageSignal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(20000)]);
      let cursor = 0;
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (cursor < selected.length) {
            if (imageSignal.aborted) return;
            const item = selected[cursor++]!;
            try {
              const selected = await this.images!.thumbnail(
                item as FeedItem & { imageCandidate?: string },
                this.articleReader.page.bind(this.articleReader),
                imageSignal,
              );
              item.image = selected?.image ?? null;
              if (selected) fingerprints.set(item.id, selected.fingerprint);
            } catch {
              item.image = null;
            }
          }
        }),
      );
      dropSharedImages(retained, fingerprints);
    }
    this.shutdown.signal.throwIfAborted();
    this.store.db.exec('SAVEPOINT feed_refresh');
    try {
      this.store.db.prepare('DELETE FROM feed_items WHERE week=?').run(week);
      const insert = this.store.db.prepare('INSERT INTO feed_items(week,id,data) VALUES(?,?,?)');
      for (const item of retained) {
        const { imageCandidate: _candidate, basedOn: _basedOn, ...clean } = item as FeedItem & { imageCandidate?: string; basedOn?: string };
        if (_basedOn) clean.reasonParams = { ...clean.reasonParams, basedOn: _basedOn };
        insert.run(week, item.id, JSON.stringify(clean));
      }
      this.putMeta(`generated:${week}`, now.toISOString());
      this.putMeta('sourceStatus', statuses);
      this.store.db.exec('RELEASE feed_refresh');
    } catch (error) {
      this.store.db.exec('ROLLBACK TO feed_refresh');
      this.store.db.exec('RELEASE feed_refresh');
      throw error;
    }
    if (settings.digestEnabled) await this.generateDigest(week, retained).catch(() => undefined);
    this.shutdown.signal.throwIfAborted();
    const activeFields = [...context.interests.categories, ...(context.interests.custom ?? []).map((item) => `custom:${item.id}`)];
    for (const field of activeFields) {
      const headlines = retained.filter((item) => item.categories.includes(field)).map((item) => item.title);
      this.topics.updateTrending(
        field,
        retained.filter((item) => item.categories.includes(field)),
      );
      void this.topics.suggest(field, week, headlines, this.shutdown.signal).catch(() => undefined);
    }
    return this.read(week);
  }

  private async updateLibraryCategories(ids: string[]): Promise<void> {
    const known = this.meta<Record<string, string[]>>('libraryCategories', {});
    const missing = [...new Set(ids.map((id) => id.replace(/v\d+$/, '')))].filter((id) => !(id in known)).slice(0, 100);
    if (!missing.length) return;
    const url = new URL('https://export.arxiv.org/api/query');
    url.searchParams.set('id_list', missing.join(','));
    url.searchParams.set('max_results', String(missing.length));
    for (const item of parseArxivAtom(await this.cache.get(url.href))) {
      if (item.arxivId) known[item.arxivId] = item.categories;
    }
    this.putMeta('libraryCategories', known);
  }

  private async generateDigest(week: string, items: FeedItem[]): Promise<void> {
    const prefs = this.store.getPreferences();
    const language = prefs.answerLanguage === 'auto' ? prefs.uiLanguage : prefs.answerLanguage;
    const digestKey = `${week}:${language}`;
    if (this.store.db.prepare('SELECT 1 FROM feed_digests WHERE week=?').get(digestKey) || !items.length || !this.registry) return;
    const references = items
      .slice(0, 12)
      .map((item, index) => `[${index + 1}] ${item.title} | ${item.url} | ${item.abstract.slice(0, 500)}`)
      .join('\n');
    const system =
      language === 'ko'
        ? '한국어로 이번 주 연구 동향을 짧은 문단으로 요약하세요. 주제별로 묶고 각 문단에 제공된 [번호] 인용을 넣으세요. 제공되지 않은 사실은 쓰지 마세요.'
        : `Summarize this week's research trends in ${language} in short paragraphs. Group by topic and cite supplied [numbers] in each paragraph. Do not add unsupported facts.`;
    let text = '';
    for await (const delta of this.registry.complete('digest', { system, messages: [{ role: 'user', content: references }], signal: this.shutdown.signal })) {
      if (delta.type === 'text') text += delta.text;
    }
    this.shutdown.signal.throwIfAborted();
    if (!text.trim()) return;
    const digest: FeedDigest = { week, generatedAt: this.now().toISOString(), text: text.trim() };
    this.store.db.prepare('INSERT OR IGNORE INTO feed_digests(week,data) VALUES(?,?)').run(digestKey, JSON.stringify(digest));
  }

  start(): void {
    if (isStale(this.meta(`generated:${isoWeek(this.now())}`, null), this.now(), this.settings().refreshIntervalHours)) {
      void this.refresh().catch(() => undefined);
    } else {
      this.schedule();
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.stopped) return;
    const interval = this.settings().refreshIntervalHours * 3600000;
    this.timer = setTimeout(() => {
      void this.refresh().catch(() => undefined);
    }, interval);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.shutdown.abort();
    await this.running?.catch(() => undefined);
  }
}
