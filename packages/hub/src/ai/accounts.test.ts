import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { SqlitePaperStore } from '../store/sqlite';
import { AccountManager, mapClaudeWindows, mapCodexWindows, type AccountCli } from './accounts';

describe('AI accounts and quota windows', () => {
  it('maps windows by duration and rate limit type, including missing data', () => {
    expect(
      mapCodexWindows({
        primary: { windowDurationMins: 10080, usedPercent: 41, resetsAt: 1800000000 },
        secondary: { windowDurationMins: 300, usedPercent: 10, resetsAt: 1800000001 },
      }),
    ).toMatchObject({ fiveHour: { usedPercent: 10, resetsAt: '2027-01-15T08:00:01.000Z' }, weekly: { usedPercent: 41 } });
    expect(mapCodexWindows({ primary: { usedPercent: 20 }, secondary: null })).toEqual({ fiveHour: null, weekly: null });
    expect(
      mapClaudeWindows({ rate_limit_info: { rateLimitType: 'five_hour', utilization: 0.42, resetsAt: '2026-10-01T00:00:00Z' } }).fiveHour?.usedPercent,
    ).toBe(42);
    expect(mapClaudeWindows({ rate_limit_info: { rateLimitType: 'seven_day', utilization: 0.2 } }).weekly?.usedPercent).toBe(20);
    expect(mapClaudeWindows({})).toEqual({ fiveHour: null, weekly: null });
  });

  it('creates, logs in, switches, and deletes managed homes with CLI env selection', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fractal-accounts-'));
    const store = new SqlitePaperStore(root);
    const loggedIn = new Set<string>();
    const calls: Array<{ provider: string; args: string[]; home: string | undefined }> = [];
    const children = new Map<string, EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => void }>();
    const cli: AccountCli = {
      async probe(provider, args, env) {
        const home = provider === 'codex' ? env.CODEX_HOME : env.CLAUDE_CONFIG_DIR;
        calls.push({ provider, args, home });
        const present = home?.startsWith(join(root, 'accounts')) ? loggedIn.has(home) : true;
        return provider === 'codex' ? (present ? 'Logged in using ChatGPT' : 'Not logged in') : JSON.stringify({ loggedIn: present, subscriptionType: 'pro' });
      },
      login(provider, args, env) {
        const home = provider === 'codex' ? env.CODEX_HOME : env.CLAUDE_CONFIG_DIR;
        calls.push({ provider, args, home });
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => {} });
        children.set(home!, child);
        return child as unknown as ChildProcess;
      },
    };
    const beforeSwitch = vi.fn(async () => {});
    try {
      const manager = new AccountManager(store, root, beforeSwitch, cli);
      expect((await manager.accounts()).filter((account) => account.kind === 'system')).toHaveLength(2);
      for (const provider of ['codex', 'claude'] as const) {
        const account = await manager.create(provider, `${provider} second`);
        const home = join(root, 'accounts', provider, account.id);
        expect(
          calls.some((call) => call.provider === provider && call.home === home && (call.args.includes('--device-auth') || call.args.includes('--claudeai'))),
        ).toBe(true);
        expect((await manager.loginProgress(account.id)).state).toBe('pending');
        children.get(home)!.stdout.write('Open https://example.com and enter code ABCD-1234');
        expect((await manager.loginProgress(account.id)).verificationUrl).toBe('https://example.com');
        loggedIn.add(home);
        children.get(home)!.emit('close', 0);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect((await manager.loginProgress(account.id)).state).toBe('done');
        expect((await manager.patch(account.id, { active: true })).active).toBe(true);
        expect(manager.activeEnvironment(provider)[provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR']).toBe(home);
        await manager.patch(`${provider}:system`, { active: true });
        await manager.remove(account.id);
        expect((await manager.accounts()).some((item) => item.id === account.id)).toBe(false);
      }
      expect(beforeSwitch).toHaveBeenCalledTimes(4);
    } finally {
      store.db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
