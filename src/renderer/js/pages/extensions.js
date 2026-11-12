import { icon } from '../icons.js';
import { state, bus } from '../state.js';
import { escapeHtml } from '../toasts.js';
import { BUILTIN_EXTENSIONS, EXTENSION_CATALOG } from '../../../shared/extensions.mjs';
import { confirmAction } from '../dialog.js';

export function renderExtensions(container, ctx) {
  let query = '', filter = 'all', external = [];
  const desktopReady = Boolean(window.vespera?.extensions);
  const status = state.private
    ? ['Extensions are paused in private windows', 'chip']
    : (desktopReady ? ['Desktop app · extensions ready', 'chip-ok'] : ['Web preview · desktop extensions unavailable', 'chip']);
  container.innerHTML = `<div class="page extensions-page"><span class="eyebrow">A LITTLE MORE SUPERPOWER</span><h1 class="page-title">Extensions</h1><p class="page-sub">Small tools that add exactly what you need. Turn on what you use and leave the rest alone.</p>
    <nav class="settings-nav" aria-label="Extensions sections"><a href="#general" data-section="general">General</a><a href="#built-in" data-section="built-in">Built-in</a><a href="#installed" data-section="installed">Installed</a><a href="#catalog" data-section="catalog">Catalog</a></nav>

    <section class="section" id="general"><h2>${icon('sparkle')} General</h2>
      <div class="extension-banner"><div class="extension-banner-icon">${icon('split')}</div><div class="grow"><b>Your essentials are already here.</b><p>Built-in privacy and productivity tools, plus a manager for compatible Chromium extensions.</p></div><span class="chip ${status[1]}">${icon('check')} ${status[0]}</span></div>
      <div class="card extension-install-card"><div class="row" style="gap:10px;flex-wrap:wrap"><b>Install from a source you trust</b><span class="grow"></span><span class="small faint">Nothing installs without your say-so.</span></div>
        <p class="muted" style="margin-top:10px">Every extension package is reviewed before it runs. Extensions can read or change website content; only load code you trust. Electron supports a subset of Chrome APIs, so some extensions may not work as expected.</p>
        <div class="extension-dev-row"><div><label class="s-label" for="ext-developer-mode">Developer mode</label><div class="s-desc">Enables unpacked extension folders on this device. Vespera still shows a permission review; this security setting is not synced.</div></div><label class="switch"><input type="checkbox" id="ext-developer-mode" aria-label="Developer mode" ${state.settings.extensions.developerMode ? 'checked' : ''} ${!desktopReady || state.private ? 'disabled' : ''}><span class="track"></span><span class="thumb"></span></label></div>
        <div class="row extension-install-actions">
          <button class="btn btn-primary" id="ext-open-store">${icon('external')} Open Chrome Web Store</button>
          <button class="btn" data-ext-open="https://github.com/topics/chrome-extension">${icon('code')} Explore GitHub</button>
          <button class="btn" id="ext-load" ${!desktopReady || state.private ? 'disabled' : ''}>${icon('download')} Install package (.zip / .crx)</button>
          <button class="btn" id="ext-load-unpacked" ${state.settings.extensions.developerMode ? '' : 'hidden'}>${icon('code')} Load unpacked</button>
        </div>
        <p class="small faint extension-dev-note" id="extension-dev-note"></p>
      </div>
    </section>

    <section class="section" id="built-in"><h2>${icon('shield')} Built-in</h2>
      <p class="muted small" style="margin-top:-6px">Ships with Vespera — no download, store, or account required.</p>
      <div class="cm-toolbar"><input class="input" id="ext-search" placeholder="Find an extension…" aria-label="Search extensions" style="max-width:340px"><div class="segmented" id="ext-filter"><button data-filter="all" class="active">All</button><button data-filter="enabled">Enabled</button></div><span class="grow"></span></div>
      <div class="extension-grid" id="ext-grid"></div>
    </section>

    <section class="section" id="installed"><h2>${icon('puzzle')} Installed</h2>
      <p class="muted small" style="margin-top:-6px">Enable or disable third-party extensions, review their declared access, pin toolbar actions, or remove them. Disabled extensions stay installed but do not run.</p>
      <div class="card"><div class="row extension-store-row"><input class="input" id="store-url" placeholder="https://chromewebstore.google.com/detail/…" aria-label="Chrome Web Store URL" spellcheck="false"><button class="btn btn-primary" id="ext-store-install" ${!desktopReady || state.private ? 'disabled' : ''}>${icon('download')} Install from Chrome Web Store</button><button class="btn btn-ghost" data-ext-open="https://chromewebstore.google.com/category/extensions">${icon('external')} Browse the store</button></div><div id="ext-external"></div></div>
    </section>

    <section class="section" id="catalog"><h2>${icon('code')} Catalog</h2><p class="muted small" style="margin-top:-6px">A short list of useful projects. Buttons open the developer’s own download page in a new tab — review every package before installing.</p><div class="extension-grid" id="catalog-grid" style="margin-top:14px"></div></section>
  </div>`;

  container.querySelectorAll('[data-section]').forEach((a) => a.onclick = (e) => { e.preventDefault(); container.querySelector('#' + a.dataset.section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  container.querySelectorAll('[data-ext-open]').forEach((btn) => btn.onclick = () => ctx.openTab(btn.dataset.extOpen));

  const developerToggle = container.querySelector('#ext-developer-mode');
  const unpackedButton = container.querySelector('#ext-load-unpacked');
  const developerNote = container.querySelector('#extension-dev-note');
  const syncDeveloperControls = () => {
    const on = Boolean(state.settings.extensions.developerMode);
    unpackedButton.hidden = !on;
    unpackedButton.disabled = !desktopReady || state.private || !on;
    developerNote.textContent = !desktopReady
      ? 'Install extensions in the Vespera desktop app.'
      : state.private ? 'Extensions are unavailable in private windows.'
        : on ? 'Unpacked folders are copied into Vespera’s extension store after you approve the permission review.'
          : 'Turn on Developer mode to load an unpacked folder.';
  };
  developerToggle.onchange = () => {
    const next = developerToggle.checked;
    if (!state.set('extensions.developerMode', next)) developerToggle.checked = !next;
    syncDeveloperControls();
    ctx.toast(`Developer mode ${developerToggle.checked ? 'enabled' : 'disabled'}`, 'info');
  };
  syncDeveloperControls();

  const builtinEnabled = (ext) => ext.action ? true : Boolean(valueAt(state.settings, ext.setting));
  function render() {
    const list = BUILTIN_EXTENSIONS.filter((ext) => (ext.name + ' ' + ext.description).toLowerCase().includes(query.toLowerCase()) && (filter !== 'enabled' || builtinEnabled(ext)));
    container.querySelector('#ext-grid').innerHTML = list.map((ext) => `<article class="extension-card"><div class="row"><span class="extension-icon ${escapeHtml(ext.id)}">${icon(ext.icon)}</span><span class="chip">${escapeHtml(ext.category)}</span><span class="grow"></span>${ext.setting ? `<label class="switch"><input type="checkbox" data-ext-toggle="${escapeHtml(ext.id)}" aria-label="Enable ${escapeHtml(ext.name)}" ${builtinEnabled(ext) ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label>` : '<span class="chip chip-ok">Ready</span>'}</div><h3>${escapeHtml(ext.name)}</h3><p>${escapeHtml(ext.description)}</p><div class="extension-card-foot"><span class="small faint">Vespera · v${escapeHtml(ext.version)}</span>${ext.action ? '<button class="text-btn" data-ext-action="reader">Open Reader View ↗</button>' : `<span class="small ${builtinEnabled(ext) ? 'extension-on' : 'muted'}">${builtinEnabled(ext) ? 'Enabled' : 'Disabled'}</span>`}</div><details><summary>Details & permissions</summary><p>${escapeHtml(ext.detail)}</p></details></article>`).join('') || '<div class="empty">No extensions match your search.</div>';
    container.querySelectorAll('[data-ext-toggle]').forEach((input) => input.onchange = () => {
      const ext = BUILTIN_EXTENSIONS.find((item) => item.id === input.dataset.extToggle);
      if (!ext) return;
      const ok = state.set(ext.setting, input.checked);
      if (!ok) input.checked = !input.checked;
      render();
      ctx.toast(`${ext.name} ${input.checked ? 'enabled' : 'disabled'}`, 'ok');
    });
    container.querySelector('[data-ext-action="reader"]')?.addEventListener('click', () => ctx.reader());

    // Third-party extensions: details and controls reflect Electron's real support.
    const pinnedIds = new Set(Array.isArray(state.settings.extensions.pinnedIds) ? state.settings.extensions.pinnedIds : []);
    const externalList = container.querySelector('#ext-external');
    externalList.innerHTML = external.length ? external.map((ext) => {
      const id = escapeHtml(ext.id || '');
      const name = escapeHtml(ext.name || 'Unnamed extension');
      const iconData = typeof ext.icon === 'string' && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/]+=*$/i.test(ext.icon) ? `<img src="${ext.icon}" alt="" referrerpolicy="no-referrer">` : icon('puzzle');
      const permissionList = Array.isArray(ext.permissions) ? ext.permissions : [];
      const siteAccess = Array.isArray(ext.hostPermissions) ? ext.hostPermissions : [];
      const pinned = pinnedIds.has(ext.id);
      const statusLabel = ext.enabled ? 'Enabled' : 'Disabled';
      return `<article class="extension-manager-card ${ext.enabled ? '' : 'is-disabled'}"><div class="extension-manager-head"><span class="extension-manager-icon">${iconData}</span><div class="extension-manager-title"><h3>${name}</h3><div class="extension-manager-meta">v${escapeHtml(ext.version || '?')} · Manifest ${escapeHtml(ext.manifestVersion || '—')} · ${statusLabel}</div></div><span class="chip ${ext.enabled ? 'chip-ok' : ''}">${statusLabel}</span></div>
        <p class="extension-manager-description">${escapeHtml(ext.description || 'No description supplied by the extension developer.')}</p>
        <div class="extension-manager-controls"><div class="extension-manager-control"><span>Enabled</span><label class="switch"><input type="checkbox" data-enable-ext="${id}" aria-label="Enable ${name}" ${ext.enabled ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label></div><div class="extension-manager-control"><span>Pin to toolbar</span><label class="switch"><input type="checkbox" data-pin-ext="${id}" aria-label="Pin ${name} to toolbar" ${pinned ? 'checked' : ''} ${!ext.enabled ? 'disabled' : ''}><span class="track"></span><span class="thumb"></span></label></div><button class="btn btn-danger btn-sm" data-remove-ext="${id}">${icon('trash')} Remove</button></div>
        <details class="extension-manager-details"><summary>Extension ID & requested access</summary><div class="extension-details-grid"><div><span>Extension ID</span><code>${id || 'Unavailable'}</code></div><div><span>Toolbar action</span><p>${ext.popup ? 'Popup available' : 'No popup declared'}${ext.actionTitle ? ' · ' + escapeHtml(ext.actionTitle) : ''}</p></div><div><span>Permissions</span><p>${permissionList.length ? permissionList.map(escapeHtml).join(' · ') : 'None declared'}</p></div><div><span>Site access</span><p>${siteAccess.length ? siteAccess.map(escapeHtml).join(' · ') : 'No host access declared'}</p></div></div><p class="small faint">Declared permissions are a summary, not a security guarantee. Extensions may still access pages or data through supported APIs.</p></details></article>`;
    }).join('') : '<div class="empty">No third-party extensions yet.<p class="small muted">Install a reviewed .zip/.crx package, load an unpacked folder with Developer mode, or paste a Chrome Web Store link above.</p></div>';

    externalList.querySelectorAll('[data-enable-ext]').forEach((input) => input.onchange = async () => {
      const id = input.dataset.enableExt, requested = input.checked;
      input.disabled = true;
      try {
        const result = requested ? await window.vespera.extensions.enable(id) : await window.vespera.extensions.disable(id);
        if (!result?.ok) { ctx.toast(result?.message || 'Could not update this extension.', 'error'); external = await window.vespera.extensions.list(); }
        else { external = result.extensions || await window.vespera.extensions.list(); ctx.toast(`${requested ? 'Enabled' : 'Disabled'} ${input.getAttribute('aria-label').replace(/^(Enable) /, '')}`, 'ok'); }
        bus.emit('extensions', external);
        render();
      } catch (err) { ctx.toast(err.message || 'Could not update this extension.', 'error'); input.disabled = false; input.checked = !requested; }
    });
    externalList.querySelectorAll('[data-pin-ext]').forEach((input) => input.onchange = () => {
      const ids = new Set(Array.isArray(state.settings.extensions.pinnedIds) ? state.settings.extensions.pinnedIds : []);
      if (input.checked) ids.add(input.dataset.pinExt); else ids.delete(input.dataset.pinExt);
      if (!state.set('extensions.pinnedIds', [...ids])) { input.checked = !input.checked; return; }
      ctx.toast(input.checked ? 'Extension pinned to the toolbar' : 'Extension unpinned', 'ok');
    });
    externalList.querySelectorAll('[data-remove-ext]').forEach((btn) => btn.onclick = async () => {
      if (!await confirmAction({ title: 'Remove extension?', message: 'This unloads the extension and deletes Vespera’s installed copy. Its developer source folder is not changed.', confirmText: 'Remove', danger: true })) return;
      try {
        const result = await window.vespera.extensions.remove(btn.dataset.removeExt);
        if (result.ok) {
          external = result.extensions || [];
          const pinned = new Set(state.settings.extensions.pinnedIds || []); pinned.delete(btn.dataset.removeExt); state.set('extensions.pinnedIds', [...pinned]);
          bus.emit('extensions', external);
          render(); ctx.toast('Extension removed', 'ok');
        } else ctx.toast(result.message || 'Extension could not be removed.', 'error');
      } catch (err) { ctx.toast(err.message || 'The extension could not be removed.', 'error'); }
    });

    const grid = container.querySelector('#catalog-grid');
    grid.innerHTML = EXTENSION_CATALOG.map((ext) => `<article class="extension-card"><div class="row"><span class="extension-icon">${icon('code')}</span><span class="chip">${escapeHtml(ext.category)}</span><span class="grow"></span></div><h3>${escapeHtml(ext.name)}</h3><p>${escapeHtml(ext.description)}</p><div class="extension-card-foot"><span class="small faint">${escapeHtml(ext.developer)}</span><button class="text-btn" data-catalog-url="${escapeHtml(ext.url)}">Download page ↗</button></div></article>`).join('');
    grid.querySelectorAll('[data-catalog-url]').forEach((button) => button.onclick = (e) => { e.preventDefault(); ctx.openTab(button.dataset.catalogUrl); });
  }

  const loadExtension = async (method) => {
    const buttons = [container.querySelector('#ext-load'), unpackedButton, container.querySelector('#ext-store-install')];
    buttons.forEach((button) => { if (button) button.disabled = true; });
    let outcome = null;
    try {
      outcome = await method();
      if (outcome?.ok) { external = outcome.extensions || await window.vespera.extensions.list(); bus.emit('extensions', external); render(); ctx.toast(`${outcome.name || 'Extension'} installed. Review its details below.`, 'ok', 5000); }
      else if (!outcome?.canceled) ctx.toast(outcome?.message || 'This extension could not be loaded.', 'error', 6500);
    } catch (err) { ctx.toast(err.message || 'This extension could not be loaded.', 'error', 6500); }
    finally { buttons.forEach((button) => { if (button?.isConnected) button.disabled = !desktopReady || state.private; }); syncDeveloperControls(); }
    return outcome;
  };
  container.querySelector('#ext-load').onclick = () => loadExtension(() => window.vespera.extensions.install());
  unpackedButton.onclick = () => {
    if (!state.settings.extensions.developerMode) return ctx.toast('Turn on Developer mode first.', 'info');
    loadExtension(() => window.vespera.extensions.loadUnpacked());
  };
  container.querySelector('#ext-open-store').onclick = () => ctx.openTab('https://chromewebstore.google.com/');
  container.querySelector('#ext-search').oninput = (e) => { query = e.target.value; render(); };
  container.querySelector('#ext-filter').onclick = (e) => {
    const button = e.target.closest('[data-filter]'); if (!button) return;
    filter = button.dataset.filter;
    container.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item === button));
    render();
  };

  const storeInput = container.querySelector('#store-url');
  const installFromStore = () => {
    const url = storeInput.value.trim();
    if (!url) { storeInput.focus(); return ctx.toast('Paste the extension’s Chrome Web Store link first.', 'info'); }
    if (!/(?:chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url) && !/\b[a-p]{32}\b/i.test(url)) return ctx.toast('That does not look like a Chrome Web Store link. Copy the address bar from the store page.', 'error', 6000);
    return loadExtension(() => window.vespera.extensions.installFromStore(url)).then(async (outcome) => {
      if (outcome?.ok) storeInput.value = '';
      external = await window.vespera.extensions.list().catch(() => external);
      bus.emit('extensions', external);
      if (container.isConnected) render();
    });
  };
  container.querySelector('#ext-store-install').onclick = installFromStore;
  storeInput.onkeydown = (e) => { if (e.key === 'Enter') installFromStore(); };

  render();
  let alive = true;
  if (desktopReady && !state.private) window.vespera.extensions.list().then((items) => {
    if (alive && container.isConnected) { external = Array.isArray(items) ? items : []; bus.emit('extensions', external); render(); }
  }).catch(() => {});
  return () => { alive = false; };
}

function valueAt(object, path) { return path.split('.').reduce((o, key) => o?.[key], object); }
