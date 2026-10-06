const fs = require('node:fs/promises');
const path = require('node:path');

// Snapshot the already extracted, exact target Electron distribution before
// electron-builder deletes its macOS notices. No cache lookup or network call.
const notices = new Map();
async function afterExtract({ appOutDir, electronPlatformName }) {
  const names = [electronPlatformName === 'darwin' ? 'LICENSE' : 'LICENSE.electron.txt', 'LICENSES.chromium.html'];
  notices.set(appOutDir, await Promise.all(names.map((name) => fs.readFile(path.join(appOutDir, name)))));
}
async function afterPack({ appOutDir, packager }) {
  const texts = notices.get(appOutDir);
  if (!texts) throw new Error('Electron license snapshot is missing');
  const directory = path.join(packager.getResourcesDir(appOutDir), 'licenses');
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(['LICENSE.electron.txt', 'LICENSES.chromium.html'].map((name, index) => fs.writeFile(path.join(directory, name), texts[index])));
  notices.delete(appOutDir);
}
module.exports = { afterExtract, afterPack };
