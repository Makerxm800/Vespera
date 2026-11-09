/** Vespera desktop shell: real Chromium tabs, native window controls, downloads and privacy. */
'use strict';
const { app, BrowserWindow, dialog, ipcMain, session, shell, nativeTheme, Menu, webContents } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const log = require('./logger');
const { DownloadManager } = require('./downloads');
const { installExtensions } = require('./extensions');
const permissions = require('./permissions');

app.setName('Vespera');
if (process.platform === 'win32') app.setAppUserModelId('app.vespera.browser');
if (app.isPackaged && !process.env.VESPERA_DATA) process.env.VESPERA_DATA = path.join(app.getPath('userData'), 'data');
log.init(path.join(app.getPath('userData'), 'logs'));
process.on('uncaughtException', (err) => log.error('Uncaught exception', err));
process.on('unhandledRejection', (err) => log.error('Unhandled rejection', err instanceof Error ? err : new Error(String(err))));
if (!app.requestSingleInstanceLock()) { app.quit(); return; }
app.on('second-instance', () => { const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : [...windows][0]; if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

const windows = new Set();
let mainWindow = null, serverHandle = null, downloadManager, extensionManager, normalSession, privateSession;
const prefsFile = path.join(app.getPath('userData'), 'preferences.json');
let prefs = { shields: { enabled: true, blockTrackers: true, blockAds: true, blockAnnoyances: false, cleanLinks: true, httpsOnly: true, gpc: true }, allowlist: {}, askDownloadLocation: true, downloadPath: '', extensionPaths: [], sitePermissions: {} };
try { const saved = JSON.parse(fs.readFileSync(prefsFile, 'utf8')); if (saved && typeof saved === 'object') prefs = { ...prefs, ...saved, shields: { ...prefs.shields, ...(saved.shields || {}) } }; } catch { /* First launch. */ }
prefs.sitePermissions = permissions.normalizeStore(prefs.sitePermissions);
function persistPrefs() { try { fs.writeFileSync(prefsFile, JSON.stringify(prefs, null, 2), { mode: 0o600 }); } catch (err) { log.error('Could not save preferences', err); } }
function uiUrl() { return `http://127.0.0.1:${serverHandle?.port || 4600}/index.html`; }
function isTrustedSender(event) { return windows.has(BrowserWindow.fromWebContents(event.sender)) && event.sender.getURL().startsWith(uiUrl()) && event.senderFrame === event.sender.mainFrame; }
function handle(channel, fn) { ipcMain.handle(channel, (event, ...args) => { if (!isTrustedSender(event)) return { ok: false, message: 'Untrusted browser request.' }; try { return fn(event, ...args); } catch (err) { log.error(channel, err); return { ok: false, message: err.message }; } }); }
function isPrivateEvent(event) { return Boolean(BrowserWindow.fromWebContents(event.sender)?.__vesperaPrivate); }
function sendMenu(action) { BrowserWindow.getFocusedWindow()?.webContents.send('menu:action', action); }

function createWindow({ privateMode = false } = {}) {
  const win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 720, minHeight: 500, frame: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0e1c' : '#f4f1ea', show: false,
    title: privateMode ? 'Vespera — Private' : 'Vespera',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false,
      sandbox: true, webviewTag: true, spellcheck: true,
      ...(privateMode ? { partition: 'incognito', additionalArguments: ['--vespera-private'] } : {}),
    },
  });
  win.__vesperaPrivate = privateMode;
  win.webContents.on('will-attach-webview', (_event, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false; webPreferences.contextIsolation = true; webPreferences.sandbox = true;
    webPreferences.partition = privateMode ? 'incognito' : 'persist:vespera';
  });
  windows.add(win);
  if (!privateMode) mainWindow = win;
  win.loadURL(uiUrl()).catch((err) => { log.error('Could not load browser UI', err); win.show(); dialog.showErrorBox('Vespera could not load its interface', `${err.message}\n\nLog: ${log.getLogFile()}`); });
  win.once('ready-to-show', () => { win.show(); if (privateMode) win.webContents.send('window:maximized', win.isMaximized()); });
  const fallback = setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) { win.show(); log.warn('Window shown by startup fallback.'); } }, 4000);
  win.webContents.on('render-process-gone', (_e, details) => { log.error('Browser UI process gone', new Error(JSON.stringify(details))); if (!win.isDestroyed()) win.webContents.reload(); });
  win.webContents.on('did-fail-load', (_e, code, description) => { if (code !== -3) log.error(`Browser UI load failed: ${description} (${code})`); });
  win.on('maximize', () => win.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win.webContents.send('window:maximized', false));
  win.on('enter-full-screen', () => { win.webContents.send('window:maximized', true); win.webContents.send('browser:fullscreen', true); });
  win.on('leave-full-screen', () => { win.webContents.send('window:maximized', win.isMaximized()); win.webContents.send('browser:fullscreen', false); });
  win.on('closed', () => {
    clearTimeout(fallback); windows.delete(win);
    if (mainWindow === win) mainWindow = [...windows].find((w) => !w.__vesperaPrivate) || null;
    if (privateMode && ![...windows].some((other) => other.__vesperaPrivate && !other.isDestroyed())) {
      downloadManager?.clear(true);
      Promise.all([privateSession?.clearStorageData(), privateSession?.clearCache()]).catch((err) => log.warn('Could not fully clear the private session', err));
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch((err) => log.error('Open external failed', err)); return { action: 'deny' }; });
  log.info(`${privateMode ? 'Private' : 'Normal'} window created`);
  return win;
}

function registerIpc() {
  const on = (channel, fn) => ipcMain.on(channel, (event, ...args) => { if (isTrustedSender(event)) fn(BrowserWindow.fromWebContents(event.sender), ...args); });
  on('window:minimize', (win) => win.minimize());
  on('window:maximize', (win) => win.isMaximized() ? win.unmaximize() : win.maximize());
  on('window:close', (win) => win.close());
  on('window:fullscreen-toggle', (win) => win.setFullScreen(!win.isFullScreen()));
  on('window:incognito', () => createWindow({ privateMode: true }));
  handle('app:version', () => app.getVersion());
  handle('prefs:save', (event, value) => {
    if (isPrivateEvent(event) || !value || typeof value !== 'object') return { ok: true };
    prefs = { ...prefs, ...value, shields: { ...prefs.shields, ...(value.shields || {}) }, allowlist: { ...(value.allowlist || {}) }, extensionPaths: prefs.extensionPaths || [], sitePermissions: prefs.sitePermissions };
    delete prefs.wallpaperData; persistPrefs(); return { ok: true };
  });
  handle('downloads:list', (event) => downloadManager.list(isPrivateEvent(event)));
  handle('downloads:action', (event, action, id) => downloadManager.action(action, String(id), isPrivateEvent(event)));
  handle('downloads:clear', (event) => { downloadManager.clear(isPrivateEvent(event)); return { ok: true }; });
  handle('downloads:start', (event, url) => {
    if (!/^https?:\/\//i.test(String(url))) return { ok: false, message: 'Only HTTP and HTTPS files can be downloaded.' };
    (isPrivateEvent(event) ? privateSession : normalSession).downloadURL(url); return { ok: true };
  });
  handle('downloads:folder', async () => { const folder = prefs.downloadPath && fs.existsSync(prefs.downloadPath) ? prefs.downloadPath : app.getPath('downloads'); const error = await shell.openPath(folder); return { ok: !error, message: error }; });
  handle('downloads:choose-folder', async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { properties: ['openDirectory', 'createDirectory'], title: 'Choose download folder' });
    if (result.canceled) return { ok: false, canceled: true };
    prefs.downloadPath = result.filePaths[0]; persistPrefs(); return { ok: true, path: prefs.downloadPath };
  });
  handle('app:read-log', () => log.readTail(400));
  handle('app:log-path', () => log.getLogFile());
  handle('app:open-logs', async () => { const error = await shell.openPath(log.getLogDir()); return { ok: !error, path: log.getLogDir(), message: error }; });
  handle('app:default-browser', () => {
    if (!app.isPackaged) return { ok: false, message: 'Install a Vespera release build first. A source checkout cannot safely register itself as your default browser.' };
    const results = ['http', 'https'].map((protocol) => app.setAsDefaultProtocolClient(protocol));
    const ok = results.every(Boolean) && app.isDefaultProtocolClient('https');
    return { ok, message: ok ? 'Vespera is now your default web browser.' : 'Your operating system did not accept the change. Set Vespera as the default browser in system settings.' };
  });
  handle('permissions:list', (event) => isPrivateEvent(event) ? [] : permissions.summarize(prefs.sitePermissions));
  handle('permissions:reset', (event) => { if (!isPrivateEvent(event)) { permissions.reset(prefs.sitePermissions); persistPrefs(); } return { ok: true }; });
  handle('extensions:list', (event) => isPrivateEvent(event) ? [] : extensionManager.list());
  handle('extensions:install', (event) => isPrivateEvent(event) ? { ok: false, message: 'Extensions are disabled in private windows.' } : extensionManager.install());
  handle('extensions:remove', (event, id) => isPrivateEvent(event) ? { ok: false, message: 'Extensions are disabled in private windows.' } : extensionManager.remove(String(id)));
}
function buildMenu() {
  const item = (label, action, accelerator) => ({ label, accelerator, click: () => sendMenu(action) });
  const template = [
    { label: 'File', submenu: [item('New Tab', 'newtab', 'CmdOrCtrl+T'), item('Reopen Closed Tab', 'reopen', 'CmdOrCtrl+Shift+T'), item('New Private Window', 'private', 'CmdOrCtrl+Shift+N'), { type: 'separator' }, item('Close Tab', 'closetab', 'CmdOrCtrl+W'), { role: 'close', label: 'Close Window' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [item('Reload Page', 'reload', 'CmdOrCtrl+R'), item('Find in Page', 'find', 'CmdOrCtrl+F'), item('Zoom In', 'zoom-in', 'CmdOrCtrl+Plus'), item('Zoom Out', 'zoom-out', 'CmdOrCtrl+-'), item('Actual Size', 'zoom-reset', 'CmdOrCtrl+0'), { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
    { label: 'History', submenu: [item('Back', 'back', 'Alt+Left'), item('Forward', 'forward', 'Alt+Right'), item('Home', 'home', 'Alt+Home'), { type: 'separator' }, item('Show History', 'history')] },
    { label: 'Tools', submenu: [item('Downloads', 'downloads', 'CmdOrCtrl+J'), item('Extensions', 'extensions'), item('Settings', 'settings', 'CmdOrCtrl+,'), item('Command Palette', 'palette', 'CmdOrCtrl+K')] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(process.platform === 'darwin' ? [{ role: 'front' }] : [{ role: 'close' }])] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function protectSessions(pu) {
  const blockLog = [];
  const report = (entry) => {
    if (entry.kind !== 'reset') { blockLog.push(entry); if (blockLog.length > 2000) blockLog.shift(); }
    try {
      const guest = entry.webContentsId && webContents.fromId(entry.webContentsId);
      const owner = guest?.hostWebContents;
      if (owner && !owner.isDestroyed()) owner.send('shield:stat', { ...entry, host: guest.getURL() ? new URL(guest.getURL()).hostname : entry.host });
    } catch { /* A tab may have closed. */ }
  };
  if (pu) {
    const { installPrivacy } = require('./privacy');
    for (const ses of [normalSession, privateSession]) {
      const privacy = installPrivacy(ses, () => prefs, report, pu);
      app.on('web-contents-created', (_e, contents) => {
        if (contents.getType() === 'webview' && contents.session === ses) privacy.protectWebContents(contents);
      });
    }
    log.info('Privacy engines attached to normal and private browsing sessions');
  }
  for (const [ses, privateMode] of [[normalSession, false], [privateSession, true]]) {
    // Fullscreen (video players, YouTube's F key) and "Copy" buttons are allowed outright; camera, mic,
    // location and notifications ask first and can be remembered per site.
    const sessionGranted = new Set(), pending = new Map();
    const verdictFor = (permission, origin) => permissions.decide({ permission, origin: permissions.originOf(origin), privateMode, remembered: prefs.sitePermissions, sessionGranted });
    ses.setPermissionRequestHandler((contents, permission, callback, details) => {
      const origin = permissions.originOf(details.requestingUrl || contents.getURL());
      const verdict = verdictFor(permission, origin);
      if (verdict !== 'ask') return callback(verdict === 'allow');
      const win = BrowserWindow.fromWebContents(contents.hostWebContents || contents);
      if (!win) return callback(false);
      const key = origin + '|' + permission;
      if (!pending.has(key)) {
        pending.set(key, dialog.showMessageBox(win, { type: 'question', message: `Allow ${origin} to use ${permission === 'media' ? 'your camera or microphone' : permission}?`, buttons: ['Block', 'Allow'], defaultId: 0, cancelId: 0, noLink: true, checkboxLabel: 'Remember my choice for this site', checkboxChecked: false }).then((r) => {
          const allow = r.response === 1;
          if (r.checkboxChecked) { permissions.setDecision(prefs.sitePermissions, origin, permission, allow ? 'allow' : 'deny'); persistPrefs(); }
          else if (allow) sessionGranted.add(key);
          return allow;
        }).catch(() => false).finally(() => pending.delete(key)));
      }
      pending.get(key).then(callback);
    });
    ses.setPermissionCheckHandler((_contents, permission, origin) => verdictFor(permission, origin) === 'allow');
    downloadManager.attach(ses, privateMode);
  }
}
function wireWebContents() {
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) contents.hostWebContents?.send('browser:new-tab', url);
        return { action: 'deny' };
      });
      contents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        const key = String(input.key || '').toLowerCase();
        const mod = Boolean(input.control || input.meta), shift = Boolean(input.shift), alt = Boolean(input.alt);
        let action = null;
        if (mod && shift && key === 't') action = 'reopen';
        else if (mod && shift && key === 'n') action = 'private';
        else if (mod && key === 't') action = 'newtab';
        else if (mod && key === 'w') action = 'closetab';
        else if (mod && key === 'r') action = 'reload';
        else if (mod && key === 'l') action = 'focus-address';
        else if (mod && key === 'f') action = 'find';
        else if (mod && key === 'j') action = 'downloads';
        else if (mod && key === 'd') action = 'bookmark';
        else if (mod && key === 'k') action = 'palette';
        else if (mod && (key === '+' || key === '=' || input.code === 'NumpadAdd')) action = 'zoom-in';
        else if (mod && (key === '-' || input.code === 'NumpadSubtract')) action = 'zoom-out';
        else if (mod && key === '0') action = 'zoom-reset';
        else if (mod && key === 'tab') action = shift ? 'tab-prev' : 'tab-next';
        else if (alt && key === 'arrowleft') action = 'back';
        else if (alt && key === 'arrowright') action = 'forward';
        else if (mod && shift && (key === 'pageup' || key === 'pagedown')) action = key === 'pageup' ? 'tab-move-left' : 'tab-move-right';
        else if (mod && !shift && (key === 'pageup' || key === 'pagedown')) action = key === 'pageup' ? 'tab-prev' : 'tab-next';
        else if (mod && !shift && !alt && /^[1-9]$/.test(key)) action = 'tab-' + key;
        else if (mod && !shift && key === 'h') action = 'history';
        else if (mod && shift && key === 'b') action = 'bookmarks-bar';
        else if (key === 'f6' || (alt && key === 'd')) action = 'focus-address';
        else if (key === 'f5') action = 'reload';
        else if (key === 'f11') action = 'fullscreen';
        if (!action) return; // Site-specific keys, including YouTube's F, stay with the page.
        event.preventDefault();
        contents.hostWebContents?.send('browser:shortcut', action);
      });
      contents.on('zoom-changed', () => {
        contents.hostWebContents?.send('browser:zoom-changed', { webContentsId: contents.id, factor: contents.getZoomFactor() });
      });
      contents.on('enter-html-full-screen', () => {
        const win = BrowserWindow.fromWebContents(contents.hostWebContents);
        // Remember whether the user was already fullscreen (F11) so leaving video fullscreen doesn't kick them out of it.
        if (win && !win.isDestroyed()) { contents.__windowWasFullscreen = win.isFullScreen(); if (!contents.__windowWasFullscreen) win.setFullScreen(true); }
        contents.hostWebContents?.send('browser:fullscreen', true);
      });
      contents.on('leave-html-full-screen', () => {
        const win = BrowserWindow.fromWebContents(contents.hostWebContents);
        if (win && !win.isDestroyed() && win.isFullScreen() && !contents.__windowWasFullscreen) win.setFullScreen(false);
        contents.__windowWasFullscreen = false;
        // Still true if the user was already in F11 fullscreen; otherwise the window's leave-full-screen event clears it.
        contents.hostWebContents?.send('browser:fullscreen', Boolean(win && !win.isDestroyed() && win.isFullScreen()));
      });
      contents.on('context-menu', (_event, params) => {
        const win = BrowserWindow.fromWebContents(contents.hostWebContents || contents);
        if (!win) return;
        const template = [];
        if (params.linkURL && /^https?:/.test(params.linkURL)) template.push(
          { label: 'Open link in new tab', click: () => contents.hostWebContents?.send('browser:new-tab', params.linkURL) },
          { label: 'Open link in background tab', click: () => contents.hostWebContents?.send('browser:new-tab-background', params.linkURL) },
          { label: 'Copy link address', click: () => require('electron').clipboard.writeText(params.linkURL) },
          { label: 'Save link as…', click: () => contents.downloadURL(params.linkURL) },
          { type: 'separator' },
        );
        if (params.mediaType === 'image' && params.srcURL) template.push(
          { label: 'Open image in new tab', click: () => contents.hostWebContents?.send('browser:new-tab', params.srcURL) },
          { label: 'Copy image address', click: () => require('electron').clipboard.writeText(params.srcURL) },
          { label: 'Save image as…', click: () => contents.downloadURL(params.srcURL) },
          { type: 'separator' },
        );
        if (params.isEditable) template.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
        else if (params.selectionText) template.push({ role: 'copy' }, { type: 'separator' }, { label: 'Search with Startpage', click: () => contents.hostWebContents?.send('browser:search-selection', params.selectionText) });
        template.push({ label: 'Back', enabled: contents.canGoBack(), click: () => contents.goBack() }, { label: 'Forward', enabled: contents.canGoForward(), click: () => contents.goForward() }, { label: 'Reload', click: () => contents.reload() }, { type: 'separator' }, { label: 'Copy page address', click: () => require('electron').clipboard.writeText(contents.getURL()) });
        if (!app.isPackaged) template.push({ type: 'separator' }, { label: 'Inspect page', click: () => contents.inspectElement(params.x, params.y) });
        Menu.buildFromTemplate(template).popup({ window: win });
      });
    }
  });

}

app.whenReady().then(async () => {
  log.info(`Vespera ${app.getVersion()} starting (Electron ${process.versions.electron}, ${process.platform})`);
  try { serverHandle = await require('../server/server').createServer({ port: 4600, host: '127.0.0.1' }); }
  catch (err) { log.error('Local service failed', err); dialog.showErrorBox('Vespera could not start', `${err.message}\n\nLog: ${log.getLogFile()}`); app.quit(); return; }
  normalSession = session.fromPartition('persist:vespera');
  privateSession = session.fromPartition('incognito');
  downloadManager = new DownloadManager(() => prefs, () => [...windows], log);
  extensionManager = installExtensions(normalSession, () => prefs, persistPrefs, () => BrowserWindow.getFocusedWindow() || mainWindow, log);
  let pu = null;
  try { pu = await import('../src/shared/privacy-utils.mjs'); } catch (err) { log.error('Privacy utilities unavailable; network filtering is disabled', err); }
  protectSessions(pu);
  registerIpc();
  wireWebContents(); createWindow(); buildMenu();
  await extensionManager.restore();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
}).catch((err) => { log.error('Startup failed', err); dialog.showErrorBox('Vespera startup failed', `${err.stack || err}\n\nLog: ${log.getLogFile()}`); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { persistPrefs(); windows.clear(); });
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disable-features', 'Translate,MediaRouter');
