const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { afterExtract, afterPack } = require('./preserve-electron-licenses.cjs');
for (const platform of ['darwin', 'win32', 'linux']) {
  test(`preserves ${platform} notices after upstream files are removed`, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'electron-licenses-'));
    try {
      const name = platform === 'darwin' ? 'LICENSE' : 'LICENSE.electron.txt';
      await fs.writeFile(path.join(directory, name), 'Electron MIT notice');
      await fs.writeFile(path.join(directory, 'LICENSES.chromium.html'), '<html>Chromium licenses</html>');
      await afterExtract({ appOutDir: directory, electronPlatformName: platform });
      await fs.unlink(path.join(directory, name));
      await fs.unlink(path.join(directory, 'LICENSES.chromium.html'));
      const resources = path.join(directory, 'resources');
      await afterPack({ appOutDir: directory, packager: { getResourcesDir: () => resources } });
      assert.equal(await fs.readFile(path.join(resources, 'licenses/LICENSE.electron.txt'), 'utf8'), 'Electron MIT notice');
      assert.equal(await fs.readFile(path.join(resources, 'licenses/LICENSES.chromium.html'), 'utf8'), '<html>Chromium licenses</html>');
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
}
