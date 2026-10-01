/** Immutable new-package/source binding; reads no user or peer profile. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { listPackage, extractFile } from '@electron/asar';
const root = process.cwd();
const output = join(root, 'dist/pdf-reader-failure-evidence');
const packaged = JSON.parse(readFileSync(join(output, 'packaged/verification.json'), 'utf8'));
const acceptedSource = process.env.PDF_READER_FAILURE_ACCEPTED_SOURCE;
assert.match(acceptedSource ?? '', /^[a-f0-9]{40}$/);
assert.equal(packaged.source, acceptedSource);
assert.equal(packaged.status, 'passed'); assert.equal(packaged.isPackaged, true);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const artifactDirectory = join(root, 'dist/installer-pdf-reader-failure');
const archive = join(artifactDirectory, 'win-unpacked/resources/app.asar');
assert.deepEqual(listPackage(archive, { isPack: false }).filter(path => /(?:reader-failure-evidence|cached-read-evidence|acquisition-evidence|[/\\]tools[/\\]|[/\\]test[/\\]|\.test\.ts$|\.pdf$|[/\\]docs[/\\])/i.test(path)), []);
const files = ['apps/desktop/main.cjs', 'apps/desktop/preload.cjs', 'apps/desktop/dist/hub.mjs', 'apps/desktop/dist/pdf.worker.mjs', 'packages/ui/dist/index.html', ...readdirSync(join(root, 'apps/desktop/assets')).map(n => `apps/desktop/assets/${n}`), ...readdirSync(join(root, 'packages/ui/dist/assets')).map(n => `packages/ui/dist/assets/${n}`)];
const resources = files.map(path => {
  const built = readFileSync(join(root, path)), shipped = extractFile(archive, normalize(path));
  assert.ok(built.equals(shipped), `${path} matches accepted source build`);
  return { path, bytes: shipped.length, sha256: sha(shipped), matchesBuiltSource: true };
});
const artifacts = ['Fractal Setup 0.1.0.exe', 'win-unpacked/Fractal.exe', 'win-unpacked/resources/app.asar'].map(path => { const bytes = readFileSync(join(artifactDirectory, path)); return { path, bytes: bytes.length, sha256: sha(bytes) }; });
const tracked = execFileSync('git', ['ls-tree', '-r', '--name-only', acceptedSource, '--', 'packages/ui', 'packages/shared', 'packages/hub', 'apps/desktop', 'scripts/build-desktop.mjs', 'package.json', 'package-lock.json'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(path => !/(?:[/\\]tools[/\\]|[/\\]test[/\\]|\.test\.(?:ts|tsx)$|\.md$)/.test(path));
const textExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.json', '.html', '.svg', '.sql', '.kt']);
const sourceFiles = tracked.map(path => {
  const working = readFileSync(join(root, path)), git = execFileSync('git', ['show', `${acceptedSource}:${path}`], { maxBuffer: 16 * 1024 * 1024 });
  const text = textExtensions.has(extname(path));
  const result = { path, workingRawSha256: sha(working), gitBlobContentSha256: sha(git), text, rawMatchesGit: working.equals(git) };
  if (text) {
    const lf = b => b.toString('utf8').replace(/\r\n/g, '\n');
    result.workingLfSha256 = sha(lf(working)); result.gitLfSha256 = sha(lf(git)); result.lfMatchesGit = lf(working) === lf(git);
    if (extname(path) === '.json') {
      const canonical = b => JSON.stringify(JSON.parse(b.toString('utf8')));
      result.workingCanonicalJsonSha256 = sha(canonical(working)); result.gitCanonicalJsonSha256 = sha(canonical(git)); result.canonicalJsonMatchesGit = canonical(working) === canonical(git);
    }
    assert.ok(result.lfMatchesGit || result.canonicalJsonMatchesGit, `${path} normalized text matches declared Git source`);
  } else assert.ok(result.rawMatchesGit, `${path} binary matches declared Git source`);
  return result;
});
assert.ok(packaged.ownedProcessExited && packaged.ownedWrapperExited && packaged.listenerReleased);
const historicalBefore = JSON.parse(readFileSync(join(output, 'historical-before.json'), 'utf8').replace(/^\uFEFF/, ''));
const historicalAfter = historicalBefore.map(({ path }) => { const bytes = readFileSync(join(root, path)); return { path, bytes: bytes.length, sha256: sha(bytes) }; });
assert.deepEqual(historicalAfter, historicalBefore);
writeFileSync(join(output, 'historical-after.json'), JSON.stringify(historicalAfter, null, 2));
writeFileSync(join(output, 'package-resources.json'), JSON.stringify({ status: 'passed', acceptedSource, runtimeSource: packaged.source, resources, artifacts, sourceFiles, textHashPolicy: 'Raw working and canonical Git blob content SHA-256 both retained; text compared after CRLF-to-LF, JSON also compared after parse/stringify; binaries compared raw.', excludedVerificationInputs: true, installerInstalled: false, ownedProcessExited: true, ownedWrapperExited: true, listenerReleased: true, earlierArtifactsPreserved: true }, null, 2));
console.log(`${resources.length} shipped resources and ${sourceFiles.length} declared Git product source files verified; immutable artifact identities recorded.`);
