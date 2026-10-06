import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = (path) => JSON.parse(readFileSync(path, 'utf8'));
const root = load('package.json');
const lock = load('package-lock.json');
assert.match(root.version, /^\d+\.\d+\.\d+$/);
assert.equal(lock.version, root.version);
assert.equal(lock.packages[''].version, root.version);
for (const name of ['shared', 'hub', 'ui']) {
  const path = `packages/${name}`;
  const pkg = load(`${path}/package.json`);
  assert.equal(pkg.version, root.version, path);
  assert.equal(lock.packages[path].version, root.version, `${path} lock`);
  for (const [dependency, version] of Object.entries(pkg.dependencies ?? {})) {
    if (dependency.startsWith('@fractal/')) {
      assert.equal(version, root.version, dependency);
      assert.equal(lock.packages[path].dependencies[dependency], root.version);
    }
  }
}
const android = readFileSync('apps/android/app/build.gradle.kts', 'utf8');
assert.equal(android.match(/versionName\s*=\s*"([^"]+)"/)[1], root.version);
assert.match(android, /applicationId\s*=\s*"app\.newspapers\.reader"/);
assert.equal(Number(android.match(/versionCode\s*=\s*(\d+)/)[1]), 12);
if (process.env.GITHUB_REF_TYPE === 'tag') {
  assert.equal(process.env.GITHUB_REF_NAME, `v${root.version}`, 'tag must exactly match every package');
}
if (process.env.GITHUB_REF_TYPE === 'branch') {
  assert.ok(process.env.GITHUB_REF_NAME.startsWith('release/'), 'remote validation uses an isolated release branch');
}
if (process.env.GITHUB_OUTPUT) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${root.version}\n`);
}
console.log(`Release versions verified: ${root.version}; Android code 12`);
