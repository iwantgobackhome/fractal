import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Optional PTY packages are installed for the host architecture by npm ci.
// Each architecture is packaged and smoked on its own native Mac host.
assert.equal(process.platform, 'darwin', 'Build macOS distributions on a macOS host');
assert.ok(['arm64', 'x64'].includes(process.arch));
const child = spawn(process.execPath, [resolve('node_modules/electron-builder/out/cli/cli.js'), '--config', 'scripts/release-config.cjs', '--mac', 'dmg', `--${process.arch}`, '--publish', 'never'], { stdio: 'inherit', env: process.env });
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
