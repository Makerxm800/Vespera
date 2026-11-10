/** App-level services exposed to UI modules that must not import app.js
 *  (importing app.js would run the whole browser boot twice). app.js fills
 *  these in during boot; the defaults keep the modules safe before then. */
export const bridge = {
  previewRestricted: () => false,
  version: () => '',
  navigate: () => {},
  openTab: () => {},
  refreshChrome: () => {},
  reader: () => {},
  download: () => {},
  settingsClosed: null,
  settingsToggled: null,
};
