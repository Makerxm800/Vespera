import { bus, state } from './state.js';
import { saveBlob } from './dialog.js';
import { toast } from './toasts.js';
const KEY = 'vespera.downloads';
function load() { try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }
export const downloads = { items: state.private ? [] : load() };
function persist() {
  if (!state.private && !window.vespera) {
    try { localStorage.setItem(KEY, JSON.stringify(downloads.items.slice(0, 100))); } catch { /* Metadata only; the file is independent. */ }
  }
  bus.emit('downloads', downloads.items);
}
export function upsertDownload(entry) {
  if (!entry?.id) return;
  const i = downloads.items.findIndex((d) => d.id === entry.id);
  if (i < 0) downloads.items.unshift(entry);
  else downloads.items[i] = { ...downloads.items[i], ...entry };
  persist();
}
export async function initDownloads() {
  if (!window.vespera) return;
  const items = await window.vespera.app.downloads();
  if (Array.isArray(items)) { downloads.items = items; persist(); }
  for (const event of ['started', 'updated', 'done']) {
    window.vespera.on('download:' + event, (entry) => {
      upsertDownload(entry);
      if (event === 'started') toast(`Downloading ${entry.name}`, 'info');
      if (event === 'done' && entry.status === 'completed') toast(`${entry.name} is ready`, 'ok');
    });
  }
}
export async function downloadUrl(url, name = '') {
  if (!/^https?:\/\//i.test(url)) return toast('Only web files can be downloaded.', 'error');
  if (window.vespera) {
    const result = await window.vespera.app.download(url);
    if (!result?.ok) toast(result?.message || 'Download could not start.', 'error');
    return;
  }
  const id = 'preview-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  let filename = name;
  try { filename ||= decodeURIComponent(new URL(url).pathname.split('/').pop() || 'download'); } catch { filename ||= 'download'; }
  filename = filename.replace(/[\\/:*?"<>|]/g, '_').slice(0, 160) || 'download';
  upsertDownload({ id, name: filename, url, status: 'progressing', received: 0, size: 0, at: Date.now(), preview: true });
  try {
    const response = await fetch('/proxy?download=1&url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('The preview service could not retrieve this file.');
    const blob = await response.blob();
    saveBlob(blob, filename);
    upsertDownload({ id, status: 'browser', received: blob.size, size: blob.size });
    toast('File sent to your browser’s downloads.', 'ok');
  } catch (err) {
    upsertDownload({ id, status: 'interrupted', error: err.message });
    toast('Download failed. Try the original site or desktop mode.', 'error');
  }
}
export function downloadText(text, name, type = 'text/plain;charset=utf-8') {
  saveBlob(new Blob([text], { type }), name);
  upsertDownload({ id: 'local-' + Date.now(), name, url: '', status: window.vespera ? 'completed' : 'browser', received: new Blob([text]).size, at: Date.now(), preview: !window.vespera });
  toast('File sent to downloads.', 'ok');
}
export async function downloadAction(action, id) {
  if (!window.vespera) return;
  const result = await window.vespera.app.downloadAction(action, id);
  if (!result?.ok) toast(result?.message || 'This file is no longer available.', 'error');
}
export function clearDownloads() { window.vespera?.app.clearDownloads(); downloads.items = downloads.items.filter((d) => ['progressing', 'paused'].includes(d.status)); persist(); }
export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return 'Size unknown';
  const units = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 || n >= 10 ? 0 : 1)} ${units[i]}`;
}
