const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'fractalDesktop',
  Object.freeze({
    version: process.argv.find((arg) => arg.startsWith('--fractal-version='))?.slice('--fractal-version='.length),
    ...(process.argv.includes('--fractal-updates')
      ? {
          updates: Object.freeze({
            onEvent(callback) {
              let active = true;
              let received = false;
              const listener = (_event, detail) => {
                received = true;
                callback(detail);
              };
              ipcRenderer.on('fractal:update', listener);
              ipcRenderer
                .invoke('fractal:updates:state')
                .then((detail) => {
                  if (active && !received && detail) callback(detail);
                })
                .catch(() => {});
              return () => {
                active = false;
                ipcRenderer.removeListener('fractal:update', listener);
              };
            },
            check: () => ipcRenderer.invoke('fractal:updates:check'),
            download: () => ipcRenderer.invoke('fractal:updates:download'),
            install: () => ipcRenderer.invoke('fractal:updates:install'),
          }),
        }
      : {}),
    readLicenses: () => ipcRenderer.invoke('fractal:licenses:read'),
    savePdf(options) {
      return ipcRenderer.invoke('fractal:save-pdf', { suggestedName: String(options?.suggestedName ?? '') });
    },
  }),
);
