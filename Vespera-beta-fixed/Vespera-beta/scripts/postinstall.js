/**
 * Vespera postinstall — friendly, non-fatal.
 * Electron downloads its Chromium binary during install. If the machine is
 * offline (or the download is blocked), the desktop app can't run yet, but the
 * local preview server (`npm run preview`) and the test suite still work.
 */
'use strict';

let electronPkg = null;
try {
  electronPkg = require('electron/package.json');
} catch {
  /* electron not installed — handled below */
}

if (electronPkg) {
  console.log(`\n  Vespera ready — Electron ${electronPkg.version} (Chromium) installed.`);
  console.log('  Run the browser with:   npm start');
  console.log('  Run the web preview:    npm run preview\n');
} else {
  console.log('\n  Vespera: Electron binary not available in this environment.');
  console.log('  The web preview and tests still work:  npm run preview / npm test');
  console.log('  On a normal machine, re-run `npm install` to get Chromium.\n');
}
