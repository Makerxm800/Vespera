import { icon } from '../icons.js';
import { state } from '../state.js';
import { escapeHtml } from '../toasts.js';
import { BUILTIN_EXTENSIONS, EXTENSION_CATALOG } from '../../../shared/extensions.mjs';
import { confirmAction } from '../dialog.js';

export function renderExtensions(container, ctx) {
  let query = '', filter = 'all', external = [];
  const status = state.private
    ? ['Extensions are paused in private windows', 'chip']
    : (window.vespera ? ['Desktop app · extensions ready', 'chip-ok'] : ['Web preview · install in the desktop app', 'chip']);
  container.innerHTML = `<div class="page extensions-page"><span class="eyebrow">A LITTLE MORE SUPERPOWER</span><h1 class="page-title">Extensions</h1><p class="page-sub">Small tools that add exactly what you need. Turn on what you use and leave the rest alone.</p>
    <nav class="settings-nav" aria-label="Extensions sections"><a href="#general" data-section="general">General</a><a href="#built-in" data-section="built-in">Built-in</a><a href="#installed" data-section="installed">Installed</a><a href="#catalog" data-section="catalog">Catalog</a></nav>

    <section class="section" id="general"><h2>${icon('sparkle')} General</h2>
      <div class="extension-banner"><div class="extension-banner-icon">${icon('split')}</div><div class="grow"><b>Your essentials are already here.</b><p>Built-in privacy and productivity tools, plus a manager for compatible third-party extensions.</p></div><span class="chip ${status[1]}">${icon('check')} ${status[0]}</span></div>
      <div class="card"><div class="row" style="gap:10px;flex-wrap:wrap"><b>Get more out of Vespera</b><span class="grow"></span><span class="small faint">Nothing installs without your say-so.</span></div>
        <p class="muted" style="margin-top:10px">Vespera runs real Chromium extensions. Add them from the Chrome Web Store with a store link, from a <b>.zip</b>/<b>.crx</b> package, or from an unpacked folder — every package is reviewed before anything runs.</p>
        <div class="row" style="margin-top:14px;flex-wrap:wrap;gap:10px">
          <button class="btn btn-primary" id="ext-open-store">${icon('external')} Open Chrome Web Store</button>
          <button class="btn" data-ext-open="https://github.com/topics/chrome-extension">${icon('code')} Popular on GitHub</button>
          <button class="btn" id="ext-load" ${!window.vespera || state.private ? 'disabled' : ''}>${icon('plus')} Install from file or folder</button>
          <span class="small faint">${state.private ? 'Extensions are disabled in private windows.' : !window.vespera ? 'Installing extensions is available in the desktop app.' : 'Always reviewed before loading. Some Chrome-only APIs may not work.'}</span>
        </div>
      </div>
    </section>

    <section class="section" id="built-in"><h2>${icon('shield')} Built-in</h2>
      <p class="muted small" style="margin-top:-6px">Ships with Vespera — no download, no store, no account. Flip on what you want.</p>
      <div class="cm-toolbar"><input class="input" id="ext-search" placeholder="Find an extension…" aria-label="Search extensions" style="max-width:340px"><div class="segmented" id="ext-filter"><button data-filter="all" class="active">All</button><button data-filter="enabled">Enabled</button></div><span class="grow"></span></div>
      <div class="extension-grid" id="ext-grid"></div>
    </section>

    <section class="section" id="installed"><h2>${icon('download')} Installed</h2>
      <p class="muted small" style="margin-top:-6px">Third-party extensions you added. They survive restarts and can be removed at any time.</p>
      <div class="card"><div class="row" style="flex-wrap:wrap;gap:10px"><input class="input" id="store-url" placeholder="https://chromewebstore.google.com/detail/…" aria-label="Chrome Web Store URL" style="flex:1;min-width:280px;max-width:520px" spellcheck="false"><button class="btn btn-primary" id="ext-store-install" ${!window.vespera || state.private ? 'disabled' : ''}>${icon('download')} Install from Chrome Web Store</button><button class="btn btn-ghost" data-ext-open="https://chromewebstore.google.com/category/extensions">${icon('external')} Browse the store</button></div><div id="ext-external"></div></div>
    </section>

    <section class="section" id="catalog"><h2>${icon('code')} Catalog</h2><p class="muted small" style="margin-top:-6px">Trusted, popular extensions. Each button opens the developer's own download page in a new tab — then install it here.</p><div class="extension-grid" id="catalog-grid" style="margin-top:14px"></div></section>
  </div>`;
  container.querySelectorAll('[data-section]').forEach((a) => a.onclick = (e) => { e.preventDefault(); container.querySelector('#' + a.dataset.section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  container.querySelectorAll('[data-ext-open]').forEach((btn) => btn.onclick = () => ctx.openTab(btn.dataset.extOpen));
  const enabled = (ext) => ext.action ? true : Boolean(valueAt(state.settings, ext.setting));
  function render() {
    const list = BUILTIN_EXTENSIONS.filter((e) => (e.name + ' ' + e.description).toLowerCase().includes(query.toLowerCase()) && (filter !== 'enabled' || enabled(e)));
    container.querySelector('#ext-grid').innerHTML = list.map((e) => `<article class="extension-card"><div class="row"><span class="extension-icon ${e.id}">${icon(e.icon)}</span><span class="chip">${e.category}</span><span class="grow"></span>${e.setting ? `<label class="switch"><input type="checkbox" data-ext-toggle="${e.id}" aria-label="Enable ${e.name}" ${enabled(e) ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label>` : '<span class="chip chip-ok">Ready</span>'}</div><h3>${e.name}</h3><p>${e.description}</p><div class="extension-card-foot"><span class="small faint">Vespera · v${e.version}</span>${e.action ? `<button class="text-btn" data-ext-action="reader">Open Reader View ↗</button>` : `<span class="small ${enabled(e) ? 'extension-on' : 'muted'}">${enabled(e) ? 'Enabled' : 'Disabled'}</span>`}</div><details><summary>Details & permissions</summary><p>${e.detail}</p></details></article>`).join('') || '<div class="empty">No extensions match your search.</div>';
    container.querySelectorAll('[data-ext-toggle]').forEach((input) => input.onchange = () => {
      const ext = BUILTIN_EXTENSIONS.find((e) => e.id === input.dataset.extToggle);
      state.set(ext.setting, input.checked); render(); ctx.toast(`${ext.name} ${input.checked ? 'enabled' : 'disabled'}`, 'ok');
    });
    container.querySelector('[data-ext-action="reader"]')?.addEventListener('click', () => ctx.reader());

    // Installed third-party extensions
    container.querySelector('#ext-external').innerHTML = external.length ? external.map((e) => `<div class="setting-row" style="margin-top:12px"><div><div class="s-label">${escapeHtml(e.name)}</div><div class="s-desc">v${escapeHtml(e.version)} · ${escapeHtml(e.path)}</div></div><button class="btn btn-danger" data-remove-ext="${escapeHtml(e.id)}">Remove</button></div>`).join('') : '<div class="empty">No third-party extensions yet.<p class="small muted">Paste a Chrome Web Store link above, or install a .zip / .crx package from your computer.</p></div>';
    container.querySelectorAll('[data-remove-ext]').forEach((btn) => btn.onclick = async () => {
      if (!await confirmAction({ title: 'Remove extension?', message: 'This unloads the extension from Vespera and deletes its installed copy.', confirmText: 'Remove', danger: true })) return;
      try {
        const result = await window.vespera.extensions.remove(btn.dataset.removeExt);
        if (result.ok) { external = result.extensions; render(); ctx.toast('Extension removed', 'ok'); } else ctx.toast(result.message, 'error');
      } catch (err) { ctx.toast(err.message || 'The extension could not be removed.', 'error'); }
    });

    // Curated catalog
    const grid = container.querySelector('#catalog-grid');
    if (grid) {
      grid.innerHTML = EXTENSION_CATALOG.map((e) => `<article class="extension-card"><div class="row"><span class="extension-icon">${icon('code')}</span><span class="chip">${escapeHtml(e.category)}</span><span class="grow"></span></div><h3>${escapeHtml(e.name)}</h3><p>${escapeHtml(e.description)}</p><div class="extension-card-foot"><span class="small faint">${escapeHtml(e.developer)}</span><span class="row" style="gap:8px"><button class="text-btn" data-catalog-url="${escapeHtml(e.url)}">Download page ↗</button></span></div></article>`).join('');
      grid.querySelectorAll('[data-catalog-url]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); ctx.openTab(a.dataset.catalogUrl); });
    }
  }
  container.querySelector('#ext-search').oninput = (e) => { query = e.target.value; render(); };
  container.querySelector('#ext-filter').onclick = (e) => { const btn = e.target.closest('[data-filter]'); if (!btn) return; filter = btn.dataset.filter; container.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('active', b === btn)); render(); };
  container.querySelector('#ext-load').onclick = async () => {
    try {
      const result = await window.vespera.extensions.install();
      if (result.ok) { external = result.extensions; render(); ctx.toast(`${result.name || 'Extension'} installed. It survives restarts.`, 'ok', 5000); }
      else if (!result.canceled) ctx.toast(result.message || 'This extension could not be loaded.', 'error', 6500);
    } catch (err) { ctx.toast(err.message || 'This extension could not be loaded.', 'error', 6500); }
  };
  container.querySelector('#ext-open-store').onclick = () => ctx.openTab('https://chromewebstore.google.com/');
  const storeInput = container.querySelector('#store-url');
  const installFromStore = async () => {
    const url = storeInput.value.trim();
    if (!url) { storeInput.focus(); return ctx.toast('Paste the extension\'s Chrome Web Store link first.', 'info'); }
    if (!/(?:chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url) && !/\b[a-p]{32}\b/i.test(url)) {
      return ctx.toast('That does not look like a Chrome Web Store link. Copy the address bar from the store page.', 'error', 6000);
    }
    const btn = container.querySelector('#ext-store-install');
    btn.disabled = true; btn.textContent = 'Downloading…';
    try {
      const result = await window.vespera.extensions.installFromStore(url);
      if (result.ok) { external = result.extensions; render(); ctx.toast(`${result.name || 'Extension'} installed from the Chrome Web Store.`, 'ok', 5000); storeInput.value = ''; }
      else ctx.toast(result.message || 'This Chrome Web Store extension could not be installed.', 'error', 7000);
    } catch (err) {
      ctx.toast(err.message || 'This Chrome Web Store extension could not be installed.', 'error', 7000);
    } finally { btn.disabled = false; btn.innerHTML = `${icon('download')} Install from Chrome Web Store`; }
  };
  container.querySelector('#ext-store-install').onclick = installFromStore;
  storeInput.onkeydown = (e) => { if (e.key === 'Enter') installFromStore(); };
  render();
  let alive = true;
  if (window.vespera && !state.private) window.vespera.extensions.list().then((items) => { if (alive) { external = items || []; render(); } });
  return () => { alive = false; };
}
function valueAt(object, path) { return path.split('.').reduce((o, k) => o?.[k], object); }
