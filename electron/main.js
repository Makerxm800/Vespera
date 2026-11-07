/**
 * Vespera main process — the real Chromium browser shell.
 *
 * Boots the local Vespera service (accounts, sync, community) and opens a
 * frameless window running the Vespera chrome UI against real webviews.
 * Privacy enforcement (blocking, GPC/DNT, link cleaning, HTTPS upgrades,
 * cosmetic filtering) is installed on the persistent session below.
 */

'use strict';

const { app, BrowserWindow, ipcMain, session, shell, nativeTheme } = require('electron');
const path = require('node:path');

// ---- App identity (before anything else) --------------------------------
app.setName('Vespera');
// Windows taskbar/Dock identity so pinned shortcuts group under "Vespera".
if (process.platform === 'win32') app.setAppUserModelId('app.vespera.browser');

// Packaged apps can't write inside the asar bundle — point the local service
// at the OS userData folder (dev keeps ./data in the repo).
if (app.isPackaged && !process.env.VESPERA_DATA) {
  process.env.VESPERA_DATA = path.join(app.getPath('userData'), 'data');
}

const { installPrivacy } = require('./privacy');
const { createServer } = require('../server/server');

let mainWindow = null;
let serverHandle = null;
let prefs = {
  shields: {
    enabled: true, blockTrackers: true, blockAds: true, blockAnnoyances: false,
    cleanLinks: true, httpsOnly: true, gpc: true, antiFingerprint: true,
  },
  allowlist: {},
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 880,
    minHeight: 560,
    frame: false, // custom Vespera titlebar
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0e1c' : '#f4f1ea',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: true,
    },
  });

  const port = serverHandle ? serverHandle.port : 4600;
  mainWindow.loadURL(`http://127.0.0.1:${port}/index.html`);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // External links open in the user's default browser, not in new windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---- IPC: window controls -----------------------------------------------
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.on('window:incognito', () => {
  // Incognito: a throwaway in-memory partition with full shields.
  const win = new BrowserWindow({
    width: 1100, height: 760, frame: false, show: true,
    backgroundColor: '#0a0e1c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webviewTag: true, partition: 'incognito',
    },
  });
  const port = serverHandle ? serverHandle.port : 4600;
  win.loadURL(`http://127.0.0.1:${port}/index.html`);
});

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('downloads:list', () => global.__vesperaDownloads || []);

// ---- App lifecycle -------------------------------------------------------
app.whenReady().then(async () => {
  // Start the bundled Vespera service (accounts/sync/community/API).
  try {
    serverHandle = await createServer({ port: 4600, host: '127.0.0.1' });
  } catch (err) {
    console.error('[vespera] service failed to start:', err);
  }

  // Install privacy enforcement on the persistent web session.
  // NOTE: privacy-utils is an ESM module; load it with dynamic import() so
  // this works on Electron's bundled Node (which lacks require(esm)).
  const pu = await import('../src/shared/privacy-utils.mjs');
  const privacy = installPrivacy(session.defaultSession, () => prefs, (kind, rule, url) => {
    global.__blockLog = global.__blockLog || [];
    if (global.__blockLog.length > 2000) global.__blockLog.shift();
    global.__blockLog.push({ kind, rule, url, at: Date.now() });
  });

  // Real downloads tracking for the Downloads page.
  global.__vesperaDownloads = [];
  session.defaultSession.on('will-download', (_event, item) => {
    const entry = {
      name: item.getFilename(),
      url: item.getURL(),
      size: formatBytes(item.getTotalBytes()),
      status: 'in-progress',
    };
    global.__vesperaDownloads.unshift(entry);
    item.on('updated', (_e, state) => { entry.status = state; });
    item.once('done', (_e, state) => { entry.status = state; });
    mainWindow?.webContents.send('download:started', entry);
  });

  createWindow();

  // The chrome UI (loaded in the window) uses webviews for page content;
  // protect each one as it appears.
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() === 'webview') {
      privacy.protectWebContents(contents, () => prefs);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Anti-automation / fingerprint surface reduction flags
// (must be set before the app is ready).
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disable-features', 'Translate,MediaRouter');

function formatBytes(n) {
  if (!n || n < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
