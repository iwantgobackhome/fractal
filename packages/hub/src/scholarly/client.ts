import type { PublicationProvider, PublicationProviderStatus } from '@fractal/shared';

const origins: Record<PublicationProvider, string> = {
  openAlex: 'https://api.openalex.org',
  crossref: 'https://api.crossref.org',
  semanticScholar: 'https://api.semanticscholar.org',
};
type Gate = { tail: Promise<void>; queued: number; next: number; cooldown: number; failure?: PublicationProviderStatus };
const sharedGates = new Map<PublicationProvider, Gate>();
export class ProviderFailure extends Error {
  constructor(readonly status: PublicationProviderStatus) {
    super(status.message ?? `${status.provider}: ${status.state}`);
  }
}
export function retryAfterMs(value: string | null, now = Date.now()): number {
  const seconds = value && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : value ? Date.parse(value) - now : 30_000;
  return Math.max(1000, Math.min(60_000, Number.isFinite(seconds) ? seconds : 30_000));
}
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let cancel!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await abortable(
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
      signal,
    );
  } finally {
    clearTimeout(timer);
  }
}
/** Shared provider serialization/cooldowns. Secrets go only to allowlisted HTTPS hosts;
 * redirects cannot forward credentials. Each request/body read has an independent bound. */
export class ScholarlyClient {
  private readonly gates: Map<PublicationProvider, Gate>;
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly options: { intervalMs?: number; timeoutMs?: number; now?: () => number } = {},
  ) {
    this.gates = options.intervalMs === 0 ? new Map() : sharedGates;
  }
  async text(provider: PublicationProvider, input: string, parent?: AbortSignal, extra: Record<string, string> = {}, body?: string): Promise<string> {
    const url = new URL(input);
    if (url.origin !== origins[provider] || url.username || url.password || url.searchParams.has('api_key'))
      throw new Error('Provider URL must use an allowlisted origin and header authentication');
    const now = this.options.now ?? Date.now;
    const gate = this.gates.get(provider) ?? { tail: Promise.resolve(), queued: 0, next: 0, cooldown: 0 };
    this.gates.set(provider, gate);
    if (gate.cooldown > now()) throw new ProviderFailure({ ...gate.failure!, retryAt: new Date(gate.cooldown).toISOString() });
    if (gate.queued >= 16) throw new ProviderFailure({ provider, state: 'rate_limited', message: `${provider} request queue is full` });
    const signal = parent
      ? AbortSignal.any([parent, AbortSignal.timeout(this.options.timeoutMs ?? 5000)])
      : AbortSignal.timeout(this.options.timeoutMs ?? 5000);
    gate.queued++;
    const work = gate.tail
      .then(async () => {
        signal.throwIfAborted();
        if (gate.cooldown > now()) throw new ProviderFailure({ ...gate.failure!, retryAt: new Date(gate.cooldown).toISOString() });
        await delay(gate.next - now(), signal);
        gate.next = now() + (this.options.intervalMs ?? 1000);
        const headers: Record<string, string> = { 'User-Agent': 'News-Papers/0.1 (personal research reader)', ...extra };
        const email = process.env.FRACTAL_CONTACT_EMAIL?.trim();
        if (email && /^[^\s@]+@[^\s@]+$/.test(email)) {
          headers['User-Agent'] = `News-Papers/0.1 (mailto:${email})`;
          if (provider === 'crossref') url.searchParams.set('mailto', email);
        }
        if (provider === 'openAlex' && process.env.OPENALEX_API_KEY) headers.Authorization = `Bearer ${process.env.OPENALEX_API_KEY}`;
        if (provider === 'semanticScholar' && process.env.SEMANTIC_SCHOLAR_API_KEY) headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
        if (body) headers['Content-Type'] = 'application/json';
        const response = await abortable(this.fetcher(url.href, { headers, body, method: body ? 'POST' : 'GET', redirect: 'error', signal }), signal);
        if (!response.ok) {
          const exhausted = provider === 'openAlex' && response.headers.get('x-ratelimit-remaining') === '0';
          const state: PublicationProviderStatus['state'] = exhausted
            ? 'budget_exhausted'
            : response.status === 429
              ? 'rate_limited'
              : [401, 403, 409].includes(response.status)
                ? 'auth_required'
                : response.status === 404
                  ? 'not_found'
                  : 'error';
          const status: PublicationProviderStatus = { provider, state, httpStatus: response.status, message: `${provider} returned HTTP ${response.status}` };
          if (response.status === 429 || exhausted) {
            gate.cooldown = now() + retryAfterMs(response.headers.get('retry-after'), now());
            status.retryAt = new Date(gate.cooldown).toISOString();
            gate.failure = status;
          }
          await response.body?.cancel().catch(() => {});
          throw new ProviderFailure(status);
        }
        if (provider === 'openAlex' && response.headers.get('x-ratelimit-remaining') === '0') {
          const reset = Number(response.headers.get('x-ratelimit-reset'));
          gate.cooldown = now() + (Number.isFinite(reset) && reset > 0 ? Math.min(86400, reset) * 1000 : 60000);
          gate.failure = {
            provider,
            state: 'budget_exhausted',
            message: 'OpenAlex daily request budget exhausted',
            retryAt: new Date(gate.cooldown).toISOString(),
          };
        }
        const reader = response.body?.getReader();
        if (!reader) return '';
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const part = await abortable(reader.read(), signal);
            if (part.done) break;
            length += part.value.byteLength;
            if (length > 5_000_000) throw new ProviderFailure({ provider, state: 'error', message: `${provider} response exceeds 5 MB` });
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        return Buffer.concat(chunks).toString('utf8');
      })
      .finally(() => {
        gate.queued--;
      });
    gate.tail = work.then(
      () => {},
      () => {},
    );
    try {
      return await abortable(work, signal);
    } catch (error) {
      if (error instanceof ProviderFailure) throw error;
      if (parent?.aborted && parent.reason?.name !== 'TimeoutError') throw parent.reason;
      throw new ProviderFailure({
        provider,
        state: signal.aborted ? 'timeout' : 'error',
        message: signal.aborted ? `${provider} request budget expired` : `${provider} request failed`,
      });
    }
  }
  async json(provider: PublicationProvider, url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const text = await this.text(provider, url, signal);
    try {
      const value = JSON.parse(text) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value as Record<string, unknown>;
    } catch {
      throw new ProviderFailure({ provider, state: 'error', message: `${provider} returned invalid metadata` });
    }
  }
}
