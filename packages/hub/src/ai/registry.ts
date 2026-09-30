import type { AiFeature, AiSettings, ModelSelection, ProviderId, UsageRecord } from '@fractal/shared';
import { aiSettingsSchema } from '@fractal/shared';
import { invalidInput } from '../store/index';
import type { AiProvider, CompleteInput, ProviderDelta, SettingsStore } from './provider';
import { DEFAULT_SETTINGS } from './settings';
import type { UsageStore } from './usage';

export class ProviderRegistry {
  onUsageRecorded: ((provider: ProviderId) => void) | null = null;
  private readonly running = new Map<ProviderId, number>();
  private settings: AiSettings | null = null;
  private records: UsageRecord[] = [];
  private loaded = false;
  private persist = Promise.resolve();
  constructor(
    private readonly providers: AiProvider[],
    private readonly store: SettingsStore,
    private readonly now = () => new Date(),
    private readonly usageStore?: UsageStore,
  ) {}
  private async loadUsage(): Promise<void> {
    if (!this.loaded) {
      this.records = (await this.usageStore?.read()) ?? [];
      this.loaded = true;
    }
  }
  async getSettings(): Promise<AiSettings> {
    return (this.settings ??= (await this.store.read()) ?? DEFAULT_SETTINGS);
  }
  async putSettings(value: AiSettings): Promise<AiSettings> {
    const parsed = aiSettingsSchema.parse(value);
    for (const selection of [parsed.default, ...Object.values(parsed.overrides)])
      if (selection && !this.providers.some((p) => p.id === selection.provider)) throw invalidInput('Unknown provider');
    await this.store.write(parsed);
    this.settings = parsed;
    return parsed;
  }
  async select(feature: AiFeature, explicit?: ModelSelection): Promise<{ provider: AiProvider; selection: ModelSelection }> {
    const settings = await this.getSettings();
    const selection = explicit ?? settings.overrides[feature] ?? settings.default;
    const provider = this.providers.find((p) => p.id === selection.provider);
    if (!provider) throw invalidInput('Unknown provider');
    if (
      !(await provider.listModels()).some((m) => m.id === selection.model) &&
      !(provider.id === 'claude' && /^claude-[a-z0-9-]{3,100}$/.test(selection.model))
    )
      throw invalidInput('Unknown model for provider');
    const status = await provider.status();
    if (!status.installed || !status.loggedIn)
      throw Object.assign(new Error(`${provider.id} is unavailable: ${status.detail ?? 'sign in first'}`), { code: 'AUTH_REQUIRED' });
    return { provider, selection };
  }
  async *complete(
    feature: AiFeature,
    input: Omit<CompleteInput, 'model' | 'effort'>,
    explicit?: ModelSelection,
  ): AsyncIterable<ProviderDelta & { provider?: ProviderId; model?: string; durationMs?: number }> {
    const { provider, selection } = await this.select(feature, explicit);
    this.running.set(provider.id, (this.running.get(provider.id) ?? 0) + 1);
    const start = Date.now();
    let inTokens: number | null = null;
    let outTokens: number | null = null;
    try {
      for await (const delta of provider.complete({ ...input, model: selection.model, effort: selection.effort })) {
        if (delta.type === 'usage') {
          inTokens = delta.inputTokens;
          outTokens = delta.outputTokens;
        }
        yield delta;
      }
    } finally {
      this.running.set(provider.id, Math.max(0, (this.running.get(provider.id) ?? 1) - 1));
      await this.recordUsage(provider.id, selection.model, inTokens, outTokens, Date.now() - start);
    }
  }
  /** Records a request handled by an existing provider-native path without changing its prompts or result. */
  async recordUsage(provider: ProviderId, model: string, inputTokens: number | null, outputTokens: number | null, durationMs: number): Promise<void> {
    const day = this.now().toISOString().slice(0, 10);
    this.persist = this.persist
      .catch(() => {})
      .then(async () => {
        await this.loadUsage();
        this.records.push({ day, provider, model, requests: 1, inputTokens, outputTokens, durationMs });
        await this.usageStore?.write(this.records);
      });
    await this.persist;
    this.onUsageRecorded?.(provider);
  }
  async waitIdle(provider: ProviderId, timeoutMs = 30000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while ((this.running.get(provider) ?? 0) > 0) {
      if (Date.now() > until) throw Object.assign(new Error('Provider is still processing a request'), { code: 'BUSY' });
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  async providersInfo() {
    return Promise.all(this.providers.map(async (p) => ({ status: await p.status(), models: await p.listModels() })));
  }
  async usage() {
    await this.persist;
    await this.loadUsage();
    const byKey = new Map<string, UsageRecord>();
    for (const row of this.records) {
      const key = `${row.day}\0${row.provider}\0${row.model}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...row });
      } else {
        existing.requests++;
        existing.durationMs += row.durationMs;
        existing.inputTokens = sum(existing.inputTokens, row.inputTokens);
        existing.outputTokens = sum(existing.outputTokens, row.outputTokens);
      }
    }
    const limits: Partial<Record<ProviderId, Record<string, unknown> | null>> = {};
    for (const provider of this.providers) limits[provider.id] = await provider.usage();
    return { totals: [...byKey.values()], limits };
  }
}
function sum(a: number | null, b: number | null) {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}
