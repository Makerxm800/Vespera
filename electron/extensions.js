/** Explicit, permission-reviewed extension loading — unpacked folders, .zip and .crx packages. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { dialog, app } = require('electron');

const STORE_ROOT = () => path.join(app.getPath('userData'), 'extensions');

/*
 * Dependency-free ZIP extraction (store + deflate). CRX files are ZIPs with a
 * signature header prepended, so we locate the End-of-Central-Directory and
 * parse central directory entries, then inflate local file data.
 */
const zlib = require('node:zlib');

function extractZip(zipPath, destDir) {
  return fs.promises.readFile(zipPath).then((buf) => {
    // CRX: "Cr24" magic + version + header length before the ZIP data.
    let offset = 0;
    if (buf.slice(0, 4).toString('ascii') === 'Cr24') {
      if (buf.readUInt32LE(4) > 3) throw new Error('This CRX version is not supported.');
      offset = 12 + buf.readUInt32LE(8);
    }
    // Find End Of Central Directory (signature 0x06054b50) from the tail.
    let eocd = -1;
    for (let i = buf.length - 22; i >= offset && i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error('This file is not a valid extension package (ZIP/Crx).');
    const count = buf.readUInt16LE(eocd + 10);
    let ptr = buf.readUInt32LE(eocd + 16) + offset;
    fs.mkdirSync(destDir, { recursive: true });
    const jobs = [];
    for (let i = 0; i < count; i++) {
      if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('Corrupt extension package.');
      const method = buf.readUInt16LE(ptr + 10);
      const compSize = buf.readUInt32LE(ptr + 20);
      const nameLen = buf.readUInt16LE(ptr + 28);
      const extraLen = buf.readUInt16LE(ptr + 30);
      const commentLen = buf.readUInt16LE(ptr + 32);
      const localOff = buf.readUInt32LE(ptr + 42) + offset;
      const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8');
      ptr += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) { fs.mkdirSync(path.join(destDir, name), { recursive: true }); continue; }
      // Locate local header to find its own extra-field length.
      if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('Corrupt extension package.');
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.slice(dataStart, dataStart + compSize);
      const outPath = path.join(destDir, name);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      if (method === 0) {
        jobs.push(fs.promises.writeFile(outPath, data));
      } else if (method === 8) {
        jobs.push(new Promise((res, rej) => zlib.inflateRaw(data, (e, out) => e ? rej(new Error('Corrupt extension package.')) : res(fs.promises.writeFile(outPath, out)))));
      } else {
        throw new Error('Unsupported compression in extension package.');
      }
    }
    return Promise.all(jobs).then(() => destDir);
  });
}

function findManifestDir(dir) {
  // Some zips nest the manifest one level down (repo-style zips).
  if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'manifest.json'))) {
      return path.join(dir, e.name, '');
    }
    if (e.isDirectory()) {
      const nested = findManifestDir(path.join(dir, e.name));
      if (nested) return nested;
    }
  }
  return null;
}

/** Copy a folder tree recursively (used to snapshot unpacked-folder installs into userData). */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function installExtensions(session, getPrefs, persistPrefs, getWindow, log) {
  const list = () => session.getAllExtensions().map((e) => ({ id: e.id, name: e.name, version: e.version, path: e.path, manifestVersion: e.manifest?.manifest_version || null }));
  /** Electron needs a real BrowserWindow — or no first argument at all; never `null`. */
  const withWindow = (method, options) => {
    const win = getWindow();
    return win && !win.isDestroyed() ? dialog[method](win, options) : dialog[method](options);
  };

  async function load(folder) {
    const existing = session.getAllExtensions().find((item) => path.resolve(item.path) === path.resolve(folder));
    if (existing) return existing;
    const ext = await session.loadExtension(folder, { allowFileAccess: false });
    const prefs = getPrefs();
    prefs.extensionPaths = [...new Set([...(prefs.extensionPaths || []), ext.path])];
    persistPrefs();
    log.info(`Extension loaded with consent: ${ext.name} ${ext.version}`);
    return ext;
  }

  async function installFromPath(folder, sourceLabel) {
    if (!fs.statSync(folder).isDirectory()) throw new Error('Choose an extension folder.');
    const manifestPath = path.join(folder, 'manifest.json');
    const manifestStat = fs.statSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.size > 1024 * 1024) throw new Error('The extension manifest is missing or too large.');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (![2, 3].includes(manifest.manifest_version) || typeof manifest.name !== 'string' || !manifest.name.trim()) throw new Error('A valid Chrome extension manifest.json is required.');
    for (const key of ['permissions', 'host_permissions', 'content_scripts']) if (manifest[key] !== undefined && !Array.isArray(manifest[key])) throw new Error('The extension manifest has an invalid ' + key + ' field.');
    const permissions = [...(manifest.permissions || []), ...(manifest.host_permissions || []), ...(manifest.content_scripts || []).flatMap((s) => Array.isArray(s.matches) ? s.matches : [])].filter((p) => typeof p === 'string').slice(0, 80);
    const answer = await withWindow('showMessageBox', { type: 'warning', title: 'Review extension permissions', message: `Load “${manifest.name}”?`, detail: `Source: ${sourceLabel}\n\nRequested access:\n${permissions.join('\n') || 'No permissions declared'}\n\nExtensions can read or change website content. Only load code you trust. Electron supports a subset of Chrome APIs; unsupported features may not work.`, buttons: ['Cancel', 'Load extension'], defaultId: 0, cancelId: 0, noLink: true });
    if (answer.response !== 1) return { ok: false, canceled: true };
    // Snapshot the extension into userData so it survives the original location moving/deleting.
    const dest = path.join(STORE_ROOT(), `${manifest.name.replace(/[^\w.-]+/g, '_')}-${Date.now()}`);
    copyDir(folder, dest);
    try {
      await load(dest);
    } catch (err) {
      try { fs.rmSync(dest, { recursive: true, force: true }); } catch { /* ignore */ }
      throw err;
    }
    return { ok: true, extensions: list(), name: manifest.name };
  }

  async function installFromStoreUrl(storeUrl) {
    // Accept chromewebstore.google.com/detail/<slug>/<id> URLs (or raw 32-char ids).
    const m = String(storeUrl || '').match(/(?:detail|category)\/[^/]+\/([a-p]{32})/i) || String(storeUrl || '').match(/^([a-p]{32})$/i);
    if (!m) return { ok: false, message: 'Paste a Chrome Web Store extension URL, e.g. https://chromewebstore.google.com/detail/<name>/<id>.' };
    const extId = m[1].toLowerCase();
    const win = getWindow();
    win?.webContents.send('browser:store-progress', { stage: 'downloading', id: extId });
    // Google's official CRX delivery endpoint (same one Chrome itself uses).
    // `x` must be encoded exactly once: "id=<id>&installsource=ondemand&uc".
    // Encoding the already-encoded string double-escapes it and Google answers 400.
    const crxUrl = 'https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&prodversion=130.0.0.0&os=win&arch=x64&nacl_arch=x86-64&x=' + encodeURIComponent(`id=${extId}&installsource=ondemand&uc`);
    const { net } = require('electron');
    const tmpZip = path.join(os.tmpdir(), `vespera-store-${extId}.crx`);
    try {
      await new Promise((resolve, reject) => {
        const request = net.request({ url: crxUrl, redirect: 'follow' });
        request.setHeader('User-Agent', 'Chromium/130');
        const file = fs.createWriteStream(tmpZip);
        request.on('response', (response) => {
          if (response.statusCode >= 400) {
            file.close();
            const detail = response.statusCode === 404
              ? 'Google has no installable package for this extension ID — check the store link, or install the .zip/.crx from the developer.'
              : `The Chrome Web Store refused the download (HTTP ${response.statusCode}).`;
            return reject(new Error(detail));
          }
          response.pipe(file);
        });
        file.on('finish', () => file.close(() => resolve()));
        request.on('error', reject);
        request.end();
      });
      const head = fs.readFileSync(tmpZip).slice(0, 4).toString('ascii');
      if (!['Cr24', 'PK'].includes(head)) throw new Error('The Chrome Web Store did not return an installable package for this extension.');
      const tempRoot = path.join(os.tmpdir(), `vespera-store-${extId}-${Date.now()}`);
      fs.mkdirSync(tempRoot, { recursive: true });
      try {
        await extractZip(tmpZip, tempRoot);
        const manifestDir = findManifestDir(tempRoot);
        if (!manifestDir) throw new Error('The package from the Chrome Web Store has no manifest.');
        return await installFromPath(manifestDir, `Chrome Web Store · ${extId}`);
      } finally {
        try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ }
        try { fs.rmSync(tmpZip, { force: true }); } catch { /* ignore */ }
      }
    } catch (err) {
      try { fs.rmSync(tmpZip, { force: true }); } catch { /* ignore */ }
      log.error('Store install failed', err);
      return { ok: false, message: err.message || 'This Chrome Web Store extension could not be installed.' };
    }
  }

  return {
    list,
    installFromStoreUrl,
    async restore() { for (const folder of getPrefs().extensionPaths || []) { try { await load(folder); } catch (err) { log.error(`Could not restore extension at ${folder}`, err); } } },
    async install() {
      const result = await withWindow('showOpenDialog', {
        title: 'Choose an extension folder, .zip or .crx',
        filters: [{ name: 'Extensions', extensions: ['zip', 'crx'] }, { name: 'All files', extensions: ['*'] }, { name: 'Folders', extensions: [] }],
        properties: ['openFile', 'openDirectory'],
        buttonLabel: 'Review extension',
      });
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
      const selected = result.filePaths[0];
      try {
        const stat = fs.statSync(selected);
        if (stat.isDirectory()) {
          return await installFromPath(selected, selected);
        }
        const lower = selected.toLowerCase();
        if (lower.endsWith('.zip') || lower.endsWith('.crx')) {
          const tempRoot = path.join(os.tmpdir(), `vespera-ext-${Date.now()}`);
          fs.mkdirSync(tempRoot, { recursive: true });
          try {
            await extractZip(selected, tempRoot);
            const manifestDir = findManifestDir(tempRoot);
            if (!manifestDir) throw new Error('No manifest.json found inside the package.');
            return await installFromPath(manifestDir, selected);
          } finally {
            try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ }
          }
        }
        throw new Error('Choose an extension folder, a .zip or a .crx package.');
      } catch (err) {
        log.error('Extension load failed', err);
        return { ok: false, message: err.message || 'This extension could not be loaded.', extensions: list() };
      }
    },
    remove(id) {
      const ext = session.getExtension(id);
      if (!ext) return { ok: false, message: 'Extension not found.' };
      const folder = ext.path;
      session.removeExtension(id);
      const prefs = getPrefs(); prefs.extensionPaths = (prefs.extensionPaths || []).filter((p) => p !== folder); persistPrefs();
      try { if (folder.startsWith(STORE_ROOT())) fs.rmSync(folder, { recursive: true, force: true }); } catch { /* ignore */ }
      return { ok: true, extensions: list() };
    },
  };
}
module.exports = { installExtensions, extractZip, findManifestDir };
