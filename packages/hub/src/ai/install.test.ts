import { describe, expect, it, vi } from 'vitest';
import { ProviderInstallManager, type InstallDependencies } from './install';

async function waitForJob(manager: ProviderInstallManager, provider: 'codex' | 'claude') {
  for (let index = 0; index < 30 && manager.get(provider).state === 'running'; index++) await new Promise((resolve) => setTimeout(resolve, 1));
  return manager.get(provider);
}

describe('provider installation jobs', () => {
  it('reports an existing executable as ready without running an installer', async () => {
    const execute = vi.fn();
    const manager = new ProviderInstallManager({ platform: 'win32', installed: async () => true, execute });
    expect(manager.get('codex')).toEqual({ state: 'idle' });
    expect(manager.start('codex')).toMatchObject({ state: 'running' });
    expect(await waitForJob(manager, 'codex')).toEqual({ state: 'done', step: 'Ready' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('uses the native Claude installer and verifies its binary', async () => {
    const execute = vi.fn(async () => {});
    const installed = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const dependencies: InstallDependencies = { platform: 'win32', installed, find: async () => 'C:\\Windows\\powershell.exe', execute };
    const manager = new ProviderInstallManager(dependencies);
    manager.start('claude');
    expect(await waitForJob(manager, 'claude')).toMatchObject({ state: 'done' });
    expect(execute).toHaveBeenCalledWith(
      'C:\\Windows\\powershell.exe',
      expect.arrayContaining(['-Command', 'irm https://claude.ai/install.ps1 | iex']),
      expect.any(AbortSignal),
    );
    expect(installed).toHaveBeenCalledTimes(2);
  });

  it('uses the Windows app installer for Codex and never invokes npm without Node', async () => {
    const execute = vi.fn(async () => {});
    const installed = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const manager = new ProviderInstallManager({ platform: 'win32', installed, find: async (name) => (name === 'winget.exe' ? 'winget.exe' : null), execute });
    manager.start('codex');
    expect(await waitForJob(manager, 'codex')).toMatchObject({ state: 'done' });
    expect(execute).toHaveBeenCalledWith('winget.exe', expect.arrayContaining(['--id', '9PLM9XGG6VKS']), expect.any(AbortSignal));

    const missing = new ProviderInstallManager({ platform: 'win32', installed: async () => false, find: async () => null, execute });
    missing.start('codex');
    expect(await waitForJob(missing, 'codex')).toMatchObject({ state: 'failed', message: 'Codex needs Windows App Installer or Node.js with npm' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('uses npm for Codex only when both Node and npm are present', async () => {
    const execute = vi.fn(async () => {});
    const installed = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const manager = new ProviderInstallManager({
      platform: 'win32',
      installed,
      find: async (name) => ({ 'node.exe': 'node.exe', 'npm.cmd': 'C:\\npm\\npm.cmd' })[name] ?? null,
      execute,
    });
    manager.start('codex');
    expect(await waitForJob(manager, 'codex')).toMatchObject({ state: 'done' });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('cmd.exe'),
      expect.arrayContaining(['"C:\\npm\\npm.cmd" install -g @openai/codex']),
      expect.any(AbortSignal),
    );
  });
  it.each(['darwin', 'linux'] as const)('uses the official Claude shell installer on %s', async (platform) => {
    const execute = vi.fn(async () => {});
    const installed = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const manager = new ProviderInstallManager({ platform, installed, execute });
    manager.start('claude');
    expect(await waitForJob(manager, 'claude')).toMatchObject({ state: 'done' });
    expect(execute).toHaveBeenCalledWith('/bin/bash', ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'], expect.any(AbortSignal));
    expect(installed).toHaveBeenCalledTimes(2);
  });
  it('prefers Homebrew on macOS and falls back to npm', async () => {
    for (const brewAvailable of [true, false]) {
      const execute = vi.fn(async () => {});
      const installed = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const manager = new ProviderInstallManager({
        platform: 'darwin',
        installed,
        execute,
        find: async (name) => (name === 'brew' ? (brewAvailable ? '/opt/homebrew/bin/brew' : null) : '/usr/local/bin/npm'),
      });
      manager.start('codex');
      expect(await waitForJob(manager, 'codex')).toMatchObject({ state: 'done' });
      expect(execute).toHaveBeenCalledWith(
        brewAvailable ? '/opt/homebrew/bin/brew' : '/usr/local/bin/npm',
        brewAvailable ? ['install', '--cask', 'codex'] : ['install', '-g', '@openai/codex'],
        expect.any(AbortSignal),
      );
    }
  });
  it.each(['darwin', 'linux'] as const)('reports missing prerequisites without launching an installer on %s', async (platform) => {
    const execute = vi.fn();
    const manager = new ProviderInstallManager({ platform, installed: async () => false, find: async () => null, execute });
    manager.start('codex');
    expect(await waitForJob(manager, 'codex')).toMatchObject({ state: 'failed', message: expect.stringContaining('npm install -g @openai/codex') });
    if (platform === 'darwin') expect(manager.get('codex').message).toContain('brew install --cask codex');
    expect(execute).not.toHaveBeenCalled();
  });
  it('uses only npm on Linux', async () => {
    const execute = vi.fn(async () => {});
    const installed = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const find = vi.fn(async () => '/usr/bin/npm');
    const manager = new ProviderInstallManager({ platform: 'linux', installed, find, execute });
    manager.start('codex');
    expect(await waitForJob(manager, 'codex')).toMatchObject({ state: 'done' });
    expect(find).toHaveBeenCalledExactlyOnceWith('npm');
    expect(execute).toHaveBeenCalledWith('/usr/bin/npm', ['install', '-g', '@openai/codex'], expect.any(AbortSignal));
  });
});
