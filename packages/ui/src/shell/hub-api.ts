import type {
  AiFeature,
  AiSettings,
  AiSseEvent,
  Annotation,
  FeedInterests,
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
} from '@fractal/shared';
import { TOKEN_HEADER } from '../lib/api';
import { t } from '../i18n';

/*
 * Client for the hub's library, AI, network and pairing endpoints. Responses
 * are reshaped into the small view models the screens use. A route the hub
 * does not serve (404/405/501) resolves to `null`, and the screen shows an
 * "unavailable" state instead of failing.
 */

export type { AiFeature, AiSettings, PairedDevice, ProviderModel };
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
}

export class HubApi {
  constructor(
    private readonly token: string | null,
    private readonly fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
  ) {}

  private async call<T>(path: string, init: { method?: string; body?: BodyInit | object; contentType?: string } = {}): Promise<T | null> {
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
    const response = await this.fetchImpl(path, { method, headers, body, credentials: 'same-origin' });
    if (response.status === 404 || response.status === 405 || response.status === 501) return null;
    const payload: unknown = await response.json().catch(() => null);
    if (payload !== null && typeof payload === 'object' && 'error' in payload) {
      const error = (payload as { error: { message?: string } }).error;
      throw new Error(error.message ?? t('errors.request'));
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

  saveAnnotation(annotation: Annotation): Promise<{ id: string; applied: boolean; rev: number } | null> {
    return this.call(`/api/papers/${encodeURIComponent(annotation.paperKey)}/annotations`, { method: 'POST', body: annotation });
  }

  feed(week?: string): Promise<FeedResponse | null> {
    return this.call(week === undefined ? '/api/feed' : `/api/feed?week=${encodeURIComponent(week)}`);
  }

  refreshFeed(): Promise<FeedResponse | null> {
    return this.call('/api/feed/refresh', { method: 'POST', body: {} });
  }

  interests(): Promise<{ interests: FeedInterests; suggestions: { category: string; count: number }[] } | null> {
    return this.call('/api/feed/interests');
  }

  saveInterests(interests: FeedInterests): Promise<unknown> {
    return this.call('/api/feed/interests', { method: 'PUT', body: interests });
  }

  saveFeedItem(id: string): Promise<{ paperKey: string } | null> {
    return this.call(`/api/feed/items/${encodeURIComponent(id)}/save`, { method: 'POST', body: {} });
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
