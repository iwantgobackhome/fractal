/** Match the fresh archive to built source without extracting or installing it. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, normalize } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { listPackage, extractFile } from '@electron/asar';
const root = resolve(import.meta.dirname, '../../..');
const output = join(root, 'docs/implementation/desktop/selection-repair');
const packaged = JSON.parse(readFileSync(join(output, 'packaged.json'), 'utf8'));
assert.equal(packaged.status, 'passed');
const archive = join(root, 'dist/installer-selection-repair/win-unpacked/resources/app.asar');
const entries = listPackage(archive, { isPack: false });
const forbidden = entries.filter((path) => /(?:attention[^/\\]*\.pdf|selection-repair|\/tools\/|\\tools\\|\/test\/fixtures\/)/i.test(path));
assert.deepEqual(forbidden, [], 'no verification tools, reports, fixture PDFs or academic PDF in release');
const files = [
  'apps/desktop/main.cjs',
  'apps/desktop/preload.cjs',
  'apps/desktop/dist/hub.mjs',
  'packages/ui/dist/index.html',
  'apps/desktop/assets/fractal.ico',
  'apps/desktop/assets/icon-256.png',
  'apps/desktop/assets/icon-32.png',
  ...readdirSync(join(root, 'packages/ui/dist/assets'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `packages/ui/dist/assets/${name}`),
];
const resources = files.map((path) => {
  const built = readFileSync(join(root, path)),
    shipped = extractFile(archive, normalize(path));
  assert.ok(built.equals(shipped), path + ' matches current accepted-source build');
  return { path, bytes: shipped.length, sha256: createHash('sha256').update(shipped).digest('hex'), matchesBuiltSource: true };
});
const main = execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `Get-CimInstance Win32_Process -Filter "ProcessId = ${packaged.runtimeIdentity.pid}" | Select-Object ProcessId,ExecutablePath,CreationDate | ConvertTo-Json -Compress`,
  ],
  { encoding: 'utf8' },
).trim();
assert.equal(main, '', 'verified owned main Electron process exited');
const port = new URL(packaged.listener).port;
const listeners = execFileSync(
  'powershell.exe',
  ['-NoProfile', '-Command', `@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).Count`],
  { encoding: 'utf8' },
).trim();
assert.equal(listeners, '0', 'owned packaged listener released');
const result = {
  status: 'passed',
  sourceCommit: packaged.source,
  archive,
  resources,
  excludedVerificationInputs: true,
  installerInstalled: false,
  mainProcessExited: true,
  listenerReleased: true,
  processIdentity: packaged.processIdentity,
  profile: packaged.runtimeIdentity.profile,
  profileRetained: statSync(packaged.runtimeIdentity.profile).isDirectory(),
  directoryRetained: packaged.directory,
  disposition:
    'Application closed through its owned handle after exact identity checks; browser dependencies/seed Hub stopped before package launch; data/profile/artifacts retained; no user or peer resources changed',
};
writeFileSync(join(output, 'package-resources.json'), JSON.stringify(result, null, 2));
console.log('Archive matches accepted-source build; owned Electron main process and listener exited; isolated profile retained.');
