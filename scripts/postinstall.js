/**
 * Vespera postinstall — friendly, non-fatal.
 * Vespera v2 is a Tauri app: the web UI ships as static assets and the native
 * shell is compiled from src-tauri with the Rust toolchain. If Rust or the
 * platform webview dependencies are missing, the app can't build yet, but the
 * browser preview (`npm run preview`) and the test suite still work.
 */
'use strict';

console.log('\n  Vespera — Tauri v2 shell installed.');
console.log('  Build the desktop app with:   npm run dist   (needs the Rust toolchain)');
console.log('  Run it in development:        npm start');
console.log('  Web preview without Rust:     npm run preview');
console.log('  Tests:                        npm test\n');
