// Test: dependency-free zip extraction + extension install flow (electron/extensions.js)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

// Stub electron before loading the module
const Module = require('module');
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'electron') return { dialog: {}, app: { getPath: () => os.tmpdir() } };
  return orig.apply(this, arguments);
};
const { extractZip, findManifestDir } = require('../electron/extensions.js');

test('extractZip unpacks a real zip (PowerShell Compress-Archive) and findManifestDir locates nested manifests', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vespera-ext-test-'));
  try {
    const extDir = path.join(tmp, 'my-extension');
    fs.mkdirSync(extDir);
    fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Test Ext', version: '1.2.3' }));
    fs.writeFileSync(path.join(extDir, 'content.js'), '// test content script '.repeat(2000));
    const zipPath = path.join(tmp, 'my-extension.zip');
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${extDir.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`);

    const dest = path.join(tmp, 'out');
    return extractZip(zipPath, dest).then((dir) => {
      assert.equal(dir, dest);
      const manifestDir = findManifestDir(dest);
      assert.ok(manifestDir, 'manifest dir found');
      const manifest = JSON.parse(fs.readFileSync(path.join(manifestDir, 'manifest.json'), 'utf8'));
      assert.equal(manifest.name, 'Test Ext');
      assert.ok(fs.readFileSync(path.join(manifestDir, 'content.js'), 'utf8').includes('// test content script'));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('extractZip rejects non-zip files with a clear error', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vespera-ext-bad-'));
  try {
    const bad = path.join(tmp, 'bad.zip');
    fs.writeFileSync(bad, 'this is not a zip file at all');
    await assert.rejects(() => extractZip(bad, path.join(tmp, 'out')), /not a valid extension package/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
