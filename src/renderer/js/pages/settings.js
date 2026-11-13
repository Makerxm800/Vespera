/** Settings — every control writes a real preference and updates the browser immediately. */
import { icon } from '../icons.js';
import { state } from '../state.js';
import { SEARCH_ENGINES, safeTabUrl } from '../../../shared/privacy-utils.mjs';
import { escapeHtml } from '../toasts.js';
import { WALLPAPERS, saveWallpaper, removeCustomWallpaper, listCustomWallpapers, retuneWallpaper, clampAdjust } from '../wallpaper.js';
import { confirmAction } from '../dialog.js';
import { downloadText } from '../downloads.js';

/** The built-in presets and personal wallpaper library are kept distinct. */
function wallpaperGridHtml(s) {
  const current = s.wallpaper || { type: 'builtin', id: 'twilight' };
  return WALLPAPERS.map((wallpaper) => {
    const selected = current.type !== 'custom' && current.id === wallpaper.id;
    return `<button class="wallpaper-choice ${selected ? 'selected' : ''}" data-wallpaper="${wallpaper.id}" aria-pressed="${selected}"><span class="wallpaper-preview ${wallpaper.id}" ${wallpaper.image ? `style="background-image:url('${wallpaper.image}')"` : ''}></span><span>${wallpaper.name}${selected ? ' ✓' : ''}</span></button>`;
  }).join('');
}
function customWallpaperTilesHtml(wallpapers, current, thumbnailUrls) {
  if (!wallpapers.length) return '<div class="wallpaper-empty"><b>No custom wallpapers yet</b><span>Add one image or select several at once. Your collection stays on this device.</span></div>';
  return wallpapers.map((wallpaper) => {
    const selected = current?.type === 'custom' && current.id === wallpaper.id;
    const thumbnail = URL.createObjectURL(wallpaper.blob);
    thumbnailUrls.push(thumbnail);
    const name = escapeHtml(wallpaper.name);
    return `<div class="custom-wallpaper-tile ${selected ? 'selected' : ''}">
      <button class="wallpaper-choice custom-wallpaper-choice ${selected ? 'selected' : ''}" type="button" data-wallpaper-select="${escapeHtml(wallpaper.id)}" aria-pressed="${selected}" aria-label="Use wallpaper ${name}" title="${name}">
        <span class="wallpaper-preview custom-wallpaper-preview" style="background-image:url('${escapeHtml(thumbnail)}')"></span>
        <span class="custom-wallpaper-name"><span>${name}</span></span>
      </button>
      <button class="custom-wallpaper-remove" type="button" data-wallpaper-remove="${escapeHtml(wallpaper.id)}" aria-label="Remove wallpaper ${name}" title="Remove ${name}">${icon('trash')}</button>
    </div>`;
  }).join('');
}
let customWallpaperLibrary = [];
let customWallpaperLibraryLoaded = false;
let customWallpaperLibraryPromise = null;
let customWallpaperLibraryError = '';
function loadCustomWallpaperLibrary(refresh = false) {
  if (refresh) { customWallpaperLibraryLoaded = false; customWallpaperLibraryPromise = null; }
  if (customWallpaperLibraryLoaded) return Promise.resolve(customWallpaperLibrary);
  if (!customWallpaperLibraryPromise) {
    customWallpaperLibraryPromise = listCustomWallpapers().then((wallpapers) => {
      customWallpaperLibrary = wallpapers;
      customWallpaperLibraryError = '';
      return wallpapers;
    }).catch((err) => {
      customWallpaperLibrary = [];
      customWallpaperLibraryError = err.message || 'Could not read custom wallpapers from this device.';
      return [];
    }).finally(() => {
      customWallpaperLibraryLoaded = true;
      customWallpaperLibraryPromise = null;
    });
  }
  return customWallpaperLibraryPromise;
}

export function renderSettings(container, ctx) {
  const s = state.settings;
  const wallpaperThumbnailUrls = [];
  const sections = [
    ['appearance', 'palette', 'Appearance'], ['tabs', 'split', 'Tabs & groups'],
    ['search', 'search', 'Search & home'], ['browser', 'globe', 'Browser'],
    ['privacy', 'shield', 'Privacy'], ['extensions', 'puzzle', 'Extensions'],
    ['downloads', 'download', 'Downloads'], ['account', 'user', 'Account'], ['about', 'info', 'About Vespera'],
  ];
  container.innerHTML = `<div class="page settings-page settings-layout">
    <header class="settings-heading"><div><span class="eyebrow">YOUR BROWSER, YOUR WAY</span><h1 class="page-title">Settings</h1><p class="page-sub">Make Vespera feel right for you. Changes apply immediately and stay on this device.</p></div><span class="chip chip-ok">${icon('check')} Saved on this device</span></header>
    <div class="settings-workspace">
      <nav class="settings-nav" aria-label="Settings sections">
        <div class="settings-nav-label">Settings</div>
        ${sections.map(([id, symbol, label], index) => `<a href="#${id}" data-section="${id}" class="${index === 0 ? 'active' : ''}" ${index === 0 ? 'aria-current="location"' : ''}>${icon(symbol)}<span>${label}</span></a>`).join('')}
      </nav>
      <div class="settings-content">
    <section class="section" id="appearance"><h2>${icon('palette')} Appearance</h2>
      <div class="setting-row"><div><div class="s-label">Theme</div><div class="s-desc">Twilight dark, warm light, or follow your system.</div></div><div class="s-control">${segment('theme', [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']], s.theme)}</div></div>
      <div class="setting-row"><div><div class="s-label">Accent color</div><div class="s-desc">A little color throughout your browser.</div></div><div class="s-control accent-controls"><div class="accent-dots">${['gold', 'violet', 'teal', 'rose'].map((c) => `<button class="accent-dot ${c} ${s.accent === c ? 'selected' : ''}" data-accent="${c}" aria-label="${c}" title="${c}"></button>`).join('')}</div><label class="custom-color" title="Choose a custom accent color"><input type="color" id="custom-accent" value="${escapeHtml(s.customAccent || '#f6b93b')}" aria-label="Custom accent color">${icon('plus')}</label></div></div>
      <div class="appearance-card">
        <div class="row wallpaper-home-row"><div><div class="s-label">Your home, your view</div><div class="s-desc">Choose the background for your new tab page. Images stay on this device.</div></div><label class="switch"><input type="checkbox" data-setting="showWallpaper" aria-label="Show wallpaper" ${s.showWallpaper ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label></div>
        <div class="wallpaper-library-label"><b>Vespera wallpapers</b><span>Ready-to-use backgrounds</span></div>
        <div class="wallpaper-grid">${wallpaperGridHtml(s)}</div>
        <div class="row wallpaper-dim"><label for="wallpaper-dim">Wallpaper dimming</label><input type="range" id="wallpaper-dim" min="0" max="85" value="${s.wallpaperDim ?? 40}"><output id="wallpaper-dim-value">${s.wallpaperDim ?? 40}%</output></div>
        ${toggleRow('wallpaperDrift', 'Gentle wallpaper motion', 'The home wallpaper breathes very slowly. Turn off for a perfectly still image.', s.wallpaperDrift !== false)}
      </div>
      <section class="custom-wallpaper-library" aria-labelledby="custom-wallpaper-title">
        <div class="custom-wallpaper-library-head"><div><div class="s-label" id="custom-wallpaper-title">Your wallpapers</div><div class="s-desc">Build a personal collection. Select several files to add them together.</div></div><button class="btn btn-primary" id="upload-wallpaper" type="button">${icon('plus')}<span data-upload-label>Add wallpapers</span></button><input type="file" id="wallpaper-file" accept="image/jpeg,image/png,image/webp" multiple hidden></div>
        <div class="wallpaper-grid custom-wallpaper-grid" id="custom-wallpaper-grid">${customWallpaperLibraryLoaded ? customWallpaperTilesHtml(customWallpaperLibrary, s.wallpaper, wallpaperThumbnailUrls) : '<div class="wallpaper-empty is-loading">Loading your wallpapers…</div>'}</div>
        ${customWallpaperLibraryError ? `<p class="wallpaper-library-error">${escapeHtml(customWallpaperLibraryError)}</p>` : ''}
      </section>
      <div class="wallpaper-actions"><button class="btn btn-ghost" id="edit-wallpaper" disabled>${icon('palette')} Edit selected wallpaper</button><button class="btn btn-ghost" id="reset-wallpaper">Use Twilight</button><span class="small faint">JPG, PNG or WebP · up to 12 MB each · stored locally</span></div>
      <div id="wp-editor-slot"></div>
      <div class="setting-row"><div><div class="s-label">Density</div><div class="s-desc">Make a little more room for your pages.</div></div><div class="s-control">${segment('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']], s.density)}</div></div>
      ${toggleRow('showBookmarksBar', 'Show bookmarks bar', 'Your saved pages, always one click away.', s.showBookmarksBar)}
      ${toggleRow('clockSeconds', 'Show seconds on the home clock', 'Updates live using your device’s local time.', s.clockSeconds)}
      ${toggleRow('clock24', 'Use 24-hour time', 'For example, 18:30 instead of 6:30 PM.', s.clock24)}
    </section>
    <section class="section" id="tabs"><h2>${icon('split')} Tabs &amp; groups</h2>
      <p class="settings-section-sub">Choose how tabs open, behave and share space. These preferences apply immediately to both the horizontal strip and vertical sidebar.</p>
      <div class="setting-row"><div><div class="s-label">Tab layout</div><div class="s-desc">Classic tabs above, or a vertical sidebar. Drag tabs to reorder.</div></div><div class="s-control">${segment('tabLayout', [['horizontal', 'Horizontal'], ['vertical', 'Vertical']], s.tabLayout)}</div></div>
      ${toggleRow('tabBehavior.openTabsNextToCurrent', 'Open new tabs beside the current tab', 'Keep new tabs near the page that opened them instead of at the end of the strip.', s.tabBehavior.openTabsNextToCurrent)}
      ${toggleRow('tabBehavior.scrollableTabStrip', 'Scrollable tab strip', 'When off, tabs compress into the available space rather than scrolling horizontally.', s.tabBehavior.scrollableTabStrip)}
      ${toggleRow('tabBehavior.hideCloseButtons', 'Hide tab close buttons', 'Close tabs with the middle mouse button or the tab actions menu.', s.tabBehavior.hideCloseButtons)}
      ${toggleRow('tabBehavior.middleClickOpensTab', 'Middle-click links to open a tab', 'Turn off to open middle-clicked links in the current tab.', s.tabBehavior.middleClickOpensTab)}
      ${toggleRow('tabBehavior.middleClickClosesTab', 'Middle-click tabs to close them', 'Turn off if you do not use the mouse wheel button to close tabs.', s.tabBehavior.middleClickClosesTab)}
      ${toggleRow('tabBehavior.tabGroupsEnabled', 'Enable tab groups', 'Show saved group headers and membership. Reorder groups by dragging; right-click a group for actions. Turning this off keeps your groups and restores them when re-enabled.', s.tabBehavior.tabGroupsEnabled)}
      ${selectRow('tabBehavior.tabAudioMode', 'Tab audio controls', 'Show a mute button, a status indicator, or no speaker icon on tabs.', s.tabBehavior.tabAudioMode, [['click-to-mute', 'Click to mute'], ['indicator', 'Indicator only'], ['hidden', 'Hide indicator']])}
      ${selectRow('tabBehavior.tabHoverMode', 'Tab hover details', 'Choose a card, page preview, or simple tooltip.', s.tabBehavior.tabHoverMode, [['card', 'Card'], ['preview', 'Preview'], ['tooltip', 'Tooltip']])}
      ${toggleRow('tabBehavior.memoryUsageOnHover', 'Estimate memory on hover', 'Shows an approximate renderer memory estimate when available in the desktop app.', s.tabBehavior.memoryUsageOnHover)}
      <div class="setting-row"><div><div class="s-label">Inactive tab appearance</div><div class="s-desc">Choose how strongly background tabs recede behind the current page.</div></div><div class="s-control">${segment('tabBehavior.inactiveTabAppearance', [['balanced', 'Balanced'], ['dimmed', 'Dimmed'], ['minimal', 'Minimal']], s.tabBehavior.inactiveTabAppearance)}</div></div>
    </section>
    <section class="section" id="search"><h2>${icon('search')} Search & home</h2>
      <div class="setting-row"><div><div class="s-label">Default search engine</div><div class="s-desc">Used by the address bar and home search.${ctx.previewRestricted() ? ' This hosted preview searches public GitHub repositories.' : ''}</div></div><div class="s-control"><select class="select" id="sel-engine" aria-label="Default search engine">${Object.values(SEARCH_ENGINES).map((e) => `<option value="${e.id}" ${s.searchEngine === e.id ? 'selected' : ''}>${e.name}</option>`).join('')}</select></div></div>
      <div class="setting-row"><div><div class="s-label">Homepage</div><div class="s-desc">Where the Home button takes you.</div></div><div class="s-control"><select class="select" id="sel-homepage" aria-label="Homepage">${[['vespera://newtab', 'Vespera home'], ['vespera://welcome', 'Welcome to Vespera'], ['vespera://privacy', 'Privacy Hub']].map(([v, label]) => `<option value="${v}" ${s.homepage === v ? 'selected' : ''}>${label}</option>`).join('')}${!['vespera://newtab', 'vespera://welcome', 'vespera://privacy'].includes(s.homepage) ? `<option value="${escapeHtml(s.homepage)}" selected>Custom website</option>` : ''}<option value="custom">Custom website…</option></select></div></div>
      <form class="setting-row hidden" id="custom-home-row"><label class="s-label" for="custom-home">Custom homepage URL</label><div class="s-control grow"><input class="input" id="custom-home" placeholder="https://example.com" value="${escapeHtml(s.homepage)}"><button class="btn btn-primary" type="submit">Save</button></div></form>
    </section>
    <section class="section" id="browser"><h2>${icon('globe')} Browser & system</h2>
      <div class="setting-row default-browser-row"><div><div class="s-label">Set Vespera as default browser</div><div class="s-desc">Register Vespera for HTTP and HTTPS links, then confirm it in your operating system. Windows and some Linux desktops require a separate choice; Vespera will not claim to be the default until the OS confirms it.</div><div class="s-desc default-browser-status" id="default-browser-status" role="status" aria-live="polite">${window.vespera ? 'Checking desktop registration…' : 'Available in the installed desktop app.'}</div></div><div class="s-control default-browser-actions"><button class="btn btn-primary" id="set-default-browser" ${!window.vespera ? 'disabled title="Available in the desktop app"' : ''}>Set Vespera as default browser</button><button class="btn" id="open-default-browser-settings" ${!window.vespera ? 'disabled title="Available in the desktop app"' : ''}>Open system settings</button></div></div>
    </section>
    <section class="section" id="privacy"><h2>${icon('shield')} Privacy & Shields</h2>
      ${toggleRow('shields.enabled', 'Shields master switch', 'Enable your configured protections. Turn off to troubleshoot a website.', s.shields.enabled)}
      ${toggleRow('shields.blockTrackers', 'Block trackers', 'Known tracking and telemetry endpoints.', s.shields.blockTrackers)}
      ${toggleRow('shields.blockAds', 'Block ads', 'Advertising networks and ad-serving patterns.', s.shields.blockAds)}
      ${toggleRow('shields.blockAnnoyances', 'Block annoyances', 'Hide bundled cosmetic rules for cookie prompts and popups.', s.shields.blockAnnoyances)}
      ${toggleRow('shields.cleanLinks', 'Clean tracking links', 'Remove utm_*, fbclid, gclid and similar parameters.', s.shields.cleanLinks)}
      ${toggleRow('shields.httpsOnly', 'HTTPS-only upgrades', 'Try secure connections first. Some HTTP-only sites may not load.', s.shields.httpsOnly)}
      ${toggleRow('shields.gpc', 'Global Privacy Control', 'Send Sec-GPC and DNT headers. Sites may choose whether to honor them.', s.shields.gpc)}
      ${toggleRow('privacy.automation', 'Reduce automation signals', 'Always enabled in the desktop app; not a guarantee against fingerprinting.', true, true)}
      <div class="setting-row"><div><div class="s-label">Per-site exceptions</div><div class="s-desc">${allowlistSummary()}</div></div><button class="btn" id="btn-clear-allowlist">Clear exceptions</button></div>
      <div class="setting-row"><div><div class="s-label">Site permissions</div><div class="s-desc" id="site-permissions-label">${window.vespera?.permissions ? 'Camera, microphone, location and notification choices you asked Vespera to remember.' : 'Available in the desktop app.'}</div></div><button class="btn" id="btn-reset-permissions" disabled>Reset choices</button></div>
      <div class="setting-row"><div><div class="s-label">Browsing history</div><div class="s-desc">Private windows never save history. Normal history can be synced to your account.</div></div><button class="btn btn-danger" id="btn-clear-history">${icon('trash')} Clear history</button></div>
    </section>
    <section class="section" id="extensions"><h2>${icon('split')} Extensions</h2><div class="setting-row"><div><div class="s-label">Your included tools</div><div class="s-desc">Shields, Dark Pages, Reader View and Focus Mode. No account or store needed.</div></div><button class="btn" id="settings-extensions">Manage extensions ${icon('external')}</button></div></section>
    <section class="section" id="downloads"><h2>${icon('download')} Downloads</h2>
      ${toggleRow('askDownloadLocation', 'Ask where to save each file', 'Desktop downloads. When off, use the folder below or your system Downloads folder.', s.askDownloadLocation)}
      <div class="setting-row"><div><div class="s-label">Download folder</div><div class="s-desc" id="download-folder-label">${escapeHtml(s.downloadPath || 'System Downloads folder')}</div></div><button class="btn" id="choose-download-folder" ${!window.vespera ? 'disabled title="Available in the desktop app"' : ''}>Choose folder</button></div>
      <div class="setting-row"><div><div class="s-label">Downloaded files</div><div class="s-desc">${window.vespera ? 'See progress, open files, or reveal them in your file manager.' : 'Files are saved by the browser running this preview.'}</div></div><button class="btn" id="settings-downloads">Open downloads</button></div>
    </section>
    <section class="section" id="account"><h2>${icon('user')} Account & sync</h2><div class="setting-row"><div><div class="s-label">${state.user ? escapeHtml(state.user.displayName) : 'Not signed in'}</div><div class="s-desc">Sync settings, bookmarks and history with your Vespera service.</div></div><button class="btn btn-primary" id="btn-account">${state.user ? 'Manage account' : 'Sign in'}</button></div>
      <div class="setting-row"><div><div class="s-label">Download a local backup</div><div class="s-desc">Export settings, bookmarks and browsing history as a JSON file. Passwords, session tokens and sign-in credentials are never included.</div></div><button class="btn" id="download-local-backup" ${state.private ? 'disabled title="Unavailable in private windows"' : ''}>${icon('download')} Save backup</button></div></section>
    <section class="section" id="about"><h2>${icon('info')} About Vespera</h2><div class="card"><div class="row"><div class="about-mark">${icon('sparkle')}</div><div class="grow"><b>Vespera Browser</b><div class="small muted">Version ${escapeHtml(ctx.version() || '0.1.8')} · ${window.vespera ? 'Chromium desktop' : 'Web preview'} · MIT licensed</div></div><div class="s-control"><button class="btn btn-sm" id="settings-updates">Release notes</button><button class="btn btn-sm" id="settings-welcome">Welcome & help</button></div></div><p class="small muted" style="margin-top:16px">No analytics. No telemetry. Settings are local-first; wallpaper images are never synced.</p></div></section>
      </div>
    </div>
  </div>`;
  const nav = container.querySelector('.settings-nav');
  const navLinks = [...container.querySelectorAll('.settings-nav [data-section]')];
  const sectionsInPage = [...container.querySelectorAll('.settings-content .section[id]')];
  let activeSection = '';
  const syncSettingsNav = () => {
    const edge = container.getBoundingClientRect().top + 66;
    let current = sectionsInPage[0]?.id || 'appearance';
    for (const section of sectionsInPage) if (section.getBoundingClientRect().top <= edge) current = section.id;
    for (const link of navLinks) {
      const active = link.dataset.section === current;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    if (current !== activeSection) {
      activeSection = current;
      const activeLink = navLinks.find((link) => link.dataset.section === current);
      if (activeLink && nav && nav.scrollWidth > nav.clientWidth + 1) {
        const navBounds = nav.getBoundingClientRect(), linkBounds = activeLink.getBoundingClientRect();
        if (linkBounds.left < navBounds.left) nav.scrollLeft -= navBounds.left - linkBounds.left;
        else if (linkBounds.right > navBounds.right) nav.scrollLeft += linkBounds.right - navBounds.right;
      }
    }
  };
  container.addEventListener('scroll', syncSettingsNav, { passive: true });
  requestAnimationFrame(syncSettingsNav);
  navLinks.forEach((a) => a.onclick = (e) => { e.preventDefault(); container.querySelector('#' + a.dataset.section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  container.querySelectorAll('[data-segment]').forEach((group) => group.onclick = (e) => {
    const btn = e.target.closest('[data-v]'); if (!btn) return;
    group.querySelectorAll('button').forEach((b) => { b.classList.toggle('active', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
    state.set(group.dataset.segment, btn.dataset.v);
  });
  container.querySelectorAll('[data-setting]').forEach((input) => input.onchange = () => {
    const ok = state.set(input.dataset.setting, input.checked);
    if (!ok) input.checked = !input.checked;
    // A short pulse gives the row feedback that its switch actually did something.
    const row = input.closest('.setting-row, .appearance-card');
    if (row && ok) { row.classList.remove('row-pulse'); void row.offsetWidth; row.classList.add('row-pulse'); }
  });
  container.querySelectorAll('[data-setting-select]').forEach((input) => input.onchange = () => state.set(input.dataset.settingSelect, input.value));
  container.querySelectorAll('[data-accent]').forEach((btn) => btn.onclick = () => {
    state.set('accent', btn.dataset.accent);
    container.querySelectorAll('[data-accent]').forEach((b) => b.classList.toggle('selected', b === btn));
  });
  container.querySelector('#custom-accent').oninput = (e) => { state.settings.customAccent = e.target.value; state.set('accent', 'custom'); container.querySelectorAll('[data-accent]').forEach((b) => b.classList.remove('selected')); };
  const markWallpaper = (id) => container.querySelectorAll('[data-wallpaper]').forEach((button) => {
    const selected = button.dataset.wallpaper === id;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    const preset = WALLPAPERS.find((wallpaper) => wallpaper.id === button.dataset.wallpaper);
    const label = button.querySelector('span:last-child');
    if (label && preset) label.textContent = preset.name + (selected ? ' ✓' : '');
  });
  const markCustomWallpaper = (id) => container.querySelectorAll('[data-wallpaper-select]').forEach((button) => {
    const selected = button.dataset.wallpaperSelect === id;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.closest('.custom-wallpaper-tile')?.classList.toggle('selected', selected);
  });
  const defaultAdjustments = () => ({ zoom: 1, x: 50, y: 50, blur: 0, brightness: 100, saturation: 100 });
  const updateEditButton = () => {
    const editBtn = container.querySelector('#edit-wallpaper');
    if (!editBtn) return;
    const selected = state.settings.wallpaper;
    const ready = selected?.type === 'custom' && customWallpaperLibrary.some((wallpaper) => wallpaper.id === selected.id);
    editBtn.disabled = !ready;
    editBtn.title = ready ? 'Zoom, position and tune your selected image' : 'Select a custom wallpaper first';
  };
  container.querySelectorAll('[data-wallpaper]').forEach((button) => button.onclick = () => {
    state.set('wallpaper', { type: 'builtin', id: button.dataset.wallpaper });
    markWallpaper(button.dataset.wallpaper);
    markCustomWallpaper('');
    updateEditButton();
  });
  container.querySelectorAll('[data-wallpaper-select]').forEach((button) => button.onclick = () => {
    const id = button.dataset.wallpaperSelect;
    if (!customWallpaperLibrary.some((wallpaper) => wallpaper.id === id)) return;
    state.set('wallpaper', { type: 'custom', id });
    markWallpaper('');
    markCustomWallpaper(id);
    updateEditButton();
  });
  container.querySelectorAll('[data-wallpaper-remove]').forEach((button) => button.onclick = async () => {
    const id = button.dataset.wallpaperRemove;
    const wallpaper = customWallpaperLibrary.find((item) => item.id === id);
    if (!wallpaper) return;
    if (!await confirmAction({ title: 'Remove this wallpaper?', message: `“${wallpaper.name}” will be removed from this device.`, confirmText: 'Remove wallpaper', danger: true })) return;
    try {
      if (state.settings.wallpaper?.type === 'custom' && state.settings.wallpaper.id === id) {
        state.set('wallpaper', { type: 'builtin', id: 'twilight' });
        state.set('wallpaperAdjust', defaultAdjustments());
      }
      await removeCustomWallpaper(id);
      await loadCustomWallpaperLibrary(true);
      ctx.rerenderPage();
      ctx.toast('Custom wallpaper removed', 'ok');
    } catch (err) { ctx.toast(err.message || 'Could not remove this wallpaper.', 'error'); }
  });
  container.querySelector('#reset-wallpaper').onclick = () => {
    state.set('wallpaper', { type: 'builtin', id: 'twilight' });
    state.set('wallpaperAdjust', defaultAdjustments());
    state.set('wallpaperDim', 40);
    ctx.rerenderPage(); ctx.toast('Back to the Twilight lake', 'ok');
  };
  updateEditButton();
  if (!customWallpaperLibraryLoaded) loadCustomWallpaperLibrary().then(() => { if (container.isConnected) ctx.rerenderPage(); });

  container.querySelector('#upload-wallpaper').onclick = () => container.querySelector('#wallpaper-file').click();
  container.querySelector('#wallpaper-file').onchange = async (event) => {
    const input = event.target, files = [...(input.files || [])];
    if (!files.length) return;
    const button = container.querySelector('#upload-wallpaper');
    const label = button.querySelector('[data-upload-label]');
    button.disabled = true;
    const savedIds = [], errors = [];
    for (let index = 0; index < files.length; index++) {
      label.textContent = `Adding ${index + 1} of ${files.length}…`;
      try { savedIds.push(await saveWallpaper(files[index])); }
      catch (err) { errors.push(`${files[index].name || 'Image'}: ${err.message || 'could not be saved'}`); }
    }
    input.value = '';
    if (savedIds.length) {
      await loadCustomWallpaperLibrary(true);
      state.set('wallpaper', { type: 'custom', id: savedIds.at(-1) });
      state.set('wallpaperAdjust', defaultAdjustments());
      ctx.rerenderPage();
      if (errors.length) ctx.toast(`Added ${savedIds.length} wallpaper${savedIds.length === 1 ? '' : 's'}; ${errors.length} could not be added. ${errors[0]}`, 'error', 8000);
      else ctx.toast(`Added ${savedIds.length} custom wallpaper${savedIds.length === 1 ? '' : 's'}.`, 'ok', 5000);
    } else {
      ctx.toast(errors[0] || 'Could not save this wallpaper.', 'error', 6500);
    }
    if (button.isConnected) {
      button.disabled = false;
      label.textContent = 'Add wallpapers';
    }
  };
  container.querySelector('#wallpaper-dim').oninput = (e) => { container.querySelector('#wallpaper-dim-value').textContent = e.target.value + '%'; state.set('wallpaperDim', Number(e.target.value)); };

  /* ---- Wallpaper editor: zoom, position, blur, brightness, saturation ---- */
  const editorSlot = container.querySelector('#wp-editor-slot');
  let editorOpen = false, editorEl = null;
  const adj = () => clampAdjust(state.settings.wallpaperAdjust);
  const editorHtml = () => {
    const a = adj();
    return `<div class="wp-editor" id="wp-editor">
      <div class="wp-editor-head"><b>${icon('palette')} Edit wallpaper</b><button class="icon-btn" id="wp-close" title="Close" aria-label="Close editor">${icon('x')}</button></div>
      <div class="wp-preview-wrap" id="wp-stage" title="Drag to reposition"><div class="wp-preview-live" id="wp-live"></div><span class="wp-hint">${icon('move')} Drag to reposition</span></div>
      <div class="wp-slider"><label>Zoom</label><input type="range" id="wp-zoom" min="100" max="400" value="${Math.round(a.zoom * 100)}"><output>${Math.round(a.zoom * 100)}%</output></div>
      <div class="wp-slider"><label>Brightness</label><input type="range" id="wp-bright" min="25" max="175" value="${a.brightness}"><output>${a.brightness}%</output></div>
      <div class="wp-slider"><label>Saturation</label><input type="range" id="wp-sat" min="0" max="200" value="${a.saturation}"><output>${a.saturation}%</output></div>
      <div class="wp-slider"><label>Blur</label><input type="range" id="wp-blur" min="0" max="40" value="${a.blur}"><output>${a.blur}</output></div>
      <div class="wp-editor-foot"><button class="btn btn-ghost" id="wp-fit">Auto fit</button><button class="btn btn-ghost" id="wp-center">Center</button><button class="btn btn-ghost" id="wp-reset-adj">Reset all</button><span class="grow"></span><button class="btn btn-primary" id="wp-done">Done</button></div>
    </div>`;
  };
  const liveStyle = (a) => `background-image:var(--wallpaper-image);background-size:${Math.round(a.zoom * 100)}% auto;background-position:${a.x}% ${a.y}%;filter:blur(${a.blur / 8}px) brightness(${a.brightness / 100}) saturate(${a.saturation / 100})`;
  function saveAdj(next) {
    state.settings.wallpaperAdjust = clampAdjust(next);
    state.saveSettings();
    retuneWallpaper(state.settings);
    if (editorEl) {
      editorEl.querySelector('#wp-live').style.cssText = liveStyle(adj());
      editorEl.querySelector('#wp-zoom').value = Math.round(adj().zoom * 100);
      editorEl.querySelector('#wp-zoom').nextElementSibling.textContent = Math.round(adj().zoom * 100) + '%';
      editorEl.querySelector('#wp-bright').value = adj().brightness; editorEl.querySelector('#wp-bright').nextElementSibling.textContent = adj().brightness + '%';
      editorEl.querySelector('#wp-sat').value = adj().saturation; editorEl.querySelector('#wp-sat').nextElementSibling.textContent = adj().saturation + '%';
      editorEl.querySelector('#wp-blur').value = adj().blur; editorEl.querySelector('#wp-blur').nextElementSibling.textContent = adj().blur;
    }
  }
  function openEditor() {
    editorOpen = true;
    editorSlot.innerHTML = editorHtml();
    editorEl = editorSlot.querySelector('#wp-editor');
    editorEl.querySelector('#wp-live').style.cssText = liveStyle(adj());
    requestAnimationFrame(() => editorEl.classList.add('open'));
    const stage = editorEl.querySelector('#wp-stage');
    // Drag to reposition — pointer events, clamped, live-updating.
    let dragging = null;
    stage.addEventListener('pointerdown', (e) => { dragging = { x: e.clientX, y: e.clientY, sx: adj().x, sy: adj().y }; stage.setPointerCapture(e.pointerId); stage.classList.add('grabbing'); });
    stage.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = stage.getBoundingClientRect();
      const dx = ((e.clientX - dragging.x) / rect.width) * 100, dy = ((e.clientY - dragging.y) / rect.height) * 100;
      saveAdj({ ...adj(), x: dragging.sx - dx, y: dragging.sy - dy });
    });
    stage.addEventListener('pointerup', () => { dragging = null; stage.classList.remove('grabbing'); });
    stage.addEventListener('pointercancel', () => { dragging = null; stage.classList.remove('grabbing'); });
    const bind = (id, apply, fmt) => {
      const input = editorEl.querySelector(id);
      input.oninput = () => { apply(Number(input.value)); const out = input.nextElementSibling; if (out) out.textContent = fmt(Number(input.value)); };
    };
    bind('#wp-zoom', (v) => saveAdj({ ...adj(), zoom: v / 100 }), (v) => v + '%');
    bind('#wp-bright', (v) => saveAdj({ ...adj(), brightness: v }), (v) => v + '%');
    bind('#wp-sat', (v) => saveAdj({ ...adj(), saturation: v }), (v) => v + '%');
    bind('#wp-blur', (v) => saveAdj({ ...adj(), blur: v }), (v) => v);
    editorEl.querySelector('#wp-fit').onclick = () => saveAdj({ zoom: 1, x: 50, y: 50, blur: adj().blur, brightness: adj().brightness, saturation: adj().saturation });
    editorEl.querySelector('#wp-center').onclick = () => saveAdj({ ...adj(), x: 50, y: 50 });
    editorEl.querySelector('#wp-reset-adj').onclick = () => saveAdj({ zoom: 1, x: 50, y: 50, blur: 0, brightness: 100, saturation: 100 });
    editorEl.querySelector('#wp-close').onclick = closeEditor;
    editorEl.querySelector('#wp-done').onclick = closeEditor;
  }
  function closeEditor() {
    editorOpen = false;
    if (!editorEl) return;
    editorEl.classList.remove('open');
    const el = editorEl;
    setTimeout(() => { if (editorEl === el) { editorSlot.innerHTML = ''; editorEl = null; } }, 260);
  }
  container.querySelector('#edit-wallpaper').onclick = () => { editorOpen ? closeEditor() : openEditor(); };
  container.querySelector('#sel-engine').onchange = (e) => state.set('searchEngine', e.target.value);
  container.querySelector('#sel-homepage').onchange = (e) => {
    const custom = e.target.value === 'custom'; container.querySelector('#custom-home-row').classList.toggle('hidden', !custom);
    if (custom) container.querySelector('#custom-home').focus(); else state.set('homepage', e.target.value);
  };
  container.querySelector('#custom-home-row').onsubmit = (e) => {
    e.preventDefault(); const value = container.querySelector('#custom-home').value.trim(); const url = safeTabUrl(value);
    if (!url) return ctx.toast('Enter a full https:// website address or vespera:// page.', 'error');
    state.set('homepage', url); ctx.toast('Homepage saved', 'ok');
  };
  const permsLabel = container.querySelector('#site-permissions-label'), permsReset = container.querySelector('#btn-reset-permissions');
  const showPermissions = async () => {
    if (!window.vespera?.permissions) return;
    const list = await window.vespera.permissions.list().catch(() => []);
    const sites = [...new Set((Array.isArray(list) ? list : []).map((p) => p.origin.replace(/^https?:\/\//, '')))];
    permsLabel.textContent = sites.length ? `Remembered for ${sites.length} site${sites.length === 1 ? '' : 's'}: ${sites.slice(0, 4).join(', ')}${sites.length > 4 ? '…' : ''}` : 'No remembered choices. Vespera asks before a site uses your camera, microphone, location or notifications.';
    permsReset.disabled = !sites.length;
  };
  showPermissions();
  permsReset.onclick = async () => { await window.vespera.permissions.reset(); await showPermissions(); ctx.toast('Site permission choices reset. Sites will ask again.', 'ok'); };
  container.querySelector('#btn-clear-allowlist').onclick = () => { state.set('allowlist', {}); ctx.rerenderPage(); ctx.toast('Site exceptions cleared. Reload open sites to apply.', 'ok'); };
  container.querySelector('#btn-clear-history').onclick = async () => { if (await confirmAction({ title: 'Clear browsing history?', message: 'This removes saved history from this device and your connected sync store. Open tabs stay open.', confirmText: 'Clear history', danger: true })) { state.clearHistory(); ctx.toast('Browsing history cleared', 'ok'); } };
  container.querySelector('#btn-account').onclick = () => ctx.navigate('vespera://account');
  container.querySelector('#download-local-backup').onclick = () => {
    if (state.private) return ctx.toast('Local backups are disabled in private windows.', 'info');
    const backup = { format: 'vespera-local-backup', schemaVersion: 1, exportedAt: new Date().toISOString(), settings: state.settings, bookmarks: state.bookmarks, history: state.history };
    const date = new Date().toISOString().slice(0, 10);
    downloadText(JSON.stringify(backup, null, 2), `Vespera-Backup-${date}.json`, 'application/json;charset=utf-8');
  };
  container.querySelector('#settings-extensions').onclick = () => ctx.openTab('vespera://extensions');
  const defaultStatus = container.querySelector('#default-browser-status');
  const defaultButton = container.querySelector('#set-default-browser');
  const settingsButton = container.querySelector('#open-default-browser-settings');
  const refreshDefaultBrowserStatus = async () => {
    if (!window.vespera?.app?.defaultBrowserStatus) return;
    try {
      const result = await window.vespera.app.defaultBrowserStatus();
      if (!defaultStatus?.isConnected) return;
      defaultStatus.textContent = result?.registered
        ? 'Vespera is registered for HTTP and HTTPS. The operating system may still have another browser selected; verify the choice in system settings.'
        : (result?.message || 'Vespera is not confirmed as the HTTP/HTTPS handler.');
    } catch (err) { if (defaultStatus?.isConnected) defaultStatus.textContent = err.message || 'Could not check browser registration.'; }
  };
  refreshDefaultBrowserStatus();
  defaultButton.onclick = async () => {
    if (!window.vespera?.app?.setDefaultBrowser) return;
    defaultButton.disabled = true;
    try {
      const result = await window.vespera.app.setDefaultBrowser();
      if (defaultStatus?.isConnected) defaultStatus.textContent = result?.message || 'Check your system settings to finish choosing a default browser.';
      ctx.toast(result?.ok ? 'HTTP and HTTPS handlers registered. Confirm Vespera in system settings.' : (result?.message || 'Could not register Vespera with the operating system.'), result?.ok ? 'info' : 'error', 6500);
      await refreshDefaultBrowserStatus();
    } catch (err) {
      if (defaultStatus?.isConnected) defaultStatus.textContent = err.message || 'Could not register Vespera with the operating system.';
      ctx.toast(err.message || 'Could not register Vespera with the operating system.', 'error', 6000);
    } finally { if (defaultButton.isConnected) defaultButton.disabled = false; }
  };
  settingsButton.onclick = async () => {
    if (!window.vespera?.app?.openDefaultBrowserSettings) return;
    try {
      const result = await window.vespera.app.openDefaultBrowserSettings();
      if (defaultStatus?.isConnected && result?.message) defaultStatus.textContent = result.message;
      if (result?.message) ctx.toast(result.message, result.ok ? 'info' : 'info', 7000);
    } catch (err) { ctx.toast(err.message || 'Could not open system settings.', 'error', 6000); }
  };
  container.querySelector('#settings-downloads').onclick = () => ctx.navigate('vespera://downloads');
  container.querySelector('#settings-welcome').onclick = () => ctx.navigate('vespera://welcome');
  container.querySelector('#settings-updates').onclick = () => ctx.navigate('vespera://updates');
  container.querySelector('#choose-download-folder').onclick = async () => {
    const result = await window.vespera.app.chooseDownloadFolder();
    if (result?.ok) { state.set('downloadPath', result.path); container.querySelector('#download-folder-label').textContent = result.path; ctx.toast('Download folder updated', 'ok'); }
    else if (result?.message) ctx.toast(result.message, 'error');
  };
  return () => {
    container.removeEventListener('scroll', syncSettingsNav);
    for (const url of wallpaperThumbnailUrls) URL.revokeObjectURL(url);
  };
}
function segment(path, values, current) { return `<div class="segmented" data-segment="${path}">${values.map(([v, label]) => `<button data-v="${v}" class="${current === v ? 'active' : ''}" aria-pressed="${current === v}">${label}</button>`).join('')}</div>`; }
function selectRow(path, label, desc, current, options) {
  return `<div class="setting-row"><div><div class="s-label">${label}</div><div class="s-desc">${desc}</div></div><div class="s-control"><select class="select" data-setting-select="${path}" aria-label="${label}">${options.map(([value, text]) => `<option value="${escapeHtml(value)}" ${current === value ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('')}</select></div></div>`;
}
function toggleRow(path, label, desc, checked, locked = false) {
  return `<div class="setting-row"><div><div class="s-label">${label}</div><div class="s-desc">${desc}</div></div><div class="s-control"><label class="switch"><input type="checkbox" ${locked ? 'data-locked' : `data-setting="${path}"`} aria-label="${label}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''}><span class="track"></span><span class="thumb"></span></label></div></div>`;
}
function allowlistSummary() { const hosts = Object.keys(state.settings.allowlist || {}); return hosts.length ? hosts.map(escapeHtml).join(', ') : 'No site exceptions. Your global settings apply everywhere.'; }
