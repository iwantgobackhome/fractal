import type {
  AiFeature,
  Article,
  FieldTopic,
  AiSettings,
  AiSseEvent,
  Annotation,
  FeedInterests,
  FeedItem,
  FeedResponse,
  PaperStructure,
  ReferenceEnrichment,
  ReferenceEntry,
  StructureBox,
  ModelSelection,
  NetworkStatus,
  PairedDevice,
  PairingPayload,
  ProviderModel,
  ProviderStatus as HubProviderStatus,
  UsageRecord,
  LibraryRecord,
  LibraryPatch,
  Folder,
  ReadProgress,
  HistoryEntry,
  PdfTextLayout,
  FeedSettings,
  PublicationBookmark,
  PublicationBookmarkResult,
  PublicationPdfLinkResult,
  RelatedPaper,
  RelatedPapersResponse,
} from '@fractal/shared';
import { TOKEN_HEADER } from '../lib/api';
import { t } from '../i18n';
import { FeedImages } from './feed-images';

/*
 * Client for the hub's library, AI, network and pairing endpoints. Responses
 * are reshaped into the small view models the screens use. A route the hub
 * does not serve (404/405/501) resolves to `null`, and the screen shows an
 * "unavailable" state instead of failing.
 */

export type { AiFeature, AiSettings, Article, FieldTopic, PairedDevice, ProviderModel, RelatedPaper };
export type AiChoice = ModelSelection;

export interface ProviderStatus extends HubProviderStatus {
  models: ProviderModel[];
  /** The terminal command that signs this CLI in, when the hub reports it. */
  loginCommand?: string;
}

/** Interface, translation and answer languages; mirrors the hub's /api/preferences. */
export interface Preferences {
  uiLanguage: 'ko' | 'en';
  translationLanguage: string;
  answerLanguage: string;
  onboardingCompleted: boolean;
}

export interface ProvidersResult {
  providers: ProviderStatus[];
  settings: AiSettings;
}

export interface UsageRow {
  day: string;
  provider: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageLimit {
  provider: string;
  label: string;
  usedPercent: number | null;
  resetsAt: string | null;
}

export interface UsageResult {
  rows: UsageRow[];
  limits: UsageLimit[];
}

/** One quota window of a subscription: how much is used and when it starts over. */
export interface LimitWindow {
  usedPercent: number;
  resetsAt: string | null;
}

/** The 5-hour and weekly windows of one signed-in account, as /api/ai/limits reports them. */
export interface AccountLimits {
  provider: HubProviderStatus['id'];
  accountId: string;
  label: string;
  /** The reader's own terminal login, or one Fractal keeps. */
  kind?: 'system' | 'managed';
  /** Whether this is the account the provider runs on; older hubs have one account each. */
  active?: boolean;
  windows: { fiveHour: LimitWindow | null; weekly: LimitWindow | null };
  plan?: string;
  observedAt: string | null;
  state: 'ok' | 'unavailable' | 'notLoggedIn';
  message?: string;
}

/** A Codex or Claude sign-in: the reader's own terminal login, or one Fractal keeps for them. */
export interface AiAccount {
  id: string;
  provider: HubProviderStatus['id'];
  label: string;
  kind: 'system' | 'managed';
  loggedIn: boolean;
  active: boolean;
  email?: string;
  plan?: string;
}

/** A CLI install the hub runs for the reader. */
export interface InstallJob {
  state: 'idle' | 'running' | 'done' | 'failed';
  step?: string;
  message?: string;
}

export interface AccountLogin {
  state: 'pending' | 'done' | 'failed';
  verificationUrl?: string;
  userCode?: string;
  message?: string;
}

/** An arXiv category with its names in both interface languages. */
export interface ArxivCategory {
  code: string;
  group: string;
  name: { en: string; ko: string };
}

/** A field the reader named themselves; `query` is what the hub searches for. */
export interface CustomInterest {
  id?: string;
  label: string;
  query: string;
}

export interface FeedImage {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

/** Feed items as this client reads them; older hubs send no image. */
export type FeedEntry = FeedItem & { image?: FeedImage | null };

export interface FeedSection {
  field: string;
  label?: string;
  items: FeedEntry[];
}

export type Interests = Omit<FeedInterests, 'custom'> & { custom?: CustomInterest[] };

export type NetworkResult = NetworkStatus;

export interface PairingSession {
  session: string;
  code: string;
  expiresAt: string;
}

export type ExportFormat = 'bibtex' | 'csl-json';

function windowLabel(minutes: unknown): string {
  if (typeof minutes !== 'number') return t('usage.limit');
  if (minutes >= 7 * 24 * 60) return t('usage.weekly');
  if (minutes >= 24 * 60) return t('usage.days', { count: Math.round(minutes / (24 * 60)) });
  return t('usage.hours', { count: Math.round(minutes / 60) });
}

/** Codex reports `{ primary, secondary }` quota windows; other providers report nothing yet. */
export function readLimits(limits: Record<string, unknown> | undefined): UsageLimit[] {
  const rows: UsageLimit[] = [];
  for (const [provider, value] of Object.entries(limits ?? {})) {
    if (value === null || typeof value !== 'object') continue;
    for (const window of Object.values(value as Record<string, unknown>)) {
      if (window === null || typeof window !== 'object') continue;
      const w = window as { usedPercent?: unknown; windowDurationMins?: unknown; resetsAt?: unknown };
      rows.push({
        provider,
        label: windowLabel(w.windowDurationMins),
        usedPercent: typeof w.usedPercent === 'number' ? w.usedPercent : null,
        resetsAt: typeof w.resetsAt === 'number' ? new Date(w.resetsAt * 1000).toISOString() : null,
      });
    }
  }
  return rows;
}

export function readUsage(raw: { totals: UsageRecord[]; limits?: Record<string, unknown> }): UsageResult {
  return {
    rows: raw.totals.map((t) => ({
      day: t.day,
      provider: t.provider,
      model: t.model,
      requests: t.requests,
      inputTokens: t.inputTokens ?? 0,
      outputTokens: t.outputTokens ?? 0,
    })),
    limits: readLimits(raw.limits),
  };
}

/** Parse a text/event-stream body into events; `data:` lines hold one JSON event each. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<AiSseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf('\n\n');
    while (split >= 0) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data !== '') yield JSON.parse(data) as AiSseEvent;
      split = buffer.indexOf('\n\n');
    }
  }
}

export interface ExplainRequest {
  kind: 'equation' | 'figure' | 'table' | 'text';
  page: number;
  bbox: StructureBox;
  surroundingText?: string;
  requestId?: string;
  selection?: ModelSelection;
}

export class HubApi {
  readonly feedImages = new FeedImages((path, signal) =>
    this.fetchImpl(path, {
      headers: this.token === null ? {} : { [TOKEN_HEADER]: this.token },
      credentials: 'same-origin',
      redirect: 'error',
      signal,
    }),
  );
  private relatedCache = new Map<string, RelatedPapersResponse>();
  private relatedPending = new Map<string, Promise<RelatedPapersResponse | null>>();
  private publicationPending = new Map<string, Promise<PublicationPdfLinkResult | null>>();
  constructor(
    private readonly token: string | null,
    private readonly fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
  ) {}

  private async call<T>(
    path: string,
    init: { method?: string; body?: BodyInit | object; contentType?: string; signal?: AbortSignal; preserveUnavailableErrors?: boolean } = {},
  ): Promise<T | null> {
    const method = init.method ?? 'GET';
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.token !== null) headers[TOKEN_HEADER] = this.token;
    let body: BodyInit | undefined;
    if (init.body instanceof Blob || init.body instanceof FormData || typeof init.body === 'string') {
      body = init.body;
      if (init.contentType !== undefined) headers['content-type'] = init.contentType;
    } else if (init.body !== undefined) {
      body = JSON.stringify(init.body);
      headers['content-type'] = 'application/json';
    }
    const response = await this.fetchImpl(path, { method, headers, body, credentials: 'same-origin', signal: init.signal });
    const unavailable = response.status === 404 || response.status === 405 || response.status === 501;
    if (unavailable && !init.preserveUnavailableErrors) return null;
    const payload: unknown = await response.json().catch(() => null);
    if (unavailable) {
      const error = payload !== null && typeof payload === 'object' && 'error' in payload ? payload.error : null;
      // Structured acquisition failures can be 404. Only an unusable error
      // response can be treated as compatibility with a missing Hub route.
      if (error === null || typeof error !== 'object' || !('message' in error) || typeof error.message !== 'string') return null;
    }
    if (payload !== null && typeof payload === 'object' && 'error' in payload) {
      const error = (payload as { error: { message?: string; code?: string; details?: unknown } }).error;
      throw Object.assign(new Error(error.message ?? t('errors.request')), { code: error.code, details: error.details, httpStatus: response.status });
    }
    if (!response.ok) throw new Error(t('errors.rejected'));
    return (payload as { data: T }).data;
  }

  private static providers(raw: { providers: { status: HubProviderStatus; models: ProviderModel[] }[]; settings: AiSettings }): ProvidersResult {
    return { providers: raw.providers.map((p) => ({ ...p.status, models: p.models })), settings: raw.settings };
  }

  async providers(): Promise<ProvidersResult | null> {
    const raw = await this.call<Parameters<typeof HubApi.providers>[0]>('/api/ai/providers');
    return raw === null ? null : HubApi.providers(raw);
  }

  library(): Promise<LibraryRecord[] | null> {
    return this.call('/api/library');
  }
  libraryRecord(key: string): Promise<LibraryRecord | null> {
    return this.call(`/api/library/${encodeURIComponent(key)}`);
  }
  async patchLibrary(key: string, patch: LibraryPatch): Promise<LibraryRecord | null> {
    const record = await this.call<LibraryRecord>(`/api/library/${encodeURIComponent(key)}`, { method: 'PATCH', body: patch });
    if (record && typeof window !== 'undefined') window.dispatchEvent(new Event('fractal:catalog-changed'));
    return record;
  }
  recordRead(key: string, readProgress: ReadProgress): Promise<LibraryRecord | null> {
    return this.call(`/api/papers/${encodeURIComponent(key)}/read`, { method: 'POST', body: { readProgress } });
  }
  folders(): Promise<Folder[] | null> {
    return this.call('/api/library/folders');
  }
  createFolder(name: string, parentId: string | null): Promise<Folder | null> {
    return this.call('/api/library/folders', { method: 'POST', body: { id: crypto.randomUUID(), name, parentId } });
  }
  patchFolder(id: string, patch: { name?: string; parentId?: string | null }): Promise<Folder | null> {
    return this.call(`/api/library/folders/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
  }
  deleteFolder(id: string): Promise<{ deleted: boolean } | null> {
    return this.call(`/api/library/folders/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** The hub answers with the saved settings; the provider list is fetched again. */
  async saveAiSettings(settings: AiSettings): Promise<ProvidersResult | null> {
    await this.call('/api/ai/settings', { method: 'PUT', body: settings });
    return this.providers();
  }

  async usage(): Promise<UsageResult | null> {
    const raw = await this.call<{ totals: UsageRecord[]; limits?: Record<string, unknown> }>('/api/ai/usage');
    return raw === null ? null : readUsage(raw);
  }

  network(): Promise<NetworkResult | null> {
    return this.call('/api/hub/network');
  }

  saveNetwork(enabled: Record<'lan' | 'tailscale', boolean>): Promise<NetworkResult | null> {
    return this.call('/api/hub/network', { method: 'PUT', body: enabled });
  }

  async startPairing(): Promise<PairingSession | null> {
    const raw = await this.call<{ session: string; expiresAt: string; payload: PairingPayload }>('/api/pairing/start', { method: 'POST', body: {} });
    return raw === null ? null : { session: raw.session, expiresAt: raw.expiresAt, code: raw.payload.code };
  }

  pairingQrUrl(session: string): string {
    return `/api/pairing/qr.svg?session=${encodeURIComponent(session)}`;
  }

  devices(): Promise<{ devices: PairedDevice[] } | null> {
    return this.call('/api/pairing/devices');
  }

  revokeDevice(id: string): Promise<unknown> {
    return this.call(`/api/pairing/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  annotations(paperKey: string): Promise<Annotation[] | null> {
    return this.call(`/api/papers/${encodeURIComponent(paperKey)}/annotations`);
  }

  textLayout(paperKey: string, page: number): Promise<PdfTextLayout | null> {
    return this.call(`/api/papers/${encodeURIComponent(paperKey)}/text-layout?page=${page}`);
  }

  async history(paperKey: string): Promise<HistoryEntry[] | null> {
    const result = await this.call<{ history: HistoryEntry[] }>(`/api/papers/${encodeURIComponent(paperKey)}/history`);
    return result?.history ?? null;
  }

  cancelHistory(paperKey: string, id: string): Promise<unknown> {
    return this.call(`/api/papers/${encodeURIComponent(paperKey)}/history/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} });
  }

  deleteHistory(paperKey: string, id: string): Promise<unknown> {
    return this.call(`/api/papers/${encodeURIComponent(paperKey)}/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async *ask(
    paperKey: string,
    request: { question: string; requestId: string; selectedText?: string; page?: number; rect?: StructureBox; selection?: ModelSelection },
  ): AsyncGenerator<AiSseEvent> {
    const headers: Record<string, string> = { accept: 'text/event-stream', 'content-type': 'application/json' };
    if (this.token !== null) headers[TOKEN_HEADER] = this.token;
    const response = await this.fetchImpl(`/api/papers/${encodeURIComponent(paperKey)}/ask`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      credentials: 'same-origin',
    });
    if (!response.ok || !response.body) {
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(payload?.error?.message ?? t('errors.explain'));
    }
    yield* readSse(response.body);
  }

  saveAnnotation(annotation: Annotation): Promise<{ id: string; applied: boolean; rev: number } | null> {
    return this.call(`/api/papers/${encodeURIComponent(annotation.paperKey)}/annotations`, { method: 'POST', body: annotation });
  }

  feed(week?: string): Promise<FeedResponse | null> {
    return this.call(week === undefined ? '/api/feed' : `/api/feed?week=${encodeURIComponent(week)}`);
  }

  refreshFeed(): Promise<FeedResponse | null> {
    return this.call('/api/feed/refresh', { method: 'POST', body: {} });
  }

  interests(): Promise<{ interests: Interests; suggestions: { category: string; count: number }[] } | null> {
    return this.call('/api/feed/interests');
  }

  saveInterests(interests: Interests): Promise<unknown> {
    return this.call('/api/feed/interests', { method: 'PUT', body: interests });
  }

  async saveFeedItem(id: string): Promise<PublicationBookmarkResult | null> {
    const result = await this.call<PublicationBookmarkResult>(`/api/feed/items/${encodeURIComponent(id)}/save`, { method: 'POST', body: {} });
    if (result && typeof window !== 'undefined') window.dispatchEvent(new Event('fractal:catalog-changed'));
    return result;
  }

  feedSettings(): Promise<FeedSettings | null> {
    return this.call('/api/feed/settings');
  }
  saveFeedSettings(settings: FeedSettings): Promise<FeedSettings | null> {
    return this.call('/api/feed/settings', { method: 'PUT', body: settings });
  }

  async bookmark(publication: PublicationBookmark): Promise<PublicationBookmarkResult | null> {
    const result = await this.call<PublicationBookmarkResult>('/api/library/bookmarks', { method: 'POST', body: publication });
    if (result && typeof window !== 'undefined') window.dispatchEvent(new Event('fractal:catalog-changed'));
    return result;
  }

  /** Explicit reading acquires bytes without changing the publication's saved state. */
  openPublication(publication: PublicationBookmark): Promise<PublicationPdfLinkResult | null> {
    // Send only the shared contract, even when a discovery entry includes feed fields.
    const body: PublicationBookmark = {
      title: publication.title,
      authors: publication.authors,
      url: publication.url,
      doi: publication.doi,
      arxivId: publication.arxivId,
      abstract: publication.abstract,
      publication: publication.publication,
    };
    const identity = JSON.stringify(body);
    const pending = this.publicationPending.get(identity);
    if (pending) return pending;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(Object.assign(new Error('PDF acquisition timed out'), { code: 'pdf_open_timeout' }));
        controller.abort();
      }, 90_000);
    });
    const request = Promise.race([
      this.call<PublicationPdfLinkResult>('/api/publications/open', { method: 'POST', body, signal: controller.signal, preserveUnavailableErrors: true }),
      deadline,
    ])
      .then((result) => {
        if (result === null) return null;
        if (
          !result?.hasPdf ||
          !result.paperKey ||
          result.record?.paperKey !== result.paperKey ||
          result.paper?.paperKey !== result.paperKey ||
          !result.paper.pdfSha256
        )
          throw Object.assign(new Error('The Hub did not return a readable PDF'), { code: 'pdf_open_invalid' });
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('fractal:catalog-changed'));
        return result;
      })
      .finally(() => {
        clearTimeout(timer);
        if (this.publicationPending.get(identity) === request) this.publicationPending.delete(identity);
      });
    this.publicationPending.set(identity, request);
    return request;
  }

  async linkPdf(key: string, file: File): Promise<PublicationPdfLinkResult | null> {
    const result = await this.call<PublicationPdfLinkResult>(`/api/library/${encodeURIComponent(key)}/pdf`, {
      method: 'POST',
      body: file,
      contentType: 'application/pdf',
    });
    if (result && typeof window !== 'undefined') window.dispatchEvent(new Event('fractal:catalog-changed'));
    return result;
  }

  structure(paperKey: string): Promise<PaperStructure | null> {
    return this.call(`/api/papers/${encodeURIComponent(paperKey)}/structure`);
  }

  reference(paperKey: string, n: string): Promise<{ entry: ReferenceEntry; enrichment: ReferenceEnrichment | null } | null> {
    return this.call(`/api/papers/${encodeURIComponent(paperKey)}/references/${encodeURIComponent(n)}`);
  }

  addReference(paperKey: string, n: string): Promise<{ paper: { paperKey: string } } | null> {
    return this.call(`/api/papers/${encodeURIComponent(paperKey)}/references/${encodeURIComponent(n)}/add`, { method: 'POST', body: {} });
  }

  /** Stream an explanation of a figure, table, equation or passage. */
  async *explain(paperKey: string, request: ExplainRequest, signal?: AbortSignal): AsyncGenerator<AiSseEvent> {
    const headers: Record<string, string> = { accept: 'text/event-stream', 'content-type': 'application/json' };
    if (this.token !== null) headers[TOKEN_HEADER] = this.token;
    const response = await this.fetchImpl(`/api/papers/${encodeURIComponent(paperKey)}/explain`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      credentials: 'same-origin',
      signal,
    });
    if (!response.ok || response.body === null) {
      const payload: unknown = await response.json().catch(() => null);
      const message =
        payload !== null && typeof payload === 'object' && 'error' in payload ? (payload as { error: { message?: string } }).error.message : undefined;
      throw new Error(message ?? t('errors.explain'));
    }
    yield* readSse(response.body);
  }

  async limits(): Promise<AccountLimits[] | null> {
    const raw = await this.call<{ accounts: AccountLimits[] }>('/api/ai/limits');
    return raw === null ? null : raw.accounts;
  }

  async accounts(): Promise<AiAccount[] | null> {
    const raw = await this.call<{ accounts: AiAccount[] }>('/api/ai/accounts');
    return raw === null ? null : raw.accounts;
  }

  addAccount(provider: AiAccount['provider'], label: string): Promise<AiAccount | null> {
    return this.call('/api/ai/accounts', { method: 'POST', body: { provider, label } });
  }

  accountLogin(id: string): Promise<AccountLogin | null> {
    return this.call(`/api/ai/accounts/${encodeURIComponent(id)}/login`);
  }

  retryAccountLogin(id: string): Promise<AccountLogin | null> {
    return this.call(`/api/ai/accounts/${encodeURIComponent(id)}/login`, { method: 'POST', body: {} });
  }

  updateAccount(id: string, change: { label?: string; active?: boolean }): Promise<AiAccount | null> {
    return this.call(`/api/ai/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body: change });
  }

  removeAccount(id: string): Promise<unknown> {
    return this.call(`/api/ai/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  installProvider(provider: HubProviderStatus['id']): Promise<InstallJob | null> {
    return this.call(`/api/ai/providers/${provider}/install`, { method: 'POST', body: {} });
  }

  installStatus(provider: HubProviderStatus['id']): Promise<InstallJob | null> {
    return this.call(`/api/ai/providers/${provider}/install`);
  }

  async topics(field: string): Promise<FieldTopic[] | null> {
    const raw = await this.call<{ topics: FieldTopic[] }>(`/api/feed/topics?field=${encodeURIComponent(field)}`);
    return raw === null ? null : raw.topics;
  }

  followTopic(id: string, followed: boolean): Promise<FieldTopic | null> {
    return this.call(`/api/feed/topics/${encodeURIComponent(id)}`, { method: 'PUT', body: { followed } });
  }

  addTopic(field: string, label: string): Promise<FieldTopic | null> {
    return this.call('/api/feed/topics', { method: 'POST', body: { field, label } });
  }

  removeTopic(id: string): Promise<unknown> {
    return this.call(`/api/feed/topics/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  article(url: string): Promise<Article | null> {
    return this.call(`/api/news/article?url=${encodeURIComponent(url)}`);
  }

  /** Machine translation for news text (not an AI model); `null` when the hub has no such route. */
  async quickTranslate(texts: string[], target: string): Promise<string[] | null> {
    const raw = await this.call<{ translations: string[] }>('/api/translate/quick', { method: 'POST', body: { texts, target } });
    return raw === null ? null : raw.translations;
  }

  async categories(): Promise<ArxivCategory[] | null> {
    const raw = await this.call<{ items: ArxivCategory[] }>('/api/feed/categories');
    return raw === null ? null : raw.items;
  }

  cachedRelated(paperKey: string): RelatedPapersResponse | null {
    return this.relatedCache.get(paperKey) ?? null;
  }
  related(paperKey: string): Promise<RelatedPapersResponse | null> {
    const pending = this.relatedPending.get(paperKey);
    if (pending) return pending;
    const request = this.call<RelatedPapersResponse>(`/api/papers/${encodeURIComponent(paperKey)}/related`)
      .then((result) => {
        if (result?.items.length || !this.relatedCache.has(paperKey)) {
          if (result) this.relatedCache.set(paperKey, result);
        }
        return result;
      })
      .finally(() => this.relatedPending.delete(paperKey));
    this.relatedPending.set(paperKey, request);
    return request;
  }

  preferences(): Promise<Preferences | null> {
    return this.call('/api/preferences');
  }

  savePreferences(preferences: Preferences): Promise<Preferences | null> {
    return this.call('/api/preferences', { method: 'PUT', body: preferences });
  }

  /** Upload a local PDF; the hub extracts metadata and merges duplicates. */
  uploadPdf(file: File): Promise<{ paper: { paperKey: string } } | null> {
    return this.call('/api/papers/upload', { method: 'POST', body: file, contentType: 'application/pdf' });
  }

  /** The export endpoint returns a file, so this hands back its URL for a download link. */
  exportUrl(format: ExportFormat, paperKeys?: string[]): string {
    const params = new URLSearchParams({ format });
    for (const key of paperKeys ?? []) params.append('key', key);
    return `/api/library/export?${params.toString()}`;
  }
}
