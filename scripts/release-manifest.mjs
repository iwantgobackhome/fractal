import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, copyFile, stat, readlink } from 'node:fs/promises';
import { resolve, join, basename, relative } from 'node:path';

const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const source = [];
for (const path of sourceFiles) {
  const bytes = await readFile(path);
  source.push({ path, sha256: digest(bytes), bytes: bytes.length });
}
const label = process.argv[2];
assert.match(label, /^(win32-x64|linux-x64|darwin-arm64|darwin-x64|android)$/);
const output = resolve('dist/release', label);
await mkdir(output, { recursive: true });
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
await writeFile(
  join(output, `source-${label}.json`),
  JSON.stringify({ version, commit, runId: process.env.GITHUB_RUN_ID ?? null, files: source }, null, 2) + '\n',
);
if (label === 'android') {
  // Legacy 0.2.x clients require this exact name during the clean-break transition.
  await copyFile('apps/android/app/build/outputs/apk/debug/app-debug.apk', join(output, `Fractal-${version}-android-debug.apk`));
  await copyFile('apps/android/app/build/outputs/apk/debug/app-debug.apk', join(output, `News-Papers-${version}-android-debug.apk`));
} else {
  const platform = label.split('-')[0];
  const arch = label.split('-')[1];
  const expected =
    platform === 'win32'
      ? [`News-Papers-${version}-win-${arch}.exe`]
      : platform === 'darwin'
        ? [`News-Papers-${version}-mac-${arch}.dmg`]
        : [`News-Papers-${version}-linux-${arch}.AppImage`, `News-Papers-${version}-linux-${arch}.deb`];
  for (const name of expected) await copyFile(join('dist/installer', name), join(output, name));
  if (platform === 'win32' || platform === 'linux') {
    const metadata = platform === 'win32' ? 'latest.yml' : 'latest-linux.yml';
    await copyFile(join('dist/installer', metadata), join(output, metadata));
    const installerFiles = new Set(await readdir('dist/installer'));
    for (const name of expected) {
      if (installerFiles.has(`${name}.blockmap`)) await copyFile(join('dist/installer', `${name}.blockmap`), join(output, `${name}.blockmap`));
    }
  }
  const smoke = JSON.parse(await readFile(join(output, `smoke-${label}.json`), 'utf8'));
  assert.equal(smoke.version, version);
  assert.equal(smoke.platform, platform);
  assert.equal(smoke.arch, arch);
  assert.ok(smoke.hubStarted && smoke.uiServed && smoke.libraryApi && smoke.ptySpawn);
  // Hash the actual app bundle, including ASAR, unpacked native binaries and Electron.
  const bundle =
    platform === 'win32'
      ? 'dist/installer/win-unpacked'
      : platform === 'linux'
        ? 'dist/installer/linux-unpacked'
        : `dist/installer/${arch === 'arm64' ? 'mac-arm64' : 'mac'}/News Papers.app`;
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        files.push({ path: relative(bundle, path).replaceAll('\\', '/'), sha256: digest(bytes), bytes: bytes.length });
      } else if (entry.isSymbolicLink()) {
        const target = await readlink(path);
        files.push({ path: relative(bundle, path).replaceAll('\\', '/'), type: 'symlink', target, sha256: digest(Buffer.from(target)) });
      }
    }
  }
  await walk(bundle);
  await writeFile(join(output, `package-${label}.json`), JSON.stringify({ version, commit, files }, null, 2) + '\n');
}
const lines = [];
for (const name of (await readdir(output)).sort()) {
  if (name.startsWith('SHA256SUMS')) continue;
  const path = join(output, name);
  assert.ok((await stat(path)).isFile());
  lines.push(`${digest(await readFile(path))}  ${basename(path)}`);
}
await writeFile(join(output, `SHA256SUMS-${label}.txt`), lines.join('\n') + '\n');
console.log(`Prepared release payload: ${output}`);
