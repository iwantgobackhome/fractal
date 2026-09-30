import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoCustomInstructions, childEnvironment, disabledMcpArgs, resolveCodexExecutable, restrictedArgs } from './runtime';
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
      const args = await disabledMcpArgs(await resolveCodexExecutable(), env);
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
});
