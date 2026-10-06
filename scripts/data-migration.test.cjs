const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { copyLegacyDirectory, migrationPaths, migrateDesktopData } = require('../apps/desktop/data-migration.cjs');

for (const platform of ['win32', 'darwin', 'linux']) {
  test(`copies legacy Hub and Electron data on ${platform}, retaining originals`, () => {
    const home = mkdtempSync(join(tmpdir(), 'news-papers-migration-'));
    try {
      const options = { platform, home, env: {} };
      for (const [oldPath, newPath] of migrationPaths(options)) {
        mkdirSync(join(oldPath, 'nested'), { recursive: true });
        writeFileSync(join(oldPath, 'nested', 'sentinel'), 'saved data');
        mkdirSync(`${newPath}.fractal-migration`, { recursive: true });
        writeFileSync(join(`${newPath}.fractal-migration`, 'partial'), 'interrupted copy');
      }
      migrateDesktopData(options);
      for (const [oldPath, newPath] of migrationPaths(options)) {
        assert.equal(readFileSync(join(oldPath, 'nested', 'sentinel'), 'utf8'), 'saved data');
        assert.equal(readFileSync(join(newPath, 'nested', 'sentinel'), 'utf8'), 'saved data');
        assert.equal(existsSync(join(newPath, 'partial')), false);
        writeFileSync(join(newPath, 'nested', 'sentinel'), 'new data');
        assert.equal(copyLegacyDirectory(oldPath, newPath), false);
        assert.equal(readFileSync(join(newPath, 'nested', 'sentinel'), 'utf8'), 'new data');
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
}
test('honors custom paths and platform environment defaults', () => {
  assert.deepEqual(migrationPaths({ platform: 'linux', home: '/home/user', env: { FRACTAL_DATA: '/custom', FRACTAL_DESKTOP_PROFILE: '/profile' } }), []);
  assert.deepEqual(migrationPaths({ platform: 'win32', home: '/home/user', env: { LOCALAPPDATA: '/local', APPDATA: '/roaming' } }), [
    ['/local/Fractal', '/local/News Papers'],
    ['/roaming/Fractal', '/roaming/News Papers'],
  ]);
  assert.deepEqual(migrationPaths({ platform: 'linux', home: '/home/user', env: { XDG_DATA_HOME: '/data', XDG_CONFIG_HOME: '/config' } }), [
    ['/data/fractal', '/data/news-papers'],
    ['/config/Fractal', '/config/News Papers'],
  ]);
});
test('empty explicit Hub override is preserved', () => {
  assert.equal(migrationPaths({ platform: 'linux', home: '/home/user', env: { FRACTAL_DATA: '' } }).length, 1);
});

test('missing legacy data does not create a destination', () => {
  const root = mkdtempSync(join(tmpdir(), 'news-papers-migration-'));
  try {
    assert.equal(copyLegacyDirectory(join(root, 'missing'), join(root, 'new')), false);
    assert.equal(existsSync(join(root, 'new')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
