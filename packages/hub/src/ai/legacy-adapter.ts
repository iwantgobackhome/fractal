import type { Connection, PaperChat, PaperQuestionInput, PaperQuestionOutput, TranslationInput, TranslationOutput, TranslationPageInput, TranslationPageOutput, Translator, Usage } from '@fractal/shared';
import type { ProviderRegistry } from './registry';
import type { ModelSelection } from '@fractal/shared';
import { decodeTranslationText, decodeTranslationPageText, translationPrompt, translationPagePrompt } from '../translation/prompt';

const emptyUsage: Usage = { inputTokens: null, outputTokens: null, limits: null, observedAt: null };
/** Keeps the existing chat and translation endpoints while selecting their provider through the registry. */
export class RegistryLegacyAdapter implements Translator, PaperChat {
  constructor(private readonly registry: ProviderRegistry, private readonly codex: Translator & PaperChat) {}
  private async selection(feature: 'chat' | 'translate', model: string): Promise<ModelSelection> {
    const settings = await this.registry.getSettings();
    const preferred = settings.overrides[feature] ?? settings.default;
    const providers = await this.registry.providersInfo();
    const matching = providers.filter(p => p.models.some(m => m.id === model));
    if (!matching.length && /^claude-[a-z0-9-]+$/.test(model)) return { ...preferred, provider: 'claude', model };
    if (!matching.length) return { ...preferred, model };
    return { ...preferred, provider: matching.find(p => p.status.id === preferred.provider)?.status.id ?? matching[0].status.id, model };
  }
  async connection(): Promise<Connection> {
    const providers = await this.registry.providersInfo();
    const available = providers.filter(p => p.status.loggedIn);
    const modelIds = [...new Set(available.flatMap(p => p.models.map(m => m.id)))];
    const settings = await this.registry.getSettings();
    return { status: available.length ? 'subscription' : 'signed_out', modelIds, defaultModelId: modelIds.includes(settings.default.model) ? settings.default.model : modelIds[0] ?? null, limits: null };
  }
  async ask(input: PaperQuestionInput): Promise<PaperQuestionOutput> {
    const selection = await this.selection('chat', input.modelId);
    if (selection.provider === 'codex') {
      const started = Date.now(); let output: PaperQuestionOutput | undefined;
      try { output = await this.codex.ask(input); return output; }
      finally { await this.registry.recordUsage('codex', input.modelId, output?.usage.inputTokens ?? null, output?.usage.outputTokens ?? null, Date.now() - started).catch(() => {}); }
    }
    let text = '', inputTokens: number | null = null, outputTokens: number | null = null;
    for await (const delta of this.registry.complete('chat', { system: input.instructions, messages: [...input.history.flatMap(h => [{ role: 'user' as const, content: h.question }, { role: 'assistant' as const, content: h.answer }]), { role: 'user', content: input.question }], signal: input.signal }, selection)) {
      if (delta.type === 'text') { text += delta.text; input.onText?.(text); }
      else { inputTokens = delta.inputTokens; outputTokens = delta.outputTokens; }
    }
    return { text, usage: { inputTokens, cachedInputTokens: null, outputTokens } };
  }
  async forget(conversationId: string): Promise<void> { await this.codex.forget(conversationId); }
  async translate(input: TranslationInput): Promise<TranslationOutput> {
    const selection = await this.selection('translate', input.modelId);
    if (selection.provider === 'codex') {
      const started = Date.now(); let output: TranslationOutput | undefined;
      try { output = await this.codex.translate(input); return output; }
      finally { await this.registry.recordUsage('codex', input.modelId, output?.usage.inputTokens ?? null, output?.usage.outputTokens ?? null, Date.now() - started).catch(() => {}); }
    }
    let text = '', usage = { ...emptyUsage };
    for await (const delta of this.registry.complete('translate', { system: translationPrompt(input), messages: [], signal: input.signal }, selection)) {
      if (delta.type === 'text') text += delta.text; else usage = { ...usage, inputTokens: delta.inputTokens, outputTokens: delta.outputTokens, observedAt: new Date().toISOString() };
    }
    return { text: decodeTranslationText(text, input.block.blockId).text, usage };
  }
  async translatePage(input: TranslationPageInput): Promise<TranslationPageOutput> {
    const selection = await this.selection('translate', input.modelId);
    if (selection.provider === 'codex') {
      const started = Date.now(); let output: TranslationPageOutput | undefined;
      try { output = await this.codex.translatePage(input); return output; }
      finally { await this.registry.recordUsage('codex', input.modelId, output?.usage.inputTokens ?? null, output?.usage.outputTokens ?? null, Date.now() - started).catch(() => {}); }
    }
    let text = '', usage = { ...emptyUsage };
    for await (const delta of this.registry.complete('translate', { system: translationPagePrompt(input), messages: [], signal: input.signal }, selection)) {
      if (delta.type === 'text') text += delta.text; else usage = { ...usage, inputTokens: delta.inputTokens, outputTokens: delta.outputTokens, observedAt: new Date().toISOString() };
    }
    const results = decodeTranslationPageText(text, new Set(input.paragraphs.map(p => p.number)));
    return { results, usage };
  }
  async disconnect(): Promise<void> { await this.codex.disconnect(); }
}
