/** Narrow, sender-validated bridge. Website guests receive no preload or Node access. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const send = (channel) => ipcRenderer.send(channel);
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('vespera', {
  window: {
    isPrivate: process.argv.includes('--vespera-private'),
    minimize: () => send('window:minimize'), maximize: () => send('window:maximize'),
    close: () => send('window:close'), incognito: () => send('window:incognito'),
    toggleFullscreen: () => send('window:fullscreen-toggle'),
  },
  prefs: { save: (value) => invoke('prefs:save', value) },
  app: {
    version: () => invoke('app:version'), readLog: () => invoke('app:read-log'),
    logPath: () => invoke('app:log-path'), openLogs: () => invoke('app:open-logs'),
    setDefaultBrowser: () => invoke('app:default-browser'),
    downloads: () => invoke('downloads:list'), download: (url) => invoke('downloads:start', url),
    downloadAction: (action, id) => invoke('downloads:action', action, id),
    clearDownloads: () => invoke('downloads:clear'),
    chooseDownloadFolder: () => invoke('downloads:choose-folder'),
    openDownloadFolder: () => invoke('downloads:folder'),
  },
  permissions: { list: () => invoke('permissions:list'), reset: () => invoke('permissions:reset') },
  extensions: {
    list: () => invoke('extensions:list'), install: () => invoke('extensions:install'),
    installFromStore: (url) => invoke('extensions:install-store', url),
    remove: (id) => invoke('extensions:remove', id),
  },
  on: (channel, fn) => {
    const allowed = ['download:started', 'download:updated', 'download:done', 'shield:stat', 'window:maximized', 'menu:action', 'browser:new-tab', 'browser:shortcut', 'browser:fullscreen', 'browser:zoom-changed', 'browser:new-tab-background', 'browser:search-selection'];
    if (!allowed.includes(channel) || typeof fn !== 'function') return () => {};
    const listener = (_event, data) => fn(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
