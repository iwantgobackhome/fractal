// Installs and detects the Codex and Claude CLIs the way a packaged Fractal does.
//   install: run the Hub's own installer (real network install, no elevation).
//   detect:  start from a desktop-launch PATH, recover the login-shell PATH, then resolve and run both CLIs.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProviderInstallManager, executableOnPath } from '../packages/hub/src/ai/install';
import { augmentCliPath, cliEnvironment } from '../packages/hub/src/ai/cli-paths';
import { resolveCodexExecutable } from '../packages/hub/src/codex/runtime';
import { resolveClaudePtyCommand } from '../packages/hub/src/ai/claude-usage';

const run = promisify(execFile);
const mode = process.argv[2];
const providers = ['claude', 'codex'] as const;

if (mode === 'install') {
  // CI runners cannot install Microsoft Store apps, so Windows takes the npm path.
  const installer = new ProviderInstallManager({
    find: (name) => (name === 'winget.exe' ? Promise.resolve(null) : executableOnPath(name)),
  });
  for (const provider of providers) {
    installer.start(provider);
    let progress = installer.get(provider);
    while (progress.state === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      progress = installer.get(provider);
    }
    console.log(`${provider} install: ${JSON.stringify(progress)}`);
    if (progress.state !== 'done') process.exitCode = 1;
  }
} else if (mode === 'detect') {
  if (process.platform !== 'win32') {
    // What Finder, Dock or a desktop launcher hands a GUI app.
    process.env.PATH = process.platform === 'darwin' ? '/usr/bin:/bin:/usr/sbin:/sbin' : '/usr/bin:/bin';
    await augmentCliPath();
  }
  for (const provider of providers) {
    try {
      const command = provider === 'codex' ? { file: await resolveCodexExecutable(), args: [] } : resolveClaudePtyCommand(process.env);
      const { stdout } = await run(command.file, [...command.args, '--version'], {
        env: cliEnvironment(process.env, command.file),
        timeout: 30_000,
        windowsHide: true,
      });
      console.log(`${provider} detected: ${command.file} -> ${stdout.trim()}`);
    } catch (error) {
      console.error(`${provider} NOT detected: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  }
} else {
  console.error('usage: cli-probe.mts install|detect');
  process.exitCode = 2;
}
