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

function zipEntryPath(root, entryName) {
  const name = String(entryName || '').replace(/\\/g, '/');
  const parts = name.split('/');
  if (parts.at(-1) === '') parts.pop(); // ZIP directory entries end in a slash.
  if (!name || name.includes('\0') || name.startsWith('/') || !parts.length || parts.some((part) => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error('This extension package contains an unsafe file path.');
  }
  const rootPath = path.resolve(root);
  const target = path.resolve(rootPath, ...parts);
  const relative = path.relative(rootPath, target);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('This extension package contains an unsafe file path.');
  }
  return target;
}

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
      const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
      ptr += 46 + nameLen + extraLen + commentLen;
      const outPath = zipEntryPath(destDir, name);
      if (name.endsWith('/')) { fs.mkdirSync(outPath, { recursive: true }); continue; }
      // Locate local header to find its own extra-field length.
      if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('Corrupt extension package.');
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.slice(dataStart, dataStart + compSize);
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

function iconDataUrl(root, manifest) {
  const action = manifest?.action || manifest?.browser_action || {};
  const icons = [manifest?.icons, action.default_icon].filter(Boolean);
  const candidates = [];
  for (const iconsMap of icons) {
    if (typeof iconsMap === 'string') candidates.push(iconsMap);
    else if (typeof iconsMap === 'object') candidates.push(...Object.entries(iconsMap).sort((a, b) => Number(b[0]) - Number(a[0])).map(([, file]) => file));
  }
  for (const relative of candidates) {
    if (typeof relative !== 'string' || !relative.trim()) continue;
    let decoded = relative.replace(/\\/g, '/').replace(/^\/+/, '');
    try { decoded = decodeURIComponent(decoded); } catch { continue; }
    if (decoded.split('/').some((part) => part === '..' || part === '.')) continue;
    const file = path.resolve(root, decoded);
    if (!file.startsWith(path.resolve(root) + path.sep)) continue;
    const ext = path.extname(file).toLowerCase();
    const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' })[ext];
    if (!mime) continue;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > 128 * 1024) continue;
      return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
    } catch { /* Try another declared icon size. */ }
  }
  return null;
}

function popupPath(manifest) {
  const raw = manifest?.action?.default_popup || manifest?.browser_action?.default_popup || '';
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const value = raw.trim().replace(/\\/g, '/');
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { return ''; }
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value) || decoded.split('/').includes('..')) return '';
  return value.replace(/^\/+/, '').slice(0, 500);
}

function extensionDetails(extension, enabled = true) {
  const manifest = extension?.manifest && typeof extension.manifest === 'object' ? extension.manifest : {};
  const action = manifest.action || manifest.browser_action || {};
  const values = (list) => [...new Set((Array.isArray(list) ? list : []).filter((value) => typeof value === 'string').map((value) => value.slice(0, 300)))].slice(0, 80);
  const contentMatches = values((Array.isArray(manifest.content_scripts) ? manifest.content_scripts : []).flatMap((entry) => Array.isArray(entry?.matches) ? entry.matches : []));
  return {
    id: String(extension?.id || '').slice(0, 128),
    name: String(manifest.name || extension?.name || 'Unnamed extension').slice(0, 160),
    version: String(manifest.version || extension?.version || '?').slice(0, 80),
    description: String(manifest.description || '').slice(0, 700),
    manifestVersion: Number(manifest.manifest_version) || null,
    permissions: values([...(Array.isArray(manifest.permissions) ? manifest.permissions : []), ...(Array.isArray(manifest.optional_permissions) ? manifest.optional_permissions : [])]),
    hostPermissions: values([...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []), ...contentMatches]),
    icon: extension?.path ? iconDataUrl(extension.path, manifest) : null,
    popup: popupPath(manifest),
    actionTitle: String(action.default_title || manifest.name || extension?.name || 'Extension').slice(0, 120),
    enabled: Boolean(enabled),
  };
}

function readDisabledExtension(metadata) {
  const root = typeof metadata?.path === 'string' ? metadata.path : '';
  let manifest = {
    name: metadata?.name, version: metadata?.version, description: metadata?.description,
    manifest_version: metadata?.manifestVersion, permissions: metadata?.permissions,
    host_permissions: metadata?.hostPermissions,
    action: { default_popup: metadata?.popup, default_title: metadata?.actionTitle },
  };
  if (root) {
    try {
      const file = path.join(root, 'manifest.json');
      const stat = fs.statSync(file);
      if (stat.isFile() && stat.size <= 1024 * 1024) manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { /* Keep the last saved metadata for a missing unpacked directory. */ }
  }
  return extensionDetails({ id: metadata?.id, name: metadata?.name, version: metadata?.version, path: root, manifest }, false);
}

function installExtensions(session, getPrefs, persistPrefs, getWindow, log) {
  const list = () => {
    const loaded = session.getAllExtensions();
    const activeIds = new Set(loaded.map((ext) => ext.id));
    const active = loaded.map((ext) => extensionDetails(ext, true));
    const saved = Array.isArray(getPrefs().extensionMetadata) ? getPrefs().extensionMetadata : [];
    const disabled = saved.filter((entry) => entry && typeof entry.id === 'string' && !activeIds.has(entry.id)).map(readDisabledExtension);
    return [...active, ...disabled];
  };
  /** Electron needs a real BrowserWindow — or no first argument at all; never `null`. */
  const withWindow = (method, options) => {
    const win = getWindow();
    return win && !win.isDestroyed() ? dialog[method](win, options) : dialog[method](options);
  };

  function persistExtensionMetadata(ext) {
    const prefs = getPrefs();
    const details = extensionDetails(ext, true);
    const metadata = {
      id: details.id, path: ext.path, name: details.name, version: details.version,
      description: details.description, manifestVersion: details.manifestVersion,
      permissions: details.permissions, hostPermissions: details.hostPermissions,
      popup: details.popup, actionTitle: details.actionTitle,
    };
    prefs.extensionMetadata = [...(Array.isArray(prefs.extensionMetadata) ? prefs.extensionMetadata : []).filter((entry) => entry?.id !== ext.id), metadata];
  }

  async function load(folder) {
    const existing = session.getAllExtensions().find((item) => path.resolve(item.path) === path.resolve(folder));
    if (existing) return existing;
    const ext = await session.loadExtension(folder, { allowFileAccess: false });
    const prefs = getPrefs();
    prefs.extensionPaths = [...new Set([...(Array.isArray(prefs.extensionPaths) ? prefs.extensionPaths : []), ext.path])];
    prefs.disabledExtensionIds = (Array.isArray(prefs.disabledExtensionIds) ? prefs.disabledExtensionIds : []).filter((id) => id !== ext.id);
    persistExtensionMetadata(ext);
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

  async function setEnabled(id, enabled) {
    const prefs = getPrefs();
    const metadata = (Array.isArray(prefs.extensionMetadata) ? prefs.extensionMetadata : []).find((entry) => entry?.id === id);
    const ext = session.getExtension(id);
    if (enabled) {
      if (ext) return { ok: true, extensions: list() };
      if (!metadata?.path || !fs.existsSync(metadata.path)) return { ok: false, message: 'The extension folder is missing. Remove it and install the extension again.' };
      try {
        await load(metadata.path);
        return { ok: true, extensions: list() };
      } catch (err) { return { ok: false, message: err.message || 'This extension could not be enabled.' }; }
    }
    if (!ext) return metadata ? { ok: true, extensions: list() } : { ok: false, message: 'Extension not found.' };
    persistExtensionMetadata(ext);
    session.removeExtension(id);
    const updated = getPrefs();
    updated.disabledExtensionIds = [...new Set([...(Array.isArray(updated.disabledExtensionIds) ? updated.disabledExtensionIds : []), id])];
    persistPrefs();
    log.info(`Extension disabled: ${ext.name} ${ext.version}`);
    return { ok: true, extensions: list() };
  }

  function remove(id) {
    const ext = session.getExtension(id);
    const prefs = getPrefs();
    const metadata = (Array.isArray(prefs.extensionMetadata) ? prefs.extensionMetadata : []).find((entry) => entry?.id === id);
    if (!ext && !metadata) return { ok: false, message: 'Extension not found.' };
    const folder = ext?.path || metadata?.path || '';
    if (ext) session.removeExtension(id);
    prefs.extensionPaths = (Array.isArray(prefs.extensionPaths) ? prefs.extensionPaths : []).filter((entry) => typeof entry === 'string' && path.resolve(entry) !== path.resolve(folder));
    prefs.disabledExtensionIds = (Array.isArray(prefs.disabledExtensionIds) ? prefs.disabledExtensionIds : []).filter((entry) => entry !== id);
    prefs.extensionMetadata = (Array.isArray(prefs.extensionMetadata) ? prefs.extensionMetadata : []).filter((entry) => entry?.id !== id);
    persistPrefs();
    try {
      const root = path.resolve(STORE_ROOT()), resolved = path.resolve(folder), relative = path.relative(root, resolved);
      if (folder && relative && !relative.startsWith('..') && !path.isAbsolute(relative)) fs.rmSync(resolved, { recursive: true, force: true });
    } catch { /* A source folder outside the managed copy is never deleted. */ }
    return { ok: true, extensions: list() };
  }

  return {
    list,
    installFromStoreUrl,
    async restore() {
      const prefs = getPrefs();
      const paths = Array.isArray(prefs.extensionPaths) ? prefs.extensionPaths : [];
      const disabledIds = new Set(Array.isArray(prefs.disabledExtensionIds) ? prefs.disabledExtensionIds : []);
      const metadata = Array.isArray(prefs.extensionMetadata) ? prefs.extensionMetadata : [];
      for (const folder of paths) {
        const saved = metadata.find((entry) => entry?.path && path.resolve(entry.path) === path.resolve(folder));
        if (saved && disabledIds.has(saved.id)) continue;
        try { await load(folder); } catch (err) { log.error(`Could not restore extension at ${folder}`, err); }
      }
    },
    async installUnpacked() {
      const result = await withWindow('showOpenDialog', {
        title: 'Choose an unpacked extension folder',
        properties: ['openDirectory'], buttonLabel: 'Review extension',
      });
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
      try { return await installFromPath(result.filePaths[0], `Unpacked folder · ${path.basename(result.filePaths[0])}`); }
      catch (err) {
        log.error('Unpacked extension load failed', err);
        return { ok: false, message: err.message || 'This unpacked extension could not be loaded.', extensions: list() };
      }
    },
    async install() {
      const result = await withWindow('showOpenDialog', {
        title: 'Choose an extension .zip or .crx package',
        filters: [{ name: 'Extensions', extensions: ['zip', 'crx'] }],
        properties: ['openFile'], buttonLabel: 'Review extension',
      });
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
      const selected = result.filePaths[0];
      try {
        const lower = selected.toLowerCase();
        if (!lower.endsWith('.zip') && !lower.endsWith('.crx')) throw new Error('Choose a .zip or .crx extension package.');
        const tempRoot = path.join(os.tmpdir(), `vespera-ext-${Date.now()}`);
        fs.mkdirSync(tempRoot, { recursive: true });
        try {
          await extractZip(selected, tempRoot);
          const manifestDir = findManifestDir(tempRoot);
          if (!manifestDir) throw new Error('No manifest.json found inside the package.');
          return await installFromPath(manifestDir, selected);
        } finally { try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ } }
      } catch (err) {
        log.error('Extension load failed', err);
        return { ok: false, message: err.message || 'This extension could not be loaded.', extensions: list() };
      }
    },
    enable: (id) => setEnabled(String(id), true),
    disable: (id) => setEnabled(String(id), false),
    remove,
  };
}
module.exports = { installExtensions, extractZip, findManifestDir, extensionDetails, iconDataUrl };
