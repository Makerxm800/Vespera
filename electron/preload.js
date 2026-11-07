/**
 * Vespera preload — the only bridge between the browser chrome (renderer)
 * and the privileged Electron main process. Exposes exactly what the UI
 * needs via contextBridge (contextIsolation stays ON).
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vespera', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    incognito: () => ipcRenderer.send('window:incognito'),
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    downloads: () => ipcRenderer.invoke('downloads:list'),
    readLog: () => ipcRenderer.invoke('app:read-log'),
    logPath: () => ipcRenderer.invoke('app:log-path'),
    openLogs: () => ipcRenderer.invoke('app:open-logs'),
  },
  on: (channel, fn) => {
    const allowed = ['download:started', 'download:updated', 'download:done', 'block:stat'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => fn(data));
  },
});
