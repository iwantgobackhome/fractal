const { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain, dialog } = require('electron');
const { join, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { writeFile } = require('node:fs/promises');
const { readFileSync } = require('node:fs');

const { migrateDesktopData } = require('./data-migration.cjs');

app.setName('News Papers');
app.setAppUserModelId('app.newspapers.desktop');
// Migrate before Electron creates its profile for the single-instance lock.
try {
  migrateDesktopData({ appData: app.getPath('appData') });
} catch {
  process.stderr.write('News Papers could not copy legacy data; startup stopped.\n');
  app.exit(1);
}
if (!process.env.FRACTAL_DESKTOP_PROFILE) app.setPath('userData', join(app.getPath('appData'), 'News Papers'));
if (process.env.FRACTAL_DESKTOP_PROFILE) app.setPath('userData', process.env.FRACTAL_DESKTOP_PROFILE);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let hub;
  let window;
  let tray;
  let quitting = false;
  let updater;
  let updateState;
  let updateDownloaded = false;
  let updateAvailable = false;
  let availableUpdate;
  let downloadPromise;
  let startupCheck;
  let periodicCheck;
  function sendUpdate(type, detail = {}) {
    const event = { type, ...detail };
    if (type !== 'update-error') updateState = event;
    if (window && !window.isDestroyed()) window.webContents.send('fractal:update', event);
  }
  async function checkUpdates() {
    if (!updater) return;
    if (downloadPromise || updateDownloaded) return availableUpdate ? { status: 'available', version: availableUpdate.version } : undefined;
    try {
      await updater.checkForUpdates();
      return availableUpdate ? { status: 'available', version: availableUpdate.version } : { status: 'current' };
    } catch (error) {
      return { status: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  }
  // macOS builds are unsigned, so Squirrel.Mac cannot apply updates; announce new releases and open the download page.
  const RELEASES = 'https://api.github.com/repos/iwantgobackhome/news-papers/releases/latest';
  function newerVersion(latest, current) {
    const parse = (value) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value))?.slice(1).map(Number);
    const a = parse(latest),
      b = parse(current);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  }
  function macUpdater() {
    let releasePage;
    return {
      async checkForUpdates() {
        try {
          const response = await fetch(RELEASES, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error(`GitHub ${response.status}`);
          const release = await response.json();
          if (release.draft || release.prerelease || !newerVersion(release.tag_name, app.getVersion())) {
            updateAvailable = false;
            availableUpdate = undefined;
            return;
          }
          const version = String(release.tag_name).replace(/^v/, '');
          releasePage = `https://github.com/iwantgobackhome/news-papers/releases/tag/v${version}`;
          updateAvailable = true;
          availableUpdate = { version, manual: true };
          sendUpdate('update-available', availableUpdate);
        } catch (error) {
          throw error;
        }
      },
      async downloadUpdate() {
        if (releasePage) await shell.openExternal(releasePage);
        if (availableUpdate) updateState = undefined;
      },
      quitAndInstall() {},
    };
  }
  function initializeUpdates() {
    if (!app.isPackaged || !['win32', 'linux', 'darwin'].includes(process.platform)) return;
    if (process.platform === 'linux' && !process.env.APPIMAGE) {
      try {
        if (readFileSync(join(process.resourcesPath, 'package-type'), 'utf8').trim() !== 'deb') return;
      } catch {
        return;
      }
    }
    const updates = process.platform === 'darwin' ? undefined : require('electron-updater');
    updater =
      process.platform === 'darwin'
        ? macUpdater()
        : process.platform === 'linux'
          ? process.env.APPIMAGE
            ? new updates.AppImageUpdater()
            : new updates.DebUpdater()
          : updates.autoUpdater;
    if (process.platform !== 'darwin') wireUpdater();
    registerUpdateIpc();
    startupCheck = setTimeout(() => void checkUpdates(), 10000);
    periodicCheck = setInterval(() => void checkUpdates(), 6 * 60 * 60 * 1000);
  }
  function wireUpdater() {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.on('update-available', (info) => {
      updateAvailable = true;
      availableUpdate = { version: info.version, notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined };
      sendUpdate('update-available', availableUpdate);
    });
    updater.on('update-not-available', () => {
      updateAvailable = false;
      availableUpdate = undefined;
    });
    updater.on('download-progress', ({ percent }) => sendUpdate('download-progress', { percent }));
    updater.on('update-downloaded', () => {
      updateDownloaded = true;
      sendUpdate('update-downloaded');
    });
    updater.on('error', () => {
      if (!updateDownloaded && availableUpdate) updateState = { type: 'update-available', ...availableUpdate };
      sendUpdate('update-error');
    });
  }
  function registerUpdateIpc() {
    for (const [action, handler] of Object.entries({
      state: () => updateState,
      check: checkUpdates,
      download: async () => {
        if (!updateAvailable || updateDownloaded) return;
        if (!downloadPromise)
          downloadPromise = updater.downloadUpdate().finally(() => {
            downloadPromise = undefined;
          });
        await downloadPromise;
      },
      install: () => {
        if (updateDownloaded) updater.quitAndInstall(false, true);
      },
    })) {
      ipcMain.handle(`fractal:updates:${action}`, async (event) => {
        const caller = BrowserWindow.fromWebContents(event.sender);
        if (!caller || caller.isDestroyed() || new URL(event.sender.getURL()).origin !== new URL(hub.url).origin) throw new Error('Updates are unavailable');
        return handler();
      });
    }
  }
  const headless = process.argv.includes('--headless');
  const icon = nativeImage.createFromPath(join(__dirname, 'assets', 'icon-256.png'));
  const trayIcon = nativeImage.createFromPath(join(__dirname, 'assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray-color.png'));
  if (process.platform === 'darwin') trayIcon.setTemplateImage(true);
  function openWindow() {
    if (headless) return;
    if (window) {
      window.show();
      window.focus();
      return;
    }
    window = new BrowserWindow({
      width: 1280,
      height: 850,
      minWidth: 820,
      minHeight: 600,
      icon,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: join(__dirname, 'preload.cjs'),
        additionalArguments: [`--fractal-version=${app.getVersion()}`, ...(updater ? ['--fractal-updates'] : [])],
      },
    });
    window.on('minimize', () => window.hide());
    window.on('close', (event) => {
      if (!quitting) {
        event.preventDefault();
        window.hide();
      }
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url) && new URL(url).origin !== new URL(hub.url).origin) void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== new URL(hub.url).origin) {
        event.preventDefault();
        if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      }
    });
    window.webContents.on('did-finish-load', () => {
      if (updateState) window.webContents.send('fractal:update', updateState);
    });
    void window.loadURL(hub.url);
    const screenshot = process.env.FRACTAL_DESKTOP_SCREENSHOT;
    if (screenshot)
      window.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          if (window && !window.isDestroyed()) await writeFile(screenshot, (await window.webContents.capturePage()).toPNG());
        }, 1500);
      });
  }
  function openPairing() {
    const started = hub.service.pairing.start();
    const pairingWindow = new BrowserWindow({
      width: 440,
      height: 520,
      title: 'Pair a device',
      icon,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    pairingWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    pairingWindow.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== new URL(hub.url).origin) event.preventDefault();
    });
    const qr = `${hub.url}/api/pairing/qr.svg?session=${encodeURIComponent(started.session)}`;
    const page = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${hub.url}; style-src 'unsafe-inline'"><style>body{font:16px system-ui;text-align:center;padding:24px;color:#202534}img{width:320px;height:320px}code{font-size:20px}</style><h2>Pair a device</h2><img src="${qr}"><p>Code: <code>${started.payload.code}</code></p><p>Expires in five minutes.</p>`;
    void pairingWindow.loadURL(`data:text/html,${encodeURIComponent(page)}`);
  }
  app.on('second-instance', () => openWindow());
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    quitting = true;
  });
  app
    .whenReady()
    .then(async () => {
      const { startHub, augmentCliPath } = await import(pathToFileURL(join(app.getAppPath(), 'apps/desktop/dist/hub.mjs')).href);
      await augmentCliPath();
      hub = await startHub({ port: 0, indexHtml: join(app.getAppPath(), 'packages/ui/dist/index.html') });
      ipcMain.handle('fractal:save-pdf', async (event, options) => {
        const caller = BrowserWindow.fromWebContents(event.sender);
        if (!caller || caller.isDestroyed() || new URL(event.sender.getURL()).origin !== new URL(hub.url).origin) throw new Error('PDF export is unavailable');
        const requested =
          typeof options?.suggestedName === 'string'
            ? basename(options.suggestedName)
                .replace(/[<>:"/\\|?*]/g, '_')
                .trim()
            : '';
        const suggestedName = (requested || 'News-Papers-translation').replace(/\.pdf$/i, '') + '.pdf';
        const pdf = await event.sender.printToPDF({ printBackground: true, preferCSSPageSize: true });
        const choice = await dialog.showSaveDialog(caller, { defaultPath: suggestedName, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
        if (choice.canceled || !choice.filePath) return { saved: false };
        await writeFile(choice.filePath, pdf);
        return { saved: true, path: choice.filePath };
      });
      initializeUpdates();
      tray = new Tray(trayIcon);
      tray.setToolTip('News Papers');
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Open', click: openWindow },
          { label: 'Pairing', click: openPairing },
          ...(updater
            ? [
                {
                  label: 'Check for updates',
                  click: () => {
                    openWindow();
                    void checkUpdates();
                  },
                },
              ]
            : []),
          { type: 'separator' },
          { label: 'Quit', click: () => app.quit() },
        ]),
      );
      tray.on('double-click', openWindow);
      openWindow();
      process.stdout.write(`${JSON.stringify({ event: 'desktop.ready', url: hub.url, headless })}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error}\n`);
      app.quit();
    });
  app.on('will-quit', () => {
    clearTimeout(startupCheck);
    clearInterval(periodicCheck);
    if (hub) void hub.close();
  });
}
