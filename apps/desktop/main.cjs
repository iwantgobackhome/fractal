const { app, BrowserWindow, Menu, Tray, nativeImage, shell } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { writeFile } = require('node:fs/promises');

if (!app.requestSingleInstanceLock()) app.quit();
else {
  let hub;
  let window;
  let tray;
  let quitting = false;
  const headless = process.argv.includes('--headless');
  const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABFklEQVQ4T6WTwQ3CMAxFXwdgA7AB2ABsADYAG4ANwAZgA7AB2ABsADYAG4ANgA3gIpEmVfkhpUjvki4V6+f/f7QzSsoD8cEQAFQAkcgn0J/y8BrgDQBnCJfwTeAtxT8gUwBO8B+kwG8AqAF4A74FUC9P1B3Cq6BqAfgBPgU4BrAM4B7oH8AmAfgDbjPoB3APsB5DrgEt0D5CXgGsBXAFuN3HkBtAFvwn4FVAJ4CKgR4A9wH2AeQAAAABJRU5ErkJggg==');
  function openWindow() {
    if (headless) return;
    if (window) { window.show(); window.focus(); return; }
    window = new BrowserWindow({ width: 1280, height: 850, minWidth: 820, minHeight: 600, icon,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.on('minimize', () => window.hide());
    window.on('close', (event) => { if (!quitting) { event.preventDefault(); window.hide(); } });
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
    void window.loadURL(hub.url);
    const screenshot = process.env.FRACTAL_DESKTOP_SCREENSHOT;
    if (screenshot) window.webContents.once('did-finish-load', () => {
      setTimeout(async () => { if (window && !window.isDestroyed()) await writeFile(screenshot, (await window.webContents.capturePage()).toPNG()); }, 1500);
    });
  }
  function openPairing() {
    const started = hub.service.pairing.start();
    const pairingWindow = new BrowserWindow({ width: 440, height: 520, title: 'Pair a device', icon,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    pairingWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    pairingWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== new URL(hub.url).origin) event.preventDefault(); });
    const qr = `${hub.url}/api/pairing/qr.svg?session=${encodeURIComponent(started.session)}`;
    const page = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${hub.url}; style-src 'unsafe-inline'"><style>body{font:16px system-ui;text-align:center;padding:24px;color:#202534}img{width:320px;height:320px}code{font-size:20px}</style><h2>Pair a device</h2><img src="${qr}"><p>Code: <code>${started.payload.code}</code></p><p>Expires in five minutes.</p>`;
    void pairingWindow.loadURL(`data:text/html,${encodeURIComponent(page)}`);
  }
  app.on('second-instance', () => openWindow());
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => { quitting = true; });
  app.whenReady().then(async () => {
    const { startHub } = await import(pathToFileURL(join(app.getAppPath(), 'apps/desktop/dist/hub.mjs')).href);
    hub = await startHub({ port: 0, indexHtml: join(app.getAppPath(), 'packages/ui/dist/index.html') });
    tray = new Tray(icon);
    tray.setToolTip('Fractal');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open', click: openWindow }, { label: 'Pairing', click: openPairing },
      { type: 'separator' }, { label: 'Quit', click: () => app.quit() },
    ]));
    tray.on('double-click', openWindow);
    openWindow();
    process.stdout.write(`${JSON.stringify({ event: 'desktop.ready', url: hub.url, headless })}\n`);
  }).catch((error) => { process.stderr.write(`${error.stack || error}\n`); app.quit(); });
  app.on('will-quit', () => { if (hub) void hub.close(); });
}
