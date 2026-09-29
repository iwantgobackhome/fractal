import type { AiFeature, ModelSelection, ProviderId, ProviderModel, ProviderStatus } from '@fractal/shared';

export interface AiMessage { role: 'user' | 'assistant'; content: string }
export interface CompleteInput { system: string; messages: AiMessage[]; images?: string[]; model: string; effort?: ModelSelection['effort']; signal?: AbortSignal }
export type ProviderDelta = { type: 'text'; text: string } | { type: 'usage'; inputTokens: number | null; outputTokens: number | null };
export interface AiProvider {
  readonly id: ProviderId;
  status(): Promise<ProviderStatus>;
  listModels(): Promise<ProviderModel[]>;
  complete(input: CompleteInput): AsyncIterable<ProviderDelta>;
  usage(): Promise<Record<string, unknown> | null>;
}
export interface SettingsStore { read(): Promise<AiSettingsValue | null>; write(value: AiSettingsValue): Promise<void> }
export interface AiSettingsValue { default: ModelSelection; overrides: Partial<Record<AiFeature, ModelSelection>> }
