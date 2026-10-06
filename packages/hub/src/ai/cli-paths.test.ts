import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliEnvironment, cliSearchDirectories, mergeLoginShellPath, parseLoginShellPath, providerInstallCommand } from './cli-paths';
import { resolveClaudePtyCommand } from './claude-usage';
import { childEnvironment, resolveCodexExecutable } from '../codex/runtime';

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'fractal-cli-paths-'));
  homes.push(home);
  const bin = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  for (const name of ['claude', 'codex', 'claude.exe', 'codex.exe']) {
    writeFileSync(join(bin, name), '#!/bin/sh\necho test-version\n');
    chmodSync(join(bin, name), 0o755);
  }
  return { home, bin };
}

describe('CLI discovery from a GUI environment', () => {
  it.each(['darwin', 'linux'] as const)('finds native CLIs with a minimal PATH on %s', async (platform) => {
    const { home, bin } = fixture();
    const env = { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };
    expect(resolveClaudePtyCommand(env, platform)).toEqual({ file: join(bin, 'claude'), args: [] });
    await expect(resolveCodexExecutable(env, platform)).resolves.toBe(join(bin, 'codex'));
  });
  it('keeps Windows executable preference and command shim handling', async () => {
    const { home, bin } = fixture();
    const env = { USERPROFILE: home, Path: bin, ComSpec: 'cmd.exe' };
    expect(resolveClaudePtyCommand(env, 'win32')).toEqual({ file: join(bin, 'claude.exe'), args: [] });
    await expect(resolveCodexExecutable(env, 'win32')).resolves.toBe(join(bin, 'codex.exe'));
    rmSync(join(bin, 'claude.exe'));
    writeFileSync(join(bin, 'claude.cmd'), '');
    expect(resolveClaudePtyCommand(env, 'win32')).toEqual({ file: 'cmd.exe', args: ['/d', '/s', '/c', `"${join(bin, 'claude.cmd')}"`] });
  });

  it('keeps the Windows official npm vendor-binary resolution', async () => {
    const { home } = fixture();
    const bin = join(home, 'npm');
    const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
    const target = architecture === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
    const root = join(bin, 'node_modules', '@openai');
    mkdirSync(join(root, 'codex'), { recursive: true });
    writeFileSync(join(root, 'codex', 'package.json'), '{}');
    const vendor = join(root, `codex-win32-${architecture}`);
    const binary = join(vendor, 'vendor', target, 'bin', 'codex.exe');
    mkdirSync(join(vendor, 'vendor', target, 'bin'), { recursive: true });
    writeFileSync(join(vendor, 'package.json'), '{}');
    writeFileSync(binary, '');
    await expect(resolveCodexExecutable({ USERPROFILE: home, PATH: bin }, 'win32')).resolves.toBe(realpathSync(binary));
  });
  it('deduplicates PATH first and selects the newest numeric nvm version', () => {
    const { home, bin } = fixture();
    for (const version of ['v9.9.9', 'v22.9.0', 'v22.12.0']) mkdirSync(join(home, '.nvm', 'versions', 'node', version, 'bin'), { recursive: true });
    const paths = cliSearchDirectories({ HOME: home, PATH: `${bin}:/usr/bin:${bin}` }, 'darwin');
    expect(paths.slice(0, 2)).toEqual([bin, '/usr/bin']);
    expect(paths.filter((path) => path === bin)).toHaveLength(1);
    expect(paths.at(-1)).toBe(join(home, '.nvm', 'versions', 'node', 'v22.12.0', 'bin'));
    expect(paths).toContain(join(home, 'Library', 'pnpm'));
    expect(cliSearchDirectories({ HOME: home }, 'linux')).toContain(join(home, '.local', 'share', 'pnpm'));
  });
  it('preserves node and the executable directory in the restricted child PATH', () => {
    if (process.platform === 'win32') return;
    const { home } = fixture();
    const nodeBin = join(home, '.nvm', 'versions', 'node', 'v22.12.0', 'bin');
    mkdirSync(nodeBin, { recursive: true });
    writeFileSync(join(nodeBin, 'node'), '');
    const env = childEnvironment({ HOME: home, PATH: '/usr/bin:/bin', OPENAI_API_KEY: 'not-inherited' }, join(home, 'custom', 'codex'));
    expect(env.PATH?.split(':')).toContain(nodeBin);
    expect(env.PATH?.split(':')).toContain(join(home, 'custom'));
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(cliEnvironment(env).PATH).toBe(env.PATH);
  });
  it('extracts the marked shell PATH while ignoring banners and trailing diagnostics', () => {
    expect(parseLoginShellPath('Welcome\n__FRACTAL_LOGIN_PATH__/opt/homebrew/bin:/usr/bin__FRACTAL_LOGIN_PATH__bye\n')).toBe('/opt/homebrew/bin:/usr/bin');
    expect(mergeLoginShellPath('/usr/bin:/bin', 'banner\n__FRACTAL_LOGIN_PATH__/opt/homebrew/bin:/usr/bin__FRACTAL_LOGIN_PATH__footer')).toBe(
      '/usr/bin:/bin:/opt/homebrew/bin',
    );
    expect(mergeLoginShellPath('/usr/bin:/bin', 'broken shell')).toBe('/usr/bin:/bin');
    expect(parseLoginShellPath('banner\n/usr/bin')).toBeNull();
    expect(parseLoginShellPath('__FRACTAL_LOGIN_PATH__/usr/bin')).toBeNull();
    expect(parseLoginShellPath('__FRACTAL_LOGIN_PATH__/usr/bin\nnoise__FRACTAL_LOGIN_PATH__')).toBeNull();
  });
  it('supplies commands for the Hub platform', () => {
    expect(providerInstallCommand('codex', 'darwin')).toBe('brew install --cask codex');
    expect(providerInstallCommand('codex', 'linux')).toBe('npm install -g @openai/codex');
    expect(providerInstallCommand('claude', 'linux')).toContain('install.sh');
    expect(providerInstallCommand('claude', 'win32')).toContain('install.ps1');
  });
});
