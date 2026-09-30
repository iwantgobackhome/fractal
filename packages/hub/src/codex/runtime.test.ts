import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoCustomInstructions, childEnvironment, disabledMcpArgs, restrictedArgs } from './runtime';
import { assertIsolatedRequest, isolatedThreadRequest } from './isolation';
import { CodexProvider } from '../ai/codex';
import type { PaperChat, Translator } from '@fractal/shared';

describe('Codex CLI isolation', () => {
  it('inherits the CLI home and strips unrelated environment variables', () => {
    const selected = childEnvironment({ CODEX_HOME: 'C:\\user-codex', PATH: 'C:\\bin', OPENAI_API_KEY: 'secret' });
    expect(selected.CODEX_HOME).toBe('C:\\user-codex');
    expect(selected.OPENAI_API_KEY).toBeUndefined();
    expect(childEnvironment({ PATH: 'C:\\bin' }).CODEX_HOME).toBeUndefined();
    expect(restrictedArgs()).toContain('web_search="disabled"');
  });

  it('reports signed-out CLI state with a terminal login command', async () => {
    const translator = { connection: async () => ({ status: 'signed_out', modelIds: [], defaultModelId: null, limits: null }) } as unknown as Translator &
      PaperChat;
    const status = await new CodexProvider(translator, async () => 'codex-cli 0.159.0').status();
    expect(status).toMatchObject({ installed: true, loggedIn: false, detail: 'Run codex login', loginCommand: 'codex login' });
  });

  it('disables a user-configured MCP server even alongside a custom instruction file', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fractal-unsafe-config-'));
    try {
      writeFileSync(join(home, 'custom.md'), 'Try to call a tool.');
      writeFileSync(
        join(home, 'config.toml'),
        `model_instructions_file = "${join(home, 'custom.md').replaceAll('\\', '/')}"\n[mcp_servers.unsafe]\ncommand = "node"\nargs = ["--version"]\n`,
      );
      const env = childEnvironment({ ...process.env, CODEX_HOME: home });
      await expect(assertNoCustomInstructions(env)).rejects.toMatchObject({ code: 'UNSAFE_RUNTIME' });
      const probe = vi.fn(async (_file: string, args: string[]) => ({
        stdout: JSON.stringify([{ name: 'unsafe', enabled: !args.includes('mcp_servers.unsafe.enabled=false') }]),
        stderr: '',
      })) as unknown as Parameters<typeof disabledMcpArgs>[2];
      const args = await disabledMcpArgs('codex.exe', env, probe);
      expect(args).toContain('mcp_servers.unsafe.enabled=false');
      const request = isolatedThreadRequest('gpt-6-sol', home, 'Fractal text-only instructions');
      expect(assertIsolatedRequest(request)).toMatchObject({
        dynamicTools: [],
        environments: [],
        sandbox: 'read-only',
        approvalPolicy: 'never',
        ephemeral: true,
        baseInstructions: 'Fractal text-only instructions',
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
  it('leaves an already-disabled app server alone and verifies all three servers are disabled', async () => {
    const servers = [
      { name: 'codex_app', enabled: false },
      { name: 'cua_repl', enabled: true },
      { name: 'node_repl', enabled: true },
    ];
    const probe = vi.fn(async (_file: string, args: string[]) => ({
      stdout: JSON.stringify(
        servers.map((server) => ({
          ...server,
          enabled: server.enabled && !args.includes(`mcp_servers.${server.name}.enabled=false`),
        })),
      ),
      stderr: '',
    })) as unknown as Parameters<typeof disabledMcpArgs>[2];
    const args = await disabledMcpArgs('codex.exe', {}, probe);
    expect(args).toEqual(['-c', 'mcp_servers.cua_repl.enabled=false', '-c', 'mcp_servers.node_repl.enabled=false']);
    expect(
      JSON.parse((await probe!('codex.exe', ['mcp', 'list', '--json', ...args], {})).stdout).every((server: { enabled: boolean }) => !server.enabled),
    ).toBe(true);
    const rejected = vi.fn(async (_file: string, requested: string[]) => {
      if (requested.includes('mcp_servers.cua_repl.enabled=false')) throw new Error('invalid transport');
      return { stdout: JSON.stringify(servers), stderr: '' };
    }) as unknown as Parameters<typeof disabledMcpArgs>[2];
    await expect(disabledMcpArgs('codex.exe', {}, rejected)).rejects.toMatchObject({
      code: 'UNSAFE_RUNTIME',
      message: 'Codex MCP override was rejected for cua_repl.',
    });
  });

  it('lists servers under the runtime overrides, so plugin-provided servers never need an override (Codex desktop app, measured)', async () => {
    // codex-cli 0.159.0 with the Codex desktop app: codex_app and cua_repl come from plugins, disappear
    // with features.plugins/computer_use off, and fail with "invalid transport" if overridden by name.
    const probe = vi.fn(async (_file: string, args: string[]) => {
      if (args.some((arg) => /^mcp_servers\.(codex_app|cua_repl)\./.test(arg))) throw new Error('invalid transport in `mcp_servers.cua_repl`');
      const pluginsOff = args.includes('features.plugins=false') && args.includes('features.computer_use=false');
      const servers = [
        ...(pluginsOff
          ? []
          : [
              { name: 'codex_app', enabled: false },
              { name: 'cua_repl', enabled: true },
            ]),
        { name: 'node_repl', enabled: !args.includes('mcp_servers.node_repl.enabled=false') },
      ];
      return { stdout: JSON.stringify(servers), stderr: '' };
    }) as unknown as Parameters<typeof disabledMcpArgs>[2];
    await expect(disabledMcpArgs('codex.exe', {}, probe)).resolves.toEqual(['-c', 'mcp_servers.node_repl.enabled=false']);
  });
});
