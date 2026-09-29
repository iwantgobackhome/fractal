import type { FeedDigest, FeedInterests, FeedItem, FeedResponse, FeedSettings, FeedSourceStatus } from '@fractal/shared';
import { feedWeekSchema } from '@fractal/shared';
import type { ProviderRegistry } from '../ai/registry';
import type { SqlitePaperStore } from '../store/sqlite';
import { invalidInput, notFound } from '../store/errors';
import { ingestUrl } from '../ingest/index';
import type { PaperAcquirer } from '../api/index';
import { CachedFetcher, arxivSource, huggingFaceSource, newsSource, recommendationSource, parseArxivAtom, type FeedSource, type RawItem } from './sources';
import { rankItems } from './ranking';

const DEFAULT_INTERESTS: FeedInterests = { categories: [], topics: [], authors: [] };
const DEFAULT_SETTINGS: FeedSettings = {
  sources: { arxiv: true, huggingFace: true, news: true, recommendations: true },
  customRssFeeds: [],
  digestEnabled: false,
  refreshIntervalHours: 6,
};
const SOURCES = [arxivSource, huggingFaceSource, newsSource, recommendationSource];

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
  ) {
    this.cache = new CachedFetcher(store, fetcher);
  }

  private meta<T>(key: string, fallback: T): T {
    const row = this.store.db.prepare('SELECT data FROM feed_meta WHERE key=?').get(key) as MetaRow | undefined;
    return row ? (JSON.parse(row.data) as T) : fallback;
  }

  private putMeta(key: string, value: unknown): void {
    this.store.db.prepare('INSERT INTO feed_meta(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(key, JSON.stringify(value));
  }

  interests(): FeedInterests {
    return this.meta('interests', DEFAULT_INTERESTS);
  }
  settings(): FeedSettings {
    return this.meta('settings', DEFAULT_SETTINGS);
  }
  putInterests(value: FeedInterests): FeedInterests {
    this.putMeta('interests', value);
    return value;
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
      .map(({ score: _score, reason: _reason, inLibrary: _inLibrary, ...item }) => item);
  }

  private status(): FeedSourceStatus[] {
    return this.meta('sourceStatus', []);
  }

  read(week = isoWeek(this.now())): FeedResponse {
    if (!feedWeekSchema.safeParse(week).success) throw invalidInput('주차 형식은 YYYY-Www이어야 합니다.');
    const items = rankItems(this.rawForWeek(week), this.interests(), this.store.listLibrary(), this.now());
    const papers = items.filter((item) => item.kind === 'paper');
    const byField = this.interests().categories.map((field) => ({ field, items: papers.filter((item) => item.categories.includes(field)).slice(0, 20) }));
    const digest = this.store.db.prepare('SELECT data FROM feed_digests WHERE week=?').get(week) as MetaRow | undefined;
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
        recommended: papers.filter((item) => item.source.includes('recommendations') && !item.inLibrary).slice(0, 30),
      },
      sourceStatus: week === isoWeek(this.now()) ? this.status() : [],
      ...(digest && this.settings().digestEnabled ? { digest: JSON.parse(digest.data) as FeedDigest } : {}),
    };
  }

  async save(id: string): Promise<{ paperKey: string }> {
    const item = this.rawForWeek(isoWeek(this.now())).find((candidate) => candidate.id === id);
    if (!item || item.kind !== 'paper') throw notFound('저장할 논문을 찾을 수 없습니다.');
    const input = item.arxivId ?? item.doi ?? item.url;
    const paper = await ingestUrl(this.store, input, this.acquirer);
    this.store.patchLibrary(paper.paperKey, {
      title: item.title,
      abstract: item.abstract || null,
      authors: item.authors.map((name) => {
        const parts = name.trim().split(/\s+/);
        return { given: parts.slice(0, -1).join(' '), family: parts.at(-1) ?? name };
      }),
      doi: item.doi,
      arxivId: item.arxivId,
    });
    return { paperKey: paper.paperKey };
  }

  async refresh(): Promise<FeedResponse> {
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
    const context = {
      interests: this.interests(),
      libraryArxivIds: library.map((item) => item.arxivId).filter((id): id is string => !!id),
      rssFeeds: settings.customRssFeeds,
      get: this.cache.get.bind(this.cache),
      now,
      report: (status: FeedSourceStatus) => statuses.push(status),
    };
    await this.updateLibraryCategories(context.libraryArxivIds).catch(() => undefined);
    const old = this.rawForWeek(week);
    const newItems: RawItem[] = [];
    for (const source of this.sources) {
      if (!settings.sources[source.id as keyof FeedSettings['sources']]) {
        statuses.push({ source: source.id, state: 'disabled', fetchedAt: null });
        continue;
      }
      try {
        const items = await source.load(context);
        newItems.push(...items);
        statuses.push({ source: source.id, state: 'ok', fetchedAt: now.toISOString() });
      } catch {
        const cached = old.filter((item) => item.source.split(',').includes(source.id));
        newItems.push(...cached);
        statuses.push({
          source: source.id,
          state: cached.length ? 'cached' : 'error',
          fetchedAt: cached.length ? this.meta(`generated:${week}`, null) : null,
          message: '소스를 가져오지 못했습니다.',
        });
      }
    }
    const ranked = rankItems(newItems, context.interests, library, now);
    this.store.db.exec('SAVEPOINT feed_refresh');
    try {
      this.store.db.prepare('DELETE FROM feed_items WHERE week=?').run(week);
      const insert = this.store.db.prepare('INSERT INTO feed_items(week,id,data) VALUES(?,?,?)');
      for (const item of ranked) insert.run(week, item.id, JSON.stringify(item));
      this.putMeta(`generated:${week}`, now.toISOString());
      this.putMeta('sourceStatus', statuses);
      this.store.db.exec('RELEASE feed_refresh');
    } catch (error) {
      this.store.db.exec('ROLLBACK TO feed_refresh');
      this.store.db.exec('RELEASE feed_refresh');
      throw error;
    }
    if (settings.digestEnabled) await this.generateDigest(week, ranked).catch(() => undefined);
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
    if (this.store.db.prepare('SELECT 1 FROM feed_digests WHERE week=?').get(week) || !items.length || !this.registry) return;
    const references = items
      .slice(0, 12)
      .map((item, index) => `[${index + 1}] ${item.title} | ${item.url} | ${item.abstract.slice(0, 500)}`)
      .join('\n');
    const system =
      '한국어로 이번 주 연구 동향을 짧은 문단으로 요약하세요. 주제별로 묶고 각 문단에 제공된 [번호] 인용을 넣으세요. 제공되지 않은 사실은 쓰지 마세요.';
    let text = '';
    for await (const delta of this.registry.complete('digest', { system, messages: [{ role: 'user', content: references }] })) {
      if (delta.type === 'text') text += delta.text;
    }
    if (!text.trim()) return;
    const digest: FeedDigest = { week, generatedAt: this.now().toISOString(), text: text.trim() };
    this.store.db.prepare('INSERT OR IGNORE INTO feed_digests(week,data) VALUES(?,?)').run(week, JSON.stringify(digest));
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
    await this.running?.catch(() => undefined);
  }
}
