/** Settings — every control writes a real preference and updates the browser immediately. */
import { icon } from '../icons.js';
import { state } from '../state.js';
import { SEARCH_ENGINES, safeTabUrl } from '../../../shared/privacy-utils.mjs';
import { escapeHtml } from '../toasts.js';
import { WALLPAPERS, saveWallpaper, applyWallpaper } from '../wallpaper.js';
import { confirmAction } from '../dialog.js';

export function renderSettings(container, ctx) {
  const s = state.settings;
  container.innerHTML = `<div class="page settings-page settings-layout">
    <div class="settings-heading"><div><span class="eyebrow">YOUR BROWSER, YOUR WAY</span><h1 class="page-title">Settings</h1><p class="page-sub">Set up Vespera the way you browse. Changes save on this device.</p></div><span class="chip chip-ok">${icon('check')} Saved on this device</span></div>
    <div class="settings-workspace">
    <nav class="settings-nav" aria-label="Settings sections"><span class="settings-nav-label">Preferences</span>
      <a href="#appearance" data-section="appearance">${icon('palette')} Appearance</a><a href="#tabs" data-section="tabs">${icon('split')} Tabs & groups</a><a href="#search" data-section="search">${icon('search')} Search & home</a><a href="#privacy" data-section="privacy">${icon('shield')} Privacy</a><a href="#extensions" data-section="extensions">${icon('split')} Extensions</a><a href="#downloads" data-section="downloads">${icon('download')} Downloads</a><a href="#account" data-section="account">${icon('user')} Account & sync</a><a href="#about" data-section="about">${icon('info')} About</a>
    </nav>
    <div class="settings-content">
    <section class="section" id="appearance"><h2>${icon('palette')} Appearance</h2><p class="settings-section-sub">Colors, wallpaper and spacing for a browser that feels like yours.</p>
      <div class="setting-row"><div><div class="s-label">Theme</div><div class="s-desc">Twilight dark, warm light, or follow your system.</div></div><div class="s-control">${segment('theme', [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']], s.theme)}</div></div>
      <div class="setting-row"><div><div class="s-label">Accent color</div><div class="s-desc">A little color throughout your browser.</div></div><div class="s-control accent-controls"><div class="accent-dots">${['gold', 'violet', 'teal', 'rose'].map((c) => `<button class="accent-dot ${c} ${s.accent === c ? 'selected' : ''}" data-accent="${c}" aria-label="${c}" title="${c}"></button>`).join('')}</div><label class="custom-color" title="Choose a custom accent color"><input type="color" id="custom-accent" value="${escapeHtml(s.customAccent || '#f6b93b')}" aria-label="Custom accent color">${icon('plus')}</label></div></div>
      <div class="appearance-card"><div class="row" style="justify-content:space-between"><div><div class="s-label">Your home, your view</div><div class="s-desc">Choose a wallpaper or upload your own. Images stay on this device.</div></div><label class="switch"><input type="checkbox" data-setting="showWallpaper" aria-label="Show wallpaper" ${s.showWallpaper ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label></div>
        <div class="wallpaper-grid">${WALLPAPERS.map((w) => `<button class="wallpaper-choice ${s.wallpaper?.id === w.id ? 'selected' : ''}" data-wallpaper="${w.id}" aria-pressed="${s.wallpaper?.id === w.id}"><span class="wallpaper-preview ${w.id}" ${w.image ? `style="background-image:url('${w.image}')"` : ''}></span><span>${w.name}${s.wallpaper?.id === w.id ? ' ✓' : ''}</span></button>`).join('')}</div>
        <div class="wallpaper-actions"><button class="btn" id="upload-wallpaper">${icon('plus')} Upload wallpaper</button><button class="btn btn-ghost" id="reset-wallpaper">Use Twilight</button><span class="small faint">JPG, PNG, WebP · up to 12 MB</span><input type="file" id="wallpaper-file" accept="image/jpeg,image/png,image/webp" hidden></div>
        <div class="row wallpaper-dim"><label for="wallpaper-dim">Wallpaper dimming</label><input type="range" id="wallpaper-dim" min="0" max="85" value="${s.wallpaperDim ?? 40}"><output id="wallpaper-dim-value">${s.wallpaperDim ?? 40}%</output></div>
      </div>
      <div class="setting-row"><div><div class="s-label">Density</div><div class="s-desc">Make a little more room for your pages.</div></div><div class="s-control">${segment('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']], s.density)}</div></div>
      ${toggleRow('showBookmarksBar', 'Show bookmarks bar', 'Your saved pages, always one click away.', s.showBookmarksBar)}
      ${toggleRow('clockSeconds', 'Show seconds on the home clock', 'Updates live using your device’s local time.', s.clockSeconds)}
      ${toggleRow('clock24', 'Use 24-hour time', 'For example, 18:30 instead of 6:30 PM.', s.clock24)}
    </section>
    <section class="section" id="tabs"><h2>${icon('split')} Tabs & groups</h2><p class="settings-section-sub">Choose where tabs open, what the mouse buttons do, and how tab groups stay organized.</p>
      <div class="setting-row"><div><div class="s-label">Tab layout</div><div class="s-desc">Keep tabs across the top or move them into a sidebar. Drag to reorder either way.</div></div><div class="s-control">${segment('tabLayout', [['horizontal', 'Across top'], ['vertical', 'Sidebar']], s.tabLayout)}</div></div>
      ${toggleRow('tabBehavior.middleClickOpensTab', 'Middle-click opens links in a background tab', 'Use the mouse wheel on a link to open it without leaving this page.', s.tabBehavior.middleClickOpensTab)}
      ${toggleRow('tabBehavior.middleClickClosesTab', 'Middle-click closes tabs', 'Click the mouse wheel on a tab to close it. The close button still works too.', s.tabBehavior.middleClickClosesTab)}
      ${toggleRow('tabBehavior.openTabsNextToCurrent', 'Open new tabs beside the current tab', 'New tabs, duplicate tabs and link tabs stay close to the page that opened them.', s.tabBehavior.openTabsNextToCurrent)}
      ${toggleRow('tabBehavior.scrollableTabStrip', 'Scroll the tab strip when it is full', 'Turn off to let tabs shrink instead of scrolling horizontally.', s.tabBehavior.scrollableTabStrip)}
      ${toggleRow('tabBehavior.hideCloseButtons', 'Hide tab close buttons', 'Tabs can still be closed with middle-click, the tab menu or Ctrl+W.', s.tabBehavior.hideCloseButtons)}
      ${toggleRow('tabBehavior.tabGroupsEnabled', 'Use tab groups', 'Create color-coded groups from a tab menu or the group button beside the tabs.', s.tabBehavior.tabGroupsEnabled)}
      ${selectRow('tabBehavior.tabAudioMode', 'Tab speaker & mute behavior', 'Choose whether the speaker icon can mute a tab or is only an indicator.', s.tabBehavior.tabAudioMode, [['click-to-mute', 'Click to mute'], ['indicator', 'Indicator only'], ['hidden', 'Hide indicator']])}
      ${selectRow('tabBehavior.tabHoverMode', 'Tab hover behavior', 'Pick a compact card, a page preview, or a simple tooltip.', s.tabBehavior.tabHoverMode, [['card', 'Compact card'], ['preview', 'Card with preview'], ['tooltip', 'Tooltip']])}
      ${toggleRow('tabBehavior.memoryUsageOnHover', 'Show memory usage on hover', 'Shows approximate renderer memory in the desktop app; the hosted preview cannot read site memory.', s.tabBehavior.memoryUsageOnHover)}
      <div class="setting-row"><div><div class="s-label">Inactive tab appearance</div><div class="s-desc">Choose how quiet background tabs look in the strip and sidebar.</div></div><div class="s-control">${segment('tabBehavior.inactiveTabAppearance', [['balanced', 'Balanced'], ['dimmed', 'Dimmed'], ['minimal', 'Minimal']], s.tabBehavior.inactiveTabAppearance)}</div></div>
    </section>
    <section class="section" id="search"><h2>${icon('search')} Search & home</h2><p class="settings-section-sub">Pick a search provider and choose what the Home button opens.</p>
      <div class="setting-row"><div><div class="s-label">Default search engine</div><div class="s-desc">Used by the address bar and home search.${ctx.previewRestricted() ? ' This hosted preview searches public GitHub repositories.' : ''}</div></div><div class="s-control"><select class="select" id="sel-engine" aria-label="Default search engine">${Object.values(SEARCH_ENGINES).map((e) => `<option value="${e.id}" ${s.searchEngine === e.id ? 'selected' : ''}>${e.name}</option>`).join('')}</select></div></div>
      <div class="setting-row"><div><div class="s-label">Homepage</div><div class="s-desc">Where the Home button takes you.</div></div><div class="s-control"><select class="select" id="sel-homepage" aria-label="Homepage">${[['vespera://newtab', 'Vespera home'], ['vespera://welcome', 'Welcome to Vespera'], ['vespera://privacy', 'Privacy Hub']].map(([v, label]) => `<option value="${v}" ${s.homepage === v ? 'selected' : ''}>${label}</option>`).join('')}${!['vespera://newtab', 'vespera://welcome', 'vespera://privacy'].includes(s.homepage) ? `<option value="${escapeHtml(s.homepage)}" selected>Custom website</option>` : ''}<option value="custom">Custom website…</option></select></div></div>
      <form class="setting-row hidden" id="custom-home-row"><label class="s-label" for="custom-home">Custom homepage URL</label><div class="s-control grow"><input class="input" id="custom-home" placeholder="https://example.com" value="${escapeHtml(s.homepage)}"><button class="btn btn-primary" type="submit">Save</button></div></form>
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
      <div class="setting-row"><div><div class="s-label">Browsing history</div><div class="s-desc">Private windows never save history. Normal history can be synced to your account.</div></div><button class="btn btn-danger" id="btn-clear-history">${icon('trash')} Clear history</button></div>
    </section>
    <section class="section" id="extensions"><h2>${icon('split')} Extensions</h2><div class="setting-row"><div><div class="s-label">Your included tools</div><div class="s-desc">Shields, Dark Pages, Reader View and Focus Mode. No account or store needed.</div></div><button class="btn" id="settings-extensions">Manage extensions ${icon('external')}</button></div></section>
    <section class="section" id="downloads"><h2>${icon('download')} Downloads</h2>
      ${toggleRow('askDownloadLocation', 'Ask where to save each file', 'Desktop downloads. When off, use the folder below or your system Downloads folder.', s.askDownloadLocation)}
      <div class="setting-row"><div><div class="s-label">Download folder</div><div class="s-desc" id="download-folder-label">${escapeHtml(s.downloadPath || 'System Downloads folder')}</div></div><button class="btn" id="choose-download-folder" ${!window.vespera ? 'disabled title="Available in the desktop app"' : ''}>Choose folder</button></div>
      <div class="setting-row"><div><div class="s-label">Downloaded files</div><div class="s-desc">${window.vespera ? 'See progress, open files, or reveal them in your file manager.' : 'Files are saved by the browser running this preview.'}</div></div><button class="btn" id="settings-downloads">Open downloads</button></div>
    </section>
    <section class="section" id="account"><h2>${icon('user')} Account & sync</h2><div class="setting-row"><div><div class="s-label">${state.user ? escapeHtml(state.user.displayName) : 'Not signed in'}</div><div class="s-desc">Sync settings, bookmarks and history with your Vespera service.</div></div><button class="btn btn-primary" id="btn-account">${state.user ? 'Manage account' : 'Sign in'}</button></div></section>
    <section class="section" id="about"><h2>${icon('info')} About Vespera</h2><p class="settings-section-sub">Build information and a few useful shortcuts.</p><div class="card"><div class="row"><div class="about-mark">${icon('sparkle')}</div><div class="grow"><b>Vespera Browser</b><div class="small muted">Version ${escapeHtml(ctx.version() || '0.1.3')} · ${window.vespera ? 'Chromium desktop' : 'Web preview'} · MIT licensed</div></div><div class="s-control"><button class="btn btn-sm" id="settings-updates">Release notes</button><button class="btn btn-sm" id="settings-welcome">Welcome & help</button></div></div><p class="small muted" style="margin-top:16px">No analytics. No telemetry. Settings are local-first; wallpaper images are never synced.</p></div></section>
    </div>
    </div>
  </div>`;
  const navLinks = [...container.querySelectorAll('[data-section]')];
  const selectSection = (id) => navLinks.forEach((link) => {
    const selected = link.dataset.section === id;
    link.classList.toggle('active', selected);
    if (selected) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
  });
  navLinks.forEach((a) => a.onclick = (e) => {
    e.preventDefault(); selectSection(a.dataset.section);
    container.querySelector('#' + a.dataset.section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const settingsObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (visible) selectSection(visible.target.id);
  }, { root: container, rootMargin: '-8% 0px -72% 0px', threshold: 0 });
  container.querySelectorAll('.settings-content .section').forEach((section) => settingsObserver.observe(section));
  selectSection(ctx.getActiveTab?.()?.url?.split('#')[1] || 'appearance');
  container.querySelectorAll('[data-segment]').forEach((group) => group.onclick = (e) => {
    const btn = e.target.closest('[data-v]'); if (!btn) return;
    group.querySelectorAll('button').forEach((b) => { b.classList.toggle('active', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
    state.set(group.dataset.segment, btn.dataset.v);
  });
  container.querySelectorAll('[data-setting]').forEach((input) => input.onchange = () => {
    if (!state.set(input.dataset.setting, input.checked)) input.checked = !input.checked;
  });
  container.querySelectorAll('[data-setting-select]').forEach((input) => input.onchange = () => state.set(input.dataset.settingSelect, input.value));
  container.querySelectorAll('[data-accent]').forEach((btn) => btn.onclick = () => {
    state.set('accent', btn.dataset.accent);
    container.querySelectorAll('[data-accent]').forEach((b) => b.classList.toggle('selected', b === btn));
  });
  container.querySelector('#custom-accent').oninput = (e) => { state.settings.customAccent = e.target.value; state.set('accent', 'custom'); container.querySelectorAll('[data-accent]').forEach((b) => b.classList.remove('selected')); };
  const markWallpaper = (id) => container.querySelectorAll('[data-wallpaper]').forEach((b) => { const selected = b.dataset.wallpaper === id; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected)); b.querySelector('span:last-child').textContent = WALLPAPERS.find((w) => w.id === b.dataset.wallpaper).name + (selected ? ' ✓' : ''); });
  container.querySelectorAll('[data-wallpaper]').forEach((btn) => btn.onclick = () => { state.set('wallpaper', { type: 'builtin', id: btn.dataset.wallpaper }); markWallpaper(btn.dataset.wallpaper); });
  container.querySelector('#reset-wallpaper').onclick = () => { state.set('wallpaper', { type: 'builtin', id: 'twilight' }); state.set('wallpaperDim', 40); markWallpaper('twilight'); container.querySelector('#wallpaper-dim').value = 40; container.querySelector('#wallpaper-dim-value').textContent = '40%'; };
  container.querySelector('#upload-wallpaper').onclick = () => container.querySelector('#wallpaper-file').click();
  container.querySelector('#wallpaper-file').onchange = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const btn = container.querySelector('#upload-wallpaper'); btn.disabled = true;
    try { await saveWallpaper(file); state.set('wallpaper', { type: 'custom', id: 'custom' }); markWallpaper('custom'); ctx.toast('Your wallpaper is ready. Saved only on this device.', 'ok'); }
    catch (err) { ctx.toast(err.message || 'Could not save this wallpaper.', 'error'); }
    finally { btn.disabled = false; e.target.value = ''; }
  };
  container.querySelector('#wallpaper-dim').oninput = (e) => { container.querySelector('#wallpaper-dim-value').textContent = e.target.value + '%'; state.set('wallpaperDim', Number(e.target.value)); };
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
  container.querySelector('#btn-clear-allowlist').onclick = () => { state.set('allowlist', {}); ctx.rerenderPage(); ctx.toast('Site exceptions cleared. Reload open sites to apply.', 'ok'); };
  container.querySelector('#btn-clear-history').onclick = async () => { if (await confirmAction({ title: 'Clear browsing history?', message: 'This removes saved history from this device and your connected sync store. Open tabs stay open.', confirmText: 'Clear history', danger: true })) { state.clearHistory(); ctx.toast('Browsing history cleared', 'ok'); } };
  container.querySelector('#btn-account').onclick = () => ctx.navigate('vespera://account');
  container.querySelector('#settings-extensions').onclick = () => ctx.navigate('vespera://extensions');
  container.querySelector('#settings-downloads').onclick = () => ctx.navigate('vespera://downloads');
  container.querySelector('#settings-welcome').onclick = () => ctx.navigate('vespera://welcome');
  container.querySelector('#settings-updates').onclick = () => ctx.navigate('vespera://updates');
  container.querySelector('#choose-download-folder').onclick = async () => {
    const result = await window.vespera.app.chooseDownloadFolder();
    if (result?.ok) { state.set('downloadPath', result.path); container.querySelector('#download-folder-label').textContent = result.path; ctx.toast('Download folder updated', 'ok'); }
    else if (result?.message) ctx.toast(result.message, 'error');
  };
  return () => settingsObserver.disconnect();
}
function segment(path, values, current) { return `<div class="segmented" data-segment="${path}">${values.map(([v, label]) => `<button data-v="${v}" class="${current === v ? 'active' : ''}" aria-pressed="${current === v}">${label}</button>`).join('')}</div>`; }
function selectRow(path, label, desc, current, options) {
  return `<div class="setting-row"><div><div class="s-label">${label}</div><div class="s-desc">${desc}</div></div><div class="s-control"><select class="select" data-setting-select="${path}" aria-label="${label}">${options.map(([value, text]) => `<option value="${escapeHtml(value)}" ${current === value ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('')}</select></div></div>`;
}
function toggleRow(path, label, desc, checked, locked = false) {
  return `<div class="setting-row"><div><div class="s-label">${label}</div><div class="s-desc">${desc}</div></div><div class="s-control"><label class="switch"><input type="checkbox" ${locked ? 'data-locked' : `data-setting="${path}"`} aria-label="${label}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''}><span class="track"></span><span class="thumb"></span></label></div></div>`;
}
function allowlistSummary() { const hosts = Object.keys(state.settings.allowlist || {}); return hosts.length ? hosts.map(escapeHtml).join(', ') : 'No site exceptions. Your global settings apply everywhere.'; }
