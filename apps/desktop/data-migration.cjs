const { cpSync, existsSync, mkdirSync, renameSync, rmSync } = require('node:fs');
const { join, dirname, resolve } = require('node:path');
const { homedir } = require('node:os');

// Publish only complete copies. An interrupted copy leaves a disposable sibling
// which is rebuilt on the next launch; the original directory is never changed.
function copyLegacyDirectory(source, target) {
  if (existsSync(target) || !existsSync(source) || resolve(source) === resolve(target)) return false;
  const temporary = `${target}.fractal-migration`;
  mkdirSync(dirname(target), { recursive: true });
  rmSync(temporary, { recursive: true, force: true });
  try {
    cpSync(source, temporary, { recursive: true, errorOnExist: true, force: false });
    renameSync(temporary, target);
    return true;
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function migrationPaths({ platform = process.platform, env = process.env, home = homedir(), appData }) {
  const dataBase = platform === 'win32' ? (env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')) : (env.XDG_DATA_HOME ?? join(home, '.local', 'share'));
  const profileBase =
    appData ||
    (platform === 'win32'
      ? env.APPDATA || join(home, 'AppData', 'Roaming')
      : platform === 'darwin'
        ? join(home, 'Library', 'Application Support')
        : env.XDG_CONFIG_HOME || join(home, '.config'));
  return [
    ...(env.FRACTAL_DATA === undefined
      ? [[join(dataBase, platform === 'win32' ? 'Fractal' : 'fractal'), join(dataBase, platform === 'win32' ? 'News Papers' : 'news-papers')]]
      : []),
    ...(!env.FRACTAL_DESKTOP_PROFILE ? [[join(profileBase, 'Fractal'), join(profileBase, 'News Papers')]] : []),
  ];
}

function migrateDesktopData(options) {
  for (const [source, target] of migrationPaths(options)) copyLegacyDirectory(source, target);
}
module.exports = { copyLegacyDirectory, migrationPaths, migrateDesktopData };
