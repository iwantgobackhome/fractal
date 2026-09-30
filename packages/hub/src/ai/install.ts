import { spawn, execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import type { AiInstallProgress, ProviderId } from '@fractal/shared';
import { resolveCodexExecutable } from '../codex/runtime';
import { resolveClaudePtyCommand } from './claude-usage';

const exec = promisify(execFile);
const COMMAND_TIMEOUT_MS = 5 * 60_000;

async function executableOnPath(name: string): Promise<string | null> {
  const paths = (process.env.PATH ?? process.env.Path ?? '').split(delimiter);
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? homedir(), 'AppData', 'Local');
    paths.push(join(local, 'Microsoft', 'WindowsApps'));
  }
  for (const directory of paths) {
    if (!directory) continue;
    const file = join(directory.replace(/^"|"$/g, ''), name);
    try {
      await access(file);
      return file;
    } catch {
      /* check the next directory */
    }
  }
  return null;
}

async function installed(provider: ProviderId): Promise<boolean> {
  try {
    const command = provider === 'codex' ? { file: await resolveCodexExecutable(), args: [] } : resolveClaudePtyCommand(process.env);
    await exec(command.file, [...command.args, '--version'], { windowsHide: true, timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function execute(file: string, args: string[], signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, shell: false, stdio: 'ignore', signal, timeout: COMMAND_TIMEOUT_MS });
    child.once('error', reject);
    child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(`Installer exited with code ${code ?? 'unknown'}`))));
  });
}

export interface InstallDependencies {
  platform?: NodeJS.Platform;
  installed?: typeof installed;
  find?: typeof executableOnPath;
  execute?: typeof execute;
}

/** One bounded, user-triggered installation job per provider. No elevation or model turn. */
export class ProviderInstallManager {
  private readonly jobs = new Map<ProviderId, AiInstallProgress>();
  private readonly controllers = new Map<ProviderId, AbortController>();
  constructor(private readonly dependencies: InstallDependencies = {}) {}

  get(provider: ProviderId): AiInstallProgress {
    return { ...(this.jobs.get(provider) ?? { state: 'idle' }) };
  }

  start(provider: ProviderId): AiInstallProgress {
    if (this.jobs.get(provider)?.state === 'running') return this.get(provider);
    const controller = new AbortController();
    this.controllers.set(provider, controller);
    this.jobs.set(provider, { state: 'running', step: 'Checking installation' });
    void this.run(provider, controller.signal).finally(() => this.controllers.delete(provider));
    return this.get(provider);
  }

  stop(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }

  private set(provider: ProviderId, progress: AiInstallProgress): void {
    this.jobs.set(provider, progress);
  }

  private async run(provider: ProviderId, signal: AbortSignal): Promise<void> {
    const verify = this.dependencies.installed ?? installed;
    const find = this.dependencies.find ?? executableOnPath;
    const launch = this.dependencies.execute ?? execute;
    let step = 'Checking installation';
    try {
      if (await verify(provider)) {
        this.set(provider, { state: 'done', step: 'Ready' });
        return;
      }
      if ((this.dependencies.platform ?? process.platform) !== 'win32') throw new Error('This installer currently supports Windows only');
      if (provider === 'claude') {
        step = 'Installing Claude Code';
        this.set(provider, { state: 'running', step });
        const powershell =
          (await find('powershell.exe')) ?? join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        await launch(
          powershell,
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'],
          signal,
        );
      } else {
        const winget = await find('winget.exe');
        if (winget) {
          step = 'Installing ChatGPT desktop app';
          this.set(provider, { state: 'running', step });
          await launch(
            winget,
            ['install', '--id', '9PLM9XGG6VKS', '-s', 'msstore', '--accept-source-agreements', '--accept-package-agreements', '--silent'],
            signal,
          );
        } else {
          const node = await find('node.exe');
          const npm = await find('npm.cmd');
          if (!node || !npm) throw new Error('Codex needs Windows App Installer or Node.js with npm');
          step = 'Installing Codex CLI';
          this.set(provider, { state: 'running', step });
          const cmd = join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'cmd.exe');
          await launch(cmd, ['/d', '/s', '/c', `"${npm}" install -g @openai/codex`], signal);
        }
      }
      step = 'Verifying executable';
      this.set(provider, { state: 'running', step });
      if (!(await verify(provider))) throw new Error(`${provider === 'codex' ? 'Codex' : 'Claude'} executable was not found after installation`);
      this.set(provider, { state: 'done', step: 'Ready' });
    } catch (error) {
      this.set(provider, { state: 'failed', step, message: error instanceof Error ? error.message.slice(0, 180) : 'Installation failed' });
    }
  }
}
