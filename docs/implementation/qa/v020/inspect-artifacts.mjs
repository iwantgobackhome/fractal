// Read downloaded evidence only. Output goes to this worker's QA directory.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [input, acceptedCommit] = process.argv.slice(2);
assert.ok(input && /^[a-f0-9]{40}$/.test(acceptedCommit), 'Supply actual artifact directory and accepted full commit');
const directory = resolve(input);
const labels = ['win32-x64', 'linux-x64', 'darwin-arm64', 'darwin-x64', 'android'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = name => JSON.parse(readFileSync(join(directory, name), 'utf8'));
const report = { acceptedCommit, inspectedAt: new Date().toISOString(), directory, scope: 'downloaded actual CI payloads and manifests; no installation or desktop GUI runtime claim', checksums: [], jobs: [], distributions: [] };
const verified = new Map();
for (const label of labels) {
  for (const line of readFileSync(join(directory, `SHA256SUMS-${label}.txt`), 'utf8').trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
    assert.ok(match, `checksum format ${label}`);
    const [, expected, name] = match;
    assert.ok(!verified.has(name), `duplicate ${name}`);
    const bytes = readFileSync(join(directory, name));
    assert.equal(sha(bytes), expected, name);
    verified.set(name, expected);
    report.checksums.push({ name, sha256: expected, bytes: bytes.length });
  }
}
const sourcePaths = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', acceptedCommit], { encoding: 'utf8' }).split('\0').filter(Boolean);
const batch = execFileSync('git', ['cat-file', '--batch'], { input: sourcePaths.map(p => `${acceptedCommit}:${p}\n`).join(''), maxBuffer: 512 * 1024 * 1024 });
const expectedFiles = new Map();
let offset = 0;
for (const path of sourcePaths) {
  const end = batch.indexOf(10, offset);
  const header = batch.subarray(offset, end).toString();
  const match = /^[a-f0-9]+ blob (\d+)$/.exec(header);
  assert.ok(match, `git blob ${path}`);
  const length = Number(match[1]);
  const bytes = batch.subarray(end + 1, end + 1 + length);
  offset = end + 1 + length + 1;
  // Git Windows checkouts may translate text line endings. Record that distinction.
  const text = !bytes.includes(0) && !/\.(png|jpg|jpeg|gif|webp|pdf|woff2?|ttf|otf|ico|icns|jar|zip|gz)$/i.test(path);
  const crlf = text ? Buffer.from(bytes.toString('utf8').replace(/\r?\n/g, '\r\n')) : bytes;
  expectedFiles.set(path, { sha256: sha(bytes), bytes: bytes.length, crlfSha256: sha(crlf), crlfBytes: crlf.length });
}
for (const label of labels) {
  const source = json(`source-${label}.json`);
  assert.equal(source.commit, acceptedCommit, `${label} commit`);
  assert.equal(source.version, '0.2.0');
  assert.deepEqual(source.files.map(f => f.path).sort(), [...sourcePaths].sort(), `${label} tracked source paths`);
  const translations = [];
  for (const file of source.files) {
    const expected = expectedFiles.get(file.path);
    const canonical = file.sha256 === expected.sha256 && file.bytes === expected.bytes;
    const windowsText = label === 'win32-x64' && file.sha256 === expected.crlfSha256 && file.bytes === expected.crlfBytes;
    assert.ok(canonical || windowsText, `${label} source differs from accepted Git blob: ${file.path}`);
    if (!canonical) translations.push(file.path);
  }
  const job = { label, commit: source.commit, runId: source.runId, sourceFiles: source.files.length, windowsCrlfTranslations: translations };
  if (label !== 'android') {
    const smoke = json(`smoke-${label}.json`), bundle = json(`package-${label}.json`);
    assert.equal(bundle.commit, acceptedCommit); assert.equal(bundle.version, '0.2.0');
    assert.equal(smoke.version, '0.2.0'); assert.equal(`${smoke.platform}-${smoke.arch}`, label);
    assert.ok(smoke.hubStarted && smoke.uiServed && smoke.libraryApi && smoke.ptySpawn);
    assert.ok(smoke.binaries.some(p => /node-pty.*\.node$/.test(p)));
    const resources = new Map(smoke.resources.map(f => [f.path.replaceAll('\\', '/'), f]));
    assert.ok(resources.has('package.json') && resources.has('apps/desktop/dist/hub.mjs') && resources.has('packages/ui/dist/index.html'));
    assert.ok([...resources.keys()].some(p => /assets\/.*\.js$/.test(p)));
    assert.ok([...resources.keys()].some(p => /node-pty.*\.node$/.test(p)));
    const prefix = label.startsWith('darwin') ? 'Contents/Resources/' : 'resources/';
    const bundleFiles = new Map(bundle.files.map(f => [f.path, f]));
    assert.ok(bundleFiles.has(`${prefix}app.asar`), `${label} ASAR hash`);
    assert.ok(bundleFiles.has(label === 'win32-x64' ? 'Fractal.exe' : label.startsWith('darwin') ? 'Contents/MacOS/Fractal' : 'fractal'));
    for (const resource of smoke.resources.filter(r => r.path.includes('app.asar.unpacked'))) {
      const packaged = bundleFiles.get(prefix + resource.path);
      assert.ok(packaged, `${label} unpacked native resource ${resource.path}`);
      assert.equal(packaged.sha256, resource.sha256); assert.equal(packaged.bytes, resource.bytes);
    }
    const links = bundle.files.filter(f => f.type === 'symlink');
    if (label.startsWith('darwin')) assert.ok(links.length, `${label} framework symlinks must be recorded`);
    for (const link of links) assert.equal(link.sha256, sha(Buffer.from(link.target)));
    job.runtime = { hub: smoke.hubStarted, ui: smoke.uiServed, library: smoke.libraryApi, nativePtySpawn: smoke.ptySpawn, executable: smoke.executable, nativeBinaries: smoke.binaries, resources: smoke.resources.length, bundleFiles: bundle.files.length, symlinks: links.length };
  } else {
    const apk = json('android-verification.json');
    assert.equal(apk.version, '0.2.0'); assert.equal(apk.versionCode, 2); assert.equal(apk.applicationId, 'app.fractal.reader');
    assert.equal(apk.certificateSha256, '62e0698d0572e672aa65a999c6e6e4a6669fb2baf4ca0c6f9c2ce7f82bdd7f4f');
    assert.ok(apk.signatureVerified && apk.debugSigned && apk.previousReleaseCertificateMatched);
    assert.equal(apk.runtimeVerified, false);
    job.apk = { version: apk.version, versionCode: apk.versionCode, applicationId: apk.applicationId, certificateSha256: apk.certificateSha256, signatureVerified: apk.signatureVerified, installedByThisReview: false };
  }
  report.jobs.push(job);
}
const payloads = ['Fractal-0.2.0-win-x64.exe', 'Fractal-0.2.0-linux-x64.AppImage', 'Fractal-0.2.0-linux-x64.deb', 'Fractal-0.2.0-mac-arm64.dmg', 'Fractal-0.2.0-mac-x64.dmg', 'Fractal-0.2.0-android-debug.apk'];
for (const name of payloads) {
  assert.ok(verified.has(name), name);
  const bytes = readFileSync(join(directory, name));
  let format;
  if (name.endsWith('.exe')) { assert.equal(bytes.subarray(0, 2).toString(), 'MZ'); format = 'Windows PE installer'; }
  else if (name.endsWith('.AppImage')) { assert.deepEqual([...bytes.subarray(0, 4)], [127, 69, 76, 70]); assert.equal(bytes.readUInt16LE(18), 62); format = 'ELF x86-64 AppImage'; }
  else if (name.endsWith('.deb')) { assert.equal(bytes.subarray(0, 8).toString(), '!<arch>\n'); format = 'Debian ar package'; }
  else if (name.endsWith('.dmg')) { assert.equal(bytes.subarray(bytes.length - 512, bytes.length - 508).toString(), 'koly'); format = 'Apple UDIF disk image'; }
  else { assert.equal(bytes.subarray(0, 2).toString(), 'PK'); format = 'APK ZIP'; }
  report.distributions.push({ name, sha256: verified.get(name), bytes: bytes.length, format });
}
const aggregated = readFileSync(join(directory, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/);
for (const line of aggregated) {
  const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line); assert.ok(match);
  assert.equal(sha(readFileSync(join(directory, match[2]))), match[1]);
}
assert.equal(aggregated.length, readdirSync(directory).filter(n => n !== 'SHA256SUMS.txt').length);
writeFileSync('docs/implementation/qa/v020/artifact-evidence.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ commit: acceptedCommit, jobs: report.jobs.length, distributions: report.distributions, checkedFiles: report.checksums.length }, null, 2));
