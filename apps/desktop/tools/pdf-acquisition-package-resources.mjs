import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, normalize } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { listPackage, extractFile } from '@electron/asar';
const root = process.cwd();
const output = join(root, 'dist/pdf-acquisition-evidence');
const packaged = JSON.parse(readFileSync(join(output, 'packaged/verification.json'), 'utf8'));
assert.equal(packaged.status, 'passed');
assert.equal(packaged.isPackaged, true);
const archive = join(root, 'dist/installer-pdf-acquisition/win-unpacked/resources/app.asar');
const entries = listPackage(archive, { isPack: false });
assert.deepEqual(
  entries.filter((path) => /(?:pdf-acquisition-evidence|[/\\]tools[/\\]|[/\\]test[/\\]fixtures[/\\]|(?:attention|clip)[^/\\]*\.pdf)/i.test(path)),
  [],
);
const files = [
  'apps/desktop/main.cjs',
  'apps/desktop/preload.cjs',
  'apps/desktop/dist/hub.mjs',
  'apps/desktop/dist/pdf.worker.mjs',
  'packages/ui/dist/index.html',
  ...readdirSync(join(root, 'apps/desktop/assets')).map((name) => `apps/desktop/assets/${name}`),
  ...readdirSync(join(root, 'packages/ui/dist/assets')).map((name) => `packages/ui/dist/assets/${name}`),
];
const resources = files.map((path) => {
  const built = readFileSync(join(root, path)),
    shipped = extractFile(archive, normalize(path));
  assert.ok(built.equals(shipped), `${path} matches accepted source build`);
  return { path, bytes: shipped.length, sha256: createHash('sha256').update(shipped).digest('hex'), matchesBuiltSource: true };
});
const artifacts = ['Fractal Setup 0.1.0.exe', 'win-unpacked/Fractal.exe', 'win-unpacked/resources/app.asar'].map((path) => {
  const absolute = join(root, 'dist/installer-pdf-acquisition', path),
    bytes = readFileSync(absolute);
  return { path: absolute, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
});
const trackedSource = execFileSync(
  'git',
  ['ls-files', 'packages/ui', 'packages/shared', 'packages/hub', 'apps/desktop', 'scripts/build-desktop.mjs', 'package.json', 'package-lock.json'],
  { encoding: 'utf8' },
)
  .trim()
  .split(/\r?\n/)
  .filter((path) => !/(?:[/\\]tools[/\\]|[/\\]test[/\\]|\.test\.ts$|\.md$)/.test(path));
const sourceFiles = trackedSource.map((path) => ({
  path,
  sha256: createHash('sha256')
    .update(readFileSync(join(root, path)))
    .digest('hex'),
}));
assert.equal(packaged.ownedProcessExited, true);
assert.equal(packaged.listenerReleased, true);
writeFileSync(
  join(output, 'package-resources.json'),
  JSON.stringify(
    {
      status: 'passed',
      acceptedSource: packaged.source,
      resources,
      artifacts,
      sourceFiles,
      excludedVerificationInputs: true,
      installerInstalled: false,
      ownedProcessExited: true,
      listenerReleased: true,
      profileRetained: statSync(join(packaged.directory, 'profile')).isDirectory(),
    },
    null,
    2,
  ),
);
console.log('Current package resources, source manifest, artifact hashes and owned cleanup verified.');
