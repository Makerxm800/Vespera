/**
 * Tauri bridge — installs `window.vespera` with the exact same contract the
 * Electron preload exposed, so the rest of the renderer runs unchanged.
 *
 * Uses Tauri's low-level `window.__TAURI_INTERNALS__` (invoke/listen) directly:
 * no bundler, no extra npm runtime — the bridge works in both `tauri dev`
 * and packaged builds.
 */
(() => {
  const internals = window.__TAURI_INTERNALS__;
  if (!internals || typeof internals.invoke !== 'function' || typeof internals.listen !== 'function') return;

  const invoke = (cmd, args) => internals.invoke(cmd, args || {});
  const listen = (event, cb) => {
    let unlisten = null;
    internals.listen(event, (e) => cb(e.payload)).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { try { unlisten?.(); } catch { /* already gone */ } };
  };
  const isPrivate = new URLSearchParams(location.search).get('private') === '1';

  window.vespera = {
    window: {
      isPrivate,
      minimize: () => invoke('window_minimize'),
      maximize: () => invoke('window_maximize'),
      close: () => invoke('window_close'),
      incognito: () => invoke('window_incognito'),
      toggleFullscreen: () => invoke('window_fullscreen_toggle'),
    },
    prefs: { save: (value) => invoke('prefs_save', { value }) },
    app: {
      version: () => invoke('app_version'),
      readLog: () => invoke('app_read_log'),
      logPath: () => invoke('app_log_path'),
      openLogs: () => invoke('app_open_logs'),
      defaultBrowserStatus: () => invoke('app_default_browser_status'),
      setDefaultBrowser: () => invoke('app_default_browser'),
      openDefaultBrowserSettings: () => invoke('app_open_default_browser_settings'),
      tabMemory: () => invoke('tabs_memory'),
      checkUpdate: () => invoke('app_update_check'),
      installUpdate: (releaseInfo) => invoke('app_update_install', { releaseInfo }),
      inspectTab: () => invoke('app_inspect_tab'),
      downloads: (privateMode) => invoke('downloads_list', { private: Boolean(privateMode) }),
      download: (url, options) => invoke('downloads_start', { url, private: isPrivate, options: options || null }),
      downloadAction: (action, id) => invoke('downloads_action', { action, id, private: isPrivate }),
      clearDownloads: () => invoke('downloads_clear', { private: isPrivate }),
      chooseDownloadFolder: () => invoke('downloads_choose_folder'),
      openDownloadFolder: () => invoke('downloads_folder'),
    },
    permissions: {
      list: () => invoke('permissions_list'),
      reset: () => invoke('permissions_reset'),
    },
    extensions: {
      list: () => invoke('extensions_list'),
      install: () => invoke('extensions_install'),
      loadUnpacked: () => invoke('extensions_load_unpacked'),
      installFromStore: (url) => invoke('extensions_install_store', { url }),
      enable: (id) => invoke('extensions_enable', { id }),
      disable: (id) => invoke('extensions_disable', { id }),
      remove: (id) => invoke('extensions_remove', { id }),
    },
    on: (channel, fn) => {
      const allowed = [
        'download:started', 'download:updated', 'download:done', 'shield:stat',
        'window:maximized', 'menu:action', 'browser:new-tab', 'browser:shortcut',
        'browser:fullscreen', 'browser:zoom-changed', 'browser:new-tab-background',
        'browser:search-selection', 'browser:extensions-changed',
      ];
      if (!allowed.includes(channel) || typeof fn !== 'function') return () => {};
      return listen(channel, fn);
    },
  };
})();
