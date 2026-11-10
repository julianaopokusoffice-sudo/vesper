'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Only the console's own origin gets this bridge. Remote pages inside the
 * browser panel never receive it: they have no preload at all.
 */
contextBridge.exposeInMainWorld('vesperDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron,
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
  installCli: () => ipcRenderer.invoke('desktop:install-cli'),
  cliStatus: () => ipcRenderer.invoke('desktop:cli-status'),
  revealData: () => ipcRenderer.invoke('desktop:reveal-data'),
  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    onStatus: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('updates:status', listener);
      return () => ipcRenderer.removeListener('updates:status', listener);
    },
  },
});
