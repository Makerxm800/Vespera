'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, shell } = require('electron');

class DownloadManager {
  constructor(getPrefs, getWindows, log) {
    this.getPrefs = getPrefs; this.getWindows = getWindows; this.log = log;
    this.file = path.join(app.getPath('userData'), 'downloads.json');
    this.items = new Map(); this.records = []; this.privateRecords = [];
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(saved)) this.records = saved.slice(0, 100).map((r) => ({ ...r, status: ['progressing', 'paused'].includes(r.status) ? 'interrupted' : r.status }));
    } catch { /* First run. */ }
  }
  persist() { try { fs.writeFileSync(this.file, JSON.stringify(this.records.slice(0, 100)), { mode: 0o600 }); } catch (err) { this.log.error('Could not save download metadata', err); } }
  broadcast(event, entry, isPrivate) {
    for (const win of this.getWindows()) if (!win.isDestroyed() && Boolean(win.__vesperaPrivate) === isPrivate) win.webContents.send('download:' + event, entry);
  }
  upsert(entry, isPrivate) {
    const list = isPrivate ? this.privateRecords : this.records;
    const i = list.findIndex((r) => r.id === entry.id);
    if (i < 0) list.unshift(entry); else list[i] = { ...list[i], ...entry };
    if (!isPrivate) this.persist();
  }
  attach(session, isPrivate = false) {
    session.on('will-download', (_event, item) => {
      const prefs = this.getPrefs();
      const folder = prefs.downloadPath && fs.existsSync(prefs.downloadPath) && fs.statSync(prefs.downloadPath).isDirectory() ? prefs.downloadPath : app.getPath('downloads');
      if (prefs.askDownloadLocation === false) item.setSavePath(path.join(folder, item.getFilename()));
      else item.setSaveDialogOptions({ defaultPath: path.join(folder, item.getFilename()) });
      const entry = { id: crypto.randomUUID(), name: item.getFilename(), url: item.getURL(), path: item.getSavePath(), size: item.getTotalBytes(), received: 0, status: 'progressing', at: Date.now(), canResume: item.canResume() };
      this.items.set(entry.id, { item, isPrivate }); this.upsert(entry, isPrivate);
      this.broadcast('started', entry, isPrivate); this.log.info(`Download started: ${entry.name}`);
      let lastUpdate = 0;
      item.on('updated', (_e, state) => {
        Object.assign(entry, { status: item.isPaused() ? 'paused' : state, received: item.getReceivedBytes(), size: item.getTotalBytes(), path: item.getSavePath(), canResume: item.canResume() });
        this.upsert(entry, isPrivate);
        if (Date.now() - lastUpdate > 200 || state !== 'progressing') { this.broadcast('updated', entry, isPrivate); lastUpdate = Date.now(); }
      });
      item.once('done', (_e, state) => {
        Object.assign(entry, { status: state, received: item.getReceivedBytes(), size: item.getTotalBytes(), path: item.getSavePath() });
        this.upsert(entry, isPrivate); this.broadcast('done', entry, isPrivate);
        this.items.delete(entry.id); this.log.info(`Download ${state}: ${entry.name}`);
      });
    });
  }
  list(isPrivate) { return isPrivate ? this.privateRecords : this.records; }
  get(id, isPrivate) { return this.list(isPrivate).find((r) => r.id === id); }
  async action(action, id, isPrivate) {
    const record = this.get(id, isPrivate);
    if (!record) return { ok: false, message: 'This download is no longer in the list.' };
    if (action === 'open' || action === 'show') {
      if (record.status !== 'completed' || !record.path || !fs.existsSync(record.path)) return { ok: false, message: 'The file has been moved, deleted, or is not finished.' };
      if (action === 'show') shell.showItemInFolder(record.path);
      else { const error = await shell.openPath(record.path); if (error) return { ok: false, message: error }; }
      return { ok: true };
    }
    const live = this.items.get(id)?.item;
    if (!live) return { ok: false, message: 'This download is no longer active.' };
    if (action === 'cancel') live.cancel();
    else if (action === 'pause') live.pause();
    else if (action === 'resume' && live.canResume()) live.resume();
    else return { ok: false, message: 'This download cannot be resumed. Please retry it.' };
    return { ok: true };
  }
  clear(isPrivate) {
    if (isPrivate) this.privateRecords = this.privateRecords.filter((r) => ['progressing', 'paused'].includes(r.status));
    else { this.records = this.records.filter((r) => ['progressing', 'paused'].includes(r.status)); this.persist(); }
  }
}
module.exports = { DownloadManager };
