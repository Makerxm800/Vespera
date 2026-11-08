/** History, bookmarks, and a live download manager. */
import { icon } from '../icons.js';
import { state, bus } from '../state.js';
import { escapeHtml, toast } from '../toasts.js';
import { downloads, formatBytes, downloadAction, clearDownloads, downloadUrl } from '../downloads.js';
import { confirmAction } from '../dialog.js';

export function renderHistory(container, ctx) {
  container.innerHTML = `<div class="page"><div class="library-heading"><div><span class="eyebrow">YOUR TRAIL THROUGH THE WEB</span><h1 class="page-title">History</h1><p class="page-sub">Find that page again. Private browsing is never saved.</p></div><button class="btn btn-danger" id="h-clear">${icon('trash')} Clear history</button></div><div class="section"><input class="input" id="h-search" placeholder="Search by title or website…" aria-label="Search history" style="max-width:480px"></div><div id="h-list" style="margin-top:18px"></div></div>`;
  const renderList = () => {
    const filter = container.querySelector('#h-search').value.toLowerCase();
    const items = state.history.filter((h) => (h.title + ' ' + h.url).toLowerCase().includes(filter));
    const list = container.querySelector('#h-list');
    if (!items.length) { list.innerHTML = `<div class="empty">${icon('clock')}<div>${filter ? 'No pages match your search.' : 'A fresh start. Pages you visit will appear here.'}</div></div>`; return; }
    const groups = new Map();
    for (const h of items) { const day = new Date(h.visitedAt).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }); if (!groups.has(day)) groups.set(day, []); groups.get(day).push(h); }
    list.innerHTML = [...groups].map(([day, rows]) => `<div class="hist-day"><h3>${escapeHtml(day)}</h3>${rows.map((h) => `<div class="hist-row" data-url="${escapeHtml(h.url)}"><span class="h-time">${new Date(h.visitedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>${icon('globe')}<button class="text-btn h-title ellipsis" data-visit>${escapeHtml(h.title || h.url)}</button><span class="h-url ellipsis">${escapeHtml(h.url)}</span><button class="icon-btn" data-del="${escapeHtml(h.url)}" title="Remove from history" aria-label="Remove ${escapeHtml(h.title)}">${icon('x')}</button></div>`).join('')}</div>`).join('');
    list.querySelectorAll('[data-visit]').forEach((btn) => btn.onclick = () => ctx.navigate(btn.closest('[data-url]').dataset.url));
    list.querySelectorAll('[data-del]').forEach((btn) => btn.onclick = () => { state.removeHistory(btn.dataset.del); });
  };
  renderList(); const off = bus.on('history', renderList);
  container.querySelector('#h-search').oninput = renderList;
  container.querySelector('#h-clear').onclick = async () => { if (await confirmAction({ title: 'Clear browsing history?', message: 'Saved visits will be removed from this device and your connected sync store.', confirmText: 'Clear history', danger: true })) { state.clearHistory(); toast('History cleared', 'ok'); } };
  return off;
}

export function renderBookmarks(container, ctx) {
  container.innerHTML = `<div class="page"><span class="eyebrow">KEEP THE GOOD STUFF</span><h1 class="page-title">Bookmarks</h1><p class="page-sub">Your favorite corners of the web, right where you left them.</p><div class="section"><div class="row library-tools"><input class="input grow" id="b-search" placeholder="Search bookmarks…" aria-label="Search bookmarks"><button class="btn" id="b-add">${icon('plus')} Save current page</button><button class="btn btn-ghost" id="b-bar">Toggle bookmarks bar</button></div><div class="bm-grid" id="b-grid"></div></div></div>`;
  const renderGrid = () => {
    const filter = container.querySelector('#b-search').value.toLowerCase();
    const items = state.bookmarks.filter((b) => (b.title + ' ' + b.url).toLowerCase().includes(filter));
    const grid = container.querySelector('#b-grid');
    grid.innerHTML = items.length ? items.map((b) => `<article class="bm-card"><button class="bm-open" data-url="${escapeHtml(b.url)}"><span class="bm-site-icon">${icon('globe')}</span><div class="bm-title">${escapeHtml(b.title || b.url)}</div><div class="bm-url">${escapeHtml(b.url)}</div></button><button class="icon-btn bm-del" data-del="${escapeHtml(b.id)}" title="Delete bookmark" aria-label="Delete ${escapeHtml(b.title)}">${icon('trash')}</button></article>`).join('') : `<div class="empty" style="grid-column:1/-1">${icon('bookmark')}<div>${filter ? 'No bookmarks match.' : 'No bookmarks yet. Open a website and press Ctrl+D.'}</div></div>`;
    grid.querySelectorAll('.bm-open').forEach((btn) => btn.onclick = () => ctx.navigate(btn.dataset.url));
    grid.querySelectorAll('[data-del]').forEach((btn) => btn.onclick = () => { state.removeBookmark(btn.dataset.del); toast('Bookmark removed', 'ok'); });
  };
  renderGrid(); const off = bus.on('bookmarks', renderGrid);
  container.querySelector('#b-search').oninput = renderGrid;
  container.querySelector('#b-add').onclick = () => {
    const tab = ctx.getActiveTab();
    if (!tab || tab._internal) return toast('Open a website first, then save it here.', 'info');
    const added = state.addBookmark({ title: tab.title, url: tab.url }); toast(added ? 'Page bookmarked' : 'Already in your bookmarks', added ? 'ok' : 'info');
  };
  container.querySelector('#b-bar').onclick = () => state.set('showBookmarksBar', !state.settings.showBookmarksBar);
  return off;
}

export function renderDownloads(container, ctx) {
  container.innerHTML = `<div class="page"><div class="library-heading"><div><span class="eyebrow">YOURS TO KEEP</span><h1 class="page-title">Downloads</h1><p class="page-sub">${window.vespera ? 'Live progress, saved files, and everything in between.' : 'Files are handed to your browser. Check its downloads for the final save location.'}</p></div><button class="btn" id="d-folder" ${!window.vespera ? 'disabled' : ''}>${icon('external')} Open folder</button></div><div class="row library-tools" style="margin:22px 0"><button class="btn" id="d-save">${icon('download')} Save current page</button><span class="grow"></span><button class="btn btn-ghost" id="d-clear">Clear list</button></div><div id="d-list"></div><p class="small faint" style="margin-top:20px">Clearing this list does not delete downloaded files. Only download files from sources you trust.</p></div>`;
  function render() {
    const list = container.querySelector('#d-list');
    if (!downloads.items.length) { list.innerHTML = `<div class="empty download-empty">${icon('download')}<h3>Nothing here just yet.</h3><p>Download a file from a website and it will appear here.</p></div>`; return; }
    list.innerHTML = downloads.items.map((d) => {
      const progress = d.size > 0 ? Math.min(100, Math.round((d.received || 0) / d.size * 100)) : 0;
      const active = ['progressing', 'paused'].includes(d.status);
      const status = { completed: 'Downloaded', progressing: d.status === 'paused' ? 'Paused' : 'Downloading…', paused: 'Paused', cancelled: 'Cancelled', interrupted: 'Download failed', browser: 'Sent to browser downloads' }[d.status] || d.status;
      return `<article class="dl-row"><div class="dl-icon">${icon(d.status === 'completed' ? 'check' : 'download')}</div><div class="grow"><div class="dl-name">${escapeHtml(d.name)}</div><div class="small muted">${escapeHtml(status)} · ${formatBytes(d.received || d.size)}${d.size ? ' / ' + formatBytes(d.size) : ''}${d.at ? ' · ' + new Date(d.at).toLocaleDateString() : ''}</div>${active ? `<progress max="100" value="${progress}" aria-label="Download progress"></progress>` : ''}${d.error ? `<div class="small form-error">${escapeHtml(d.error)}</div>` : ''}</div><div class="dl-actions">${d.status === 'completed' && !d.preview ? `<button class="btn" data-action="open" data-id="${escapeHtml(d.id)}">Open</button><button class="icon-btn" data-action="show" data-id="${escapeHtml(d.id)}" title="Show in folder">${icon('external')}</button>` : ''}${active ? `<button class="icon-btn" data-action="${d.status === 'paused' ? 'resume' : 'pause'}" data-id="${escapeHtml(d.id)}" title="${d.status === 'paused' ? 'Resume' : 'Pause'}">${d.status === 'paused' ? '▶' : 'Ⅱ'}</button><button class="icon-btn" data-action="cancel" data-id="${escapeHtml(d.id)}" title="Cancel">${icon('x')}</button>` : ''}${['interrupted', 'cancelled'].includes(d.status) && d.url ? `<button class="icon-btn" data-retry="${escapeHtml(d.id)}" title="Retry">${icon('refresh')}</button>` : ''}</div></article>`;
    }).join('');
    list.querySelectorAll('[data-action]').forEach((btn) => btn.onclick = () => downloadAction(btn.dataset.action, btn.dataset.id));
    list.querySelectorAll('[data-retry]').forEach((btn) => btn.onclick = () => { const d = downloads.items.find((d) => d.id === btn.dataset.retry); if (d) downloadUrl(d.url, d.name); });
  }
  render(); const off = bus.on('downloads', render);
  container.querySelector('#d-folder').onclick = async () => { const r = await window.vespera.app.openDownloadFolder(); if (!r.ok) toast(r.message, 'error'); };
  container.querySelector('#d-save').onclick = () => { const tab = ctx.getActiveTab(); if (tab._internal) return toast('Open a website or file first.', 'info'); ctx.download(tab.url, (tab.title || 'page') + '.html'); };
  container.querySelector('#d-clear').onclick = async () => { if (await confirmAction({ title: 'Clear download list?', message: 'Active downloads will keep running. Files already on disk will not be deleted.', confirmText: 'Clear list' })) { clearDownloads(); toast('Download list cleared', 'ok'); } };
  return off;
}
