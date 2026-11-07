/** History, Bookmarks & Downloads pages. */
import { icon } from '../icons.js';
import { state } from '../state.js';
import { escapeHtml, toast } from '../toasts.js';

/* ---------------- History ---------------- */
export function renderHistory(container, ctx) {
  container.innerHTML = `
    <div class="page">
      <div class="row" style="justify-content:space-between">
        <div>
          <h1 class="page-title">History</h1>
          <p class="page-sub" style="margin-bottom:0">Stored only on this device — and your account, if sync is on.</p>
        </div>
        <button class="btn btn-danger" id="h-clear">${icon('trash')} Clear browsing history</button>
      </div>
      <div class="section">
        <input class="input" id="h-search" placeholder="Search history…" style="max-width:420px">
      </div>
      <div id="h-list" style="margin-top:18px"></div>
    </div>`;

  const renderList = (filter = '') => {
    const list = container.querySelector('#h-list');
    const items = state.history.filter((h) =>
      !filter || (h.title + ' ' + h.url).toLowerCase().includes(filter.toLowerCase()));
    if (!items.length) {
      list.innerHTML = `<div class="empty">${icon('clock')}<div>No history ${filter ? 'matches' : 'yet'} — pages you visit will show up here.</div></div>`;
      return;
    }
    // Group by day
    const groups = new Map();
    for (const h of items) {
      const day = new Date(h.visitedAt).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(h);
    }
    list.innerHTML = [...groups.entries()].map(([day, rows]) => `
      <div class="hist-day">
        <h3>${escapeHtml(day)}</h3>
        ${rows.map((h) => `
          <div class="hist-row" data-url="${escapeHtml(h.url)}">
            <span class="h-time">${new Date(h.visitedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            ${icon('globe')}
            <span class="h-title ellipsis">${escapeHtml(h.title || h.url)}</span>
            <span class="h-url ellipsis">${escapeHtml(h.url)}</span>
            <button class="icon-btn" data-del="${escapeHtml(h.url)}" title="Remove">
              ${icon('x')}
            </button>
          </div>`).join('')}
      </div>`).join('');

    list.querySelectorAll('.hist-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-del]')) return;
        ctx.navigate(row.dataset.url, { kind: 'url' });
      });
    });
    list.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.history = state.history.filter((h) => h.url !== btn.dataset.del);
        localStorage.setItem('vespera.history', JSON.stringify({ items: state.history }));
        renderList(container.querySelector('#h-search').value);
      });
    });
  };

  renderList();
  container.querySelector('#h-search').addEventListener('input', (e) => renderList(e.target.value));
  container.querySelector('#h-clear').addEventListener('click', () => {
    state.clearHistory();
    renderList();
    toast('Browsing history cleared', 'ok');
  });
}

/* ---------------- Bookmarks ---------------- */
export function renderBookmarks(container, ctx) {
  container.innerHTML = `
    <div class="page">
      <h1 class="page-title">Bookmarks</h1>
      <p class="page-sub">Your saved pages. ${state.bookmarks.length} bookmark${state.bookmarks.length === 1 ? '' : 's'}.</p>
      <div class="section">
        <div class="row" style="margin-bottom:16px">
          <input class="input grow" id="b-search" placeholder="Search bookmarks…" style="max-width:420px">
          <button class="btn" id="b-add">${icon('plus')} Add current page</button>
        </div>
        <div class="bm-grid" id="b-grid"></div>
      </div>
    </div>`;

  const renderGrid = (filter = '') => {
    const grid = container.querySelector('#b-grid');
    const items = state.bookmarks.filter((b) =>
      !filter || (b.title + ' ' + b.url).toLowerCase().includes(filter.toLowerCase()));
    if (!items.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${icon('bookmark')}<div>
        No bookmarks ${filter ? 'match' : 'yet'} — press <span class="chip">Ctrl</span> <span class="chip">D</span> on any page.</div></div>`;
      return;
    }
    grid.innerHTML = items.map((b) => `
      <div class="bm-card" data-url="${escapeHtml(b.url)}">
        <div class="bm-title">${escapeHtml(b.title || b.url)}</div>
        <div class="bm-url">${escapeHtml(b.url)}</div>
        <button class="icon-btn bm-del" data-del="${b.id}" title="Delete">${icon('trash')}</button>
      </div>`).join('');

    grid.querySelectorAll('.bm-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-del]')) return;
        ctx.navigate(card.dataset.url, { kind: 'url' });
      });
    });
    grid.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.removeBookmark(btn.dataset.del);
        renderGrid(container.querySelector('#b-search').value);
        toast('Bookmark removed', 'ok');
      });
    });
  };

  renderGrid();
  container.querySelector('#b-search').addEventListener('input', (e) => renderGrid(e.target.value));
  container.querySelector('#b-add').addEventListener('click', () => {
    const tab = ctx.getActiveTab?.();
    if (!tab || tab.url.startsWith('vespera://')) return toast('Open a real page first', 'error');
    const added = state.addBookmark({ title: tab.title, url: tab.url });
    toast(added ? 'Bookmarked!' : 'Already bookmarked', added ? 'ok' : 'info');
    renderGrid();
  });
}

/* ---------------- Downloads ---------------- */
export function renderDownloads(container, ctx) {
  const downloads = window.__vesperaDownloads || [];
  container.innerHTML = `
    <div class="page">
      <h1 class="page-title">Downloads</h1>
      <p class="page-sub">Files you download appear here. Vespera never scans or uploads your downloads.</p>
      <div class="section" id="d-list">
        ${downloads.length ? downloads.map((d) => `
          <div class="dl-row">
            <div class="dl-icon">${icon('download')}</div>
            <div class="grow">
              <div style="font-weight:650">${escapeHtml(d.name)}</div>
              <div class="small muted">${escapeHtml(d.size || '')} · ${escapeHtml(d.status || 'done')}</div>
            </div>
          </div>`).join('') : `
          <div class="empty">${icon('download')}
            <div>No downloads yet.</div>
            <div class="small faint">In the desktop app, downloaded files are listed here automatically.</div>
          </div>`}
      </div>
    </div>`;
}
