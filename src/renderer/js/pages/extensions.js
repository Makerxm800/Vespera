import { icon } from '../icons.js';
import { state } from '../state.js';
import { escapeHtml } from '../toasts.js';
import { BUILTIN_EXTENSIONS, CHROME_WEB_STORE } from '../../../shared/extensions.mjs';
import { confirmAction } from '../dialog.js';

export function renderExtensions(container, ctx) {
  let query = '', filter = 'all', external = [];
  container.innerHTML = `<div class="page"><span class="eyebrow">A LITTLE MORE SUPERPOWER</span><h1 class="page-title">Extensions</h1><p class="page-sub">Useful tools, already included. Turn on what you need and leave the rest alone.</p>
    <div class="extension-banner"><div class="extension-banner-icon">${icon('split')}</div><div class="grow"><b>Your essentials are already here.</b><p>Built-in privacy and productivity tools, plus a manager for compatible third-party extensions.</p></div><span class="chip chip-accent">Built in</span></div>
    <div class="cm-toolbar"><input class="input" id="ext-search" placeholder="Find an extension…" aria-label="Search extensions" style="max-width:340px"><div class="segmented" id="ext-filter"><button data-filter="all" class="active">All</button><button data-filter="enabled">Enabled</button></div><span class="grow"></span><button class="btn" id="ext-store">Chrome Web Store ${icon('external')}</button></div>
    <div class="extension-grid" id="ext-grid"></div>
    <section class="section"><h2>${icon('code')} Chrome extensions & compatibility</h2><div class="card"><p class="muted">Browse the Chrome Web Store to discover extensions, but store listings cannot be installed directly into Vespera yet. On desktop, load a compatible extension folder obtained from its developer.</p><p class="small muted" style="margin-top:10px">Vespera uses Electron’s Chromium engine, not the full Google Chrome extension environment. Some Chrome APIs and extensions may not work. Review permissions and only load code you trust.</p><div class="row" style="margin-top:18px;flex-wrap:wrap"><button class="btn" id="ext-load" ${!window.vespera || state.private ? 'disabled' : ''}>${icon('plus')} Load unpacked extension</button><span class="small faint">${state.private ? 'Extensions are not loaded in private windows.' : !window.vespera ? 'Loading unpacked extensions is available on desktop.' : 'Only load source code you trust.'}</span></div><div id="ext-external"></div></div></section>
  </div>`;
  const enabled = (ext) => ext.action ? true : Boolean(valueAt(state.settings, ext.setting));
  function render() {
    const list = BUILTIN_EXTENSIONS.filter((e) => (e.name + ' ' + e.description).toLowerCase().includes(query.toLowerCase()) && (filter !== 'enabled' || enabled(e)));
    container.querySelector('#ext-grid').innerHTML = list.map((e) => `<article class="extension-card"><div class="row"><span class="extension-icon ${e.id}">${icon(e.icon)}</span><span class="chip">${e.category}</span><span class="grow"></span>${e.setting ? `<label class="switch"><input type="checkbox" data-ext-toggle="${e.id}" aria-label="Enable ${e.name}" ${enabled(e) ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label>` : '<span class="chip chip-ok">Ready</span>'}</div><h3>${e.name}</h3><p>${e.description}</p><div class="extension-card-foot"><span class="small faint">Vespera · v${e.version}</span>${e.action ? `<button class="text-btn" data-ext-action="${e.action}">Open Reader View ↗</button>` : `<span class="small ${enabled(e) ? 'extension-on' : 'muted'}">${enabled(e) ? 'Enabled' : 'Disabled'}</span>`}</div><details><summary>Details & permissions</summary><p>${e.detail}</p></details></article>`).join('') || '<div class="empty">No extensions match your search.</div>';
    container.querySelectorAll('[data-ext-toggle]').forEach((input) => input.onchange = () => {
      const ext = BUILTIN_EXTENSIONS.find((e) => e.id === input.dataset.extToggle);
      state.set(ext.setting, input.checked); render(); ctx.toast(`${ext.name} ${input.checked ? 'enabled' : 'disabled'}`, 'ok');
    });
    container.querySelector('[data-ext-action="reader"]')?.addEventListener('click', () => ctx.reader());
    container.querySelector('#ext-external').innerHTML = external.map((e) => `<div class="setting-row" style="margin-top:12px"><div><div class="s-label">${escapeHtml(e.name)}</div><div class="s-desc">v${escapeHtml(e.version)} · ${escapeHtml(e.path)}</div></div><button class="btn btn-danger" data-remove-ext="${escapeHtml(e.id)}">Remove</button></div>`).join('');
    container.querySelectorAll('[data-remove-ext]').forEach((btn) => btn.onclick = async () => {
      if (!await confirmAction({ title: 'Remove extension?', message: 'This unloads the extension from Vespera. Its source folder is not deleted.', confirmText: 'Remove', danger: true })) return;
      const result = await window.vespera.extensions.remove(btn.dataset.removeExt);
      if (result.ok) { external = result.extensions; render(); ctx.toast('Extension removed', 'ok'); } else ctx.toast(result.message, 'error');
    });
  }
  container.querySelector('#ext-search').oninput = (e) => { query = e.target.value; render(); };
  container.querySelector('#ext-filter').onclick = (e) => { const btn = e.target.closest('[data-filter]'); if (!btn) return; filter = btn.dataset.filter; container.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('active', b === btn)); render(); };
  container.querySelector('#ext-store').onclick = () => { ctx.openTab(CHROME_WEB_STORE); ctx.toast('The store is for discovery. Direct store installation is not supported yet; use Load unpacked for compatible extensions.', 'info', 5500); };
  container.querySelector('#ext-load').onclick = async () => {
    const result = await window.vespera.extensions.install();
    if (result.ok) { external = result.extensions; render(); ctx.toast('Extension loaded. Your trusted folder is saved for future launches.', 'ok', 5000); }
    else if (!result.canceled) ctx.toast(result.message || 'This extension could not be loaded.', 'error', 6500);
  };
  render();
  let alive = true;
  if (window.vespera && !state.private) window.vespera.extensions.list().then((items) => { if (alive) { external = items || []; render(); } });
  return () => { alive = false; };
}
function valueAt(object, path) { return path.split('.').reduce((o, k) => o?.[k], object); }
