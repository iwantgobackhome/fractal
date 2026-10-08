import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'dist/release-all');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const labels = ['win32-x64', 'linux-x64', 'darwin-arm64', 'darwin-x64', 'android'];
const files = await readdir(directory);
const payloads = [
  `News-Papers-${version}-win-x64.exe`,
  `News-Papers-${version}-linux-x64.AppImage`,
  `News-Papers-${version}-linux-x64.deb`,
  `News-Papers-${version}-mac-arm64.dmg`,
  `News-Papers-${version}-mac-x64.dmg`,
  `News-Papers-${version}-android-debug.apk`,
  `Fractal-${version}-android-debug.apk`,
];
for (const name of payloads) assert.ok(files.includes(name), `missing ${name}`);
const updateFiles = {
  'win32-x64': ['latest.yml', `News-Papers-${version}-win-x64.exe.blockmap`],
  'linux-x64': ['latest-linux.yml', `News-Papers-${version}-linux-x64.AppImage.blockmap`],
};
const verified = new Map();
let commit;
for (const label of labels) {
  const manifest = await readFile(join(directory, `SHA256SUMS-${label}.txt`), 'utf8');
  const listed = new Set();
  const distributions = payloads.filter((name) =>
    label === 'android' ? name.endsWith('-android-debug.apk') : name.includes(`-${label.replace('win32', 'win').replace('darwin', 'mac')}.`),
  );
  const allowed = new Set([
    ...distributions,
    ...distributions.map((name) => `${name}.blockmap`).filter(() => label === 'win32-x64' || label === 'linux-x64'),
    ...(updateFiles[label] ?? []),
    `source-${label}.json`,
    ...(label === 'android' ? ['android-verification.json'] : [`smoke-${label}.json`, `package-${label}.json`]),
  ]);
  for (const line of manifest.trim().split('\n')) {
    const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
    assert.ok(match, `invalid checksum row: ${line}`);
    const [, hash, name] = match;
    assert.ok(allowed.has(name), `unexpected file ${name} in ${label}`);
    assert.ok(!verified.has(name), `duplicate artifact ${name}`);
    const bytes = await readFile(join(directory, name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, name);
    verified.set(name, hash);
    listed.add(name);
  }
  for (const name of [...distributions, ...(updateFiles[label] ?? [])]) assert.ok(listed.has(name), `missing ${name} in ${label}`);
  assert.ok(listed.has(`source-${label}.json`));
  const source = JSON.parse(await readFile(join(directory, `source-${label}.json`), 'utf8'));
  assert.equal(source.version, version);
  commit ??= source.commit;
  assert.equal(source.commit, commit, 'all jobs must build one source commit');
  if (process.env.GITHUB_SHA) assert.equal(source.commit, process.env.GITHUB_SHA);
  if (label !== 'android') {
    assert.ok(listed.has(`smoke-${label}.json`) && listed.has(`package-${label}.json`));
    const smoke = JSON.parse(await readFile(join(directory, `smoke-${label}.json`), 'utf8'));
    assert.equal(smoke.version, version);
    assert.equal(`${smoke.platform}-${smoke.arch}`, label);
    assert.ok(smoke.hubStarted && smoke.uiServed && smoke.libraryApi && smoke.ptySpawn && smoke.pdfWorkerStarted);
  } else {
    assert.ok(listed.has('android-verification.json'));
    const apk = JSON.parse(await readFile(join(directory, 'android-verification.json'), 'utf8'));
    assert.equal(apk.version, version);
    assert.equal(apk.versionCode, 15);
    assert.equal(apk.applicationId, 'app.newspapers.reader');
    assert.ok(apk.debugSigned && apk.signatureVerified);
    assert.match(apk.certificateSha256, /^[a-f0-9]{64}$/);
    if (process.env.GITHUB_REF_TYPE === 'tag') assert.ok(apk.previousReleaseCertificateMatched, 'published APK must preserve previous signature');
  }
}
assert.equal(
  verified.get(`News-Papers-${version}-android-debug.apk`),
  verified.get(`Fractal-${version}-android-debug.apk`),
  'legacy Android alias must be identical',
);
for (const name of payloads) assert.ok(verified.has(name), `unverified distribution ${name}`);
for (const name of files)
  assert.ok(verified.has(name) || /^SHA256SUMS-(win32-x64|linux-x64|darwin-arm64|darwin-x64|android)\.txt$/.test(name), `unexpected file ${name}`);
const lines = [];
for (const name of files.sort()) {
  const hash = createHash('sha256')
    .update(await readFile(join(directory, name)))
    .digest('hex');
  lines.push(`${hash}  ${name}`);
}
await writeFile(join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log(`All five native jobs and six installers, the legacy Android alias, and Windows/Linux update metadata and blockmaps verified at ${commit}`);
