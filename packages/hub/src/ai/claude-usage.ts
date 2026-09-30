import { existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { delimiter, join, resolve, sep } from 'node:path';
import type { IPty } from '@lydell/node-pty';
import type { AiAccountLimits } from '@fractal/shared';

type Windows = AiAccountLimits['windows'];
const empty = (): Windows => ({ fiveHour: null, weekly: null });
const ansi = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;

type ScreenState = { kind: 'ready' } | { kind: 'trust'; selection: 'no' | 'yes' | 'unknown' } | { kind: 'other'; title: string };

function screenTitle(screen: string): string {
  const heading = screen
    .replace(/[─━═▐▛▜▝██▀]/g, ' ')
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .find((line) => line.length >= 4 && line.length <= 72 && /^[\p{L}\p{N}]/u.test(line) && !/[\\/@]/.test(line));
  if (heading) return heading;
  const compact = screen.toLowerCase().replace(/\s+/g, '');
  if (/select.*theme|choose.*theme|appearance/.test(compact)) return 'Theme selection';
  if (/signin|login|authentication|choosehowtologin/.test(compact)) return 'Sign-in';
  if (/welcometoclaudecode/.test(compact)) return 'Welcome to Claude Code';
  if (/quicksafetycheck/.test(compact)) return 'Workspace safety check';
  return 'Unrecognized Claude setup screen';
}

/** Recognize the command bar separately from the workspace safety dialog. */
export function classifyClaudeUsageScreen(output: string, cwd: string): ScreenState {
  const screen = output.replace(ansi, '');
  const banner = /Claude\s*Code\s*v\d/i.exec(screen);
  if (banner && /\/effort/.test(screen.slice(banner.index)) && /(?:^|[\r\n])\s*[>❯›]\s*(?:Try|\/|$)/im.test(screen.slice(banner.index)))
    return { kind: 'ready' };
  const compact = screen.toLowerCase().replace(/\s+/g, '');
  if (compact.includes('quicksafetycheck:isthisaprojectyoucreatedoroneyoutrust?')) {
    if (!compact.includes(cwd.toLowerCase().replace(/\s+/g, ''))) return { kind: 'other', title: 'Workspace safety check for another folder' };
    // Claude draws the selected option with ❯ (U+276F); older builds and recordings use >.
    const selected = (option: string) => /[>❯›]/.test(compact.charAt(compact.indexOf(option) - 1));
    return { kind: 'trust', selection: selected('no,exit') ? 'no' : selected('yes,itrustthisfolder') ? 'yes' : 'unknown' };
  }
  return { kind: 'other', title: screenTitle(screen) };
}

function usageDirectory(dataDirectory: string, accountId: string): string {
  const base = resolve(dataDirectory, 'claude-usage');
  const cwd = resolve(base, encodeURIComponent(accountId));
  if (!cwd.startsWith(base + sep)) throw new Error('Claude usage workspace path is invalid');
  mkdirSync(cwd, { recursive: true });
  if (lstatSync(base).isSymbolicLink() || lstatSync(cwd).isSymbolicLink() || readdirSync(cwd).length) {
    throw new Error('Claude usage workspace is not empty or app-owned');
  }
  return cwd;
}

/** Give ConPTY an absolute CLI path rather than relying on the inherited PATH. */
export function resolveClaudePtyCommand(env: NodeJS.ProcessEnv): { file: string; args: string[] } {
  const paths = Object.entries(env)
    .filter(([key, value]) => key.toLowerCase() === 'path' && typeof value === 'string')
    .flatMap(([, value]) => value!.split(delimiter).map((part) => part.replace(/^"|"$/g, '')));
  if (env.USERPROFILE) paths.push(join(env.USERPROFILE, '.local', 'bin'));
  for (const name of ['claude.exe', 'claude.cmd']) {
    for (const directory of paths) {
      const file = join(directory, name);
      if (!existsSync(file)) continue;
      return name.endsWith('.cmd')
        ? { file: env.ComSpec ?? env.COMSPEC ?? join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'), args: ['/d', '/s', '/c', `"${file}"`] }
        : { file, args: [] };
    }
  }
  throw new Error('Claude CLI executable was not found on PATH');
}

function resetAt(raw: string, now: Date): string | null {
  const zone = /\(([^)]+\/[^)]+)\)/.exec(raw)?.[1] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const match = /(?:(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{1,2}),?\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(raw);
  if (!match) return null;
  try {
    const parts = (date: Date) =>
      Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
          timeZone: zone,
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          hourCycle: 'h23',
        })
          .formatToParts(date)
          .map((part) => [part.type, Number(part.value)]),
      );
    const local = parts(now);
    const month = match[1]
      ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(
          match[1][0].toUpperCase() + match[1].slice(1).toLowerCase(),
        ) + 1
      : local.month;
    if (month < 1) return null;
    const day = match[2] ? Number(match[2]) : local.day;
    const hour = (Number(match[3]) % 12) + (match[5].toLowerCase() === 'pm' ? 12 : 0);
    const minute = Number(match[4] ?? 0);
    let localTime = Date.UTC(local.year, month - 1, day, hour, minute);
    const convert = (value: number) => {
      const zoned = parts(new Date(value));
      return value + localTime - Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute);
    };
    let result = convert(convert(localTime));
    if (result < now.getTime()) {
      const next = new Date(localTime);
      if (match[1]) next.setUTCFullYear(next.getUTCFullYear() + 1);
      else next.setUTCDate(next.getUTCDate() + 1);
      localTime = next.getTime();
      result = convert(convert(localTime));
    }
    return new Date(result).toISOString();
  } catch {
    return null;
  }
}

/** Parse only the official subscription windows from Claude's /usage screen. */
export function parseClaudeUsageScreen(output: string, now = new Date()): Windows {
  const screen = output.replace(ansi, '');
  const windows = empty();
  for (const [key, heading] of [
    ['fiveHour', 'Current\\s*session'],
    ['weekly', 'Current\\s*week\\s*\\(all\\s*models\\)'],
  ] as const) {
    const match = new RegExp(`${heading}.{0,130}?(\\d{1,3})\\s*%\\s*used\\s*Resets\\s*([^\\r\\n]{0,55})`, 'is').exec(screen);
    if (!match) continue;
    const reset = match[2].split(/Current|What's/i)[0];
    windows[key] = { usedPercent: Math.min(100, Number(match[1])), resetsAt: resetAt(reset, now) };
  }
  return windows;
}

/** Drive /usage in a PTY. This command reads quota status and never sends a model prompt. */
export async function readClaudeUsageViaPty(env: NodeJS.ProcessEnv, dataDirectory: string, accountId: string): Promise<Windows> {
  if (process.platform !== 'win32') return empty();
  const cwd = usageDirectory(dataDirectory, accountId);
  let pty: typeof import('@lydell/node-pty');
  try {
    pty = await import('@lydell/node-pty');
  } catch {
    throw new Error('Claude PTY module is unavailable');
  }
  const command = resolveClaudePtyCommand(env);
  const childEnv = { ...env };
  delete childEnv.CLAUDECODE;
  delete childEnv.CLAUDE_CODE_ENTRYPOINT;
  return new Promise((resolve, reject) => {
    let terminal: IPty;
    try {
      terminal = pty.spawn(command.file, command.args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd,
        env: childEnv as Record<string, string>,
      });
    } catch {
      reject(new Error('Claude PTY could not start'));
      return;
    }
    let output = '';
    let sent = false;
    let trustConfirmed = false;
    let settled = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const finish = (reason?: string) => {
      if (settled) return;
      settled = true;
      if (poll) clearInterval(poll);
      if (deadline) clearTimeout(deadline);
      try {
        terminal.kill();
      } catch {
        /* already exited */
      }
      const windows = parseClaudeUsageScreen(output);
      if (windows.fiveHour || windows.weekly) resolve(windows);
      else reject(new Error(reason ?? (sent ? 'Claude /usage did not show subscription windows' : 'Claude CLI did not reach its prompt')));
    };
    terminal.onData((data) => {
      output = (output + data).slice(-40000);
    });
    terminal.onExit(() => {
      const state = classifyClaudeUsageScreen(output, cwd);
      finish(state.kind === 'other' && output ? `Claude first-run screen: ${state.title}` : 'Claude CLI exited before showing usage');
    });
    poll = setInterval(() => {
      const screen = output.replace(ansi, '');
      const state = classifyClaudeUsageScreen(output, cwd);
      if (!sent && state.kind === 'trust' && !trustConfirmed) {
        if (state.selection === 'unknown') {
          finish('Claude workspace trust choice was not recognized');
          return;
        }
        trustConfirmed = true;
        setTimeout(() => {
          if (settled) return;
          try {
            if (state.selection === 'no') terminal.write('\x1b[B');
            setTimeout(
              () => {
                if (settled) return;
                try {
                  terminal.write('\r');
                } catch {
                  finish('Claude workspace trust confirmation failed');
                }
              },
              state.selection === 'no' ? 350 : 0,
            );
          } catch {
            finish('Claude workspace trust confirmation failed');
          }
        }, 800);
        return;
      }
      if (!sent && state.kind === 'ready') {
        sent = true;
        try {
          terminal.write('/usage\r');
        } catch {
          finish('Claude CLI did not accept /usage');
          return;
        }
      }
      if (sent) {
        const windows = parseClaudeUsageScreen(screen);
        if (windows.fiveHour && windows.weekly) finish();
      }
    }, 200);
    deadline = setTimeout(() => {
      const state = classifyClaudeUsageScreen(output, cwd);
      finish(
        sent
          ? 'Claude /usage did not show subscription windows'
          : `Claude first-run screen: ${state.kind === 'other' ? state.title : state.kind === 'trust' ? 'Workspace safety check' : 'Command prompt'}`,
      );
    }, 30000);
  });
}
