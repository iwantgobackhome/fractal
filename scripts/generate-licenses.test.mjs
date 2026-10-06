import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionPackages, formatLicenses } from './generate-licenses.mjs';
test('production closure follows transitive dependencies and deduplicates', () => {
  const lock = {
    packages: {
      '': { dependencies: { a: '1', b: '1' }, devDependencies: { dev: '1' } },
      'node_modules/a': { dependencies: { b: '1' } },
      'node_modules/b': {},
      'node_modules/dev': {},
    },
  };
  assert.deepEqual(productionPackages(lock, ['']), ['node_modules/a', 'node_modules/b']);
});
test('license output deduplicates versions and explicitly reports missing text', () => {
  const pkg = { name: 'a', version: '1', license: 'MIT', repository: { url: 'https://example.org/a' } };
  const output = formatLicenses([pkg, pkg, { ...pkg, version: '2', text: 'Full license' }]);
  assert.equal(output.match(/a@1/g).length, 1);
  assert.match(output, /No license text included/);
  assert.match(output, /Full license/);
  assert.match(output, /Repository: https:\/\/example.org\/a/);
});
