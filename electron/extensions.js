/** Explicit, permission-reviewed unpacked extension loading. Never auto-import Chrome profiles. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { dialog } = require('electron');
function installExtensions(session, getPrefs, persistPrefs, getWindow, log) {
  const list = () => session.getAllExtensions().map((e) => ({ id: e.id, name: e.name, version: e.version, path: e.path, manifestVersion: e.manifest?.manifest_version || null }));
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
  return {
    list,
    async restore() { for (const folder of getPrefs().extensionPaths || []) { try { await load(folder); } catch (err) { log.error(`Could not restore extension at ${folder}`, err); } } },
    async install() {
      const win = getWindow();
      const result = await dialog.showOpenDialog(win, { title: 'Choose a trusted unpacked extension folder', properties: ['openDirectory'], buttonLabel: 'Review extension' });
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
      const folder = result.filePaths[0];
      try {
        if (!fs.statSync(folder).isDirectory()) throw new Error('Choose an extension folder.');
        const manifestPath = path.join(folder, 'manifest.json');
        const manifestStat = fs.statSync(manifestPath);
        if (!manifestStat.isFile() || manifestStat.size > 1024 * 1024) throw new Error('The extension manifest is missing or too large.');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (![2, 3].includes(manifest.manifest_version) || typeof manifest.name !== 'string' || !manifest.name.trim()) throw new Error('A valid Chrome extension manifest.json is required.');
        for (const key of ['permissions', 'host_permissions', 'content_scripts']) if (manifest[key] !== undefined && !Array.isArray(manifest[key])) throw new Error('The extension manifest has an invalid ' + key + ' field.');
        const permissions = [...(manifest.permissions || []), ...(manifest.host_permissions || []), ...(manifest.content_scripts || []).flatMap((s) => Array.isArray(s.matches) ? s.matches : [])].filter((p) => typeof p === 'string').slice(0, 80);
        const answer = await dialog.showMessageBox(win, { type: 'warning', title: 'Review extension permissions', message: `Load “${manifest.name}”?`, detail: `Folder: ${folder}\n\nRequested access:\n${permissions.join('\n') || 'No permissions declared'}\n\nExtensions can read or change website content. Only load code you trust. Electron supports a subset of Chrome APIs; unsupported features may not work.`, buttons: ['Cancel', 'Load extension'], defaultId: 0, cancelId: 0, noLink: true });
        if (answer.response !== 1) return { ok: false, canceled: true };
        await load(folder);
        return { ok: true, extensions: list() };
      } catch (err) { log.error('Extension load failed', err); return { ok: false, message: err.message || 'This extension could not be loaded.', extensions: list() }; }
    },
    remove(id) {
      const ext = session.getExtension(id);
      if (!ext) return { ok: false, message: 'Extension not found.' };
      const folder = ext.path;
      session.removeExtension(id);
      const prefs = getPrefs(); prefs.extensionPaths = (prefs.extensionPaths || []).filter((p) => p !== folder); persistPrefs();
      return { ok: true, extensions: list() };
    },
  };
}
module.exports = { installExtensions };
