import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { AiAccount, AiAccountLimits, AiLoginProgress, AiLimitsResponse, ProviderId } from '@fractal/shared';
import type { SqlitePaperStore } from '../store/sqlite';
import { invalidInput, notFound } from '../store/errors';
import { resolveCodexExecutable, startOfficialRpc } from '../codex/runtime';
import { readClaudeUsageViaPty } from './claude-usage';

const run = promisify(execFile);
interface Row {
  id: string;
  provider: ProviderId;
  label: string;
  kind: 'system' | 'managed';
  active: number;
}
const object = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' ? (value as Record<string, unknown>) : null);
export function mapCodexWindows(value: unknown): AiAccountLimits['windows'] {
  const windows: AiAccountLimits['windows'] = { fiveHour: null, weekly: null };
  const source = object(value);
  for (const raw of [source?.primary, source?.secondary]) {
    const window = object(raw);
    const duration = Number(window?.windowDurationMins);
    const key = duration >= 240 && duration <= 360 ? 'fiveHour' : duration >= 9000 && duration <= 11000 ? 'weekly' : null;
    if (!key || typeof window?.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) continue;
    windows[key] = {
      usedPercent: Math.max(0, Math.min(100, window.usedPercent)),
      resetsAt: typeof window.resetsAt === 'number' && Number.isFinite(window.resetsAt) ? new Date(window.resetsAt * 1000).toISOString() : null,
    };
  }
  return windows;
}
export function mapClaudeWindows(value: unknown): AiAccountLimits['windows'] {
  const windows: AiAccountLimits['windows'] = { fiveHour: null, weekly: null };
  const info = object(object(value)?.rate_limit_info) ?? object(value);
  const type = info?.rateLimitType ?? info?.rate_limit_type;
  const key = type === 'five_hour' ? 'fiveHour' : type === 'seven_day' ? 'weekly' : null;
  if (key && typeof info?.utilization === 'number') {
    const reset = info.resetsAt ?? info.resets_at;
    windows[key] = {
      usedPercent: Math.max(0, Math.min(100, info.utilization <= 1 ? info.utilization * 100 : info.utilization)),
      resetsAt:
        typeof reset === 'string'
          ? Number.isFinite(Date.parse(reset))
            ? new Date(reset).toISOString()
            : null
          : typeof reset === 'number'
            ? new Date(reset * 1000).toISOString()
            : null,
    };
  }
  return windows;
}
function claudeExecutable(): string {
  return process.platform === 'win32' ? 'claude.exe' : 'claude';
}
export interface AccountCli {
  probe(provider: ProviderId, args: string[], env: NodeJS.ProcessEnv): Promise<string>;
  login(provider: ProviderId, args: string[], env: NodeJS.ProcessEnv): ChildProcess | Promise<ChildProcess>;
}
const defaultCli: AccountCli = {
  async probe(provider, args, env) {
    const result = await run(provider === 'codex' ? await resolveCodexExecutable() : claudeExecutable(), args, { env, timeout: 12000, windowsHide: true });
    return `${result.stdout}\n${result.stderr}`;
  },
  async login(provider, args, env) {
    return spawn(provider === 'codex' ? await resolveCodexExecutable() : claudeExecutable(), args, {
      env,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  },
};

export class AccountManager {
  private readonly progress = new Map<string, AiLoginProgress>();
  private readonly loginProcesses = new Map<string, ChildProcess>();
  private readonly observations = new Map<string, AiAccountLimits>();
  private readonly checked = new Map<string, number>();
  private readonly refreshing = new Set<string>();
  stop(): void {
    for (const child of this.loginProcesses.values()) child.kill();
    this.loginProcesses.clear();
  }
  constructor(
    private readonly store: SqlitePaperStore,
    private readonly root: string,
    private readonly beforeSwitch: (provider: ProviderId) => Promise<void> = async () => {},
    private readonly cli: AccountCli = defaultCli,
    private readonly claudeUsage: typeof readClaudeUsageViaPty = readClaudeUsageViaPty,
  ) {}
  private message(en: string, ko: string): string {
    return this.store.getPreferences().uiLanguage === 'ko' ? ko : en;
  }
  private rows(): Row[] {
    return this.store.db.prepare('SELECT id,provider,label,kind,active FROM ai_accounts ORDER BY provider,kind,id').all() as unknown as Row[];
  }
  private row(id: string): Row {
    const row = this.store.db.prepare('SELECT id,provider,label,kind,active FROM ai_accounts WHERE id=?').get(id) as Row | undefined;
    if (!row) throw notFound('Account not found');
    return row;
  }
  active(provider: ProviderId): Row {
    return this.rows().find((row) => row.provider === provider && row.active === 1)!;
  }
  private directory(row: Row): string {
    return join(this.root, 'accounts', row.provider, row.id);
  }
  environment(row: Row): NodeJS.ProcessEnv {
    return row.kind === 'system'
      ? { ...process.env }
      : { ...process.env, [row.provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR']: this.directory(row) };
  }
  activeEnvironment(provider: ProviderId): NodeJS.ProcessEnv {
    return this.environment(this.active(provider));
  }
  private async status(row: Row): Promise<{ loggedIn: boolean; email?: string; plan?: string }> {
    try {
      const env = this.environment(row);
      if (row.provider === 'codex') {
        const result = await this.cli.probe('codex', ['login', 'status'], env);
        return { loggedIn: /^Logged in/im.test(result) };
      }
      const result = JSON.parse(await this.cli.probe('claude', ['auth', 'status'], env)) as Record<string, unknown>;
      return {
        loggedIn: result.loggedIn === true,
        ...(typeof result.email === 'string' ? { email: result.email } : {}),
        ...(typeof result.subscriptionType === 'string' ? { plan: result.subscriptionType } : {}),
      };
    } catch {
      return { loggedIn: false };
    }
  }
  async accounts(): Promise<AiAccount[]> {
    return Promise.all(
      this.rows().map(async (row) => ({
        id: row.id,
        provider: row.provider,
        label: row.label,
        kind: row.kind,
        active: !!row.active,
        ...(await this.status(row)),
      })),
    );
  }
  async create(provider: ProviderId, label: string): Promise<AiAccount> {
    const id = randomUUID();
    const row: Row = { id, provider, label, kind: 'managed', active: 0 };
    mkdirSync(this.directory(row), { recursive: true });
    this.store.db.prepare('INSERT INTO ai_accounts(id,provider,label,kind,active) VALUES(?,?,?,?,0)').run(id, provider, label, 'managed');
    await this.login(id);
    return (await this.accounts()).find((account) => account.id === id)!;
  }
  async login(id: string): Promise<AiLoginProgress> {
    const row = this.row(id);
    if (row.kind !== 'managed') throw invalidInput('System account uses the existing CLI login');
    if (this.loginProcesses.has(id)) return this.progress.get(id)!;
    const args = row.provider === 'codex' ? ['login', '--device-auth'] : ['auth', 'login', '--claudeai'];
    let child: ChildProcess;
    try {
      child = await this.cli.login(row.provider, args, this.environment(row));
    } catch {
      const failed: AiLoginProgress = { state: 'failed', message: this.message('Could not start login', '로그인을 시작할 수 없습니다.') };
      this.progress.set(id, failed);
      return failed;
    }
    this.loginProcesses.set(id, child);
    const state: AiLoginProgress = { state: 'pending' };
    this.progress.set(id, state);
    let output = '';
    const onData = (bytes: Buffer) => {
      output = (output + bytes.toString('utf8')).slice(-3000);
      const url = /https:\/\/[^\s]+/.exec(output)?.[0];
      const code = /(?:code|Code)[:\s]+([A-Z0-9-]{5,})/.exec(output)?.[1];
      if (url) state.verificationUrl = url;
      if (code) state.userCode = code;
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', () => {
      this.progress.set(id, { state: 'failed', message: this.message('Could not start login', '로그인을 시작할 수 없습니다.') });
      this.loginProcesses.delete(id);
    });
    child.once('close', () => {
      void this.status(row).then((status) => {
        this.progress.set(
          id,
          status.loggedIn ? { state: 'done' } : { state: 'failed', message: this.message('Login did not complete', '로그인이 완료되지 않았습니다.') },
        );
        this.loginProcesses.delete(id);
      });
    });
    return state;
  }
  async loginProgress(id: string): Promise<AiLoginProgress> {
    const row = this.row(id);
    if ((await this.status(row)).loggedIn) return { state: 'done' };
    return this.progress.get(id) ?? { state: 'failed', message: this.message('Login has not started', '로그인이 시작되지 않았습니다.') };
  }
  async patch(id: string, patch: { label?: string; active?: boolean }): Promise<AiAccount> {
    const row = this.row(id);
    if (patch.label !== undefined) this.store.db.prepare('UPDATE ai_accounts SET label=? WHERE id=?').run(patch.label, id);
    if (patch.active === true && !row.active) {
      if (!(await this.status(row)).loggedIn) throw invalidInput('Account is not logged in');
      await this.beforeSwitch(row.provider);
      this.store.db.exec('SAVEPOINT account_switch');
      try {
        this.store.db.prepare('UPDATE ai_accounts SET active=0 WHERE provider=?').run(row.provider);
        this.store.db.prepare('UPDATE ai_accounts SET active=1 WHERE id=?').run(id);
        this.store.db.exec('RELEASE account_switch');
      } catch (error) {
        this.store.db.exec('ROLLBACK TO account_switch');
        this.store.db.exec('RELEASE account_switch');
        throw error;
      }
    }
    if (patch.active === false && row.active) throw invalidInput('Activate another account to switch');
    return (await this.accounts()).find((account) => account.id === id)!;
  }
  async remove(id: string): Promise<void> {
    const row = this.row(id);
    if (row.kind === 'system') throw invalidInput('System account cannot be removed');
    if (row.active) throw invalidInput('Activate another account before removal');
    this.loginProcesses.get(id)?.kill();
    try {
      await this.cli.probe(row.provider, row.provider === 'codex' ? ['logout'] : ['auth', 'logout'], this.environment(row));
    } catch {
      /* directory removal clears the managed login */
    }
    const directory = resolve(this.directory(row));
    const base = resolve(this.root, 'accounts', row.provider) + sep;
    if (!directory.startsWith(base)) throw invalidInput('Invalid account directory');
    rmSync(directory, { recursive: true, force: true });
    this.store.db.prepare('DELETE FROM ai_accounts WHERE id=?').run(id);
    this.observations.delete(id);
    this.checked.delete(id);
  }
  observeClaude(id: string, event: unknown): void {
    const mapped = mapClaudeWindows(event);
    if (!mapped.fiveHour && !mapped.weekly) return;
    const previous = this.observations.get(id);
    this.observations.set(id, {
      provider: 'claude',
      accountId: id,
      label: this.row(id).label,
      active: !!this.row(id).active,
      kind: this.row(id).kind,
      windows: { fiveHour: mapped.fiveHour ?? previous?.windows.fiveHour ?? null, weekly: mapped.weekly ?? previous?.windows.weekly ?? null },
      observedAt: new Date().toISOString(),
      state: 'ok',
    });
  }
  requestRefresh(id: string, force = false): void {
    if (this.refreshing.has(id) || (!force && Date.now() - (this.checked.get(id) ?? 0) < 60_000)) return;
    this.refreshing.add(id);
    this.checked.set(id, Date.now());
    void this.refresh(id).finally(() => this.refreshing.delete(id));
  }
  async limits(): Promise<AiLimitsResponse> {
    const accounts = await this.accounts();
    const result = accounts.map((account) => {
      const observed = this.observations.get(account.id);
      if (account.loggedIn) this.requestRefresh(account.id);
      return {
        provider: account.provider,
        accountId: account.id,
        label: account.label,
        active: account.active,
        kind: account.kind,
        windows: observed?.windows ?? { fiveHour: null, weekly: null },
        ...(account.plan ? { plan: account.plan } : {}),
        observedAt: observed?.observedAt ?? null,
        state: account.loggedIn ? (observed?.state ?? 'unavailable') : 'notLoggedIn',
        ...(account.loggedIn && !observed
          ? {
              message:
                account.provider === 'claude'
                  ? this.message('Checking Claude usage screen', 'Claude 사용량을 확인하고 있습니다.')
                  : this.message('Checking Codex limits', 'Codex 사용량을 확인하고 있습니다.'),
            }
          : {}),
        ...(observed?.state === 'unavailable' ? { message: observed.message ?? this.message('Usage source unavailable', '사용량 정보가 없습니다.') } : {}),
      } satisfies AiAccountLimits;
    });
    return { accounts: result };
  }
  async refresh(id: string): Promise<void> {
    const row = this.row(id);
    if (row.provider === 'claude') {
      try {
        const windows = await this.claudeUsage(this.environment(row));
        const previous = this.observations.get(id);
        this.observations.set(id, {
          provider: 'claude',
          accountId: id,
          label: row.label,
          kind: row.kind,
          active: !!row.active,
          windows: { fiveHour: windows.fiveHour ?? previous?.windows.fiveHour ?? null, weekly: windows.weekly ?? previous?.windows.weekly ?? null },
          observedAt: new Date().toISOString(),
          state: windows.fiveHour || windows.weekly ? 'ok' : 'unavailable',
          ...(!windows.fiveHour && !windows.weekly
            ? { message: this.message('Claude usage screen did not show subscription windows', 'Claude 사용량 화면에 구독 한도가 표시되지 않았습니다.') }
            : {}),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown PTY failure';
        this.observations.set(id, {
          provider: 'claude',
          accountId: id,
          label: row.label,
          kind: row.kind,
          active: !!row.active,
          windows: { fiveHour: null, weekly: null },
          observedAt: null,
          state: 'unavailable',
          message: this.message(`Claude usage unavailable: ${reason}`, `Claude 사용량 확인 실패: ${reason}`),
        });
      }
      return;
    }
    try {
      const rpc = await startOfficialRpc(this.environment(row));
      try {
        const result = object(await rpc.request('account/rateLimits/read', {}));
        const windows = mapCodexWindows(result?.rateLimits);
        this.observations.set(id, {
          provider: row.provider,
          accountId: id,
          label: row.label,
          active: !!row.active,
          kind: row.kind,
          windows,
          observedAt: new Date().toISOString(),
          state: windows.fiveHour || windows.weekly ? 'ok' : 'unavailable',
          ...(!windows.fiveHour && !windows.weekly
            ? { message: this.message('No subscription windows reported', '구독 한도 정보가 보고되지 않았습니다.') }
            : {}),
        });
      } finally {
        await rpc.close();
      }
    } catch {
      this.observations.set(id, {
        provider: row.provider,
        accountId: id,
        label: row.label,
        active: !!row.active,
        kind: row.kind,
        windows: { fiveHour: null, weekly: null },
        observedAt: null,
        state: 'unavailable',
        message: this.message('Could not read Codex limits', 'Codex 사용량을 읽을 수 없습니다.'),
      });
    }
  }
}
