/** Real Chromium UI regression tests. Run: npx playwright install chromium && npm run test:ui */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
process.env.VESPERA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'vespera-ui-'));
process.env.VESPERA_PROXY_ALLOW_PRIVATE = '1';
process.env.VESPERA_PROXY_ALLOWED_HOSTS = '127.0.0.1,api.github.com';
const { createServer } = require('../server/server.js');
const article = 'Vespera makes room for a calmer web. '.repeat(30);
const fixture = http.createServer((req, res) => {
  if (req.url.startsWith('/file.txt')) { res.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="hello.txt"' }); return res.end('Hello from Vespera'); }
  if (req.url.startsWith('/second')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<title>Second page</title><h1>Second page</h1><a href="/">Back to fixture</a>'); }
  if (req.url.startsWith('/headers')) { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(JSON.stringify({ gpc: req.headers['sec-gpc'], cookie: req.headers.cookie || null })); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<title>Fixture Home</title><article><h1>A readable article</h1><p>${article}</p></article><audio id="fixture-audio"></audio><a id="next" href="/second">Second page</a><a id="file" href="/file.txt" download="hello.txt">Download a file</a><script src="https://google-analytics.com/analytics.js"></script>`);
});
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const fixtureUrl = 'http://127.0.0.1:' + fixture.address().port;
const service = await createServer({ port: 0, host: '127.0.0.1' });
const base = 'http://127.0.0.1:' + service.port;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
const browser = await chromium.launch({ executablePath, headless: true, args: executablePath ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log('✓ ' + name); }
async function go(url) { await page.locator('#omni-input').fill(url); await page.locator('#omni-input').press('Enter'); }
async function menu(act) { await page.locator('#btn-menu').click(); await page.locator(`[data-act="${act}"]`).click(); }
try {
  await page.goto(base);
  await step('startup renders one real tab, live clock, visible window controls and wallpaper', async () => {
    assert.equal(await page.locator('#tabstrip .tab').count(), 1);
    assert.equal(await page.locator('#titlebar .brand').count(), 0, 'the tab row should not waste space on a brand label');
    assert.equal(await page.locator('#btn-new-group').count(), 1);
    const scrollbar = await page.locator('.page-scroll').evaluate((el) => ({ width: getComputedStyle(el).scrollbarWidth, webkitWidth: getComputedStyle(el, '::-webkit-scrollbar').width, radius: getComputedStyle(el, '::-webkit-scrollbar-thumb').borderRadius }));
    assert.equal(scrollbar.width, 'thin'); assert.equal(scrollbar.webkitWidth, '9px'); assert.match(scrollbar.radius, /999px/);
    assert.match(await page.locator('.nt-hero h1').textContent(), /Welcome to Vespera/);
    const before = await page.locator('#nt-time').textContent(); await page.waitForTimeout(1200); assert.notEqual(await page.locator('#nt-time').textContent(), before);
    for (const id of ['wc-min', 'wc-max', 'wc-close']) assert.equal(await page.locator('#' + id).isVisible(), true);
    const image = await page.locator('.nt-wallpaper').evaluate((el) => getComputedStyle(el).backgroundImage.match(/url\("?([^"\)]+)/)?.[1]);
    assert.ok(image); assert.equal((await page.request.get(image)).status(), 200);
  });
  await step('home search animates on focus/submit and right-click opens a page menu', async () => {
    await page.locator('#nt-input').focus(); assert.match(await page.locator('#nt-search').getAttribute('class'), /is-focused/);
    await page.locator('#nt-go').click(); assert.match(await page.locator('#nt-search').getAttribute('class'), /is-empty/);
    await page.locator('#nt-input').fill('vespera://settings'); await page.locator('#nt-go').click();
    assert.match(await page.locator('#nt-search').getAttribute('class'), /is-searching/);
    await page.waitForSelector('.settings-page'); await page.locator('#btn-back').click(); await page.waitForSelector('.nt-hero');
    await page.locator('.nt-hero h1').click({ button: 'right' }); assert.equal(await page.locator('.context-menu').count(), 1);
    assert.match(await page.locator('.context-menu').textContent(), /Customize home/); await page.keyboard.press('Escape');
  });
  await step('menu toggles closed on the same anchor and its live tab switches work', async () => {
    await page.locator('#btn-menu').click(); assert.equal(await page.locator('.browser-menu').count(), 1);
    const beside = page.locator('[data-pref="tabBehavior.openTabsNextToCurrent"]');
    assert.equal(await beside.getAttribute('aria-checked'), 'true');
    await beside.click(); assert.equal(await beside.getAttribute('aria-checked'), 'false');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vespera.settings')).tabBehavior.openTabsNextToCurrent), false);
    await beside.click(); assert.equal(await beside.getAttribute('aria-checked'), 'true');
    await page.locator('#btn-menu').click(); assert.equal(await page.locator('.browser-menu').count(), 0);
    await menu('tab-settings'); assert.match(await page.locator('#omni-input').inputValue(), /settings#tabs/);
    assert.equal(await page.locator('.settings-layout').count(), 1);
    await page.locator('[data-section="tabs"]').click();
    assert.equal(await page.locator('[data-setting="tabBehavior.middleClickOpensTab"]').isVisible(), true);
    assert.equal(await page.locator('[data-setting="tabBehavior.openTabsNextToCurrent"]').isChecked(), true);
    await page.locator('[data-setting="tabBehavior.hideCloseButtons"]').check();
    assert.equal(await page.locator('body').evaluate((el) => el.classList.contains('tabs-hide-close')), true);
    assert.equal(await page.locator('#tabstrip .tab.active .close').isVisible(), false);
    await page.locator('[data-setting="tabBehavior.hideCloseButtons"]').uncheck();
    await page.locator('[data-setting="tabBehavior.scrollableTabStrip"]').uncheck();
    assert.equal(await page.locator('body').evaluate((el) => el.classList.contains('tabs-no-scroll')), true);
    await page.locator('[data-setting="tabBehavior.scrollableTabStrip"]').check();
    await page.locator('[data-setting="tabBehavior.tabGroupsEnabled"]').uncheck();
    assert.equal(await page.locator('body').evaluate((el) => el.classList.contains('tab-groups-disabled')), true);
    await page.locator('[data-setting="tabBehavior.tabGroupsEnabled"]').check();
    const audioMode = page.locator('[data-setting-select="tabBehavior.tabAudioMode"]');
    await audioMode.selectOption('indicator'); assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vespera.settings')).tabBehavior.tabAudioMode), 'indicator');
    await audioMode.selectOption('hidden'); await audioMode.selectOption('click-to-mute');
    const hoverMode = page.locator('[data-setting-select="tabBehavior.tabHoverMode"]');
    await hoverMode.selectOption('preview'); assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vespera.settings')).tabBehavior.tabHoverMode), 'preview');
    await hoverMode.selectOption('tooltip'); await hoverMode.selectOption('card');
    await page.locator('[data-setting="tabBehavior.memoryUsageOnHover"]').uncheck();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vespera.settings')).tabBehavior.memoryUsageOnHover), false);
    await page.locator('[data-setting="tabBehavior.memoryUsageOnHover"]').check();
    const inactive = page.locator('[data-segment="tabBehavior.inactiveTabAppearance"]');
    await inactive.locator('[data-v="dimmed"]').click(); assert.equal(await page.locator('body').evaluate((el) => el.classList.contains('tabs-inactive-dimmed')), true);
    await inactive.locator('[data-v="minimal"]').click(); assert.equal(await page.locator('body').evaluate((el) => el.classList.contains('tabs-inactive-minimal')), true);
    await inactive.locator('[data-v="balanced"]').click();
  });
  await step('theme, accent, wallpaper, homepage and clock toggles persist', async () => {
    await page.locator('[data-segment="theme"] [data-v="light"]').click(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.locator('[data-accent="teal"]').click(); assert.equal(await page.locator('html').getAttribute('data-accent'), 'teal');
    await page.locator('[data-wallpaper="aurora"]').click();
    await page.locator('[data-setting="clock24"]').check();
    await page.locator('#sel-homepage').selectOption('vespera://welcome');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vespera.settings')));
    assert.equal(saved.theme, 'light'); assert.equal(saved.accent, 'teal'); assert.equal(saved.wallpaper.id, 'aurora'); assert.equal(saved.clock24, true); assert.equal(saved.homepage, 'vespera://welcome');
    await page.locator('#btn-home').click(); assert.match(await page.locator('.welcome-hero').textContent(), /Welcome to Vespera/);
    await page.locator('#btn-back').click(); assert.match(await page.locator('#omni-input').inputValue(), /settings/);
    await page.locator('#btn-forward').click(); assert.match(await page.locator('.welcome-hero').textContent(), /Welcome to Vespera/);
  });
  await step('vertical tabs retain a working omnibox; all four built-in extensions render', async () => {
    await go('vespera://settings'); await page.locator('[data-segment="tabLayout"] [data-v="vertical"]').click();
    assert.equal(await page.locator('#omni-input').count(), 1); assert.equal(await page.locator('#toolbar').isVisible(), true);
    await go('vespera://extensions'); assert.equal(await page.locator('.extension-card').count(), 4);
    await page.locator('[data-ext-toggle="focusMode"]').check(); assert.equal(await page.locator('#sidebar').isVisible(), false);
    await page.locator('[data-ext-toggle="focusMode"]').uncheck(); assert.equal(await page.locator('#sidebar').isVisible(), true);
    await go('vespera://settings'); await page.locator('[data-segment="tabLayout"] [data-v="horizontal"]').click();
  });
  await step('new, close and reopen tab keyboard controls', async () => {
    await page.keyboard.press('Control+t'); assert.equal(await page.locator('#tabstrip .tab').count(), 2);
    await page.locator('#omni-input').blur(); await page.keyboard.press('Control+w'); assert.equal(await page.locator('#tabstrip .tab').count(), 1);
    await page.keyboard.press('Control+Shift+t'); assert.equal(await page.locator('#tabstrip .tab').count(), 2);
  });
  await step('tabs animate open/close and close buttons stay smooth and compact', async () => {
    await page.locator('#tabstrip .tab.active .close').click();
    assert.equal(await page.locator('#tabstrip .tab').count(), 1);
    assert.ok(await page.locator('.tab-exit-ghost').count() >= 1);
    await page.waitForFunction(() => !document.querySelector('.tab-exit-ghost'));
    await page.keyboard.press('Control+t');
    assert.equal(await page.locator('#tabstrip .tab').count(), 2);
    assert.equal(await page.locator('#tabstrip .tab-enter').count(), 1);
    await page.waitForFunction(() => !document.querySelector('#tabstrip .tab-enter'));
    const radius = await page.locator('#tabstrip .tab.active .close').evaluate((el) => getComputedStyle(el).borderRadius);
    assert.match(radius, /50%/);
    const windowClose = await page.locator('#wc-close').boundingBox(); assert.ok(windowClose.width <= 32 && windowClose.height <= 32);
    await page.keyboard.press('Control+w'); assert.equal(await page.locator('#tabstrip .tab').count(), 1);
  });
  await step('tab groups rename, color, collapse, expand and persist', async () => {
    await page.locator('#tabstrip .tab.active').click({ button: 'right' });
    await page.waitForSelector('.tab-actions-menu');
    await page.locator('.tab-actions-menu [data-action="new-group"]').click();
    await page.waitForSelector('.group-editor-menu');
    await page.locator('[data-group-name]').fill('Weekend plans');
    await page.locator('[data-group-color-choice="pink"]').click();
    await page.locator('[data-group-save]').click();
    const header = page.locator('.tab-group-header');
    await page.waitForFunction(() => document.querySelector('.tab-group-header')?.textContent.includes('Weekend plans'));
    const groupId = await header.getAttribute('data-group-header');
    assert.equal(await header.getAttribute('data-group-color'), 'pink');
    await header.locator('[data-group-menu]').click();
    await page.locator('[data-group-action="newtab"]').click();
    await page.waitForFunction((id) => document.querySelectorAll(`#tabstrip [data-id][data-group-id="${id}"]`).length === 2, groupId);
    await page.locator(`#tabstrip [data-group-toggle="${groupId}"]`).click();
    assert.equal(await page.locator(`#tabstrip [data-group-toggle="${groupId}"]`).getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator(`#tabstrip [data-id][data-group-id="${groupId}"]`).count(), 0);
    await page.locator(`#tabstrip [data-group-toggle="${groupId}"]`).click();
    assert.equal(await page.locator(`#tabstrip [data-id][data-group-id="${groupId}"]`).count(), 2);
    await go('vespera://settings#tabs');
    await page.locator('#content > .page-scroll:not(.hidden) #tabs [data-segment="tabLayout"] [data-v="vertical"]').click();
    await page.waitForSelector(`#vtabs-list [data-group-header="${groupId}"]`);
    assert.equal(await page.locator(`#vtabs-list [data-id][data-group-id="${groupId}"]`).count(), 2);
    await page.locator(`#vtabs-list [data-group-toggle="${groupId}"]`).click();
    assert.equal(await page.locator(`#vtabs-list [data-id][data-group-id="${groupId}"]`).count(), 0);
    await page.locator(`#vtabs-list [data-group-toggle="${groupId}"]`).click();
    await page.locator('#content > .page-scroll:not(.hidden) #tabs [data-segment="tabLayout"] [data-v="horizontal"]').click();
    await page.waitForTimeout(220); await page.reload(); await page.waitForSelector('#tabstrip .tab.active');
    assert.equal(await page.locator('.tab-group-header').textContent().then((text) => text.includes('Weekend plans')), true);
    assert.equal(await page.locator('.tab-group-header').getAttribute('data-group-color'), 'pink');
    await page.locator('.tab-group-header [data-group-menu]').click();
    await page.locator('[data-group-action="ungroup"]').click();
    assert.equal(await page.locator('.tab-group-header').count(), 0);
    assert.equal(await page.locator('#tabstrip .tab').count(), 2);
  });
  await step('proxy browsing, middle-click tabs, title updates, link navigation, back and reload', async () => {
    await go(fixtureUrl + '/?utm_source=test');
    await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
    assert.equal(await page.locator('#omni-input').inputValue(), fixtureUrl + '/');
    const frame = page.frames().find((f) => f.url().includes('/proxy?'));
    await page.locator('#tabstrip .tab.active').hover();
    await page.waitForSelector('.tab-hovercard');
    assert.match(await page.locator('.tab-hovercard').textContent(), /Fixture Home/);
    await page.mouse.move(700, 400);
    await page.locator('#tabstrip .tab.active').click({ button: 'right' });
    await page.locator('.tab-actions-menu [data-action="mute"]').click();
    await frame.waitForFunction(() => document.querySelector('#fixture-audio')?.muted === true);
    assert.equal(await page.locator('#tabstrip .tab.active [data-audio-toggle]').getAttribute('aria-label'), 'Unmute Fixture Home');
    await page.locator('#tabstrip .tab.active [data-audio-toggle]').click();
    await frame.waitForFunction(() => document.querySelector('#fixture-audio')?.muted === false);
    const before = await page.locator('#tabstrip .tab').evaluateAll((rows) => rows.map((row) => row.dataset.id));
    const activeId = await page.locator('#tabstrip .tab.active').getAttribute('data-id');
    await frame.locator('#next').click({ button: 'middle' });
    await page.waitForFunction((count) => document.querySelectorAll('#tabstrip .tab').length === count, before.length + 1);
    const afterMiddle = await page.locator('#tabstrip .tab').evaluateAll((rows) => rows.map((row) => row.dataset.id));
    const openedId = afterMiddle.find((id) => !before.includes(id));
    assert.equal(await page.locator('#tabstrip .tab.active').getAttribute('data-id'), activeId);
    assert.equal(afterMiddle.indexOf(openedId), afterMiddle.indexOf(activeId) + 1, 'middle-clicked links open immediately to the right');
    await page.waitForFunction((id) => document.querySelector(`#tabstrip [data-id="${id}"] .title`)?.textContent === 'Second page', openedId);
    await page.locator(`#tabstrip .tab[data-id="${openedId}"]`).click({ button: 'middle' });
    assert.equal(await page.locator('#tabstrip .tab').count(), before.length, 'middle-click on a tab closes it');
    await frame.locator('#next').click({ button: 'right' });
    await page.waitForSelector('.context-menu'); assert.match(await page.locator('.context-menu').textContent(), /Open link in new tab/); await page.keyboard.press('Escape');
    await frame.locator('#next').click();
    await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Second page');
    await page.locator('#btn-back').click();
    await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
    await page.locator('#btn-reload').click();
    await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
  });
  await step('tab hover previews, tooltip mode, memory hint and inactive appearance work', async () => {
    const activeSetting = (selector) => page.locator('#content > .page-scroll:not(.hidden) ' + selector);
    await page.keyboard.press('Control+t'); await go('vespera://settings#tabs');
    await activeSetting('[data-setting-select="tabBehavior.tabHoverMode"]').selectOption('preview');
    await page.locator('#omni-input').blur(); await page.keyboard.press('Control+w');
    await page.locator('#tabstrip .tab.active').hover(); await page.waitForSelector('.tab-hovercard.has-preview');
    assert.match(await page.locator('.tab-hovercard').textContent(), /Page snapshots are available in the desktop app/);
    assert.match(await page.locator('.tab-hovercard').textContent(), /Memory estimate unavailable in web preview/);
    await page.mouse.move(700, 400);
    await page.keyboard.press('Control+t'); await go('vespera://settings#tabs');
    await activeSetting('[data-setting-select="tabBehavior.tabHoverMode"]').selectOption('tooltip');
    await activeSetting('[data-setting="tabBehavior.memoryUsageOnHover"]').uncheck();
    const inactive = activeSetting('[data-segment="tabBehavior.inactiveTabAppearance"]');
    await inactive.locator('[data-v="dimmed"]').click(); assert.equal(await page.locator('body').evaluate((el) => el.classList.contains('tabs-inactive-dimmed')), true);
    await inactive.locator('[data-v="minimal"]').click(); assert.equal(await page.locator('body').evaluate((el) => el.classList.contains('tabs-inactive-minimal')), true);
    await page.locator('#omni-input').blur(); await page.keyboard.press('Control+w');
    await page.locator('#tabstrip .tab.active').hover(); await page.waitForTimeout(450);
    assert.equal(await page.locator('.tab-hovercard').count(), 0, 'tooltip-only mode should use the native tab tooltip when memory is off');
    assert.match(await page.locator('#tabstrip .tab.active').getAttribute('title'), /Fixture Home/);
    await page.mouse.move(700, 400);
    await page.keyboard.press('Control+t'); await go('vespera://settings#tabs');
    await activeSetting('[data-setting-select="tabBehavior.tabHoverMode"]').selectOption('card');
    await activeSetting('[data-setting="tabBehavior.memoryUsageOnHover"]').check();
    await activeSetting('[data-setting-select="tabBehavior.tabAudioMode"]').selectOption('click-to-mute');
    await activeSetting('[data-segment="tabBehavior.inactiveTabAppearance"] [data-v="balanced"]').click();
    await page.locator('#omni-input').blur(); await page.keyboard.press('Control+w');
  });
  await step('Shields block a real tracker resource and update the badge', async () => {
    await page.waitForFunction(() => Number(document.querySelector('#shield-count')?.textContent) > 0);
    assert.ok(Number(await page.locator('#shield-count').textContent()) >= 1);
  });
  await step('Privacy Hub controls, live stats and per-site exceptions work', async () => {
    await go('vespera://privacy'); await page.waitForSelector('.privacy-hub');
    assert.ok(Number(await page.locator('#hub-total').textContent()) >= 1);
    await page.locator('#hub-enabled').uncheck();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vespera.settings')).shields.enabled), false);
    await page.locator('#hub-enabled').check();
    await page.locator('#hub-blockAds').uncheck();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vespera.settings')).shields.blockAds), false);
    await page.locator('#hub-blockAds').check();
    await page.locator('#hub-site-enabled').uncheck();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vespera.settings')).allowlist['127.0.0.1']), true);
    assert.equal(await page.locator('.hub-exception').count(), 1);
    await page.locator('[data-remove-exception]').click(); assert.equal(await page.locator('.hub-exception').count(), 0);
    const settingsButton = await page.locator('#hub-settings').boundingBox(); assert.ok(settingsButton.height <= 34);
    await page.locator('#hub-return-site').click();
    await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
  });
  await step('bookmarks and history contain the visited page', async () => {
    await page.locator('#btn-bookmark').click(); await go('vespera://bookmarks'); assert.equal(await page.locator('.bm-card').count(), 1);
    await go('vespera://history'); assert.ok(await page.locator('.hist-row').count() >= 1);
  });
  await step('downloads retrieve a real file and report browser handoff', async () => {
    await go(fixtureUrl); await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
    const frame = page.frames().find((f) => f.url().includes('/proxy?'));
    const pending = page.waitForEvent('download'); await frame.locator('#file').click(); const download = await pending;
    assert.equal(download.suggestedFilename(), 'hello.txt');
    await go('vespera://downloads'); await page.waitForFunction(() => document.querySelector('#content > .page-scroll:not(.hidden) #d-list')?.textContent.includes('Sent to browser downloads'), null, { timeout: 20000 });
  });
  await step('Reader View extracts the last article and returns to the extensions page', async () => {
    await go(fixtureUrl); await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
    await go('vespera://extensions'); await page.locator('[data-ext-action="reader"]').click();
    await page.waitForSelector('#reader-text'); assert.match(await page.locator('#reader-text').textContent(), /calmer web/);
    await page.locator('#reader-back').click(); await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Extensions');
  });
  await step('restricted preview search has honest GitHub results and a full-web link', async () => {
    await page.route('**/proxy?**api.github.com**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify( { total_count: 1, items: [{ full_name: 'example/vespera', name: 'vespera', html_url: 'https://github.com/example/vespera', description: 'A test project', stargazers_count: 12, language: 'JavaScript', updated_at: '2026-11-07T00:00:00Z' }] }) }));
    await go('vespera://search?q=vespera'); await page.waitForSelector('.search-result'); assert.match(await page.locator('.search-result').textContent(), /A test project/);
    assert.match(await page.locator('.search-page').textContent(), /public GitHub repositories/);
  });
  await step('personal account registers, persists, syncs and signs in/out', async () => {
    await go('vespera://account'); await page.waitForSelector('.auth-card');
    const submitSize = await page.locator('#a-submit').boundingBox(); assert.ok(submitSize.height <= 36);
    await page.locator('#tab-register').click();
    await page.locator('#a-name').fill('Preview Tester');
    await page.locator('#a-email').fill('preview-tester@example.com');
    await page.locator('#a-pass').fill('correct-horse-battery');
    await page.locator('[data-toggle-password="a-pass"]').click(); assert.equal(await page.locator('#a-pass').getAttribute('type'), 'text');
    await page.locator('[data-toggle-password="a-pass"]').click();
    await page.locator('#a-submit').click(); await page.waitForSelector('#p-sync-now');
    assert.match(await page.locator('.profile-name').textContent(), /Preview Tester/);
    assert.ok(await page.evaluate(() => localStorage.getItem('vespera.token')));
    await page.waitForTimeout(250); await page.reload(); await page.waitForSelector('#p-sync-now');
    await page.locator('#p-sync-now').click(); await page.waitForFunction(() => document.querySelector('#p-sync-status')?.textContent === 'Synced');
    await page.locator('#p-signout').click(); await page.waitForSelector('#auth-form');
    assert.equal(await page.evaluate(() => localStorage.getItem('vespera.token')), null);
    await page.locator('#a-email').fill('preview-tester@example.com');
    await page.locator('#a-pass').fill('correct-horse-battery');
    await page.locator('#a-submit').click(); await page.waitForSelector('#p-sync-now');
    await page.locator('#p-signout').click(); await page.waitForSelector('#auth-form');
  });
  await step('release notes identify the running build and link to published installers', async () => {
    await menu('updates'); await page.waitForSelector('.updates-page');
    assert.match(await page.locator('.updates-page').textContent(), /0\.1\.3/);
    assert.match(await page.locator('.updates-page a[href*="releases"]').first().getAttribute('href'), /github\.com\/Makerxm800\/Vespera-beta\/releases/);
  });
  await step('session restores the active tab after a real reload', async () => {
    await go('vespera://settings'); await page.waitForTimeout(250); const count = await page.locator('#tabstrip .tab').count();
    await page.reload(); await page.waitForSelector('#tabstrip .tab.active'); assert.equal(await page.locator('#tabstrip .tab').count(), count); assert.match(await page.locator('#omni-input').inputValue(), /settings/);
  });
  await step('preview minimize/close are honest, reversible dock actions', async () => {
    await page.locator('#wc-min').click(); assert.equal(await page.locator('#app').isVisible(), false); await page.locator('#web-restore').click();
    await page.locator('#wc-close').click(); await page.locator('[data-cancel]').click(); assert.equal(await page.locator('#app').isVisible(), true);
    await page.locator('#wc-close').click(); await page.locator('[data-confirm]').click(); await page.locator('#app').waitFor({ state: 'hidden' }); await page.locator('#web-restore').click();
  });
  await step('standalone app manifest and shell worker are served', async () => {
    const manifest = await page.request.get(base + '/manifest.webmanifest'); assert.equal(manifest.status(), 200); assert.equal((await manifest.json()).display, 'standalone');
    assert.equal((await page.request.get(base + '/sw.js')).status(), 200);
    assert.equal((await page.request.get(base + '/assets/icon-512.png')).status(), 200);
  });
  await step('small viewport keeps controls on screen without horizontal overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await go('vespera://newtab');
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth })); assert.ok(size.scroll <= size.width + 1);
    assert.equal(await page.locator('#wc-min').isVisible(), true); assert.equal(await page.locator('#btn-menu').isVisible(), true);
    for (const route of ['vespera://privacy', 'vespera://account', 'vespera://settings#tabs']) {
      await go(route); await page.waitForTimeout(120);
      const fit = await page.evaluate(() => { const el = document.querySelector('.page-scroll:not(.hidden)'); return el.scrollWidth <= el.clientWidth + 1; });
      assert.ok(fit, route + ' fits a small viewport');
    }
  });
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log(`\n${passed} browser UI checks passed; no uncaught errors.`);
} finally {
  await browser.close();
  service.server.closeAllConnections?.(); await new Promise((resolve) => service.server.close(resolve));
  fixture.closeAllConnections?.(); await new Promise((resolve) => fixture.close(resolve));
}
