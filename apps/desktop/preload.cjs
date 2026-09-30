const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'fractalDesktop',
  Object.freeze({
    savePdf(options) {
      return ipcRenderer.invoke('fractal:save-pdf', { suggestedName: String(options?.suggestedName ?? '') });
    },
  }),
);
