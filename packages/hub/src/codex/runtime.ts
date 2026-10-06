import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { cliEnvironment, cliSearchDirectories } from '../ai/cli-paths';
import { failure, isRpcClosed, JsonLineRpc } from './rpc';

/** CLI overrides only. Not a claim that read-only blocks shell/file-read/MCP tools.
 * Sources: https://developers.openai.com/codex/config-reference
 *          https://developers.openai.com/codex/app-server
 * These are defense in depth for account inspection; no thread is started.
 * Deliberately no auto-compaction override: model_auto_compact_token_limit exists (config schema,
 * 0.156.0) but a huge value is clamped to about 90% of the context window, so it cannot switch
 * compaction off (measured against a loopback provider). chat.ts handles a compaction instead.
 */
export function restrictedArgs(): string[] {
  return [
    'app-server',
    '--listen',
    'stdio://',
    ...[
      'approval_policy="never"',
      'sandbox_mode="read-only"',
      'web_search="disabled"',
      'features.shell_tool=false',
      'features.apps=false',
      'features.hooks=false',
      'features.multi_agent=false',
      'features.memories=false',
      'features.goals=false',
      'features.plugins=false',
      'features.remote_plugin=false',
      'features.browser_use=false',
      'features.computer_use=false',
      'features.code_mode.enabled=false',
      'notify=[]',
      'developer_instructions=""',
      'instructions=""',
      'project_doc_max_bytes=0',
      // 0.156.0 otherwise opens every thread with a ~5,500-character developer message listing the
      // bundled skills and the user's own ~/.agents/skills (measured: 379 characters without it).
      // It does not remove the 'skills' tools the official program still declares (official source
      // ext/skills/src/extension.rs: an empty environments list counts as "cloud skills available"); a call to one is a
      // non-text item and ends the process like any tool.
      'skills.include_instructions=false',
      'shell_environment_policy.inherit="none"',
      'shell_environment_policy.ignore_default_excludes=false',
      'model_provider="openai"',
    ].flatMap((value) => ['-c', value]),
  ];
}
const run = promisify(execFile);
/** Discover configured server names without opening credential files or exposing server settings.
 * Already-disabled servers need no override; some app-managed entries reject one. */
export async function disabledMcpArgs(executable: string, env: NodeJS.ProcessEnv, probe: typeof run = run, signal?: AbortSignal): Promise<string[]> {
  // List servers under the same overrides the app-server runs with: plugin- and app-provided
  // entries (the desktop app's codex_app, cua_repl) vanish once those features are off, and they
  // reject an mcp_servers.<name> override because they have no transport of their own.
  const base = restrictedArgs().filter((_, index, all) => index >= all.indexOf('-c'));
  let first: unknown;
  try {
    first = JSON.parse((await probe(executable, ['mcp', 'list', '--json', ...base], { env, windowsHide: true, timeout: 10_000, signal })).stdout) as unknown;
  } catch {
    throw failure('UNSAFE_RUNTIME', 'Codex MCP list could not be read.');
  }
  if (!Array.isArray(first)) throw failure('UNSAFE_RUNTIME', 'Codex MCP list has an invalid format.');
  const entries = first as Array<{ name?: unknown; enabled?: unknown } | null>;
  if (entries.some((entry) => !entry || typeof entry.name !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(entry.name) || typeof entry.enabled !== 'boolean'))
    throw failure('UNSAFE_RUNTIME', 'Codex MCP list has an invalid server entry.');
  const enabled = entries.filter((entry) => entry!.enabled === true).map((entry) => entry!.name as string);
  const args: string[] = [];
  for (const name of enabled) {
    const override = ['-c', `mcp_servers.${name}.enabled=false`];
    try {
      const checked = JSON.parse(
        (await probe(executable, ['mcp', 'list', '--json', ...base, ...override], { env, windowsHide: true, timeout: 10_000, signal })).stdout,
      ) as unknown;
      if (!Array.isArray(checked) || !checked.some((entry) => entry && typeof entry === 'object' && entry.name === name && entry.enabled === false))
        throw new Error('override not reflected');
    } catch {
      throw failure('UNSAFE_RUNTIME', `Codex MCP override was rejected for ${name}.`);
    }
    args.push(...override);
  }
  let checked: unknown;
  try {
    checked = JSON.parse(
      (await probe(executable, ['mcp', 'list', '--json', ...base, ...args], { env, windowsHide: true, timeout: 10_000, signal })).stdout,
    ) as unknown;
  } catch {
    throw failure('UNSAFE_RUNTIME', `Codex MCP isolation could not verify ${enabled.join(', ') || 'the server list'}.`);
  }
  if (!Array.isArray(checked)) throw failure('UNSAFE_RUNTIME', 'Codex MCP verification returned an invalid list.');
  const missing = entries
    .map((entry) => entry!.name as string)
    .filter((name) => !checked.some((entry) => entry && typeof entry === 'object' && entry.name === name));
  if (missing.length) throw failure('UNSAFE_RUNTIME', `Codex MCP verification omitted: ${missing.join(', ')}.`);
  const stillEnabled = checked
    .filter((entry) => !entry || typeof entry !== 'object' || entry.enabled !== false)
    .map((entry) => String(entry?.name ?? 'unknown'));
  if (stillEnabled.length) throw failure('UNSAFE_RUNTIME', `Codex MCP servers remain enabled: ${stillEnabled.join(', ')}.`);
  return args;
}
/** Preserve OS startup paths and the user's CLI home selection. Credentials stay with Codex. */
export function childEnvironment(env: NodeJS.ProcessEnv = process.env, executable?: string): NodeJS.ProcessEnv {
  const permitted = new Set(['path', 'systemroot', 'windir', 'comspec', 'pathext', 'temp', 'tmp', 'home', 'userprofile', 'appdata', 'localappdata']);
  const output = Object.fromEntries(Object.entries(env).filter(([key, value]) => permitted.has(key.toLowerCase()) && value !== undefined));
  if (env.CODEX_HOME?.trim()) output.CODEX_HOME = env.CODEX_HOME;
  return cliEnvironment(output, executable);
}
/** Inspect only config.toml, never credential files. User-supplied instructions cannot
 * become part of Fractal's text-only generation task. */
export async function assertNoCustomInstructions(env: NodeJS.ProcessEnv): Promise<void> {
  const home = env.CODEX_HOME?.trim() || join(env.USERPROFILE || env.HOME || homedir(), '.codex');
  let config: string;
  try {
    config = await readFile(join(home, 'config.toml'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw failure('UNSAFE_RUNTIME', 'Codex configuration could not be checked.');
  }
  if (/^\s*(?:model_instructions_file|experimental_instructions_file|developer_instructions|instructions)\s*=/m.test(config))
    throw failure('UNSAFE_RUNTIME', 'Codex custom instructions are not allowed for Fractal threads.');
}
/** Resolve native official npm binary on Windows: never run a .cmd through a shell. */
export async function resolveCodexExecutable(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Promise<string> {
  const paths = cliSearchDirectories(env, platform);
  for (const directory of paths) {
    if (!directory) continue;
    const direct = join(directory, platform === 'win32' ? 'codex.exe' : 'codex');
    try {
      await access(direct, platform === 'win32' ? constants.F_OK : constants.X_OK);
      return direct;
    } catch {
      /* continue */
    }
    if (platform !== 'win32') continue;
    const root = join(directory, 'node_modules', '@openai', 'codex', 'package.json');
    try {
      await access(root);
      const require = createRequire(root);
      const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
      const target = architecture === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
      const pkg = require.resolve(`@openai/codex-win32-${architecture}/package.json`);
      const binary = join(dirname(pkg), 'vendor', target, 'bin', 'codex.exe');
      await access(binary);
      return binary;
    } catch {
      /* do not install or prompt */
    }
  }
  throw Object.assign(new Error('Codex is not installed'), { code: 'ENOENT' });
}
export async function startOfficialRpc(sourceEnv: NodeJS.ProcessEnv = process.env, signal?: AbortSignal): Promise<JsonLineRpc> {
  signal?.throwIfAborted();
  const executable = await resolveCodexExecutable(sourceEnv);
  const env = childEnvironment(sourceEnv, executable);
  await assertNoCustomInstructions(env);
  const mcpArgs = await disabledMcpArgs(executable, env, run, signal);
  signal?.throwIfAborted();
  const child = spawn(executable, [...restrictedArgs(), ...mcpArgs], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env, signal });
  const rpc = new JsonLineRpc(child);
  try {
    await rpc.request('initialize', { clientInfo: { name: 'paperread', title: 'PaperRead', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    rpc.initialized();
    return rpc;
  } catch (error) {
    await rpc.close();
    throw error;
  }
}
/** Build one process factory for the translator and account session to share.
 * The owner must call both modules' shutdown methods only when the service
 * itself is stopping; ordinary account/connection reads must not close it. */
export function createOfficialRpcFactory(start: () => Promise<JsonLineRpc> = startOfficialRpc): () => Promise<JsonLineRpc> {
  let shared: Promise<JsonLineRpc> | null = null;
  return async () => {
    for (;;) {
      const existing = shared;
      if (existing) {
        try {
          const rpc = await existing;
          if (!isRpcClosed(rpc)) return rpc;
          if (shared === existing) shared = null;
        } catch (error) {
          if (shared === existing) shared = null;
          throw error;
        }
        continue;
      }
      const pending = Promise.resolve().then(start);
      let owned!: Promise<JsonLineRpc>;
      owned = pending
        .then((rpc) => {
          if (isRpcClosed(rpc)) throw failure('NETWORK', '공식 Codex 연결이 이미 종료되었습니다.', true);
          rpc.onClose?.(() => {
            if (shared === owned) shared = null;
          });
          return rpc;
        })
        .catch((error) => {
          if (shared === owned) shared = null;
          throw error;
        });
      shared = owned;
      return owned;
    }
  };
}
