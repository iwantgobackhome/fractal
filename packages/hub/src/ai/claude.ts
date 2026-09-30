import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import type { ProviderModel, ProviderStatus } from '@fractal/shared';
import type { AiProvider, CompleteInput, ProviderDelta } from './provider';

const run = promisify(execFile);
export type SpawnClaude = (args: string[]) => ChildProcessWithoutNullStreams;
export type ProbeClaude = (args: string[]) => Promise<{ stdout: string }>;
const models: ProviderModel[] = [
  ...['opus', 'sonnet', 'haiku'].map((id) => ({ id, label: `Claude ${id}` })),
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
];
function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function count(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Claude emits text deltas only when partial messages are requested; final messages are fallback. */
export function parseClaudeEvent(value: unknown): ProviderDelta[] {
  const event = record(value);
  if (!event) return [];
  if (event.type === 'stream_event') {
    const inner = record(event.event),
      delta = record(inner?.delta);
    if (inner?.type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string') return [{ type: 'text', text: delta.text }];
    return [];
  }
  if (event.type === 'result') {
    const usage = record(event.usage);
    return [{ type: 'usage', inputTokens: count(usage?.input_tokens), outputTokens: count(usage?.output_tokens) }];
  }
  return [];
}

export class ClaudeProvider implements AiProvider {
  readonly id = 'claude' as const;
  constructor(
    private readonly spawnProcess: SpawnClaude = (args) =>
      spawn(process.platform === 'win32' ? 'claude.exe' : 'claude', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false }),
    private readonly probe: ProbeClaude = (args) => run(process.platform === 'win32' ? 'claude.exe' : 'claude', args, { windowsHide: true, timeout: 10_000 }),
  ) {}
  async status(): Promise<ProviderStatus> {
    let version: string;
    try {
      version = (await this.probe(['--version'])).stdout.trim();
    } catch {
      return { id: this.id, installed: false, loggedIn: false, version: null, detail: 'Claude CLI is not installed', loginCommand: 'claude auth login' };
    }
    try {
      const auth = record(JSON.parse((await this.probe(['auth', 'status'])).stdout));
      return {
        id: this.id,
        installed: true,
        loggedIn: auth?.loggedIn === true,
        version,
        detail: auth?.loggedIn === true ? undefined : 'Run claude auth login',
        loginCommand: 'claude auth login',
      };
    } catch {
      return { id: this.id, installed: true, loggedIn: false, version, detail: 'Could not confirm Claude login', loginCommand: 'claude auth login' };
    }
  }
  async listModels(): Promise<ProviderModel[]> {
    return models;
  }
  async usage(): Promise<Record<string, unknown> | null> {
    return null;
  }
  async *complete(input: CompleteInput): AsyncIterable<ProviderDelta> {
    if (input.images?.length) throw Object.assign(new Error('Claude CLI image input is not supported in this integration'), { code: 'INVALID_INPUT' });
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model',
      input.model,
      '--tools',
      '',
      '--safe-mode',
      '--no-session-persistence',
      '--disable-slash-commands',
      '--strict-mcp-config',
    ];
    if (input.effort) args.push('--effort', input.effort);
    const child = this.spawnProcess(args);
    const abort = () => child.kill();
    if (input.signal?.aborted) {
      abort();
    } else {
      input.signal?.addEventListener('abort', abort, { once: true });
    }
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-2000);
    });
    const prompt = `${input.system}\n\n${input.messages.map((m) => `${m.role}: ${m.content}`).join('\n\n')}`;
    child.stdin.end(prompt);
    let streamed = false,
      fallback = '',
      reported = false,
      failed = false;
    try {
      for await (const line of createInterface({ input: child.stdout })) {
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        const obj = record(event);
        if (obj?.type === 'assistant') {
          const message = record(obj.message);
          const content = Array.isArray(message?.content) ? message.content : [];
          fallback = content
            .map((part) => record(part)?.text)
            .filter((v): v is string => typeof v === 'string')
            .join('');
        }
        if (obj?.type === 'result' && obj.is_error === true) failed = true;
        for (const delta of parseClaudeEvent(event)) {
          if (delta.type === 'text') streamed = true;
          if (delta.type === 'usage') reported = true;
          yield delta;
        }
      }
      const exit = child.exitCode ?? (await new Promise<number | null>((resolve) => child.once('close', resolve)));
      if (exit !== 0 || failed) throw Object.assign(new Error('Claude generation failed; check CLI sign-in and model availability'), { code: 'NETWORK' });
      if (!streamed && fallback) yield { type: 'text', text: fallback };
      if (!reported) yield { type: 'usage', inputTokens: null, outputTokens: null };
    } finally {
      input.signal?.removeEventListener('abort', abort);
      if (!child.killed && child.exitCode === null) child.kill();
    }
  }
}
