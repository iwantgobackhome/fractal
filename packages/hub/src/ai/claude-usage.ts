import * as pty from '@lydell/node-pty';
import type { AiAccountLimits } from '@fractal/shared';

type Windows = AiAccountLimits['windows'];
const empty = (): Windows => ({ fiveHour: null, weekly: null });
const ansi = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;

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
export async function readClaudeUsageViaPty(env: NodeJS.ProcessEnv): Promise<Windows> {
  if (process.platform !== 'win32') return empty();
  return new Promise((resolve, reject) => {
    let terminal: pty.IPty;
    try {
      terminal = pty.spawn('claude.exe', [], { name: 'xterm-256color', cols: 120, rows: 40, cwd: process.cwd(), env: env as Record<string, string> });
    } catch (error) {
      reject(error);
      return;
    }
    let output = '';
    let sent = false;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(deadline);
      try {
        terminal.kill();
      } catch {
        /* already exited */
      }
      if (error) reject(error);
      else resolve(parseClaudeUsageScreen(output));
    };
    terminal.onData((data) => {
      output = (output + data).slice(-40000);
    });
    terminal.onExit(() => finish(new Error('Claude usage PTY exited')));
    const poll = setInterval(() => {
      const screen = output.replace(ansi, '');
      if (!sent && /Claude\s*Code|ClaudeCode|\/effort/i.test(screen)) {
        sent = true;
        terminal.write('/usage\r');
      }
      if (sent) {
        const windows = parseClaudeUsageScreen(screen);
        if (windows.fiveHour && windows.weekly) finish();
      }
    }, 200);
    const deadline = setTimeout(() => finish(), 45000);
  });
}
