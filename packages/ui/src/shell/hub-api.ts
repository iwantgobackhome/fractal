import { TOKEN_HEADER } from '../lib/api';

/*
 * Client for the hub endpoints added in W1 (AI providers, network and pairing,
 * library import and export). Those endpoints are built in parallel by other
 * tasks, so every call resolves to `null` when the hub does not have the route
 * yet (404/405), and screens show an "unavailable" state instead of failing.
 * The view types below mirror the task specs; they are replaced by the shared
 * zod contracts at integration.
 */

export interface ProviderModel {
  id: string;
  label?: string;
  efforts?: string[];
}

export interface ProviderStatus {
  id: 'codex' | 'claude';
  installed: boolean;
  loggedIn: boolean;
  version?: string | null;
  account?: string | null;
  models: ProviderModel[];
}

export type AiFeature = 'chat' | 'translate' | 'explain' | 'digest';

export interface AiChoice {
  provider: 'codex' | 'claude';
  model: string;
  effort?: string | null;
}

export interface AiSettings {
  default: AiChoice;
  overrides: Partial<Record<AiFeature, AiChoice>>;
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

export interface UsageResult {
  rows: UsageRow[];
  limits?: { provider: string; label: string; usedPercent: number | null; resetsAt: string | null }[];
}

export interface NetworkAddress {
  kind: 'loopback' | 'lan' | 'tailscale';
  address: string;
  enabled: boolean;
}

export interface NetworkResult {
  port: number;
  addresses: NetworkAddress[];
}

export interface PairingSession {
  session: string;
  code: string;
  expiresAt: string;
  payload: unknown;
}

export interface PairedDevice {
  id: string;
  name: string;
  platform: string;
  createdAt: string;
  lastSeen: string | null;
}

export type ExportFormat = 'bibtex' | 'csl-json';

export class HubUnavailable extends Error {}

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
      throw new Error(error.message ?? '요청을 처리하지 못했습니다.');
    }
    if (!response.ok) throw new Error('요청이 거절되었습니다.');
    return (payload as { data: T }).data;
  }

  providers(): Promise<ProvidersResult | null> {
    return this.call('/api/ai/providers');
  }

  saveAiSettings(settings: AiSettings): Promise<ProvidersResult | null> {
    return this.call('/api/ai/settings', { method: 'PUT', body: settings });
  }

  usage(): Promise<UsageResult | null> {
    return this.call('/api/ai/usage');
  }

  network(): Promise<NetworkResult | null> {
    return this.call('/api/hub/network');
  }

  saveNetwork(enabled: Record<'lan' | 'tailscale', boolean>): Promise<NetworkResult | null> {
    return this.call('/api/hub/network', { method: 'PUT', body: enabled });
  }

  startPairing(): Promise<PairingSession | null> {
    return this.call('/api/pairing/start', { method: 'POST', body: {} });
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

  /** Upload a local PDF; the hub extracts metadata and merges duplicates. */
  uploadPdf(file: File): Promise<{ paper: { paperKey: string } } | null> {
    return this.call('/api/papers/upload', { method: 'POST', body: file, contentType: 'application/pdf' });
  }

  /** The export endpoint returns a file, so this hands back its URL for a download link. */
  exportUrl(format: ExportFormat, paperKeys?: string[]): string {
    const params = new URLSearchParams({ format });
    if (paperKeys !== undefined && paperKeys.length > 0) params.set('papers', paperKeys.join(','));
    return `/api/library/export?${params.toString()}`;
  }
}
