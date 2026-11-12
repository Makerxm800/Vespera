// Test: dependency-free zip extraction + extension install flow (electron/extensions.js)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/** Minimal stored-ZIP writer so this test builds a real archive on every OS
 *  (the runner images do not all ship PowerShell, and neither does Linux). */
function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}
function makeZip(entries) {
  const chunks = [], central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);           // stored
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);       // 1980-01-01
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

// Stub electron before loading the module
const Module = require('module');
const orig = Module.prototype.require;
let extensionTestUserData = os.tmpdir();
Module.prototype.require = function (id) {
  if (id === 'electron') return { dialog: {}, app: { getPath: () => extensionTestUserData } };
  return orig.apply(this, arguments);
};
const { extractZip, findManifestDir, installExtensions } = require('../electron/extensions.js');

test('extractZip unpacks a real zip (built in-test) and findManifestDir locates nested manifests', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vespera-ext-test-'));
  try {
    const body = '// test content script '.repeat(2000);
    const zipPath = path.join(tmp, 'my-extension.zip');
    // Repo-style layout: the manifest sits one folder down.
    fs.writeFileSync(zipPath, makeZip([
      ['my-extension/manifest.json', JSON.stringify({ manifest_version: 3, name: 'Test Ext', version: '1.2.3' })],
      ['my-extension/content.js', body],
    ]));

    const dest = path.join(tmp, 'out');
    // Await inside the try: returning the promise would let `finally` delete
    // the zip before extractZip reads it (the file is read asynchronously).
    const dir = await extractZip(zipPath, dest);
    assert.equal(dir, dest);
    const manifestDir = findManifestDir(dest);
    assert.ok(manifestDir, 'manifest dir found');
    const manifest = JSON.parse(fs.readFileSync(path.join(manifestDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.name, 'Test Ext');
    assert.ok(fs.readFileSync(path.join(manifestDir, 'content.js'), 'utf8').includes('// test content script'));
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

test('extractZip rejects ZIP-slip paths before writing outside its destination', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vespera-ext-slippage-'));
  try {
    const archive = path.join(tmp, 'unsafe.zip');
    const destination = path.join(tmp, 'out');
    fs.writeFileSync(archive, makeZip([['../escaped.txt', 'must not be written']]));
    await assert.rejects(() => extractZip(archive, destination), /unsafe file path/i);
    assert.equal(fs.existsSync(path.join(tmp, 'escaped.txt')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('extension manager exposes icons and permissions and persists enable/disable state', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vespera-ext-manager-'));
  const previousUserData = extensionTestUserData;
  extensionTestUserData = tmp;
  try {
    const folder = path.join(tmp, 'reviewed-extension');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({
      manifest_version: 3, name: 'Reviewed helper', version: '2.4.1', description: 'A small reviewed helper.',
      permissions: ['storage'], host_permissions: ['https://*.example.com/*'],
      action: { default_popup: 'popup.html', default_title: 'Open helper' }, icons: { 48: 'icon.png' },
    }));
    fs.writeFileSync(path.join(folder, 'icon.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    const id = 'a'.repeat(32);
    const prefs = { extensionPaths: [folder], disabledExtensionIds: [], extensionMetadata: [] };
    const makeSession = () => {
      const loaded = new Map();
      return {
        loaded,
        getAllExtensions: () => [...loaded.values()],
        getExtension: (key) => loaded.get(key),
        loadExtension: async (directory) => {
          const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
          const extension = { id, name: manifest.name, version: manifest.version, path: directory, manifest };
          loaded.set(id, extension);
          return extension;
        },
        removeExtension: (key) => loaded.delete(key),
      };
    };
    const logger = { info() {}, error() {} };
    const session = makeSession();
    const manager = installExtensions(session, () => prefs, () => {}, () => null, logger);
    await manager.restore();
    let details = manager.list()[0];
    assert.equal(details.enabled, true);
    assert.equal(details.name, 'Reviewed helper');
    assert.equal(details.manifestVersion, 3);
    assert.deepEqual(details.permissions, ['storage']);
    assert.deepEqual(details.hostPermissions, ['https://*.example.com/*']);
    assert.equal(details.popup, 'popup.html');
    assert.match(details.icon, /^data:image\/png;base64,/);

    const disabled = await manager.disable(id);
    assert.equal(disabled.ok, true);
    assert.equal(disabled.extensions[0].enabled, false);
    assert.ok(prefs.disabledExtensionIds.includes(id));

    const restoredSession = makeSession();
    const restoredManager = installExtensions(restoredSession, () => prefs, () => {}, () => null, logger);
    await restoredManager.restore();
    assert.equal(restoredSession.loaded.size, 0, 'disabled extensions stay unloaded after restart');
    assert.equal(restoredManager.list()[0].enabled, false);
    const enabled = await restoredManager.enable(id);
    assert.equal(enabled.ok, true);
    assert.equal(enabled.extensions[0].enabled, true);
    assert.deepEqual(prefs.disabledExtensionIds, []);

    const removed = restoredManager.remove(id);
    assert.equal(removed.ok, true);
    assert.equal(removed.extensions.length, 0);
    assert.equal(prefs.extensionPaths.length, 0);
  } finally {
    extensionTestUserData = previousUserData;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
