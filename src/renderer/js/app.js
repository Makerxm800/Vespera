/** Vespera browser controller. Every page action is bound to its owning tab. */
import { state, applyAppearance, bus } from './state.js';
import { platform } from './platform.js';
import { TabManager, TAB_GROUP_COLORS } from './tabs.js';
import { initTabHover } from './tab-hover.js';
import { initOmnibox } from './omnibox.js';
import { toggleShields, updateShieldBadge, hostOf } from './shields.js';
import { openPalette, closePalette, paletteOpen } from './palette.js';
import { toast, escapeHtml } from './toasts.js';
import { icon } from './icons.js';
import { classifyInput, buildSearchUrl, isInternal, internalPageKey, INTERNAL_PAGES, cleanTrackingParams, safeTabUrl, SEARCH_ENGINES } from '../../shared/privacy-utils.mjs';
import { closePopover, openPopover } from './popover.js';
import { confirmAction } from './dialog.js';
import { initDownloads, downloadUrl } from './downloads.js';
import * as api from './api.js';
import { renderWelcome } from './pages/welcome.js';
import { renderNewtab } from './pages/newtab.js';
import { renderSettings } from './pages/settings.js';
import { renderPrivacy } from './pages/privacy.js';
import { renderCommunity } from './pages/community.js';
import { renderAccount } from './pages/account.js';
import { renderHistory, renderBookmarks, renderDownloads } from './pages/library.js';
import { renderLogs } from './pages/logs.js';
import { renderExtensions } from './pages/extensions.js';
import { renderReader, renderSearch, renderNotFound } from './pages/tools.js';
import { renderUpdates } from './pages/updates.js';

const PAGE_RENDERERS = {
  'vespera://newtab': renderNewtab, 'vespera://welcome': renderWelcome,
  'vespera://settings': renderSettings, 'vespera://privacy': renderPrivacy,
  'vespera://community': renderCommunity, 'vespera://account': renderAccount,
  'vespera://history': renderHistory, 'vespera://bookmarks': renderBookmarks,
  'vespera://downloads': renderDownloads, 'vespera://shields': renderPrivacy,
  'vespera://logs': renderLogs, 'vespera://extensions': renderExtensions,
  'vespera://reader': renderReader, 'vespera://search': renderSearch,
  'vespera://updates': renderUpdates,
};
let tabs, omnibox, saveTimer, previewRestricted = false, serviceVersion = '';
let tabHover;
let previousDark = false;
let installPrompt = null;
const contentEl = document.getElementById('content');
const $ = (id) => document.getElementById(id);
const diagnostics = [];
function diagnostic(message) { diagnostics.unshift({ at: Date.now(), message: String(message) }); if (diagnostics.length > 100) diagnostics.pop(); }
window.addEventListener('error', (e) => diagnostic(e.message));
window.addEventListener('unhandledrejection', (e) => diagnostic(e.reason?.message || e.reason));

function navigate(input, opts = {}) {
  const value = String(input?.value ?? input ?? '').trim();
  if (!value) return;
  const tab = opts.tab || tabs.active;
  if (!tab) return;
  const target = opts.kind === 'search' ? { kind: 'search', value } : opts.kind === 'url' ? classifyInput(value) : classifyInput(value);
  let url = target.kind === 'search' ? buildSearchUrl(target.value, state.settings.searchEngine) : target.value;
  if (target.kind === 'search' && previewRestricted && !platform.isElectron) {
    url = 'vespera://search?q=' + encodeURIComponent(target.value);
  }
  if (!safeTabUrl(url)) return toast('That address is not a safe web page. Use an http:// or https:// address.', 'error');
  const sh = state.settings.shields;
  if (sh.enabled && sh.cleanLinks && !isInternal(url)) {
    const clean = cleanTrackingParams(url);
    if (clean.removed.length) { tab.shields.cleaned += clean.removed.length; state.recordBlock('link', hostOf(clean.url)); url = clean.url; }
  }
  if (sh.enabled && sh.httpsOnly && url.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/)/i.test(url)) {
    url = 'https://' + url.slice(7); state.recordBlock('https', hostOf(url));
  }
  openInTab(tab, url);
}

function disposeView(tab) {
  clearTimeout(tab.loadTimer);
  try { tab.pageCleanup?.(); } catch (err) { diagnostic(err.message); }
  tab.pageCleanup = null;
  tab.disposeView?.();
  tab.disposeView = null;
  tab.view?.remove(); tab.view = null;
}
function openInTab(tab, url, { push = true } = {}) {
  url = safeTabUrl(url);
  if (!url) return;
  closePopover(); closeFind();
  disposeView(tab);
  if (push) {
    tab.entries = tab.entries.slice(0, tab.entryIndex + 1);
    tab.entries.push({ url, title: INTERNAL_PAGES[internalPageKey(url)]?.title || url });
    if (tab.entries.length > 100) tab.entries.shift();
    tab.entryIndex = tab.entries.length - 1;
  }
  tab.url = url;
  tab._internal = isInternal(url);
  tab.audible = false;
  tab.error = null; tab.favicon = null; tab.reader ||= null;
  tab.shields = { blocked: 0, ads: 0, trackers: 0, cleaned: tab.shields?.cleaned || 0 };
  if (tab._internal) {
    tab.title = INTERNAL_PAGES[internalPageKey(url)]?.title || 'Page not found';
    tab.loading = false;
    tab.view = document.createElement('div'); tab.view.className = 'page-scroll';
    contentEl.appendChild(tab.view);
    renderInternalPage(tab.view, url, tab);
  } else {
    tab.title = hostOf(url) || url; tab.loading = true;
    tab.view = platform.createView(tab); contentEl.appendChild(tab.view);
    tab.disposeView = platform.bindView(tab.view, tab, {
      onLoading: (loading) => {
        tab.loading = loading;
        if (!loading) { clearTimeout(tab.loadTimer); applyPageExtensions(tab); state.addHistory({ title: tab.title, url: tab.url }); }
        tabs.update(tab);
      },
      onTitle: (title) => { if (title) { tabs.update(tab, { title }); state.addHistory({ title, url: tab.url }); } },
      onUrl: (next) => {
        if (!safeTabUrl(next) || isInternal(next)) return;
        tab.url = next; tab.entries[tab.entryIndex] = { url: next, title: tab.title };
        tabs.update(tab);
      },
      onFavicon: (favicon) => tabs.update(tab, { favicon }),
      onAudioState: ({ audible }) => { const next = Boolean(audible); if (tab.audible !== next) tabs.update(tab, { audible: next }); },
      onError: (message) => showLoadError(tab, message),
      onLink: (link, newTab, foreground = true, gesture = '') => {
        if (!newTab) return navigate(link, { tab, kind: 'url' });
        if (gesture === 'middle' && state.settings.tabBehavior.middleClickOpensTab === false) return navigate(link, { tab, kind: 'url' });
        tabs.add(link, { activate: foreground, besideId: tab.id, groupId: tab.groupId || null });
      },
      onDownload: (link, name) => downloadUrl(link, name),
      onShield: (kind, count) => { if (!count) return; tab.shields[kind === 'tracker' ? 'trackers' : 'ads'] += count; tab.shields.blocked += count; for (let i = 0; i < count; i++) state.recordBlock(kind, hostOf(tab.url)); tabs.update(tab); },
      onFound: (result) => { $('find-count').textContent = result.matches ? `${result.activeMatchOrdinal} / ${result.matches}` : 'No matches'; },
      onContext: (info, x, y) => showContextMenu(tab, x, y, info),
    });
    state.addHistory({ title: tab.title, url });
    tab.loadTimer = setTimeout(() => { if (tab.loading && tab.view) showLoadError(tab, 'This page is taking longer than expected. You can retry or open the original site.'); }, 25000);
  }
  tab.view.classList.toggle('hidden', tabs.activeId !== tab.id);
  tabs.update(tab);
  applyPageExtensions(tab);
}
function showLoadError(tab, message) {
  clearTimeout(tab.loadTimer);
  tab.loading = false; tab.error = message;
  tabs.update(tab);
  if (!tab.view?.classList.contains('web-frame') || tab.view.querySelector('.load-error')) return;
  const overlay = document.createElement('div'); overlay.className = 'load-error';
  overlay.innerHTML = `<div class="error-symbol">${icon('globe')}</div><span class="chip">Let’s try that again</span><h1>This page couldn’t be opened</h1>
    <p>${escapeHtml(message)}</p><div class="error-host">${escapeHtml(hostOf(tab.url) || tab.url)}</div>
    <div class="hero-actions"><button class="btn btn-primary" data-retry>${icon('refresh')} Try again</button><a class="btn" href="${escapeHtml(tab.url)}" target="_blank" rel="noopener noreferrer">Open original ${icon('external')}</a><button class="btn btn-ghost" data-home>Back home</button></div>
    <p class="small faint">Some websites limit embedded browsing. “Open original” visits the site directly.</p>`;
  tab.view.appendChild(overlay);
  overlay.querySelector('[data-retry]').onclick = () => reload(tab);
  overlay.querySelector('[data-home]').onclick = () => navigate('vespera://newtab', { tab });
}
function renderInternalPage(page, url, tab) {
  try { tab.pageCleanup?.(); } catch { /* stale page */ }
  tab.pageCleanup = null;
  const key = internalPageKey(url);
  const renderer = PAGE_RENDERERS[key] || renderNotFound;
  const ctx = {
    navigate: (v, o = {}) => navigate(v, { ...o, tab }),
    openTab: (v) => tabs.add(v), toast, getActiveTab: () => tab,
    refreshChrome: (rebuildTabs) => { applyAppearance(); omnibox?.refreshEngine(); if (rebuildTabs) { positionTabUI(); tabs.render(); } },
    rerenderPage: () => renderInternalPage(page, url, tab),
    refreshPage: () => openInTab(tab, tab.url, { push: false }),
    reload: () => reload(tab), reader: () => openReader(tab),
    previewRestricted: () => previewRestricted,
    version: () => serviceVersion, diagnostics: () => diagnostics,
    download: downloadUrl,
    back: () => goBack(tab),
  };
  try { tab.pageCleanup = renderer(page, ctx) || null; }
  catch (err) { diagnostic(err.stack || err.message); page.innerHTML = `<div class="page"><h1>Something went wrong</h1><p>${escapeHtml(err.message)}</p><button class="btn" id="page-retry">Try again</button></div>`; page.querySelector('#page-retry').onclick = ctx.rerenderPage; }
  const section = url.includes('#') ? url.split('#')[1] : '';
  if (section) requestAnimationFrame(() => page.querySelector('#' + CSS.escape(section))?.scrollIntoView({ block: 'start' }));
}

function updateChromeFor(tab) {
  if (!tab || tabs.active !== tab) return;
  omnibox?.setUrl(tab.url, tab._internal);
  updateShieldBadge(tab);
  $('btn-back').disabled = tab.entryIndex <= 0;
  $('btn-forward').disabled = tab.entryIndex >= tab.entries.length - 1;
  $('btn-reload').innerHTML = icon(tab.loading ? 'x' : 'refresh');
  $('btn-reload').title = tab.loading ? 'Stop loading' : 'Reload (Ctrl+R)';
  const marked = state.isBookmarked(tab.url);
  $('btn-bookmark').innerHTML = icon(marked ? 'bookmarkFill' : 'bookmark');
  $('btn-bookmark').classList.toggle('is-active', marked);
  $('btn-bookmark').title = marked ? 'Remove bookmark' : 'Bookmark this page (Ctrl+D)';
  document.title = (tab.title || 'New Tab') + ' — Vespera' + (state.private ? ' (Private)' : '');
  $('page-status').textContent = tab.error ? 'Page unavailable' : tab.loading ? 'Loading ' + (hostOf(tab.url) || 'page') + '…' : tab._internal ? 'Vespera · Ready' : hostOf(tab.url) || 'Ready';
  $('zoom-status').textContent = Math.round(tab.zoom * 100) + '%';
  $('open-original').classList.toggle('hidden', tab._internal);
  if (!tab._internal) $('open-original').href = tab.url;
  document.querySelectorAll('[data-nav]').forEach((el) => el.classList.toggle('active', tab._internal && el.dataset.nav === internalPageKey(tab.url)));
}
async function applyPageExtensions(tab) {
  if (!platform.isWebview(tab.view)) return;
  const frame = platform.inner(tab.view);
  try {
    if (state.settings.extensions.darkPages && !tab.darkCss) tab.darkCss = await frame.insertCSS('html{filter:invert(1) hue-rotate(180deg)!important;background:#111!important}img,video,canvas{filter:invert(1) hue-rotate(180deg)}');
    else if (!state.settings.extensions.darkPages && tab.darkCss) { await frame.removeInsertedCSS(tab.darkCss); tab.darkCss = null; }
  } catch { /* Page navigated while CSS was being applied. */ }
}
function positionTabUI() {
  const vertical = state.settings.tabLayout === 'vertical';
  const behavior = state.settings.tabBehavior;
  document.body.classList.toggle('vertical-tabs', vertical);
  document.body.classList.toggle('tabs-no-scroll', behavior.scrollableTabStrip === false);
  document.body.classList.toggle('tabs-hide-close', behavior.hideCloseButtons === true);
  document.body.classList.toggle('tab-groups-disabled', behavior.tabGroupsEnabled === false);
  document.body.classList.toggle('tabs-inactive-dimmed', behavior.inactiveTabAppearance === 'dimmed');
  document.body.classList.toggle('tabs-inactive-minimal', behavior.inactiveTabAppearance === 'minimal');
  $('vtabs').classList.toggle('hidden', !vertical);
  $('rail').classList.toggle('hidden', vertical);
  const toolbar = $('toolbar');
  if (vertical) $('toolbar-vt').appendChild(toolbar);
  else $('app').insertBefore(toolbar, $('main-row'));
}
function buildRail() {
  const items = [
    ['vespera://newtab', 'sparkle', 'Home'], ['vespera://extensions', 'split', 'Extensions'],
    ['vespera://privacy', 'shield', 'Privacy Hub'], ['vespera://community', 'users', 'Community'],
    ['vespera://history', 'clock', 'History'], ['vespera://bookmarks', 'bookmark', 'Bookmarks'],
    ['vespera://downloads', 'download', 'Downloads'], ['vespera://settings', 'gear', 'Settings'],
    ['vespera://account', 'user', 'Account'],
  ];
  $('rail').innerHTML = items.map(([url, ic, title], i) => `${i === 4 || i === 7 ? '<div class="rail-sep"></div>' : ''}<button class="icon-btn" data-nav="${url}" title="${title}" aria-label="${title}">${icon(ic)}</button>`).join('');
  $('vtabs-foot').innerHTML = items.filter(([url]) => !['vespera://newtab', 'vespera://community'].includes(url)).map(([url, ic, title]) => `<button class="vtab-nav" data-nav="${url}">${icon(ic)} ${title}</button>`).join('');
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.nav));
    btn.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); tabs.add(btn.dataset.nav); } });
  });
}
function renderBookmarksBar() {
  const bar = $('bookmarks-bar');
  bar.classList.toggle('hidden', !state.settings.showBookmarksBar);
  bar.innerHTML = state.bookmarks.length ? state.bookmarks.slice(0, 20).map((b) => `<button class="bookmark-chip" data-bookmark-url="${escapeHtml(b.url)}" title="${escapeHtml(b.url)}">${icon('globe')}<span>${escapeHtml(b.title || b.url)}</span></button>`).join('') : '<span class="small muted">Your bookmarks bar is ready. Save a page with the bookmark button or Ctrl+D.</span><button class="text-btn" data-open-bookmarks>Manage bookmarks</button>';
  bar.querySelectorAll('[data-bookmark-url]').forEach((b) => b.onclick = () => navigate(b.dataset.bookmarkUrl));
  bar.querySelector('[data-open-bookmarks]')?.addEventListener('click', () => navigate('vespera://bookmarks'));
}
function goBack(tab = tabs.active) {
  if (!tab || tab.entryIndex <= 0) return;
  tab.entryIndex--; openInTab(tab, tab.entries[tab.entryIndex].url, { push: false });
}
function goForward(tab = tabs.active) {
  if (!tab || tab.entryIndex >= tab.entries.length - 1) return;
  tab.entryIndex++; openInTab(tab, tab.entries[tab.entryIndex].url, { push: false });
}
function reload(tab = tabs.active) {
  if (!tab) return;
  closeFind();
  if (tab._internal) { renderInternalPage(tab.view, tab.url, tab); toast('Page refreshed', 'ok', 1400); return; }
  tab.view?.querySelector('.load-error')?.remove(); tab.error = null; tab.loading = true;
  platform.reload(tab.view); tabs.update(tab);
  clearTimeout(tab.loadTimer);
  tab.loadTimer = setTimeout(() => { if (tab.loading) showLoadError(tab, 'The site did not respond. Try again or open the original.'); }, 25000);
}
function bookmarkActive() {
  const tab = tabs.active;
  if (!tab || tab._internal) return toast('Open a website to bookmark it.', 'info');
  const existing = state.bookmarks.find((b) => b.url === tab.url);
  if (existing) { state.removeBookmark(existing.id); toast('Bookmark removed', 'ok'); }
  else { state.addBookmark({ title: tab.title, url: tab.url }); toast('Page saved to bookmarks', 'ok'); }
  updateChromeFor(tab);
}
async function setZoom(delta, reset = false) {
  const tab = tabs.active;
  tab.zoom = reset ? 1 : Math.max(.5, Math.min(2, Math.round((tab.zoom + delta) * 10) / 10));
  await platform.setZoom(tab.view, tab.zoom); updateChromeFor(tab);
  const value = $('zoom-value'); if (value) value.textContent = Math.round(tab.zoom * 100) + '%';
}
function toggleTabMute(id) {
  const tab = tabs.tabs.find((item) => item.id === id);
  if (!tab || tab._internal) return;
  tab.muted = !tab.muted;
  platform.setAudioMuted(tab.view, tab.muted);
  tabs.update(tab, { muted: tab.muted });
}
function closeFind() { $('find-bar').classList.add('hidden'); platform.stopFind(tabs?.active?.view); }
function openFind() {
  if (!platform.isElectron || tabs.active?._internal) return toast('Use your browser’s Find command in the web preview.', 'info');
  $('find-bar').classList.remove('hidden'); $('find-input').focus(); $('find-input').select();
}
async function openReader(tab = tabs.active) {
  const previousArticle = tab?.entries.slice(0, tab.entryIndex).reverse().find((e) => /^https?:/.test(e.url));
  const sourceUrl = tab?._internal ? previousArticle?.url : tab?.url;
  if (!sourceUrl) return toast('Open a website first, then choose Reader View.', 'info');
  toast('Preparing a quiet reading view…', 'info');
  try {
    if (platform.isElectron && !tab._internal) {
      tab.reader = await platform.inner(tab.view).executeJavaScript(`(()=>{const source=document.querySelector('article')||document.querySelector('main')||document.body;const clone=source.cloneNode(true);clone.querySelectorAll('script,style,nav,header,footer,aside,form,noscript,svg,iframe,button').forEach(e=>e.remove());return {title:document.title,text:clone.textContent.replace(/[\\t\\r ]+/g,' ').replace(/\\n\\s*\\n\\s*\\n+/g,'\\n\\n').trim().slice(0,120000),url:location.href}})()`);
    } else {
      const response = await fetch('/api/reader?url=' + encodeURIComponent(sourceUrl));
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'This article is not reachable from the preview.');
      tab.reader = result;
    }
    if (!tab.reader?.text || tab.reader.text.length < 80) throw new Error('No readable article was found on this page.');
    navigate('vespera://reader', { tab });
  } catch (err) { toast(err.message || 'Reader View is unavailable for this page.', 'error', 5500); }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard', 'ok', 1600); }
  catch { toast('Clipboard access was blocked by your browser.', 'error'); }
}
function showContextMenu(tab, x, y, info = {}) {
  if (!tab) return;
  const item = (act, ic, label, disabled = false) => `<button class="menu-item" data-ctx="${act}" ${disabled ? 'disabled' : ''}>${icon(ic)} ${label}</button>`;
  const sep = '<div class="menu-sep"></div>';
  let html = '';
  if (info.link) html += item('open-link', 'plus', 'Open link in new tab') + item('copy-link', 'link', 'Copy link address') + item('save-link', 'download', 'Save link as…') + sep;
  if (info.image) html += item('open-image', 'image', 'Open image in new tab') + item('copy-image', 'link', 'Copy image address') + item('save-image', 'download', 'Save image as…') + sep;
  if (info.selection) html += item('copy-selection', 'copy', 'Copy selection') + item('search-selection', 'search', 'Search for “' + escapeHtml(info.selection.slice(0, 28)) + (info.selection.length > 28 ? '…' : '') + '”') + sep;
  html += item('back', 'arrowLeft', 'Back', tab.entryIndex <= 0) + item('forward', 'arrowRight', 'Forward', tab.entryIndex >= tab.entries.length - 1) + item('reload', 'refresh', 'Reload') + sep;
  if (!tab._internal) html += item('save-page', 'download', 'Save page as…') + item('reader', 'eye', 'Reader View') + item('bookmark', 'bookmark', state.isBookmarked(tab.url) ? 'Remove bookmark' : 'Bookmark page') + sep;
  if (internalPageKey(tab.url) === 'vespera://newtab') html += item('customize', 'palette', 'Customize home') + sep;
  html += item('copy-address', 'link', 'Copy page address') + item('home', 'sparkle', 'Home') + item('settings', 'gear', 'Settings');
  const anchor = document.createElement('span');
  anchor.className = 'context-anchor'; anchor.tabIndex = -1;
  anchor.style.left = Math.max(0, x) + 'px'; anchor.style.top = Math.max(0, y) + 'px';
  document.body.appendChild(anchor);
  const pop = openPopover(anchor, html, { className: 'menu context-menu', label: 'Page context menu', align: 'context', onClose: () => anchor.remove() });
  if (!pop) { anchor.remove(); return; }
  pop.el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-ctx]')?.dataset.ctx; if (!act) return;
    pop.close();
    switch (act) {
      case 'open-link': tabs.add(info.link, { activate: false, besideId: tab.id, groupId: tab.groupId || null }); break;
      case 'copy-link': copyText(info.link); break;
      case 'save-link': downloadUrl(info.link); break;
      case 'open-image': tabs.add(info.image, { activate: false, besideId: tab.id, groupId: tab.groupId || null }); break;
      case 'copy-image': copyText(info.image); break;
      case 'save-image': downloadUrl(info.image); break;
      case 'copy-selection': copyText(info.selection); break;
      case 'search-selection': navigate(info.selection, { kind: 'search', tab }); break;
      case 'back': goBack(tab); break;
      case 'forward': goForward(tab); break;
      case 'reload': reload(tab); break;
      case 'save-page': downloadUrl(tab.url, (tab.title || 'page') + '.html'); break;
      case 'reader': openReader(tab); break;
      case 'bookmark': tabs.activate(tab.id); bookmarkActive(); break;
      case 'customize': navigate('vespera://settings#appearance', { tab }); break;
      case 'copy-address': copyText(tab.url); break;
      case 'home': navigate(state.settings.homepage || 'vespera://newtab', { tab }); break;
      case 'settings': navigate('vespera://settings', { tab }); break;
    }
  });
}
function wireContextMenus() {
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('input,textarea,select,[contenteditable="true"],[contenteditable=""]')) return;
    if (e.target.closest('#tabstrip,#vtabs-list')) return; // tab-specific menu
    if (!e.target.closest('#content')) return;
    e.preventDefault();
    showContextMenu(tabs.active, e.clientX, e.clientY, { selection: String(window.getSelection() || '').slice(0, 2000) });
  });
}
function wireMiddleClickLinks() {
  document.addEventListener('auxclick', (e) => {
    if (e.button !== 1 || state.settings.tabBehavior.middleClickOpensTab === false) return;
    if (e.target.closest('#tabstrip,#vtabs-list')) return;
    const link = e.target.closest('a[href]');
    if (!link) return;
    const raw = link.getAttribute('href') || '';
    if (!raw || raw.startsWith('#') || raw.startsWith('javascript:')) return;
    let url;
    try { url = raw.startsWith('vespera://') ? raw : new URL(raw, location.href).href; } catch { return; }
    if (!safeTabUrl(url)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const active = tabs.active;
    tabs.add(url, { activate: false, besideId: active?.id, groupId: active?.groupId || null, title: link.textContent?.trim() || undefined });
  }, true);
}

function openMenu(anchor) {
  const s = state.settings;
  const item = (act, ic, label, kbd = '') => `<button class="menu-item" data-act="${act}">${icon(ic)} ${label}${kbd ? `<span class="kbd">${kbd}</span>` : ''}</button>`;
  const toggle = (path, label) => `<button class="menu-toggle" type="button" role="switch" data-pref="${path}" aria-checked="${Boolean(s.tabBehavior[path.split('.').at(-1)])}"><span class="menu-toggle-label">${label}</span><span class="menu-switch" aria-hidden="true"><i></i></span></button>`;
  const pop = openPopover(anchor, `
    ${item('newtab', 'plus', 'New tab', 'Ctrl+T')}
    ${item('private', 'eyeOff', state.private ? 'Private window' : 'New private window', 'Ctrl+Shift+N')}
    ${!platform.isElectron ? `<button class="menu-item ${installPrompt ? '' : 'hidden'}" data-act="install">${icon('download')} Install Vespera as an app</button>` : ''}
    <div class="menu-sep"></div>
    ${item('history', 'clock', 'History')}${item('bookmarks', 'bookmark', 'Bookmarks')}${item('downloads', 'download', 'Downloads')}${item('extensions', 'split', 'Extensions')}
    <div class="menu-sep"></div>
    <div class="zoom-row"><span>Zoom</span><button class="icon-btn" data-act="zoom-out" title="Zoom out">−</button><b id="zoom-value">${Math.round(tabs.active.zoom * 100)}%</b><button class="icon-btn" data-act="zoom-in" title="Zoom in">+</button><button class="icon-btn" data-act="zoom-reset" title="Reset zoom">${icon('refresh')}</button></div>
    ${item('find', 'search', 'Find in page', 'Ctrl+F')}${item('print', 'download', 'Print page', 'Ctrl+P')}
    <div class="menu-sep"></div>
    <div class="menu-label">Tabs</div>
    ${toggle('tabBehavior.middleClickOpensTab', 'Middle-click opens links')}
    ${toggle('tabBehavior.middleClickClosesTab', 'Middle-click closes tabs')}
    ${toggle('tabBehavior.openTabsNextToCurrent', 'Open new tabs beside current')}
    ${toggle('tabBehavior.tabGroupsEnabled', 'Show tab groups')}
    ${s.tabBehavior.tabGroupsEnabled ? item('new-group', 'plus', 'Group current tab') : ''}
    ${item('tab-settings', 'split', 'Tab settings')}
    <div class="menu-sep"></div>
    ${item('customize', 'palette', 'Customize Vespera')}${item('theme', s.theme === 'dark' ? 'sun' : 'moon', s.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme')}
    ${item('vertical', 'split', (s.tabLayout === 'vertical' ? '✓ ' : '') + 'Vertical tabs')}${item('bookbar', 'bookmark', (s.showBookmarksBar ? '✓ ' : '') + 'Bookmarks bar')}${item('focus', 'eye', (s.extensions.focusMode ? '✓ ' : '') + 'Focus mode')}
    <div class="menu-sep"></div>
    ${item('palette', 'keyboard', 'Command palette', 'Ctrl+K')}${item('privacy', 'shield', 'Privacy Hub')}${item('account', 'user', state.user ? 'Account · ' + escapeHtml(state.user.displayName) : 'Sign in / create account')}${item('settings', 'gear', 'Settings')}${item('updates', 'sparkle', 'What’s new')}${item('logs', 'flask', 'View logs')}${item('welcome', 'sparkle', 'Welcome & about')}
  `, { label: 'Vespera menu', className: 'menu browser-menu' });
  if (!pop) return;
  if (!platform.isElectron) pop.el.querySelector('[data-act="private"]').disabled = true;
  pop.el.addEventListener('click', async (e) => {
    const pref = e.target.closest('[data-pref]');
    if (pref) {
      const path = pref.dataset.pref;
      const next = pref.getAttribute('aria-checked') !== 'true';
      if (state.set(path, next)) pref.setAttribute('aria-checked', String(next));
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (!act.startsWith('zoom')) pop.close();
    switch (act) {
      case 'newtab': tabs.add('vespera://newtab'); break;
      case 'new-group': {
        const group = tabs.createGroup('New group');
        if (group) requestAnimationFrame(() => openGroupEditor(group.id, document.querySelector(`[data-group-header="${CSS.escape(group.id)}"]`)));
        else toast('Turn on Tab groups to create a group.', 'info');
        break;
      }
      case 'install': if (installPrompt) { installPrompt.prompt(); const choice = await installPrompt.userChoice; if (choice.outcome === 'accepted') toast('Vespera is installing as an app.', 'ok'); installPrompt = null; } break;
      case 'private': if (platform.isElectron) window.vespera.window.incognito(); break;
      case 'history': case 'bookmarks': case 'downloads': case 'extensions': case 'privacy': case 'account': case 'settings': case 'logs': case 'welcome': case 'updates': navigate('vespera://' + act); break;
      case 'customize': navigate('vespera://settings#appearance'); break;
      case 'tab-settings': navigate('vespera://settings#tabs'); break;
      case 'theme': state.set('theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); break;
      case 'vertical': state.set('tabLayout', s.tabLayout === 'vertical' ? 'horizontal' : 'vertical'); break;
      case 'bookbar': state.set('showBookmarksBar', !s.showBookmarksBar); break;
      case 'focus': state.set('extensions.focusMode', !s.extensions.focusMode); break;
      case 'palette': openPalette({ actions: paletteActions() }); break;
      case 'zoom-in': setZoom(.1); break;
      case 'zoom-out': setZoom(-.1); break;
      case 'zoom-reset': setZoom(0, true); break;
      case 'find': openFind(); break;
      case 'print': if (platform.isElectron && !tabs.active._internal) platform.print(tabs.active.view); else toast('Open the original website to print it from the web preview.', 'info'); break;
    }
  });
}
function openGroupEditor(groupId, anchor) {
  const group = tabs.getGroup(groupId);
  if (!group || !anchor) return;
  const colors = TAB_GROUP_COLORS.map((color) => `<button class="group-color-choice" type="button" data-group-color-choice="${color}" data-color="${color}" aria-label="${color}" aria-pressed="${group.color === color}" title="${color}"><i></i></button>`).join('');
  const pop = openPopover(anchor, `<div class="group-editor">
    <div class="menu-label">Tab group</div>
    <label>Group name<input class="input" data-group-name maxlength="40" value="${escapeHtml(group.title)}" aria-label="Group name"></label>
    <div class="menu-label">Color</div><div class="group-colors">${colors}</div>
    <button class="btn btn-primary btn-sm" data-group-save>Save group</button>
    <div class="menu-sep"></div>
    <button class="menu-item" data-group-action="newtab">${icon('plus')} New tab in group</button>
    <button class="menu-item" data-group-action="collapse">${icon('split')} ${group.collapsed ? 'Expand group' : 'Collapse group'}</button>
    <button class="menu-item" data-group-action="ungroup">${icon('x')} Ungroup tabs</button>
    <button class="menu-item danger" data-group-action="close">${icon('trash')} Close group</button>
  </div>`, { className: 'menu group-editor-menu', label: 'Tab group options' });
  if (!pop) return;
  pop.el.addEventListener('click', (e) => {
    const color = e.target.closest('[data-group-color-choice]');
    if (color) {
      pop.el.querySelectorAll('[data-group-color-choice]').forEach((button) => button.setAttribute('aria-pressed', String(button === color)));
      return;
    }
    const action = e.target.closest('[data-group-action]')?.dataset.groupAction;
    if (e.target.closest('[data-group-save]')) {
      const selectedColor = pop.el.querySelector('[data-group-color-choice][aria-pressed="true"]')?.dataset.groupColorChoice || group.color;
      tabs.updateGroup(groupId, { title: pop.el.querySelector('[data-group-name]').value, color: selectedColor });
      pop.close();
      return;
    }
    if (!action) return;
    pop.close();
    if (action === 'newtab') tabs.add('vespera://newtab', { groupId, besideId: tabs.activeId });
    if (action === 'collapse') tabs.toggleGroup(groupId);
    if (action === 'ungroup') tabs.ungroup(groupId);
    if (action === 'close') tabs.closeGroup(groupId);
  });
  pop.el.querySelector('[data-group-name]')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); pop.el.querySelector('[data-group-save]')?.click(); }
  });
}

function openTabContextMenu(id, anchor) {
  const tab = tabs.tabs.find((item) => item.id === id);
  if (!tab || !anchor) return;
  const item = (action, ic, label) => `<button class="menu-item" data-action="${action}">${icon(ic)} ${label}</button>`;
  const groupsEnabled = state.settings.tabBehavior.tabGroupsEnabled !== false;
  const groupItems = groupsEnabled ? tabs.groups.filter((group) => group.id !== tab.groupId)
    .map((group) => `<button class="menu-item" data-group-move="${escapeHtml(group.id)}"><span class="tab-group-dot" data-group-color="${group.color}"></span> Move to ${escapeHtml(group.title)}</button>`).join('') : '';
  const pop = openPopover(anchor, `${item('pin', 'star', tab.pinned ? 'Unpin tab' : 'Pin tab')}
    ${item('duplicate', 'plus', 'Duplicate tab')}
    ${!tab._internal ? item('mute', tab.muted ? 'volume' : 'volumeOff', tab.muted ? 'Unmute tab' : 'Mute tab') : ''}
    ${item('others', 'x', 'Close other tabs')}
    ${item('close', 'x', 'Close tab')}
    <div class="menu-sep"></div>
    <div class="menu-label">Organize</div>
    ${groupsEnabled ? item('new-group', 'plus', 'Create group with this tab') : ''}
    ${groupsEnabled && tab.groupId ? item('ungroup', 'x', 'Remove from its group') : ''}
    ${groupItems ? `<div class="menu-label">Move to group</div>${groupItems}` : ''}`, { label: 'Tab actions', className: 'menu tab-actions-menu' });
  if (!pop) return;
  pop.el.querySelector('[data-action="new-group"]')?.toggleAttribute('disabled', state.settings.tabBehavior.tabGroupsEnabled === false);
  pop.el.addEventListener('click', (e) => {
    const destination = e.target.closest('[data-group-move]')?.dataset.groupMove;
    if (destination) { pop.close(); tabs.moveToGroup(id, destination); return; }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    pop.close();
    if (action === 'pin') tabs.togglePin(id);
    if (action === 'duplicate') tabs.duplicate(id);
    if (action === 'mute') toggleTabMute(id);
    if (action === 'others') tabs.closeOthers(id);
    if (action === 'close') tabs.close(id);
    if (action === 'ungroup') tabs.ungroupTab(id);
    if (action === 'new-group') {
      const group = tabs.createGroup('New group', id);
      if (group) requestAnimationFrame(() => openGroupEditor(group.id, document.querySelector(`[data-group-header="${CSS.escape(group.id)}"]`)));
    }
  });
}

function wireWindowControls() {
  document.body.classList.add(platform.isElectron ? 'electron' : 'web-preview');
  if (state.private) { document.body.classList.add('private-mode'); $('runtime-status').textContent = 'Private · not saved'; }
  else $('runtime-status').textContent = platform.isElectron ? 'Desktop · Chromium' : 'Live preview';
  const min = $('wc-min'), max = $('wc-max'), close = $('wc-close');
  if (platform.isElectron) {
    min.onclick = () => platform.minimize(); max.onclick = () => platform.maximize(); close.onclick = () => platform.close();
    window.vespera.on('window:maximized', (value) => { max.title = value ? 'Restore window' : 'Maximize window'; max.setAttribute('aria-label', max.title); max.classList.toggle('is-maximized', value); });
    return;
  }
  min.title = 'Minimize preview to dock';
  max.title = 'Enter / exit fullscreen';
  close.title = 'Hide preview (tabs are saved)';
  const hide = (description) => { persistSession(); $('app').classList.add('hidden'); $('web-window-dock').classList.remove('hidden'); $('dock-description').textContent = description; $('web-restore').focus(); };
  min.onclick = () => hide('Minimized. Your tabs are still here.');
  max.onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { state.set('extensions.focusMode', !state.settings.extensions.focusMode); toast('Fullscreen is unavailable here. Focus mode toggled instead.', 'info'); }
  };
  close.onclick = async () => { if (await confirmAction({ title: 'Hide Vespera preview?', message: 'Your tabs are saved on this device. A browser tab cannot close its own operating-system window; you can reopen this preview from the dock.', confirmText: 'Hide preview' })) hide('Preview hidden. Reopen whenever you’re ready.'); };
  $('web-restore').onclick = () => { $('app').classList.remove('hidden'); $('web-window-dock').classList.add('hidden'); tabs.active?.view && updateChromeFor(tabs.active); };
}
function paletteActions() {
  const go = (url) => () => navigate(url);
  return [
    { title: 'New Tab', icon: 'plus', kbd: 'Ctrl+T', run: () => tabs.add('vespera://newtab') },
    { title: 'Close Tab', icon: 'x', kbd: 'Ctrl+W', run: () => tabs.close(tabs.activeId) },
    { title: 'Reopen Closed Tab', icon: 'refresh', kbd: 'Ctrl+Shift+T', run: () => tabs.reopenClosed() || toast('No recently closed tabs.', 'info') },
    ...['settings', 'extensions', 'privacy', 'community', 'history', 'bookmarks', 'downloads', 'logs', 'account', 'welcome', 'updates'].map((page) => ({ title: 'Open ' + (INTERNAL_PAGES['vespera://' + page]?.title || page), icon: INTERNAL_PAGES['vespera://' + page]?.icon || 'sparkle', run: go('vespera://' + page) })),
    { title: 'Customize wallpaper & colors', icon: 'palette', run: go('vespera://settings#appearance') },
    { title: 'Toggle Theme', icon: 'moon', run: () => state.set('theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') },
    { title: 'Toggle Vertical Tabs', icon: 'split', run: () => state.set('tabLayout', state.settings.tabLayout === 'vertical' ? 'horizontal' : 'vertical') },
    { title: 'Reader View', icon: 'eye', run: () => openReader() },
    { title: 'Bookmark This Page', icon: 'star', kbd: 'Ctrl+D', run: bookmarkActive },
    { title: 'Clear Browsing History', icon: 'trash', run: async () => { if (await confirmAction({ title: 'Clear browsing history?', message: 'This removes history on this device and from your connected sync store.', confirmText: 'Clear history', danger: true })) { state.clearHistory(); toast('History cleared', 'ok'); } } },
  ];
}
function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    const field = /^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key === 'Escape') { closePopover(); if (paletteOpen()) closePalette(); closeFind(); return; }
    if (mod && e.shiftKey && key === 't') { e.preventDefault(); tabs.reopenClosed() || toast('No recently closed tabs.', 'info'); }
    else if (mod && e.shiftKey && key === 'n') { e.preventDefault(); if (platform.isElectron) window.vespera.window.incognito(); else toast('Private windows are available in the desktop app.', 'info'); }
    else if (mod && key === 'k') { e.preventDefault(); openPalette({ actions: paletteActions() }); }
    else if (mod && key === 'l') { e.preventDefault(); omnibox?.focus(); }
    else if (mod && key === 't') { e.preventDefault(); tabs.add('vespera://newtab'); }
    else if (mod && key === 'w' && !field) { e.preventDefault(); tabs.close(tabs.activeId); }
    else if (mod && key === 'd') { e.preventDefault(); bookmarkActive(); }
    else if (mod && key === 'r') { e.preventDefault(); reload(); }
    else if (mod && key === 'f') { if (platform.isElectron && !tabs.active?._internal) { e.preventDefault(); openFind(); } }
    else if (mod && key === 'p') { if (platform.isElectron && !tabs.active?._internal) { e.preventDefault(); platform.print(tabs.active.view); } }
    else if (mod && (key === '=' || key === '+')) { e.preventDefault(); setZoom(.1); }
    else if (mod && key === '-') { e.preventDefault(); setZoom(-.1); }
    else if (mod && key === '0') { e.preventDefault(); setZoom(0, true); }
    else if (mod && e.key === 'Tab') { e.preventDefault(); e.shiftKey ? tabs.prev() : tabs.next(); }
    else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
    else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
    else if (e.altKey && key === 'home') { e.preventDefault(); navigate(state.settings.homepage); }
    else if (e.key === 'F5') { e.preventDefault(); reload(); }
    else if (e.key === 'F11') { e.preventDefault(); $('wc-max').click(); }
    else if (!field && e.key === '/') { e.preventDefault(); omnibox?.focus(); }
  });
}
function persistSession() {
  if (state.private || !tabs) return;
  try { localStorage.setItem('vespera.session', JSON.stringify({
    tabs: tabs.tabs.map((t) => ({ url: t.url, title: t.title, pinned: t.pinned, muted: t.muted, groupId: t.groupId || null })),
    groups: tabs.groups.map((g) => ({ ...g })),
    activeIndex: tabs.tabs.findIndex((t) => t.id === tabs.activeId),
  })); } catch { /* Storage errors are reported by state saves. */ }
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(persistSession, 150); }

function boot() {
  state.saveSettings(); applyAppearance();
  previousDark = state.settings.extensions.darkPages;
  wireWindowControls();
  tabs = new TabManager({
    onMount: (tab) => openInTab(tab, tab.url, { push: false }),
    onActiveChange: updateChromeFor, onChange: scheduleSave,
    getSettings: () => state.settings,
    onContextMenu: openTabContextMenu,
    onGroupContextMenu: openGroupEditor,
    onToggleMute: toggleTabMute,
  });
  tabHover = initTabHover(tabs, () => state.settings);
  buildRail(); positionTabUI(); renderBookmarksBar();
  omnibox = initOmnibox({ onNavigate: (target) => navigate(target.value, { kind: target.kind }), isPreviewSearch: () => previewRestricted && !platform.isElectron });
  window.__vesperaNavigate = (t) => navigate(t.value, { kind: t.kind });
  $('btn-back').onclick = () => goBack(); $('btn-forward').onclick = () => goForward();
  $('btn-reload').onclick = () => tabs.active?.loading ? (platform.stop(tabs.active.view), tabs.update(tabs.active, { loading: false })) : reload();
  $('btn-home').onclick = () => navigate(state.settings.homepage || 'vespera://newtab');
  $('btn-newtab').onclick = $('btn-newtab-vt').onclick = () => tabs.add('vespera://newtab');
  $('btn-new-group').onclick = () => {
    const group = tabs.createGroup('New group');
    if (!group) return toast('Turn on Tab groups to create a group.', 'info');
    requestAnimationFrame(() => openGroupEditor(group.id, document.querySelector(`[data-group-header="${CSS.escape(group.id)}"]`)));
  };
  $('btn-bookmark').onclick = bookmarkActive;
  $('btn-palette').onclick = () => openPalette({ actions: paletteActions() });
  $('btn-menu').onclick = (e) => openMenu(e.currentTarget);
  $('btn-shields').onclick = (e) => toggleShields(e.currentTarget, tabs.active, { onNavigate: navigate, onReload: () => reload() });
  $('site-info').onclick = (e) => toggleShields(e.currentTarget, tabs.active, { onNavigate: navigate, onReload: () => reload() });
  $('preview-details').onclick = (e) => openPopover(e.currentTarget, `<div class="menu-label">Vespera is running live</div><p class="popover-copy">Tabs, Home, search, settings, extensions, downloads and customization work right here — no setup needed. Some websites restrict embedded pages or are unreachable from this hosted environment; “Open original” visits them directly.</p><p class="popover-copy">Right-click pages, links and images for browser actions. Use the menu to install Vespera as a standalone app when your browser offers it.</p><button class="btn" data-dismiss>Got it</button>`, { className: 'popover info-popover', label: 'About this live browser' });
  $('dismiss-preview').onclick = () => $('preview-banner').classList.add('hidden');
  $('open-original').target = '_blank'; $('open-original').rel = 'noopener noreferrer';
  $('find-input').addEventListener('input', (e) => { $('find-count').textContent = ''; platform.find(tabs.active?.view, e.target.value); });
  $('find-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') platform.find(tabs.active?.view, e.target.value, { forward: !e.shiftKey, findNext: true }); });
  $('find-next').onclick = () => platform.find(tabs.active?.view, $('find-input').value, { forward: true, findNext: true });
  $('find-prev').onclick = () => platform.find(tabs.active?.view, $('find-input').value, { forward: false, findNext: true });
  $('find-close').onclick = closeFind;
  wireKeyboard(); wireContextMenus(); wireMiddleClickLinks();
  if (!platform.isElectron) {
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
    window.addEventListener('appinstalled', () => { installPrompt = null; toast('Vespera installed. Launch it from your apps.', 'ok'); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch((err) => diagnostic('App shell cache unavailable: ' + err.message));
  }
  bus.on('storage-error', (message) => toast(message, 'error', 6000));
  bus.on('sync-error', (message) => toast(message, 'error', 5000));
  bus.on('settings', () => {
    applyAppearance(); omnibox?.refreshEngine(); positionTabUI(); tabs.render(); renderBookmarksBar();
    tabHover?.close();
    tabs.focusActiveStrip();
    if (previousDark !== state.settings.extensions.darkPages) {
      previousDark = state.settings.extensions.darkPages;
      for (const tab of tabs.tabs) if (!tab._internal) platform.isWebview(tab.view) ? applyPageExtensions(tab) : reload(tab);
    }
    if (tabs.active) { updateChromeFor(tabs.active); platform.setZoom(tabs.active.view, tabs.active.zoom); }
  });
  bus.on('bookmarks', () => { renderBookmarksBar(); if (tabs.active) updateChromeFor(tabs.active); });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (state.settings.theme === 'system') applyAppearance(); });
  let restored = false;
  if (!state.private) {
    try {
      const session = JSON.parse(localStorage.getItem('vespera.session') || 'null');
      if (Array.isArray(session?.tabs) && session.tabs.length) {
        const groups = Array.isArray(session.groups) ? session.groups.slice(0, 60) : [];
        tabs.groups = groups.filter((g) => g && typeof g.id === 'string' && /^group-[a-z0-9-]{1,80}$/i.test(g.id) && typeof g.title === 'string')
          .map((g) => ({ id: g.id, title: g.title.slice(0, 40) || 'New group', color: TAB_GROUP_COLORS.includes(g.color) ? g.color : 'blue', collapsed: Boolean(g.collapsed) }));
        const groupIds = new Set(tabs.groups.map((g) => g.id));
        for (const t of session.tabs.slice(0, 60)) if (safeTabUrl(t.url)) tabs.add(t.url, { title: t.title, pinned: t.pinned, muted: t.muted, groupId: groupIds.has(t.groupId) ? t.groupId : null, activate: false });
        if (tabs.tabs.length) { tabs.activate(tabs.tabs[Math.max(0, Math.min(session.activeIndex || 0, tabs.tabs.length - 1))].id); restored = true; }
      }
    } catch { diagnostic('Could not restore the previous session.'); }
  }
  if (!restored) tabs.add('vespera://newtab');
  initDownloads().catch((err) => diagnostic(err.message));
  if (platform.isElectron) {
    window.vespera.on('browser:new-tab', (request) => {
      const url = typeof request === 'string' ? request : request?.url;
      if (!safeTabUrl(url)) return;
      const active = tabs.active;
      tabs.add(url, { activate: typeof request === 'string' ? true : request.foreground !== false, besideId: active?.id, groupId: active?.groupId || null });
    });
    window.vespera.on('shield:stat', (event) => {
      const tab = tabs.tabs.find((t) => { try { return platform.inner(t.view)?.getWebContentsId?.() === event.webContentsId; } catch { return false; } });
      if (!tab) return;
      if (event.kind === 'reset') tab.shields = { blocked: 0, ads: 0, trackers: 0, cleaned: 0 };
      else if (['tracker', 'ad'].includes(event.kind)) { tab.shields[event.kind === 'tracker' ? 'trackers' : 'ads']++; tab.shields.blocked++; state.recordBlock(event.kind, event.host); }
      else if (event.kind === 'link') { tab.shields.cleaned += event.count || 1; state.recordBlock('link', event.host); }
      tabs.update(tab);
    });
    window.vespera.on('menu:action', (action) => {
      const actions = { newtab: () => tabs.add('vespera://newtab'), reopen: () => tabs.reopenClosed(), closetab: () => tabs.close(tabs.activeId), private: () => window.vespera.window.incognito(), reload: () => reload(), find: openFind, 'zoom-in': () => setZoom(.1), 'zoom-out': () => setZoom(-.1), 'zoom-reset': () => setZoom(0, true), back: () => goBack(), forward: () => goForward(), home: () => navigate(state.settings.homepage), palette: () => openPalette({ actions: paletteActions() }) };
      if (actions[action]) actions[action]();
      else if (INTERNAL_PAGES['vespera://' + action]) navigate('vespera://' + action);
    });
  }
  fetch('/api/health').then((r) => r.json()).then((health) => {
    previewRestricted = Boolean(health.previewRestricted); serviceVersion = health.version || '';
    omnibox?.refreshEngine();
    if (previewRestricted) $('preview-label').textContent = 'Live browser · GitHub search & browsing ready · Some sites may be limited';
    for (const tab of tabs.tabs) if (tab._internal && internalPageKey(tab.url) === 'vespera://newtab') renderInternalPage(tab.view, tab.url, tab);
  }).catch(() => { $('preview-label').textContent = 'Live browser · Local service unavailable'; });
  window.addEventListener('beforeunload', persistSession);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persistSession(); });
  if (api.getToken() && !state.private) api.auth.me().then((r) => {
    if (r.ok) state.setUser(r.user);
    else if (r.status === 401) state.clearSession();
  });
}
boot();
