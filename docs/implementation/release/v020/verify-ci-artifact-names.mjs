import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Initialize the public entry first; its internal platform modules share cycles.
require('app-builder-lib');
const { PlatformPackager } = require('app-builder-lib/out/platformPackager.js');
const { Arch } = require('builder-util');
const config = require('../../../../scripts/release-config.cjs');
const { version } = require('../../../../package.json');
const packager = Object.create(PlatformPackager.prototype);
packager.info = { config };
packager.platform = { buildConfigurationKey: 'linux' };
packager.appInfo = { version };
packager.platformSpecificBuildOptions = { ...config.linux };
for (const target of config.linux.target) assert.deepEqual(target.arch, ['x64']);

// Exercise the installed v26 filename expansion, including target arch aliases.
delete packager.platformSpecificBuildOptions.artifactName;
assert.equal(packager.expandArtifactNamePattern({}, 'AppImage', Arch.x64), `Fractal-${version}-linux-x86_64.AppImage`);
assert.equal(packager.expandArtifactNamePattern({}, 'deb', Arch.x64), `Fractal-${version}-linux-amd64.deb`);
packager.platformSpecificBuildOptions = config.linux;
for (const ext of ['AppImage', 'deb']) {
  const actual = packager.expandArtifactNamePattern(config.linux, ext, Arch.x64);
  assert.equal(actual, `Fractal-${version}-linux-x64.${ext}`);
  console.log(`PASS installed electron-builder Linux filename expansion: ${actual}`);
}
