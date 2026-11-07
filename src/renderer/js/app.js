/**
 * Vespera app controller — boots the browser shell and wires every module.
 * Runs identically in Electron (real Chromium webviews) and the web preview.
 */
import { state, applyAppearance, bus } from './state.js';
import { platform } from './platform.js';
import { TabManager } from './tabs.js';
import { initOmnibox } from './omnibox.js';
import { toggleShields, updateShieldBadge, closeShields } from './shields.js';
import { openPalette, closePalette, paletteOpen } from './palette.js';
import { toast, escapeHtml } from './toasts.js';
import { icon } from './icons.js';
import { classifyInput, buildSearchUrl, isInternal, INTERNAL_PAGES, cleanTrackingParams } from '../../shared/privacy-utils.mjs';
import * as api from './api.js';

import { renderWelcome } from './pages/welcome.js';
import { renderNewtab } from './pages/newtab.js';
import { renderSettings } from './pages/settings.js';
import { renderPrivacy } from './pages/privacy.js';
import { renderCommunity } from './pages/community.js';
import { renderAccount } from './pages/account.js';
import { renderHistory, renderBookmarks, renderDownloads } from './pages/library.js';
import { renderLogs } from './pages/logs.js';

const PAGE_RENDERERS = {
  'vespera://newtab': renderNewtab,
  'vespera://welcome': renderWelcome,
  'vespera://settings': renderSettings,
  'vespera://privacy': renderPrivacy,
  'vespera://community': renderCommunity,
  'vespera://account': renderAccount,
  'vespera://history': renderHistory,
  'vespera://bookmarks': renderBookmarks,
  'vespera://downloads': renderDownloads,
  'vespera://shields': renderPrivacy,
  'vespera://logs': renderLogs,
};

let tabs;
let omnibox;
const contentEl = document.getElementById('content');

/* ================================================================
   Navigation
   ================================================================ */

function classify(value, kind) {
  if (kind === 'url') return { kind: 'url', value };
  if (kind === 'search') return { kind: 'search', value };
  return classifyInput(value);
}

function navigate(input, opts = {}) {
  const target = classify(input.value ?? input, opts.kind);
  const tab = tabs.active;
  if (!tab) return;

  let url;
  if (target.kind === 'search') {
    url = buildSearchUrl(target.value, state.settings.searchEngine);
  } else if (target.kind === 'internal') {
    url = target.value;
  } else {
    url = target.value;
  }

  // Privacy: strip tracking parameters before we ever load the page.
  if (state.settings.shields.cleanLinks && !url.startsWith('vespera://')) {
    const { url: clean, removed } = cleanTrackingParams(url);
    if (removed.length) {
      tab.shields.cleaned += removed.length;
      state.recordBlock('link', hostOf(clean));
      url = clean;
    }
  }
  // Privacy: HTTPS-only upgrades.
  if (state.settings.shields.httpsOnly && url.startsWith('http://')
      && !/^(localhost|127\.0\.0\.1)/i.test(url)) {
    url = 'https://' + url.slice('http://'.length);
    state.recordBlock('https', hostOf(url));
  }

  openInTab(tab, url);
}

function openInTab(tab, url) {
  tab.url = url;
  tab._internal = isInternal(url);
  tab.shields = { blocked: 0, ads: 0, trackers: 0, cleaned: tab.shields?.cleaned || 0 };

  // Tear down previous view.
  if (tab.pageCleanup) { try { tab.pageCleanup(); } catch { /* noop */ } tab.pageCleanup = null; }
  if (tab.view) { tab.view.remove(); tab.view = null; }

  if (tab._internal) {
    tab.title = INTERNAL_PAGES[url]?.title || 'Vespera';
    const page = document.createElement('div');
    page.className = 'page-scroll';
    contentEl.appendChild(page);
    tab.view = page;
    renderInternalPage(page, url, tab);
    tab.loading = false;
  } else {
    tab.title = url;
    tab.loading = true;
    const view = platform.createView(tab);
    contentEl.appendChild(view);
    tab.view = view;
    platform.bindView(view, tab, {
      onLoading: (v) => {
        tab.loading = v;
        if (!v) {
          // Cosmetic filtering after load (Electron webviews).
          applyCosmetic(view, tab);
        }
        tabs.update(tab, {});
        updateChromeFor(tab);
      },
      onTitle: (t) => tabs.update(tab, { title: t }),
      onUrl: (u) => {
        tab.url = u;
        updateChromeFor(tab);
      },
      onFavicon: (f) => tabs.update(tab, { favicon: f }),
      onError: (msg) => toast(msg, 'error'),
    });
  }

  tabs.update(tab, {});
  updateChromeFor(tab);

  if (!tab._internal) {
    state.addHistory({ title: tab.title, url: tab.url });
  }
}

function renderInternalPage(page, url, tab) {
  const renderer = PAGE_RENDERERS[url] || renderWelcome;
  const ctx = {
    navigate: (v, o) => navigate(v, o || {}),
    toast,
    getActiveTab: () => tabs.active,
    refreshChrome: (rebuildTabs) => {
      applyAppearance();
      omnibox?.refreshEngine();
      if (rebuildTabs) { positionTabUI(); tabs.render(); }
    },
    rerenderPage: () => renderInternalPage(page, url, tab),
  };
  tab.pageCleanup = renderer(page, ctx) || null;
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

/* ================================================================
   Chrome (toolbar / omnibox / badges) sync
   ================================================================ */

function updateChromeFor(tab) {
  if (!tab) return;
  omnibox?.setUrl(tab.url, tab._internal);
  updateShieldBadge(tab);
  document.getElementById('btn-back')?.toggleAttribute('disabled', false);
  document.getElementById('btn-forward')?.toggleAttribute('disabled', false);
  document.title = (tab.title || 'Vespera') + ' — Vespera';
}

function applyCosmetic(view, tab) {
  if (view.tagName !== 'WEBVIEW') return;
  if (!state.settings.shields.enabled || !state.settings.shields.blockAnnoyances) return;
  // Cosmetic filter list is evaluated in the main process; here we ask via
  // a simple inline pass using the bundled rules endpoint when needed.
  fetch('/api/filters').then((r) => r.json()).then(({ rules }) => {
    const host = hostOf(tab.url) || '';
    const hide = [];
    for (const line of rules) {
      const m = String(line).match(/^(.*?)(##)(.+)$/);
      if (!m) continue;
      const ruleHost = m[1].trim();
      const selector = m[3].trim();
      if (!ruleHost || host === ruleHost || host.endsWith('.' + ruleHost)) {
        if (/^\.(cookie|gdpr|newsletter|signup|share|social|sticky-share|follow)/.test(selector)) {
          hide.push(selector);
        }
      }
    }
    if (hide.length) {
      const css = hide.map((s) => `${s}{display:none!important}`).join('\n');
      platform.injectCss(view, css);
    }
  }).catch(() => {});
}

/* ================================================================
   Layout modes
   ================================================================ */

function positionTabUI() {
  const vertical = state.settings.tabLayout === 'vertical';
  document.body.classList.toggle('vertical-tabs', vertical);
  const rail = document.getElementById('rail');
  const vtabs = document.getElementById('vtabs');
  if (vtabs) vtabs.style.display = vertical ? 'flex' : 'none';
  if (rail) rail.style.display = vertical ? 'none' : 'flex';
}

function buildRail() {
  const rail = document.getElementById('rail');
  const foot = document.getElementById('vtabs-foot');
  const navItems = [
    ['vespera://newtab', 'sparkle', 'New Tab'],
    ['vespera://privacy', 'shield', 'Privacy Dashboard'],
    ['vespera://community', 'users', 'Community'],
    ['vespera://history', 'clock', 'History'],
    ['vespera://bookmarks', 'bookmark', 'Bookmarks'],
    ['vespera://downloads', 'download', 'Downloads'],
    ['vespera://settings', 'gear', 'Settings'],
    ['vespera://account', 'user', 'Account'],
  ];
  rail.innerHTML = navItems.map(([url, ic, title], i) =>
    `${i === 3 || i === 6 ? '<div class="rail-sep"></div>' : ''}
     <button class="icon-btn" data-nav="${url}" title="${title}">${icon(ic)}</button>`).join('');
  foot.innerHTML = navItems.map(([url, ic, title]) =>
    `<button class="vtab-nav" data-nav="${url}">${icon(ic)} ${title}</button>`).join('');

  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.nav, { kind: 'url' }));
    btn.addEventListener('auxclick', (e) => {
      if (e.button === 1) { e.preventDefault(); tabs.add(btn.dataset.nav); }
    });
  });
}

function buildToolbarVt() {
  const tb = document.getElementById('toolbar-vt');
  if (!tb || tb.dataset.built) return;
  tb.dataset.built = '1';
  tb.innerHTML = `
    <button class="icon-btn" data-vt="back" title="Back">${icon('arrowUp')}</button>
    <button class="icon-btn" data-vt="reload" title="Reload">${icon('refresh')}</button>
    <div class="omnibox-wrap" id="omnibox-wrap-vt" style="margin:0 8px">
      <div class="omnibox">
        <div class="site-info">${icon('lock')}</div>
        <input id="omni-input-vt" type="text" spellcheck="false" placeholder="Search or type a URL">
        <button class="icon-btn go-btn" id="omni-go-vt">${icon('external')}</button>
      </div>
    </div>
    <button class="icon-btn" data-vt="shields" title="Shields">${icon('shield')}</button>
    <button class="icon-btn" data-vt="menu" title="Menu">${icon('gear')}</button>`;
  tb.querySelector('#omni-go-vt').addEventListener('click', () => {
    navigate(tb.querySelector('#omni-input-vt').value, { kind: 'auto' });
  });
  tb.querySelector('#omni-input-vt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigate(e.target.value, { kind: 'auto' });
  });
  tb.querySelector('[data-vt="back"]').addEventListener('click', () => goBack());
  tb.querySelector('[data-vt="reload"]').addEventListener('click', () => reload());
  tb.querySelector('[data-vt="shields"]').addEventListener('click', (e) =>
    toggleShields(e.currentTarget, tabs.active, { onToggleSite: shieldAction }));
  tb.querySelector('[data-vt="menu"]').addEventListener('click', (e) => openMenu(e.currentTarget));
}

/* ================================================================
   Toolbar actions
   ================================================================ */

function goBack() {
  const tab = tabs.active;
  if (!tab) return;
  if (tab._internal) return navigate('vespera://newtab', { kind: 'url' });
  platform.goBack(tab.view);
}
function goForward() {
  const tab = tabs.active;
  if (tab && !tab._internal) platform.goForward(tab.view);
}
function reload() {
  const tab = tabs.active;
  if (!tab) return;
  if (tab._internal) return renderInternalPage(tab.view, tab.url, tab);
  platform.reload(tab.view);
  tab.loading = true;
  tabs.update(tab, {});
}

function bookmarkActive() {
  const tab = tabs.active;
  if (!tab || tab._internal) return toast('Internal pages are always in your bookmarks 😉', 'info');
  const added = state.addBookmark({ title: tab.title, url: tab.url });
  toast(added ? 'Bookmarked!' : 'Already bookmarked', added ? 'ok' : 'info');
}

function shieldAction(action) {
  if (action?.startsWith?.('__navigate:')) return navigate(action.slice(11), { kind: 'url' });
  applyCosmetic(tabs.active?.view, tabs.active);
}

/* ================================================================
   Menu + window controls
   ================================================================ */

function openMenu(anchor) {
  document.querySelector('.menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'menu';
  const r = anchor.getBoundingClientRect();
  menu.style.top = (r.bottom + 8) + 'px';
  menu.style.right = (window.innerWidth - r.right) + 'px';
  menu.innerHTML = `
    <button class="menu-item" data-go="vespera://newtab">${icon('sparkle')} New Tab <span class="kbd">Ctrl+T</span></button>
    <button class="menu-item" data-go="vespera://history">${icon('clock')} History</button>
    <button class="menu-item" data-go="vespera://bookmarks">${icon('bookmark')} Bookmarks</button>
    <button class="menu-item" data-go="vespera://downloads">${icon('download')} Downloads</button>
    <div class="menu-sep"></div>
    <button class="menu-item" data-go="vespera://privacy">${icon('shield')} Privacy Dashboard</button>
    <button class="menu-item" data-go="vespera://community">${icon('users')} Community</button>
    <button class="menu-item" data-go="vespera://account">${icon('user')} ${state.user ? 'Account' : 'Sign in'}</button>
    <div class="menu-sep"></div>
    <button class="menu-item" data-act="theme">${icon(state.settings.theme === 'dark' ? 'sun' : 'moon')} ${state.settings.theme === 'dark' ? 'Light' : 'Dark'} theme</button>
    <button class="menu-item" data-act="palette">${icon('search')} Command palette <span class="kbd">Ctrl+K</span></button>
    <button class="menu-item" data-go="vespera://logs">${icon('flask')} View logs</button>
    <button class="menu-item" data-go="vespera://settings">${icon('gear')} Settings</button>
    <div class="menu-sep"></div>
    <button class="menu-item" data-go="vespera://welcome">${icon('heart')} About Vespera</button>`;
  document.body.appendChild(menu);
  setTimeout(() => {
    const onDoc = (e) => {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', onDoc); }
    };
    document.addEventListener('mousedown', onDoc);
  }, 0);
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    menu.remove();
    if (item.dataset.go) navigate(item.dataset.go, { kind: 'url' });
    else if (item.dataset.act === 'theme') {
      state.set('theme', state.settings.theme === 'dark' ? 'light' : 'dark');
      applyAppearance();
    } else if (item.dataset.act === 'palette') {
      openPalette({ actions: paletteActions() });
    }
  });
}

function wireWindowControls() {
  if (!platform.isElectron) return;
  document.body.classList.add('electron');
  document.getElementById('wc-min')?.addEventListener('click', () => platform.minimize());
  document.getElementById('wc-max')?.addEventListener('click', () => platform.maximize());
  document.getElementById('wc-close')?.addEventListener('click', () => platform.close());
}

/* ================================================================
   Command palette actions
   ================================================================ */

function paletteActions() {
  const go = (url) => () => navigate(url, { kind: 'url' });
  return [
    { title: 'New Tab', icon: 'plus', kbd: 'Ctrl+T', run: () => tabs.add('vespera://newtab') },
    { title: 'Close Tab', icon: 'x', kbd: 'Ctrl+W', run: () => tabs.close(tabs.activeId) },
    { title: 'Reopen Closed Tab', icon: 'refresh', kbd: 'Ctrl+Shift+T', run: () => tabs.reopenClosed() },
    { title: 'Open Settings', icon: 'gear', run: go('vespera://settings') },
    { title: 'Open Privacy Dashboard', icon: 'shield', run: go('vespera://privacy') },
    { title: 'Open Community', icon: 'users', run: go('vespera://community') },
    { title: 'Open History', icon: 'clock', run: go('vespera://history') },
    { title: 'Open Bookmarks', icon: 'bookmark', run: go('vespera://bookmarks') },
    { title: 'Open Downloads', icon: 'download', run: go('vespera://downloads') },
    { title: 'View Logs', icon: 'flask', run: go('vespera://logs') },
    { title: state.user ? 'Open Account' : 'Sign in', icon: 'user', run: go('vespera://account') },
    { title: 'Toggle Theme', icon: 'moon', run: () => {
      state.set('theme', state.settings.theme === 'dark' ? 'light' : 'dark');
      applyAppearance();
    } },
    { title: 'Toggle Vertical Tabs', icon: 'split', run: () => {
      state.set('tabLayout', state.settings.tabLayout === 'vertical' ? 'horizontal' : 'vertical');
      applyAppearance(); positionTabUI(); tabs.render();
    } },
    { title: 'Bookmark This Page', icon: 'star', kbd: 'Ctrl+D', run: bookmarkActive },
    { title: 'Clear Browsing History', icon: 'trash', run: () => {
      state.clearHistory(); toast('History cleared', 'ok');
    } },
  ];
}

/* ================================================================
   Keyboard shortcuts
   ================================================================ */

function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const inField = /^(input|textarea|select)$/i.test(e.target.tagName);

    if (e.key === 'Escape' && paletteOpen()) { closePalette(); return; }

    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette({ actions: paletteActions() }); }
    else if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); omnibox?.focus(); }
    else if (mod && e.key.toLowerCase() === 't') { e.preventDefault(); tabs.add('vespera://newtab'); }
    else if (mod && e.key.toLowerCase() === 'w') { e.preventDefault(); tabs.close(tabs.activeId); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); tabs.reopenClosed(); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); bookmarkActive(); }
    else if (mod && e.key.toLowerCase() === 'r') { e.preventDefault(); reload(); }
    else if (mod && e.key === 'Tab') { e.preventDefault(); e.shiftKey ? tabs.prev() : tabs.next(); }
    else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
    else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
    else if (e.key === 'F5') { e.preventDefault(); reload(); }
    else if (!inField && e.key === '/') { e.preventDefault(); omnibox?.focus(); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      toast('Incognito window — no history, no cookies, full shields', 'ok');
      if (platform.isElectron) window.vespera.window.incognito();
    }
  });
}

/* ================================================================
   Boot
   ================================================================ */

function boot() {
  applyAppearance();
  positionTabUI();
  wireWindowControls();

  tabs = new TabManager({
    onActiveChange: (tab) => updateChromeFor(tab),
  });

  buildRail();
  buildToolbarVt();

  omnibox = initOmnibox({ onNavigate: (target) => navigate(target.value, { kind: target.kind }) });
  window.__vesperaNavigate = (t) => navigate(t.value, { kind: t.kind });

  // Toolbar wiring
  document.getElementById('btn-back')?.addEventListener('click', goBack);
  document.getElementById('btn-forward')?.addEventListener('click', goForward);
  document.getElementById('btn-reload')?.addEventListener('click', reload);
  document.getElementById('btn-home')?.addEventListener('click', () =>
    navigate(state.settings.homepage || 'vespera://newtab', { kind: 'url' }));
  document.getElementById('btn-newtab')?.addEventListener('click', () => tabs.add('vespera://newtab'));
  document.getElementById('btn-bookmark')?.addEventListener('click', bookmarkActive);
  document.getElementById('btn-palette')?.addEventListener('click', () => openPalette({ actions: paletteActions() }));
  document.getElementById('btn-menu')?.addEventListener('click', (e) => openMenu(e.currentTarget));
  document.getElementById('btn-shields')?.addEventListener('click', (e) =>
    toggleShields(e.currentTarget, tabs.active, { onToggleSite: shieldAction }));

  wireKeyboard();

  // Live-update chrome when settings change (e.g. from a settings page).
  bus.on('settings', () => {
    applyAppearance();
    omnibox?.refreshEngine();
    positionTabUI();
    tabs.render();
  });
  bus.on('user', () => { /* pages rerender themselves */ });

  // Restore session: open last tabs, else the welcome experience.
  let restored = false;
  try {
    const session = JSON.parse(localStorage.getItem('vespera.session') || 'null');
    if (session?.tabs?.length) {
      for (const t of session.tabs) tabs.add(t.url, { title: t.title, activate: false });
      tabs.activate(session.activeId && tabs.tabs.some((t) => t.id === session.activeId)
        ? session.activeId : tabs.tabs[0].id);
      restored = true;
    }
  } catch { /* ignore */ }
  if (!restored) {
    tabs.add('vespera://welcome');
    if (state.history.length > 3) tabs.add('vespera://newtab');
    tabs.activate(tabs.tabs[0].id);
  }

  // Persist session for crash/relaunch recovery.
  setInterval(() => {
    localStorage.setItem('vespera.session', JSON.stringify({
      tabs: tabs.tabs.map((t) => ({ url: t.url, title: t.title })),
      activeId: tabs.activeId,
    }));
  }, 2000);

  // Validate/refresh account session in the background.
  if (api.getToken()) {
    api.auth.me().then((r) => {
      if (r.ok) state.setUser(r.user);
      else { api.setSession(null, null); state.user = null; }
    });
  }
}

boot();
