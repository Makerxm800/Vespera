/**
 * Renderer smoke test: boots the real Vespera chrome in jsdom and drives the
 * UI the way a user does — menu, pages, extension controls, access panel,
 * inspect, hover cards. Runs on `npm test` with no browser binary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

/**
 * The app schedules long-lived timers at boot (the memory-saver sweep runs
 * every minute in a real browser). A test process must exit when the suite
 * ends, so track every interval created from here on and clear them after
 * the tests — otherwise the runner hangs forever waiting on them.
 */
const bootTimers = [];
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => {
  const id = realSetInterval(...args);
  bootTimers.push(id);
  return id;
};
// Clear them once the suite is done, or the runner waits on them forever.
test.after(() => {
  for (const id of bootTimers) clearInterval(id);
});

const html = readFileSync(fileURLToPath(new URL('../src/renderer/index.html', import.meta.url)), 'utf8');

/** Fakes for the desktop (Tauri) surface the renderer probes through window.vespera. */
const EXT_ALL = 'a'.repeat(32), EXT_SITE = 'b'.repeat(32), EXT_BARE = 'c'.repeat(32), EXT_NONE = 'd'.repeat(32);
const FAKE_EXTENSIONS = [
  { id: EXT_ALL, name: 'All Sites Guard', version: '1.2.0', enabled: true, description: 'Guards every site.', permissions: ['storage', 'tabs'], hostPermissions: ['<all_urls>'], popup: true, options: '', actionTitle: 'All Sites Guard', icon: null },
  { id: EXT_SITE, name: 'Site Tools', version: '0.9.1', enabled: true, description: 'Tools for example sites.', permissions: ['activeTab'], hostPermissions: ['*://*.example.com/*'], popup: false, options: 'options.html', actionTitle: '', icon: null },
  { id: EXT_BARE, name: 'Bare Worker', version: '0.4.0', enabled: true, description: 'Runs without any UI.', permissions: ['alarms'], hostPermissions: [], popup: false, options: '', actionTitle: '', icon: null },
  { id: EXT_NONE, name: 'Quiet Notes', version: '2.0.0', enabled: false, description: 'Local notes only.', permissions: ['storage'], hostPermissions: [], popup: true, options: '', actionTitle: 'Quiet Notes', icon: null },
];

const calls = { inspectTab: [], checkUpdate: 0, installUpdate: 0, downloads: [] };

function makeVespera() {
  return {
    app: {
      checkUpdate: async () => { calls.checkUpdate++; return { ok: true, current: '0.1.9', latest: '0.2.0', hasUpdate: true, publishedAt: '2026-11-15T00:00:00Z', notes: 'New stuff.' }; },
      installUpdate: async (release) => { calls.installUpdate++; return { ok: true, latest: release.latest, message: 'Downloaded and launching the installer.' }; },
      inspectTab: async (contentsId, x, y) => { calls.inspectTab.push({ contentsId, x, y }); return { ok: true }; },
      download: async (url, options) => { calls.downloads.push({ url, options }); return { ok: true }; },
      chooseDownloadFolder: async () => ({ ok: true, path: '/tmp/vespera-downloads' }),
      tabMemory: async () => ({ ok: true, bytes: 512 * 1024 * 1024 }),
    },
    extensions: {
      list: async () => FAKE_EXTENSIONS,
      enable: async (id) => { const ext = FAKE_EXTENSIONS.find((e) => e.id === id); if (ext) ext.enabled = true; return { ok: true, extensions: FAKE_EXTENSIONS }; },
      disable: async (id) => { const ext = FAKE_EXTENSIONS.find((e) => e.id === id); if (ext) ext.enabled = false; return { ok: true, extensions: FAKE_EXTENSIONS }; },
      install: async () => ({ ok: true, name: 'Installed', extensions: FAKE_EXTENSIONS }),
      installFromStore: async () => ({ ok: true, name: 'Installed', extensions: FAKE_EXTENSIONS }),
      loadUnpacked: async () => ({ ok: true, name: 'Unpacked', extensions: FAKE_EXTENSIONS }),
      remove: async (id) => { const i = FAKE_EXTENSIONS.findIndex((e) => e.id === id); if (i >= 0) FAKE_EXTENSIONS.splice(i, 1); return { ok: true, extensions: FAKE_EXTENSIONS }; },
    },
    window: { isPrivate: false, minimize() {}, maximize() {}, close() {}, toggleFullscreen() {}, incognito() {} },
    on: () => {},
  };
}

let dom, window, document, state, bridge, tauriInternals, originalProcess;

async function boot() {
  dom = new JSDOM(html, { url: 'https://vespera.local/', runScripts: 'outside-only' });
  window = dom.window;
  document = window.document;
  originalProcess = window.process;

  // Minimal browser-API polyfills jsdom lacks.
  const mql = (query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
  window.matchMedia = (query) => mql(query);
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};
  // Lightweight rAF that doesn't keep the event loop alive like pretendToBeVisual.
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ previewRestricted: false, version: '0.1.9' }) });
  // The Tauri shell injects __TAURI_INTERNALS__; the renderer bridge turns it
  // into window.vespera. The smoke test simulates the desktop the same way.
  window.__TAURI_INTERNALS__ = {
    invoke: async () => ({ ok: true }),
    listen: async () => () => {},
  };
  tauriInternals = window.__TAURI_INTERNALS__;
  window.vespera = makeVespera();

  // Webviews in the real desktop expose these — give jsdom's elements the same
  // surface so capturePreview/memory/inspect paths run for real.
  window.HTMLElement.prototype.getWebContentsId = function getWebContentsId() { return 42; };
  window.HTMLElement.prototype.capturePage = async function capturePage() {
    const image = {
      isEmpty: () => false,
      getSize: () => ({ width: 640, height: 360 }),
      resize: () => image,
      toDataURL: () => 'data:image/png;base64,TESTPREVIEW',
    };
    return image;
  };
  const iframeWindows = new WeakMap();
  Object.defineProperty(window.HTMLIFrameElement.prototype, 'contentWindow', {
    configurable: true,
    get() {
      if (!iframeWindows.has(this)) {
        const guestWindow = {
          postMessage(message) {
            if (message?.type !== 'vespera:capture-preview') return;
            const event = new window.MessageEvent('message', { data: {
              type: 'vespera:preview', id: message.id, image: 'data:image/jpeg;base64,TESTPREVIEW',
            } });
            Object.defineProperty(event, 'source', { value: guestWindow });
            window.setTimeout(() => window.dispatchEvent(event), 0);
          },
        };
        iframeWindows.set(this, guestWindow);
      }
      return iframeWindows.get(this);
    },
  });

  // Expose the jsdom realm as Node globals so the renderer modules resolve
  // window/document/localStorage/matchMedia the same way as in the browser.
  const setGlobal = (name, value) => {
    try { global[name] = value; } catch { Object.defineProperty(global, name, { value, configurable: true, writable: true }); }
  };
  setGlobal('window', window);
  setGlobal('document', document);
  setGlobal('location', window.location);
  setGlobal('navigator', window.navigator);
  setGlobal('localStorage', window.localStorage);
  setGlobal('matchMedia', window.matchMedia);
  setGlobal('fetch', window.fetch);
  setGlobal('CSS', window.CSS);
  setGlobal('Event', window.Event);
  setGlobal('CustomEvent', window.CustomEvent);
  setGlobal('MouseEvent', window.MouseEvent);
  setGlobal('KeyboardEvent', window.KeyboardEvent);
  setGlobal('PointerEvent', window.PointerEvent || window.MouseEvent);
  setGlobal('FocusEvent', window.FocusEvent);
  setGlobal('InputEvent', window.InputEvent);
  setGlobal('getComputedStyle', window.getComputedStyle.bind(window));
  setGlobal('requestAnimationFrame', window.requestAnimationFrame);
  setGlobal('cancelAnimationFrame', window.cancelAnimationFrame);
  setGlobal('AbortController', window.AbortController);
  setGlobal('AbortSignal', window.AbortSignal);
  setGlobal('innerWidth', window.innerWidth);
  setGlobal('innerHeight', window.innerHeight);

  await import('../src/renderer/js/state.js').then((m) => { state = m.state; });
  await import('../src/renderer/js/app-bridge.js').then((m) => { bridge = m.bridge; });
  await import('../src/renderer/js/app.js'); // calls boot() on import
  await new Promise((resolve) => setTimeout(resolve, 60));
  return { window, document, state, bridge };
}

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const click = (el) => el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const contextMenuAt = (el, x = 100, y = 100) => el?.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
const pointer = (type, el) => el?.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: 120, clientY: 40 }));
const menuOpen = () => document.querySelector('.browser-menu');
/** Popovers close on an outside pointerdown — mirror that in jsdom. */
const closePopovers = () => document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
const activePage = (selector) => [...document.querySelectorAll(selector)].find((el) => !el.closest('.page-scroll')?.classList.contains('hidden'));
const siteTabRow = () => [...document.querySelectorAll('#tabstrip .tab')].find((row) => row.getAttribute('aria-label') === 'example.com');

test.before(async () => {
  await boot();
});

test('Vespera renderer boots in jsdom and renders its chrome', async () => {
  assert.ok(document.querySelector('#tabstrip'), 'tab strip exists');
  assert.equal(document.querySelectorAll('#tabstrip .tab').length, 1, 'starts with one new-tab page');
  assert.equal(state.settings.extensions.pinnedIds.length, 0);
});

test('browser menu: tab toggles are gone, check-for-updates is present', async () => {
  click(document.querySelector('#btn-menu'));
  const menu = menuOpen();
  assert.ok(menu, 'menu opens');
  assert.equal(menu.querySelectorAll('[data-pref]').length, 0, 'no tab toggles remain in the menu');
  assert.match(menu.textContent, /Check for updates/);
  assert.match(menu.textContent, /Tab settings/);
  // Opening Check for updates navigates to the updates page.
  click([...menu.querySelectorAll('[data-act]')].find((b) => b.dataset.act === 'check-update'));
  await tick();
  assert.ok(activePage('.updates-page'), 'navigates to the updates page');
  closePopovers();
});

test('updates page: check finds the update, install runs it', async () => {
  bridge.navigate('vespera://updates');
  await tick(80);
  assert.ok(document.querySelector('#update-check'), 'update button rendered');
  // Desktop builds auto-check on mount; wait for the result.
  await tick(60);
  const status = document.querySelector('#update-status').textContent;
  assert.match(status, /Update available/, 'status reports the available update');
  const install = document.querySelector('#update-install');
  assert.ok(install && !install.classList.contains('hidden'), 'install button appears');
  click(install);
  await tick(80);
  assert.equal(calls.installUpdate, 1, 'install calls the desktop updater');
  assert.match(document.querySelector('#update-status').textContent, /Installing/);
});

test('extensions page: the desktop shell shows the notice and keeps installs off', async () => {
  // The shipped Tauri app has no Chromium extension runtime — the page must
  // say so up front and offer no way to install third-party extensions.
  bridge.navigate('vespera://extensions');
  await tick(80);
  const page = activePage('.extensions-page');
  assert.ok(page, 'extensions page rendered');
  assert.equal(page.querySelectorAll('[data-section]').length, 5, 'General / Built-in / Installed / Access / Catalog');
  const notice = page.querySelector('.extension-notice');
  assert.ok(notice, 'notice explains the missing extension runtime');
  assert.match(notice.textContent, /Chrome extensions can.t run in this version of Vespera/);
  assert.match(page.querySelector('.extension-banner .chip').textContent, /built-in tools ready/, 'status chip reflects the native shell');
  assert.equal(page.querySelectorAll('#ext-external .extension-manager-card').length, 0, 'no third-party cards in the native shell');
  assert.match(page.querySelector('#ext-external').textContent, /No third-party extensions yet/, 'installed section explains the empty list');
  assert.ok(page.querySelector('#ext-open-store').hidden, 'store button hidden');
  assert.ok(page.querySelector('#ext-load').disabled, 'package install disabled');
  assert.ok([...page.querySelectorAll('#ext-grid .extension-card')].some((card) => card.textContent.includes('Shields')), 'built-in tools still render');
  assert.ok(page.querySelector('#ext-access'), 'access panel present');
  assert.match(page.querySelector('#ext-access').textContent, /Open a website to see its extension access/, 'empty access state without a site');
});

test('extensions page renders sections, cards and controls', async () => {
  // Third-party cards only load when the shell reports extension support (web
  // preview). Drop the desktop probe and re-render to exercise the manager UI.
  delete window.__TAURI_INTERNALS__;
  window.process = { versions: { electron: 'test' } };
  bridge.navigate('vespera://newtab');
  await tick(40);
  bridge.navigate('vespera://extensions');
  await tick(120);
  const page = activePage('.extensions-page');
  assert.ok(page, 'extensions page rendered');
  assert.equal(page.querySelectorAll('[data-section]').length, 5, 'General / Built-in / Installed / Access / Catalog');
  assert.ok(page.querySelector('#ext-access'), 'access panel present');
  assert.match(page.querySelector('#ext-access').textContent, /Open a website to see its extension access/, 'empty access state without a site');
  const cards = page.querySelectorAll('#ext-external .extension-manager-card');
  assert.equal(cards.length, 4, 'one card per installed extension');
  assert.ok(cards[0].querySelector('[data-enable-ext]'), 'enable switch present');
  assert.ok(cards[0].querySelector('[data-pin-toggle]'), 'pin switch present');
  assert.ok(cards[0].querySelector('[data-pin-ext]'), 'pin star button present');
  assert.ok(cards[0].querySelector('[data-details-ext]'), 'details button present');
  assert.match(cards[0].textContent, /On all sites/, 'all-sites access label');
  assert.match(cards[0].textContent, /Sees and changes every website/, 'capability line from host permissions');
  assert.match(cards[1].textContent, /No site access/, 'host-scoped extension needs a host to be labelled');
  assert.match(cards[1].textContent, /Options/, 'popup-less extension offers its options page');
  assert.match(cards[3].textContent, /Disabled/, 'disabled extension is labelled disabled');
  assert.match(cards[2].textContent, /Runs on a schedule/, 'capability line from declared permissions');
});

test('extension details popover lists permissions and site access', async () => {
  const page = activePage('.extensions-page');
  click(page.querySelector('[data-details-ext]'));
  const pop = document.querySelector('.extension-perms-popover');
  assert.ok(pop, 'details popover opens');
  assert.match(pop.textContent, /Site access/);
  assert.match(pop.textContent, /On all sites/);
  assert.match(pop.textContent, /storage/, 'declared permissions are listed');
  closePopovers();
  assert.ok(!document.querySelector('.extension-perms-popover'), 'popover closes');
});

test('pinning an extension from a card pins it and adds its toolbar action', async () => {
  const page = activePage('.extensions-page');
  const card = page.querySelector('#ext-external .extension-manager-card');
  click(card.querySelector('[data-pin-ext]'));
  await tick(40);
  assert.deepEqual(state.settings.extensions.pinnedIds, [EXT_ALL], 'pinned id is stored');
  const action = document.querySelector('#extension-actions [data-extension-action]');
  assert.ok(action, 'pinned extension action appears in the toolbar');
  // Unpinning removes it again.
  const cardAgain = document.querySelector('#ext-external .extension-manager-card');
  click(cardAgain.querySelector('[data-pin-ext]'));
  await tick(40);
  assert.deepEqual(state.settings.extensions.pinnedIds, [], 'unpin clears the id');
  assert.equal(document.querySelectorAll('#extension-actions [data-extension-action]').length, 0, 'toolbar action removed');
});

test('extension toolbar actions open popup, options or details — never nothing', async () => {
  // ext-site has no popup but ships an options page → opens it in a popover.
  const page = activePage('.extensions-page');
  click(page.querySelectorAll('#ext-external .extension-manager-card')[1].querySelector('[data-pin-ext]'));
  await tick(40);
  const action = [...document.querySelectorAll('#extension-actions [data-extension-action]')].find((b) => b.dataset.extensionAction === EXT_SITE);
  assert.ok(action, 'site tools is pinned to the toolbar');
  click(action);
  await tick(40);
  const optionsPop = document.querySelector('.extension-action-popover');
  assert.ok(optionsPop, 'popup-less extension opens its options page');
  assert.match(optionsPop.textContent, /Options/);
  closePopovers();
  // ext-bare has neither popup nor options → falls back to its details view.
  click(page.querySelectorAll('#ext-external .extension-manager-card')[2].querySelector('[data-pin-ext]'));
  await tick(40);
  const bareAction = [...document.querySelectorAll('#extension-actions [data-extension-action]')].find((b) => b.dataset.extensionAction === EXT_BARE);
  assert.ok(bareAction, 'bare worker is pinned to the toolbar');
  click(bareAction);
  await tick(40);
  assert.ok(document.querySelector('.extension-perms-popover'), 'extension with no popup or options opens its details');
  closePopovers();
  // Unpin both to keep later tests clean.
  for (const card of document.querySelectorAll('#ext-external .extension-manager-card')) {
    const name = card.querySelector('h3')?.textContent;
    if (name === 'Site Tools' || name === 'Bare Worker') click(card.querySelector('[data-pin-ext]'));
    await tick(30);
  }
  assert.deepEqual(state.settings.extensions.pinnedIds, [], 'cleanup unpinned both');
});

test('built-in extension toggles flip their settings', async () => {
  const page = activePage('.extensions-page');
  const before = state.settings.shields.enabled;
  const shieldCard = [...page.querySelectorAll('#ext-grid .extension-card')].find((card) => card.textContent.includes('Shields'));
  const input = shieldCard.querySelector('[data-ext-toggle]');
  input.checked = !input.checked;
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(40);
  assert.equal(state.settings.shields.enabled, !before, 'shields toggle reflects the switch');
});

test('access panel groups extensions for the site in the active website tab', async () => {
  // A website tab stays open behind the extensions page.
  bridge.openTab('https://example.com/');
  await tick(40);
  bridge.openTab('vespera://extensions');
  await tick(80);
  const access = activePage('.extensions-page').querySelector('#ext-access');
  assert.ok(access.querySelector('.access-group'), 'access groups rendered');
  const full = access.querySelectorAll('.access-group')[0];
  const none = access.querySelectorAll('.access-group')[1];
  assert.match(full.textContent, /Full access/);
  assert.match(full.textContent, /All Sites Guard/, 'all-sites extension lands in full access');
  assert.match(full.textContent, /Site Tools/, 'site-matching extension lands in full access');
  assert.match(none.textContent, /No access needed/);
  assert.match(none.textContent, /Quiet Notes/, 'disabled extension lands in no access');
  assert.match(none.textContent, /Bare Worker/, 'extension without site access lands in no access');
  // Per-extension card labels adapt to the active site.
  const siteCard = [...activePage('.extensions-page').querySelectorAll('#ext-external .extension-manager-card')].find((card) => card.textContent.includes('Site Tools'));
  assert.match(siteCard.textContent, /On this site/, 'site-scoped extension is labelled On this site');
  // The details popover lists every installed extension with its access level.
  click(access.querySelector('[data-access-details]'));
  const pop = document.querySelector('.extensions-menu');
  assert.ok(pop, 'access details popover opens');
  assert.match(pop.textContent, /All Sites Guard/);
  closePopovers();
  // Put the desktop probe back so the remaining tests run as the shipped app does.
  window.__TAURI_INTERNALS__ = tauriInternals;
  if (originalProcess === undefined) delete window.process;
  else window.process = originalProcess;
});

test('toolbar extensions menu has per-extension switches, pin and details', async () => {
  // Exercise the legacy Chromium shell explicitly; the native Tauri webview
  // is covered separately and intentionally exposes no Chrome extension APIs.
  const previousProcess = window.process;
  window.process = { versions: { electron: 'test' } };
  try {
  // The menu reads site access from the active tab — focus a website tab first.
  const siteRow = siteTabRow();
  assert.ok(siteRow, 'a website tab is open');
  click(siteRow);
  await tick(40);
  click(document.querySelector('#btn-extensions'));
  await tick(60);
  const menu = document.querySelector('.extensions-menu');
  assert.ok(menu, 'extensions menu opens');
  const rows = menu.querySelectorAll('.extension-menu-row');
  assert.equal(rows.length, 4, 'one row per installed extension');
  assert.ok(rows[0].querySelector('[data-ext-enable]'), 'on/off switch present');
  assert.ok(rows[0].querySelector('[data-ext-pin]'), 'pin button present');
  assert.ok(rows[0].querySelector('[data-ext-details]'), 'details button present');
  assert.match(rows[0].textContent, /On all sites/, 'row shows site access');
  // Turning an extension off from the menu disables it.
  const enable = rows[2].querySelector('[data-ext-enable]');
  enable.checked = false;
  enable.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(60);
  assert.equal(FAKE_EXTENSIONS.find((e) => e.id === EXT_BARE).enabled, false, 'disable was applied');
  closePopovers();
  } finally {
    if (previousProcess === undefined) delete window.process;
    else window.process = previousProcess;
  }
});

test('right-click site menu offers Inspect and invoking it hits the desktop API', async () => {
  bridge.openTab('https://example.com/');
  await tick(60);
  const content = document.querySelector('#content');
  contextMenuAt(content, 220, 180);
  await tick(30);
  const menu = document.querySelector('.context-menu');
  assert.ok(menu, 'site context menu opens');
  assert.match(menu.textContent, /Inspect/);
  const inspect = [...menu.querySelectorAll('[data-ctx]')].find((b) => b.dataset.ctx === 'inspect');
  assert.ok(inspect && !inspect.disabled, 'Inspect is enabled in the desktop build');
  click(inspect);
  await tick(30);
  assert.equal(calls.inspectTab.length, 1, 'Inspect calls the desktop inspector');
  assert.equal(calls.inspectTab[0].contentsId, 42, 'with the web contents id');
  closePopovers();
});

test('tab context menu offers Inspect for any tab', async () => {
  // Inspect opens for website tabs; internal pages have no page to inspect.
  const siteRow = siteTabRow();
  assert.ok(siteRow, 'a website tab is open');
  contextMenuAt(siteRow, 140, 30);
  await tick(30);
  const menu = document.querySelector('.tab-actions-menu');
  assert.ok(menu, 'tab context menu opens');
  assert.match(menu.textContent, /Inspect/);
  const inspect = [...menu.querySelectorAll('[data-tab-act]')].find((b) => b.dataset.tabAct === 'inspect');
  assert.ok(inspect && !inspect.disabled, 'Inspect is enabled for a website tab');
  click(inspect);
  await tick(30);
  assert.equal(calls.inspectTab.length, 2, 'tab menu Inspect calls the desktop inspector');
  closePopovers();
});

test('tab hover shows a card and follows the mouse to the next tab', async () => {
  state.set('tabBehavior.tabHoverMode', 'preview');
  // A second website tab with its own host so the hovered titles differ.
  bridge.openTab('https://news.example.com/');
  await tick(60);
  const siteRows = [...document.querySelectorAll('#tabstrip .tab')].filter((row) => ['example.com', 'news.example.com'].includes(row.getAttribute('aria-label')));
  assert.ok(siteRows.length >= 2, 'need at least two website tabs');
  pointer('pointerover', siteRows[siteRows.length - 1]);
  await tick(360);
  let card = document.querySelector('.tab-hovercard');
  assert.ok(card, 'hover card appears for the website tab');
  const firstTitle = card.querySelector('.tab-hovercard-copy strong').textContent;
  // Tauri renders proxied sites in sandboxed iframes; the guest bridge returns
  // an on-demand, size-limited snapshot to the requesting tab.
  await tick(80);
  card = document.querySelector('.tab-hovercard');
  assert.ok(card, 'hover card remains open after capture');
  assert.ok(card.querySelector('.tab-hovercard-copy strong'), 'hover card still shows the tab title');
  assert.ok(card.querySelector('.tab-hovercard-preview img'), 'Tauri iframe supplies a page snapshot');
  pointer('pointerover', siteRows[0]);
  await tick(520); // hover delay + crossfade handoff
  card = document.querySelector('.tab-hovercard');
  assert.ok(card, 'the same card is reused for the next tab');
  const secondTitle = card.querySelector('.tab-hovercard-copy strong').textContent;
  assert.notEqual(secondTitle, firstTitle, 'card content follows the hovered tab');
  pointer('pointerout', siteRows[0]);
  await tick(180);
  assert.ok(!document.querySelector('.tab-hovercard'), 'card closes when leaving the strip');
});

test('settings page renders every section and tab toggles live here', async () => {
  bridge.navigate('vespera://settings');
  await tick(80);
  assert.equal(document.querySelectorAll('.settings-layout .settings-nav a').length, 10, 'settings nav includes the new Updates section');
  for (const id of ['appearance', 'tabs', 'search', 'browser', 'privacy', 'extensions', 'downloads', 'updates', 'account', 'about']) {
    assert.ok(document.querySelector(`.settings-page .section#${id}`), `section ${id} rendered`);
  }
  assert.ok(document.querySelector('#settings-check-update'), 'updates section has its check button');
  const developerMode = document.querySelector('#extensions input[aria-label="Developer mode"]');
  assert.ok(developerMode.disabled && !developerMode.checked, 'unsupported Tauri developer mode is disabled and not shown as active');
  assert.match(document.querySelector('#extensions').textContent, /no Chrome extension runtime/i, 'extension copy matches the native shell');
  assert.equal(document.querySelector('[data-setting="privacy.automation"]'), null, 'no fake always-on automation control is presented');
  assert.match(document.querySelector('#privacy').textContent, /does not currently spoof or randomize browser fingerprinting signals/i);
  assert.match(document.querySelector('#about').textContent, /System webview desktop/);
  const askLocation = document.querySelector('[data-setting="askDownloadLocation"]');
  assert.ok(askLocation && !askLocation.disabled, 'desktop save-dialog preference is available in Tauri');
  askLocation.checked = false;
  askLocation.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(state.settings.askDownloadLocation, false, 'save-dialog preference changes state');
  click(document.querySelector('#choose-download-folder'));
  await tick(40);
  assert.equal(state.settings.downloadPath, '/tmp/vespera-downloads', 'folder selection persists');
  assert.equal(document.querySelector('#download-folder-label').textContent, '/tmp/vespera-downloads');
  await bridge.download('https://example.com/archive.zip', 'custom-name.zip');
  assert.deepEqual(calls.downloads.at(-1), {
    url: 'https://example.com/archive.zip',
    options: { name: 'custom-name.zip', askLocation: false, folder: '/tmp/vespera-downloads' },
  }, 'Tauri receives the selected filename and saved folder preference');
  // A tab-behavior switch in Settings changes state (the menu toggle is gone).
  const toggle = document.querySelector('[data-setting="tabBehavior.scrollableTabStrip"]');
  assert.ok(toggle, 'tab behavior toggle exists in Settings');
  const before = state.settings.tabBehavior.scrollableTabStrip;
  toggle.checked = !toggle.checked;
  toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(state.settings.tabBehavior.scrollableTabStrip, !before, 'settings switch persists');
});
