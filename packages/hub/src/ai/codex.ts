import type { ProviderModel, ProviderStatus, PaperChat, Translator } from '@fractal/shared';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AiProvider, CompleteInput, ProviderDelta } from './provider';
import { resolveCodexExecutable } from '../codex/runtime';

const run = promisify(execFile);

export class CodexProvider implements AiProvider {
  readonly id = 'codex' as const;
  constructor(private readonly translator: Translator & PaperChat, private readonly versionProbe = async () => (await run(await resolveCodexExecutable(), ['--version'], { windowsHide: true, timeout: 10_000 })).stdout.trim()) {}
  async status(): Promise<ProviderStatus> {
    const state = await this.translator.connection();
    let version: string | null = null;
    if (state.status !== 'missing') try { version = await this.versionProbe(); } catch { /* status remains best effort */ }
    return { id: this.id, installed: state.status !== 'missing', loggedIn: state.status === 'subscription', version, detail: state.status };
  }
  async listModels(): Promise<ProviderModel[]> {
    const state = await this.translator.connection();
    const ids = state.modelIds.length ? state.modelIds : ['gpt-6-sol'];
    return ids.map(id => ({ id, label: id, efforts: ['low', 'medium', 'high', 'xhigh'] }));
  }
  async usage(): Promise<Record<string, unknown> | null> { return (await this.translator.connection()).limits; }
  async *complete(input: CompleteInput): AsyncIterable<ProviderDelta> {
    if (input.images?.length) throw Object.assign(new Error('Codex app-server image input is not supported in this integration'), { code: 'INVALID_INPUT' });
    const queue: ProviderDelta[] = []; let wake: (() => void) | undefined; let done = false; let error: unknown;
    let previous = '';
    const push = (delta: ProviderDelta) => { queue.push(delta); wake?.(); wake = undefined; };
    void this.translator.ask({ conversationId: randomUUID(), modelId: input.model, effort: input.effort, instructions: input.system, history: [], question: input.messages.map(m => `${m.role}: ${m.content}`).join('\n\n'), signal: input.signal,
      onText: value => { const addition = value.startsWith(previous) ? value.slice(previous.length) : value; previous = value; if (addition) push({ type: 'text', text: addition }); },
    }).then(out => {
      if (out.text.startsWith(previous) && out.text.length > previous.length) push({ type: 'text', text: out.text.slice(previous.length) });
      push({ type: 'usage', inputTokens: out.usage.inputTokens, outputTokens: out.usage.outputTokens });
    }, cause => { error = cause; }).finally(() => { done = true; wake?.(); });
    while (!done || queue.length) {
      if (queue.length) { yield queue.shift()!; continue; }
      await new Promise<void>(resolve => { wake = resolve; });
    }
    if (error) throw error;
  }
}
