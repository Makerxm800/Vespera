/**
 * Vespera main process — the real Chromium browser shell.
 *
 * Startup is fully instrumented and fail-safe:
 *   - every step is written to <userData>/logs/vespera.log
 *   - any fatal error shows a dialog WITH the log path (never a silent exit)
 *   - the window is guaranteed to appear (no "ready-to-show" black hole)
 *   - a second double-click focuses the running window instead of crashing
 */

'use strict';

const { app, BrowserWindow, dialog, ipcMain, session, shell, nativeTheme } = require('electron');
const path = require('node:path');
const log = require('./logger');

// ---- App identity (before anything else) --------------------------------
app.setName('Vespera');
if (process.platform === 'win32') app.setAppUserModelId('app.vespera.browser');

// Packaged apps can't write inside the app bundle — point the local service
// at the OS userData folder (dev keeps ./data in the repo).
if (app.isPackaged && !process.env.VESPERA_DATA) {
  process.env.VESPERA_DATA = path.join(app.getPath('userData'), 'data');
}

log.init(path.join(app.getPath('userData'), 'logs'));

// Safety net: log stray errors instead of popping a crash dialog — but the
// log file always records exactly what happened.
process.on('uncaughtException', (err) => log.error('uncaught exception', err));
process.on('unhandledRejection', (err) => log.error('unhandled rejection', err instanceof Error ? err : new Error(String(err))));

// ---- Single instance ----------------------------------------------------
// A second double-click focuses the existing window instead of booting a
// second copy that would fight over the service port (EADDRINUSE crash).
if (!app.requestSingleInstanceLock()) {
  log.info('second instance detected — focusing the existing window and quitting');
  app.quit();
  return;
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    log.info('focused existing window (second launch)');
  }
});

let mainWindow = null;
let serverHandle = null;
let prefs = {
  shields: {
    enabled: true, blockTrackers: true, blockAds: true, blockAnnoyances: false,
    cleanLinks: true, httpsOnly: true, gpc: true, antiFingerprint: true,
  },
  allowlist: {},
};

function showFatal(title, err) {
  log.error(title, err);
  dialog.showErrorBox(
    'Vespera could not start — ' + title,
    `${(err && (err.stack || err.message)) || err}\n\n` +
    `A full log was written to:\n${log.getLogFile()}\n\n` +
    'Please attach this file if you report the problem.'
  );
}

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
  const url = `http://127.0.0.1:${port}/index.html`;
  log.info(`loading browser UI from ${url}`);
  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    log.info('window shown (ready-to-show)');
  });

  // GUARANTEE the window appears even if the renderer never fires
  // ready-to-show (white-screen / slow start). A browser that opens to a
  // blank window beats a browser that opens to nothing at all.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      log.warn('window shown by fallback timer (ready-to-show never fired)');
    }
  }, 4000);

  // Renderer crashes are logged with details instead of vanishing silently.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log.error('renderer process gone', new Error(JSON.stringify(details)));
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        message: 'A Vespera tab process crashed',
        detail: `${details.reason}\n\nThe browser will reload. Details are in the log:\n${log.getLogFile()}`,
      });
      mainWindow.webContents.reload();
    }
  });

  // External links open in the user's default browser, not in new windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---- IPC: window controls & diagnostics ---------------------------------
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.on('window:incognito', () => {
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
  log.info('incognito window opened');
});

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('downloads:list', () => global.__vesperaDownloads || []);
ipcMain.handle('app:read-log', () => log.readTail(400));
ipcMain.handle('app:log-path', () => log.getLogFile());
ipcMain.handle('app:open-logs', () => {
  shell.openPath(log.getLogDir());
  return log.getLogDir();
});

// ---- App lifecycle -------------------------------------------------------
app.whenReady().then(async () => {
  log.info(`Vespera ${app.getVersion()} starting  (electron ${process.versions.electron}, ${process.platform})`);
  log.info(`userData: ${app.getPath('userData')}`);

  // Start the bundled Vespera service (accounts/sync/community/API).
  // createServer falls back to the next free port if 4600 is taken, so a
  // leftover instance or another app can never crash Vespera at startup.
  try {
    const { createServer } = require('../server/server');
    serverHandle = await createServer({ port: 4600, host: '127.0.0.1' });
    log.info(`service ready on port ${serverHandle.port}`);
  } catch (err) {
    showFatal('local service failed to start', err);
    app.quit();
    return;
  }

  // Install privacy enforcement on the persistent web session.
  // privacy-utils is an ESM module; load with import() (Electron's bundled
  // Node lacks require(esm)). If it ever fails, degrade gracefully — the
  // browser still works, the incident is in the log.
  let pu = null;
  try {
    const { installPrivacy } = require('./privacy');
    pu = await import('../src/shared/privacy-utils.mjs');
    const privacy = installPrivacy(session.defaultSession, () => prefs, (kind, rule, url) => {
      global.__blockLog = global.__blockLog || [];
      if (global.__blockLog.length > 2000) global.__blockLog.shift();
      global.__blockLog.push({ kind, rule, url, at: Date.now() });
    }, pu);
    log.info('privacy engine attached to the browser session');

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
      item.once('done', (_e, state) => {
        entry.status = state;
        log.info(`download finished: ${entry.name} (${state})`);
      });
      mainWindow?.webContents.send('download:started', entry);
      log.info(`download started: ${entry.name}`);
    });

    app.on('web-contents-created', (_e, contents) => {
      if (contents.getType() === 'webview') {
        privacy.protectWebContents(contents, () => prefs);
      }
    });
  } catch (err) {
    log.error('privacy engine failed to attach (browser will run without it)', err);
  }

  createWindow();
  log.info('main window created');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  log.info('all windows closed — quitting');
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
