import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const PATH_MARKER = '__FRACTAL_LOGIN_PATH__';

export function cliSearchDirectories(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const separator = platform === 'win32' ? ';' : ':';
  const paths = Object.entries(env)
    .filter(([key, value]) => key.toLowerCase() === 'path' && typeof value === 'string')
    .flatMap(([, value]) => value!.split(separator).map((part) => part.replace(/^"|"$/g, '')))
    .filter(Boolean);
  const home = (platform === 'win32' ? env.USERPROFILE : env.HOME) || homedir();
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    paths.push(
      join(home, '.local', 'bin'),
      join(local, 'Programs', 'OpenAI', 'Codex', 'bin'),
      join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'npm'),
      join(local, 'Microsoft', 'WindowsApps'),
    );
  } else if (platform === 'darwin' || platform === 'linux') {
    paths.push(
      join(home, '.local', 'bin'),
      join(home, '.claude', 'local'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      join(home, '.npm-global', 'bin'),
      join(home, '.volta', 'bin'),
      join(home, '.bun', 'bin'),
      platform === 'darwin' ? join(home, 'Library', 'pnpm') : join(home, '.local', 'share', 'pnpm'),
    );
    try {
      const root = join(env.NVM_DIR || join(home, '.nvm'), 'versions', 'node');
      const versions = readdirSync(root)
        .filter((name) => /^v\d+\.\d+\.\d+$/.test(name))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      const newest = versions.map((name) => join(root, name, 'bin')).find((directory) => existsSync(directory));
      if (newest) paths.push(newest);
    } catch {
      /* nvm is optional */
    }
  }
  return [...new Set(paths)];
}

export function cliEnvironment(env: NodeJS.ProcessEnv = process.env, executable?: string): NodeJS.ProcessEnv {
  if (process.platform === 'win32') return env;
  const paths = cliSearchDirectories(env);
  if (executable) paths.push(dirname(executable));
  return { ...env, PATH: [...new Set(paths)].join(':') };
}

/** Only accept the marked value, never shell banners or startup diagnostics. */
export function parseLoginShellPath(output: string): string | null {
  const start = output.indexOf(PATH_MARKER);
  if (start < 0) return null;
  const end = output.indexOf(PATH_MARKER, start + PATH_MARKER.length);
  if (end < 0) return null;
  const value = output.slice(start + PATH_MARKER.length, end);
  return value && !/[\r\n\0]/.test(value) ? value : null;
}

export function mergeLoginShellPath(inherited: string, output: string): string {
  return [...new Set([inherited, parseLoginShellPath(output) ?? ''].flatMap((value) => value.split(':')).filter(Boolean))].join(':');
}

export async function augmentCliPath(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return;
  let output = '';
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      run(env.SHELL || '/bin/sh', ['-ilc', `printf '${PATH_MARKER}%s${PATH_MARKER}' "$PATH"`], {
        env,
        timeout: 2500,
        killSignal: 'SIGKILL',
        maxBuffer: 128 * 1024,
      }),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error('Login shell timed out')), 2800);
      }),
    ]);
    output = result.stdout;
  } catch {
    /* A broken or slow login shell must not prevent startup. */
  } finally {
    clearTimeout(deadline);
  }
  const inherited = env.PATH ?? env.Path ?? '';
  env.PATH = cliSearchDirectories({ ...env, PATH: mergeLoginShellPath(inherited, output) }).join(':');
}

export function providerInstallCommand(provider: 'codex' | 'claude', platform: NodeJS.Platform = process.platform): string {
  if (provider === 'claude') return platform === 'win32' ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash';
  return platform === 'darwin' ? 'brew install --cask codex' : 'npm install -g @openai/codex';
}
