/** Real Chromium UI regression tests. Run: npx playwright install chromium && npm run test:ui */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const appVersion = require('../package.json').version;
process.env.VESPERA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'vespera-ui-'));
process.env.VESPERA_PROXY_ALLOW_PRIVATE = '1';
process.env.VESPERA_PROXY_ALLOWED_HOSTS = '127.0.0.1,api.github.com';
const { createServer } = require('../server/server.js');
const article = 'Vespera makes room for a calmer web. '.repeat(30);
const tinyWallpaperPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const fixture = http.createServer((req, res) => {
  if (req.url.startsWith('/file.txt')) { res.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="hello.txt"' }); return res.end('Hello from Vespera'); }
  if (req.url.startsWith('/second')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<title>Second page</title><h1>Second page</h1><a href="/">Back to fixture</a>'); }
  if (req.url.startsWith('/headers')) { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(JSON.stringify({ gpc: req.headers['sec-gpc'], cookie: req.headers.cookie || null })); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<title>Fixture Home</title><article><h1>A readable article</h1><p>${article}</p></article><audio id="fixture-audio"></audio><a id="next" href="/second">Second page</a><a id="blank" href="/second" target="_BLANK">Second page in a new tab</a><a id="file" href="/file.txt" download="hello.txt">Download a file</a><script src="https://google-analytics.com/analytics.js"></script>`);
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
    assert.equal(await page.locator('#rail [data-nav="vespera://settings"]').count(), 0, 'Settings is removed from the left rail');
    assert.equal(await page.locator('#vtabs-foot [data-nav="vespera://settings"]').count(), 0, 'Settings is removed from the vertical sidebar');
    assert.match(await page.locator('.nt-hero h1').textContent(), /Welcome to Vespera/);
    const before = await page.locator('#nt-time').textContent(); await page.waitForTimeout(1200); assert.notEqual(await page.locator('#nt-time').textContent(), before);
    for (const id of ['wc-min', 'wc-max', 'wc-close']) assert.equal(await page.locator('#' + id).isVisible(), true);
    const image = await page.locator('.nt-wallpaper').evaluate((el) => getComputedStyle(el).backgroundImage.match(/url\("?([^"\)]+)/)?.[1]);
    assert.ok(image); assert.equal((await page.request.get(image)).status(), 200);
  });
  await step('buttons and their icons share smooth hover, press and reduced-motion behavior', async () => {
    const control = page.locator('#btn-home');
    const transitions = await control.evaluate((el) => ({
      button: getComputedStyle(el).transitionProperty,
      icon: getComputedStyle(el.querySelector('svg')).transitionProperty,
    }));
    assert.match(transitions.button, /transform/);
    assert.match(transitions.icon, /transform/);
    await control.hover(); await page.waitForTimeout(280);
    assert.notEqual(await control.evaluate((el) => getComputedStyle(el).transform), 'none');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await control.evaluate((el) => getComputedStyle(el).transform), 'none');
    assert.equal(await control.locator('svg').evaluate((el) => getComputedStyle(el).animationName), 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.mouse.move(0, 0);
  });
  await step('home search, browser menu and Ctrl+, open the full internal Settings page', async () => {
    await page.locator('#nt-input').focus(); assert.match(await page.locator('#nt-search').getAttribute('class'), /is-focused/);
    await page.locator('#nt-go').click(); assert.match(await page.locator('#nt-search').getAttribute('class'), /is-empty/);
    await page.locator('#nt-input').fill('vespera://settings'); await page.locator('#nt-go').click();
    await page.waitForSelector('.settings-layout');
    assert.equal(await page.locator('.settings-layer').count(), 0, 'Settings no longer renders a floating panel');
    assert.match(await page.locator('#omni-input').inputValue(), /^vespera:\/\/settings/);
    assert.equal(await page.locator('#btn-back').isDisabled(), false, 'Settings is part of the current tab history');
    assert.ok(await page.locator('.settings-nav [data-section="privacy"]').count());
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.settings-layout').count(), 1, 'Escape does not dismiss a normal page');
    await go('vespera://newtab'); await page.waitForSelector('.nt-hero');
    await page.locator('#site-info').click();
    assert.match(await page.locator('.site-info-popover').textContent(), /Site privacy settings/, 'site-specific settings remain available');
    await page.locator('.site-info-popover [data-site-action="privacy"]').click();
    await page.waitForFunction(() => document.querySelector('.settings-layout .settings-nav a.active')?.dataset.section === 'privacy');
    assert.match(await page.locator('#omni-input').inputValue(), /#privacy$/, 'the site privacy control opens its Settings section');
    await go('vespera://newtab'); await page.waitForSelector('.nt-hero');
    await page.keyboard.press('Control+,'); await page.waitForSelector('.settings-layout');
    assert.match(await page.locator('#omni-input').inputValue(), /^vespera:\/\/settings/);
    await go('vespera://newtab'); await page.waitForSelector('.nt-hero');
    await page.locator('.nt-hero h1').click({ button: 'right' }); assert.equal(await page.locator('.context-menu').count(), 1);
    assert.match(await page.locator('.context-menu').textContent(), /Customize home/); await page.keyboard.press('Escape');
  });
  await step('tab groups can be created, renamed and joined by Alt-dragging', async () => {
    const first = page.locator('#tabstrip .tab').first();
    await first.click({ button: 'right' });
    await page.locator('.menu [data-tab-act="group"]').click();
    await page.waitForSelector('.group-editor-menu');
    await page.locator('[data-group-name]').fill('Starter group');
    await page.locator('[data-group-save]').click();
    assert.equal(await page.locator('#tabstrip .tab.grouped').count(), 1);
    await page.keyboard.press('Control+t');
    assert.equal(await page.locator('#tabstrip .tab').count(), 2);
    // A plain drag only reorders; holding Alt while dropping onto a tab groups them.
    await page.keyboard.down('Alt');
    await page.locator('#tabstrip .tab').nth(1).dragTo(page.locator('#tabstrip .tab').first());
    await page.keyboard.up('Alt');
    assert.equal(await page.locator('#tabstrip .tab.grouped').count(), 2);
    await page.locator('#tabstrip .tab.grouped').first().click({ button: 'right' });
    await page.locator('[data-group-name]').fill('Research');
    await page.locator('[data-tab-act="rename"]').click();
    assert.equal(await page.locator('.tab-group-header .tab-group-title').first().textContent(), 'Research');
    assert.equal(await page.locator('#tabstrip .tab-group-label').count(), 0, 'group names are not repeated as tags on individual tabs');
    await page.locator('#tabstrip .tab.grouped').first().click({ button: 'right' });
    await page.locator('[data-tab-act="ungroup"]').click();
    assert.equal(await page.locator('#tabstrip .tab.grouped').count(), 1);
    await page.keyboard.press('Control+w');
    assert.equal(await page.locator('#tabstrip .tab').count(), 1);
  });
  await step('tab groups rename, recolor, collapse, expand and persist across both layouts', async () => {
    const current = page.locator('#tabstrip .tab.active');
    await current.click({ button: 'right' }); await page.waitForSelector('.tab-actions-menu');
    await page.locator('.tab-actions-menu [data-action="new-group"]').click();
    await page.waitForSelector('.group-editor-menu');
    await page.locator('[data-group-name]').fill('Weekend plans');
    await page.locator('[data-group-color-choice="pink"]').click();
    await page.locator('[data-group-save]').click();
    const header = page.locator('.tab-group-header').first();
    await page.waitForFunction(() => document.querySelector('.tab-group-header')?.textContent.includes('Weekend plans'));
    const groupId = await header.getAttribute('data-group-header');
    assert.equal(await header.getAttribute('data-group-color'), 'pink');
    await header.click({ button: 'right' });
    await page.waitForSelector('.group-editor-menu');
    await page.locator('[data-group-action="newtab"]').click();
    await page.waitForFunction((id) => document.querySelectorAll(`#tabstrip [data-id][data-group-id="${id}"]`).length === 2, groupId);
    await page.locator(`#tabstrip [data-group-toggle="${groupId}"]`).click();
    assert.equal(await page.locator(`#tabstrip [data-group-toggle="${groupId}"]`).getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator(`#tabstrip [data-id][data-group-id="${groupId}"]`).count(), 0);
    await page.locator(`#tabstrip [data-group-toggle="${groupId}"]`).click();
    assert.equal(await page.locator(`#tabstrip [data-id][data-group-id="${groupId}"]`).count(), 2);

    // Create a second group, then drag the first group to the end of the strip.
    await page.locator('#btn-newtab').click();
    await page.locator('#tabstrip .tab.active').click({ button: 'right' });
    await page.locator('.tab-actions-menu [data-action="new-group"]').click();
    await page.waitForSelector('.group-editor-menu');
    await page.locator('[data-group-name]').fill('Reading list');
    await page.locator('[data-group-save]').click();
    const secondHeader = page.locator('.tab-group-header').nth(1);
    const secondGroupId = await secondHeader.getAttribute('data-group-header');
    const targetBox = await secondHeader.boundingBox();
    await page.locator(`#tabstrip [data-group-header="${groupId}"]`).dragTo(secondHeader, { targetPosition: { x: targetBox.width - 2, y: targetBox.height / 2 } });
    assert.deepEqual(await page.locator('.tab-group-header').evaluateAll((headers) => headers.map((node) => node.dataset.groupHeader)), [secondGroupId, groupId]);

    await go('vespera://settings#tabs');
    await page.locator('.settings-layout .settings-content [data-setting="tabBehavior.tabGroupsEnabled"]').uncheck();
    await go('vespera://newtab');
    assert.equal(await page.locator('#tabstrip .tab-group-header').count(), 0);
    assert.equal(await page.locator(`#tabstrip [data-id][data-group-id="${groupId}"]`).count(), 2, 'disabling groups preserves their membership');
    await go('vespera://settings#tabs');
    await page.locator('.settings-layout .settings-content [data-setting="tabBehavior.tabGroupsEnabled"]').check();
    await go('vespera://newtab');
    await page.waitForSelector(`#tabstrip [data-group-header="${groupId}"]`);
    await go('vespera://settings#tabs');
    const settings = page.locator('.settings-layout .settings-content');
    await settings.locator('[data-segment="tabLayout"] [data-v="vertical"]').click();
    await go('vespera://newtab');
    await page.waitForSelector(`#vtabs-list [data-group-header="${groupId}"]`);
    assert.equal(await page.locator(`#vtabs-list [data-id][data-group-id="${groupId}"]`).count(), 2);
    await page.locator(`#vtabs-list [data-group-toggle="${groupId}"]`).click();
    assert.equal(await page.locator(`#vtabs-list [data-id][data-group-id="${groupId}"]`).count(), 0);
    await page.locator(`#vtabs-list [data-group-toggle="${groupId}"]`).click();
    const verticalTarget = page.locator(`#vtabs-list [data-group-header="${groupId}"]`);
    const verticalBox = await verticalTarget.boundingBox();
    await page.locator(`#vtabs-list [data-group-header="${secondGroupId}"]`).dragTo(verticalTarget, { targetPosition: { x: verticalBox.width / 2, y: verticalBox.height - 2 } });
    assert.deepEqual(await page.locator('#vtabs-list [data-group-header]').evaluateAll((headers) => headers.map((node) => node.dataset.groupHeader)), [groupId, secondGroupId]);
    await go('vespera://settings#tabs');
    await page.locator('.settings-layout .settings-content [data-segment="tabLayout"] [data-v="horizontal"]').click();
    await go('vespera://newtab');
    await page.waitForTimeout(250); await page.reload(); await page.waitForSelector('#tabstrip .tab.active');
    assert.deepEqual(await page.locator('.tab-group-header').evaluateAll((headers) => headers.map((node) => node.dataset.groupHeader)), [groupId, secondGroupId], 'vertical group order survives a session reload');
    assert.equal(await page.locator(`#tabstrip [data-group-header="${groupId}"]`).getAttribute('data-group-color'), 'pink');
    await page.locator(`#tabstrip [data-group-header="${secondGroupId}"]`).click({ button: 'right' });
    await page.locator('[data-group-action="close"]').click();
    await page.locator(`#tabstrip [data-group-header="${groupId}"]`).click({ button: 'right' });
    await page.locator('[data-group-action="ungroup"]').click();
    assert.equal(await page.locator('.tab-group-header').count(), 0);
    await page.keyboard.press('Control+w'); assert.equal(await page.locator('#tabstrip .tab').count(), 1);
  });
  await step('private browsing landing page explains what is and is not hidden', async () => {
    await go('vespera://private'); await page.waitForSelector('.private-page');
    assert.match(await page.locator('.private-page').textContent(), /browsing privately/);
    assert.match(await page.locator('.private-page').textContent(), /internet service provider/);
    await page.locator('#private-new-tab').click();
    assert.equal(await page.locator('#tabstrip .tab').count(), 2);
    await page.keyboard.press('Control+w');
    await go('vespera://newtab');
  });
  await step('menu toggles closed on the same anchor and opens the full browser Settings page', async () => {
    assert.equal(await page.locator('#btn-menu').getAttribute('aria-label'), 'Toggle Menu');
    assert.equal(await page.locator('#btn-menu').getAttribute('title'), 'Toggle Menu');
    await page.locator('#btn-menu').click(); assert.equal(await page.locator('.browser-menu').getAttribute('aria-label'), 'Toggle Menu');
    await page.locator('#btn-menu').click(); assert.equal(await page.locator('.browser-menu').count(), 0);
    await menu('settings'); assert.equal(await page.locator('.settings-layout').count(), 1);
    assert.equal(await page.locator('.settings-layer').count(), 0);
    assert.match(await page.locator('.settings-layout .settings-nav a.active').textContent(), /Appearance/);
    assert.equal(await page.locator('.settings-layout .settings-nav a').count(), 9);
    const navBox = await page.locator('.settings-layout .settings-nav').boundingBox();
    assert.ok(navBox.height < 450, 'section navigation hugs its links instead of filling an oversized empty box');
    await page.locator('.settings-layout .settings-nav [data-section="browser"]').click();
    await page.waitForFunction(() => document.querySelector('.settings-layout .settings-nav a.active')?.dataset.section === 'browser');
    assert.equal(await page.locator('#set-default-browser').isDisabled(), true);
    assert.equal(await page.locator('#open-default-browser-settings').isDisabled(), true);
    assert.match(await page.locator('#default-browser-status').textContent(), /desktop app/i);
    assert.doesNotMatch(await page.locator('#default-browser-status').textContent(), /now your default/i);
    await page.locator('.settings-nav [data-section="appearance"]').click();
  });
  await step('command-palette searches and utility pages open in new tabs without replacing current work', async () => {
    await page.waitForFunction(() => document.querySelector('#preview-label')?.textContent.includes('GitHub search'));
    const originalId = await page.locator('#tabstrip .tab.active').getAttribute('data-id');
    await page.keyboard.press('Control+k');
    await page.locator('#palette-q').fill('a private search that should stay in its own tab');
    await page.locator('#palette-q').press('Enter');
    await page.waitForFunction((id) => document.querySelectorAll('#tabstrip .tab').length === 2 && document.querySelector('#tabstrip .tab.active')?.dataset.id !== id, originalId);
    assert.match(await page.locator('#omni-input').inputValue(), /^vespera:\/\/search\?q=/);
    const searchId = await page.locator('#tabstrip .tab.active').getAttribute('data-id');
    assert.ok(await page.locator(`#tabstrip [data-id="${originalId}"]`).count());
    await page.keyboard.press('Control+k'); await page.locator('#palette-q').fill('History'); await page.locator('#palette-q').press('Enter');
    await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'History');
    assert.equal(await page.locator('#tabstrip .tab').count(), 3);
    assert.ok(await page.locator(`#tabstrip [data-id="${searchId}"]`).count(), 'the search result remains open in its own tab');
    await page.keyboard.press('Control+w'); await page.keyboard.press('Control+w');
    await page.waitForFunction((id) => document.querySelectorAll('#tabstrip .tab').length === 1 && document.querySelector('#tabstrip .tab.active')?.dataset.id === id, originalId);
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
    await page.locator('#btn-back').click(); await page.waitForSelector('.settings-layout');
    assert.match(await page.locator('#omni-input').inputValue(), /^vespera:\/\/settings/);
    await page.locator('#btn-forward').click(); assert.match(await page.locator('.welcome-hero').textContent(), /Welcome to Vespera/);
  });
  await step('custom wallpaper library can add several images, restore them, and remove safely', async () => {
    await go('vespera://settings#appearance'); await page.waitForSelector('#custom-wallpaper-grid');
    await page.locator('#wallpaper-file').setInputFiles([
      { name: 'Mountains.png', mimeType: 'image/png', buffer: tinyWallpaperPng },
      { name: 'Forest.png', mimeType: 'image/png', buffer: tinyWallpaperPng },
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.custom-wallpaper-choice').length === 2);
    const selectedAfterUpload = await page.evaluate(() => JSON.parse(localStorage.getItem('vespera.settings')).wallpaper.id);
    assert.ok(await page.locator(`[data-wallpaper-select="${selectedAfterUpload}"]`).count(), 'the last imported image becomes active');
    assert.match(await page.locator('#custom-wallpaper-grid').textContent(), /Mountains\.png|Forest\.png/);

    await page.waitForTimeout(220);
    await page.reload(); await page.waitForSelector('.settings-layout');
    await page.waitForFunction(() => document.querySelectorAll('.custom-wallpaper-choice').length === 2);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vespera.settings')).wallpaper.id), selectedAfterUpload, 'custom images and active selection survive reload');
    assert.match(await page.locator('#custom-wallpaper-grid').textContent(), /Mountains\.png/);
    assert.match(await page.locator('#custom-wallpaper-grid').textContent(), /Forest\.png/);
    assert.equal(await page.locator('#edit-wallpaper').isEnabled(), true, 'the active custom image can be edited');
    await page.locator('#edit-wallpaper').click();
    await page.waitForFunction(() => document.querySelector('#wp-editor')?.classList.contains('open'));
    await page.locator('#wp-zoom').evaluate((input) => { input.value = '175'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('vespera.settings')).wallpaperAdjust.zoom === 1.75);
    assert.equal(await page.locator('#wp-zoom').evaluate((input) => input.nextElementSibling.textContent), '175%', 'the editor updates its live value and saved adjustment');
    await page.locator('#wp-done').click(); await page.waitForTimeout(280);
    const ids = await page.locator('.custom-wallpaper-choice').evaluateAll((buttons) => buttons.map((button) => button.dataset.wallpaperSelect));
    const firstId = ids.find((id) => id !== selectedAfterUpload);
    await page.locator(`[data-wallpaper-select="${firstId}"]`).click();
    await page.waitForFunction((id) => JSON.parse(localStorage.getItem('vespera.settings')).wallpaper.id === id, firstId);
    await page.locator(`[data-wallpaper-remove="${firstId}"]`).click(); await page.locator('.confirm-dialog [data-confirm]').click();
    await page.waitForFunction(() => document.querySelectorAll('.custom-wallpaper-choice').length === 1);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vespera.settings')).wallpaper.id), 'twilight', 'deleting the active image selects a safe built-in wallpaper');

    await page.locator('#wallpaper-file').setInputFiles({ name: 'Clouds.png', mimeType: 'image/png', buffer: tinyWallpaperPng });
    await page.waitForFunction(() => document.querySelectorAll('.custom-wallpaper-choice').length === 2);
    const cloudId = await page.locator('.custom-wallpaper-choice[aria-label="Use wallpaper Clouds.png"]').getAttribute('data-wallpaper-select');
    assert.ok(cloudId); assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vespera.settings')).wallpaper.id), cloudId);
    const remainingId = await page.locator('.custom-wallpaper-choice').evaluateAll((buttons) => buttons.find((button) => button.dataset.wallpaperSelect !== document.querySelector('.custom-wallpaper-choice[aria-pressed="true"]')?.dataset.wallpaperSelect)?.dataset.wallpaperSelect);
    await page.locator(`[data-wallpaper-remove="${remainingId}"]`).click(); await page.locator('.confirm-dialog [data-confirm]').click();
    await page.waitForFunction(() => document.querySelectorAll('.custom-wallpaper-choice').length === 1);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vespera.settings')).wallpaper.id), cloudId, 'removing a different image leaves the selection intact');
    await page.locator(`[data-wallpaper-remove="${cloudId}"]`).click(); await page.locator('.confirm-dialog [data-confirm]').click();
    await page.waitForSelector('.wallpaper-empty');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vespera.settings')).wallpaper.id), 'twilight');

    // Older releases stored one raw Blob under `custom`; it remains selectable and removable.
    await page.evaluate(async (png) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('vespera-wallpapers', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readwrite');
        tx.objectStore('images').put(new Blob([Uint8Array.from(png)], { type: 'image/png' }), 'custom');
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
      db.close();
    }, [...tinyWallpaperPng]);
    await page.reload(); await page.waitForSelector('.settings-layout');
    await page.waitForSelector('[data-wallpaper-select="custom"]');
    assert.match(await page.locator('#custom-wallpaper-grid').textContent(), /Custom wallpaper/);
    await page.locator('[data-wallpaper-select="custom"]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('vespera.settings')).wallpaper.id === 'custom');
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--wallpaper-image').includes('blob:'));
    await page.locator('[data-wallpaper-remove="custom"]').click(); await page.locator('.confirm-dialog [data-confirm]').click();
    await page.waitForSelector('.wallpaper-empty');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vespera.settings')).wallpaper.id), 'twilight', 'removing the legacy image falls back safely');
  });
  await step('vertical tabs retain a working omnibox; all four built-in extensions render', async () => {
    await go('vespera://settings'); await page.locator('[data-segment="tabLayout"] [data-v="vertical"]').click();
    assert.equal(await page.locator('#omni-input').count(), 1); assert.equal(await page.locator('#toolbar').isVisible(), true);
    // Settings is a normal page; leave it through browser navigation before the next route.
    await go('vespera://newtab');
    await go('vespera://extensions');
    assert.equal(await page.locator('#ext-grid .extension-card').count(), 4);
    assert.ok(await page.locator('#catalog-grid .extension-card').count() > 0);
    assert.ok(await page.locator('.settings-nav [data-section="catalog"]').count() === 1);
    assert.ok(await page.locator('.extension-dev-row').count() === 1, 'Developer mode controls are present');
    assert.equal(await page.locator('#ext-developer-mode').isDisabled(), true, 'web previews do not pretend to load extensions');
    assert.equal(await page.locator('#ext-load').isDisabled(), true);
    assert.equal(await page.locator('#ext-load-unpacked').isHidden(), true, 'unpacked loading stays behind Developer mode');
    await page.locator('[data-ext-toggle="focusMode"]').check(); assert.equal(await page.locator('#sidebar').isVisible(), false);
    await page.locator('[data-ext-toggle="focusMode"]').uncheck(); assert.equal(await page.locator('#sidebar').isVisible(), true);
    await go('vespera://settings'); await page.locator('[data-segment="tabLayout"] [data-v="horizontal"]').click();
    await go('vespera://newtab');
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
  await step('proxy browsing, title updates, link navigation, back and reload', async () => {
    await go(fixtureUrl + '/?utm_source=test');
    await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
    assert.equal(await page.locator('#omni-input').inputValue(), fixtureUrl + '/');
    await page.locator('#site-info').click();
    assert.match(await page.locator('.site-info-popover').textContent(), /Connection is not secure/);
    assert.match(await page.locator('.site-info-popover').textContent(), /Cookies & site data/);
    await page.keyboard.press('Escape');
    const frame = page.frames().find((f) => f.url().includes('/proxy?'));
    await frame.locator('#next').click({ button: 'right' });
    await page.waitForSelector('.context-menu'); assert.match(await page.locator('.context-menu').textContent(), /Open link in new tab/); await page.keyboard.press('Escape');
    const homeTabId = await page.locator('#tabstrip .tab.active').getAttribute('data-id');
    const startCount = await page.locator('#tabstrip .tab').count();
    await frame.locator('#next').click({ modifiers: ['Control'] });
    await page.waitForFunction((count) => document.querySelectorAll('#tabstrip .tab').length === count + 1, startCount);
    assert.equal(await page.locator('#tabstrip .tab.active').getAttribute('data-id'), homeTabId, 'Control-click opens in a background tab');
    const ctrlTab = page.locator('#tabstrip .tab').filter({ hasText: 'Second page' }).last();
    await ctrlTab.locator('.close').click(); await page.waitForFunction((count) => document.querySelectorAll('#tabstrip .tab').length === count, startCount);
    await frame.locator('#blank').click();
    await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Second page');
    assert.equal(await page.locator('#tabstrip .tab').count(), startCount + 1, 'target=_blank opens a managed browser tab');
    await page.locator('#tabstrip .tab.active .close').click(); await page.waitForFunction((count) => document.querySelectorAll('#tabstrip .tab').length === count, startCount);
    await frame.locator('#next').click();
    await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Second page');
    await page.locator('#btn-back').click();
    await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
    await page.locator('#btn-reload').click();
    await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
  });
  await step('middle-click, mute controls, hover cards and memory preferences work', async () => {
    await go(fixtureUrl); await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
    let frame = page.frames().find((f) => f.url().includes('/proxy?'));
    await page.locator('#tabstrip .tab.active').hover(); await page.waitForSelector('.tab-hovercard');
    assert.match(await page.locator('.tab-hovercard').textContent(), /Fixture Home/);
    assert.ok(await page.locator('.tab-hovercard [data-hover-preview]').count(), 'thumbnail previews are enabled by default');
    assert.match(await page.locator('.tab-hovercard').textContent(), /Page snapshots are available in the desktop app/);
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
    assert.equal(afterMiddle.indexOf(openedId), afterMiddle.indexOf(activeId) + 1, 'middle-clicked links open beside the current tab');
    await page.waitForFunction((id) => document.querySelector(`#tabstrip [data-id="${id}"] .title`)?.textContent === 'Second page', openedId);
    await page.locator(`#tabstrip .tab[data-id="${openedId}"]`).click({ button: 'middle' });
    assert.equal(await page.locator('#tabstrip .tab').count(), before.length, 'middle-click closes the tab when enabled');

    const baseCount = await page.locator('#tabstrip .tab').count();
    await go('vespera://settings#tabs');
    const layoutSettings = page.locator('.settings-layout .settings-content');
    await layoutSettings.locator('[data-setting="tabBehavior.openTabsNextToCurrent"]').uncheck();
    await layoutSettings.locator('[data-setting="tabBehavior.hideCloseButtons"]').check();
    await layoutSettings.locator('[data-setting="tabBehavior.scrollableTabStrip"]').uncheck();
    await go(fixtureUrl); await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
    assert.equal(await page.locator('body').evaluate((el) => el.classList.contains('tabs-hide-close')), true);
    assert.equal(await page.locator('body').evaluate((el) => el.classList.contains('tabs-no-scroll')), true);
    assert.equal(await page.locator('#tabstrip .tab.active .close').isVisible(), false);
    if (await page.locator('#tabstrip .tab').count() < 2) await page.locator('#btn-newtab').click();
    await page.locator('#tabstrip .tab').first().click();
    const orderBeforeNew = await page.locator('#tabstrip .tab').evaluateAll((rows) => rows.map((row) => row.dataset.id));
    await page.locator('#btn-newtab').click();
    const orderAfterNew = await page.locator('#tabstrip .tab').evaluateAll((rows) => rows.map((row) => row.dataset.id));
    const lastOpened = orderAfterNew.find((id) => !orderBeforeNew.includes(id));
    assert.equal(orderAfterNew.indexOf(lastOpened), orderAfterNew.length - 1, 'disabling beside-current opens tabs at the end');
    while (await page.locator('#tabstrip .tab').count() > baseCount) await page.keyboard.press('Control+w');
    await go('vespera://settings#tabs');
    const restoreLayoutSettings = page.locator('.settings-layout .settings-content');
    await restoreLayoutSettings.locator('[data-setting="tabBehavior.openTabsNextToCurrent"]').check();
    await restoreLayoutSettings.locator('[data-setting="tabBehavior.hideCloseButtons"]').uncheck();
    await restoreLayoutSettings.locator('[data-setting="tabBehavior.scrollableTabStrip"]').check();
    await go(fixtureUrl); await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');

    await go('vespera://settings#tabs');
    const settings = page.locator('.settings-layout .settings-content');
    await settings.locator('[data-setting-select="tabBehavior.tabHoverMode"]').selectOption('preview');
    await go(fixtureUrl); await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
    await page.locator('#tabstrip .tab.active').hover(); await page.waitForSelector('.tab-hovercard.has-preview');
    assert.match(await page.locator('.tab-hovercard').textContent(), /Page snapshots are available in the desktop app/);
    assert.match(await page.locator('.tab-hovercard').textContent(), /Memory estimate unavailable in web preview/);
    await page.mouse.move(700, 400);

    await go('vespera://settings#tabs');
    const settingsAgain = page.locator('.settings-layout .settings-content');
    await settingsAgain.locator('[data-setting-select="tabBehavior.tabHoverMode"]').selectOption('tooltip');
    await settingsAgain.locator('[data-setting="tabBehavior.memoryUsageOnHover"]').uncheck();
    await settingsAgain.locator('[data-segment="tabBehavior.inactiveTabAppearance"] [data-v="dimmed"]').click();
    assert.equal(await page.locator('body').evaluate((el) => el.classList.contains('tabs-inactive-dimmed')), true);
    await settingsAgain.locator('[data-segment="tabBehavior.inactiveTabAppearance"] [data-v="minimal"]').click();
    assert.equal(await page.locator('body').evaluate((el) => el.classList.contains('tabs-inactive-minimal')), true);
    await go(fixtureUrl); await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
    await page.locator('#tabstrip .tab.active').hover(); await page.waitForTimeout(450);
    assert.equal(await page.locator('.tab-hovercard').count(), 0, 'tooltip mode with memory off uses the native tab tooltip');
    assert.match(await page.locator('#tabstrip .tab.active').getAttribute('title'), /Fixture Home/);
    await page.mouse.move(700, 400);

    await go('vespera://settings#tabs');
    const restoreSettings = page.locator('.settings-layout .settings-content');
    await restoreSettings.locator('[data-setting-select="tabBehavior.tabHoverMode"]').selectOption('card');
    await restoreSettings.locator('[data-setting="tabBehavior.memoryUsageOnHover"]').check();
    await restoreSettings.locator('[data-setting-select="tabBehavior.tabAudioMode"]').selectOption('click-to-mute');
    await restoreSettings.locator('[data-segment="tabBehavior.inactiveTabAppearance"] [data-v="balanced"]').click();
    await restoreSettings.locator('[data-setting="tabBehavior.middleClickOpensTab"]').uncheck();
    await go(fixtureUrl); await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
    const countBeforeCurrent = await page.locator('#tabstrip .tab').count();
    frame = page.frames().find((f) => f.url().includes('/proxy?'));
    await frame.locator('#next').click({ button: 'middle' });
    await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Second page');
    assert.equal(await page.locator('#tabstrip .tab').count(), countBeforeCurrent, 'disabling middle-click tab opening navigates the current tab');
    await go('vespera://settings#tabs');
    await page.locator('.settings-layout .settings-content [data-setting="tabBehavior.middleClickOpensTab"]').check();
    await page.locator('.settings-layout .settings-content [data-setting="tabBehavior.middleClickClosesTab"]').uncheck();
    await go(fixtureUrl); await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
    await page.locator('#tabstrip .tab.active').click({ button: 'middle' });
    assert.equal(await page.locator('#tabstrip .tab').count(), countBeforeCurrent, 'disabling middle-click tab closing leaves the tab open');
    await go('vespera://settings#tabs');
    await page.locator('.settings-layout .settings-content [data-setting="tabBehavior.middleClickClosesTab"]').check();
    await go(fixtureUrl); await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
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
  await step('history shows useful visit details and opens a result without replacing the library tab', async () => {
    await page.locator('#btn-bookmark').click(); await go('vespera://bookmarks'); assert.equal(await page.locator('.bm-card').count(), 1);
    await go('vespera://history'); assert.ok(await page.locator('.hist-row').count() >= 1);
    assert.ok(await page.locator('.hist-row .h-site').count() >= 1);
    assert.ok(await page.locator('.hist-row time[datetime]').count() >= 1);
    const before = await page.locator('#tabstrip .tab').count();
    await page.locator('.hist-row [data-visit]').first().click();
    await page.waitForFunction((count) => document.querySelectorAll('#tabstrip .tab').length === count + 1, before);
    await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
    await page.locator('#tabstrip .tab.active .close').click();
    await page.waitForFunction((count) => document.querySelectorAll('#tabstrip .tab').length === count, before);
    assert.equal(await page.locator('#tabstrip .tab.active .title').textContent(), 'History');
  });
  await step('downloads retrieve a real file and report browser handoff', async () => {
    await go(fixtureUrl); await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Fixture Home');
    const frame = page.frames().find((f) => f.url().includes('/proxy?'));
    const pending = page.waitForEvent('download'); await frame.locator('#file').click(); const download = await pending;
    assert.equal(download.suggestedFilename(), 'hello.txt');
    await page.waitForFunction(() => {
      try { return JSON.parse(localStorage.getItem('vespera.downloads') || '[]').some((item) => item.name === 'hello.txt' && item.status === 'browser'); }
      catch { return false; }
    }, null, { timeout: 20000 });
    await page.locator('#btn-downloads').click();
    assert.match(await page.locator('.recent-downloads-menu').textContent(), /hello.txt/);
    await page.locator('[data-open-downloads]').click();
    await page.waitForFunction(() => document.querySelector('#tabstrip .tab.active .title')?.textContent === 'Downloads', null, { timeout: 20000 });
    await page.waitForFunction(() => { const text = document.querySelector('#d-list')?.textContent || ''; return text.includes('hello.txt') && /Downloaded|Sent to browser downloads/.test(text); }, null, { timeout: 20000 });
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
    await go('vespera://settings#account');
    await page.waitForSelector('#download-local-backup');
    const backupDownload = page.waitForEvent('download');
    await page.locator('#download-local-backup').click();
    const backup = await backupDownload;
    assert.ok(backup.suggestedFilename().startsWith('Vespera-Backup-') && backup.suggestedFilename().endsWith('.json'));
    await go('vespera://newtab');
  });
  await step('release notes identify the running build and link to published installers', async () => {
    await menu('updates'); await page.waitForSelector('.updates-page');
    assert.ok((await page.locator('.updates-page').textContent()).includes(appVersion), 'release notes identify the current package version');
    assert.match(await page.locator('.updates-page a[href*="releases"]').first().getAttribute('href'), /github\.com\/Makerxm800\/Vespera\/releases/);
  });
  await step('session restores the active tab after a real reload', async () => {
    await go('vespera://history'); await page.waitForTimeout(250); const count = await page.locator('#tabstrip .tab').count();
    await page.reload(); await page.waitForSelector('#tabstrip .tab.active'); assert.equal(await page.locator('#tabstrip .tab').count(), count); assert.match(await page.locator('#omni-input').inputValue(), /history/);
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
    for (const route of ['vespera://privacy', 'vespera://account']) {
      await go(route); await page.waitForTimeout(120);
      const fit = await page.evaluate(() => { const el = document.querySelector('.page-scroll:not(.hidden)'); return el.scrollWidth <= el.clientWidth + 1; });
      assert.ok(fit, route + ' fits a small viewport');
    }
    await go('vespera://settings#privacy'); await page.waitForSelector('.settings-layout');
    await page.waitForFunction(() => document.querySelector('.settings-layout .settings-nav a.active')?.dataset.section === 'privacy');
    const settingsFit = await page.evaluate(() => {
      const page = document.querySelector('.page-scroll:not(.hidden)'), nav = document.querySelector('.settings-layout .settings-nav');
      const active = nav.querySelector('a.active').getBoundingClientRect(), navBox = nav.getBoundingClientRect();
      const privacy = document.querySelector('#privacy').getBoundingClientRect();
      return {
        pageFits: page.scrollWidth <= page.clientWidth + 1,
        navScrolls: nav.scrollWidth > nav.clientWidth,
        navIsSingleRow: getComputedStyle(nav).flexWrap === 'nowrap',
        activeVisible: active.left >= navBox.left - 1 && active.right <= navBox.right + 1,
        sectionClearsNav: privacy.top >= navBox.bottom - 1,
      };
    });
    assert.ok(settingsFit.pageFits, 'full Settings page fits without document overflow on mobile');
    assert.ok(settingsFit.navScrolls && settingsFit.navIsSingleRow, 'section navigation stays on one horizontally scrollable row');
    assert.ok(settingsFit.activeVisible, 'the active section remains visible in the compact navigation');
    assert.ok(settingsFit.sectionClearsNav, 'deep-linked section heading clears the sticky navigation');
  });
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log(`\n${passed} browser UI checks passed; no uncaught errors.`);
} finally {
  await browser.close();
  service.server.closeAllConnections?.(); await new Promise((resolve) => service.server.close(resolve));
  fixture.closeAllConnections?.(); await new Promise((resolve) => fixture.close(resolve));
}
