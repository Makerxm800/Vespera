/**
 * Vespera postinstall — installs static browser assets generated from pinned
 * npm packages, then prints the usual build/run guidance.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const vendorDir = path.join(root, 'src', 'renderer', 'vendor');
const vendorPackages = [
  ['html2canvas/dist/html2canvas.min.js', 'html2canvas.min.js'],
  ['html2canvas/LICENSE', 'html2canvas.LICENSE'],
];
for (const [source, target] of vendorPackages) {
  const from = path.join(root, 'node_modules', source);
  const to = path.join(vendorDir, target);
  if (!fs.existsSync(from)) {
    throw new Error(`Required browser runtime asset not present: ${source}`);
  }
  fs.mkdirSync(vendorDir, { recursive: true });
  fs.copyFileSync(from, to);
}

console.log('\n  Vespera — Tauri v2 shell installed.');
console.log('  Build the desktop app with:   npm run dist   (needs the Rust toolchain)');
console.log('  Run it in development:        npm start');
console.log('  Web preview without Rust:     npm run preview');
console.log('  Tests:                        npm test\n');
