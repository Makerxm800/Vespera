/** Vespera QA driver — `node scripts/_qa/run.mjs <scenario>` */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { startServer } from './server.mjs';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'out') + '/';
mkdirSync(OUT, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
writeFileSync(OUT + 'wp-test.png', PNG);

const scenario = process.argv[2] || 'home';
const server = await startServer(4617);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: OUT + name + '.png' }); };
const dump = () => page.evaluate(() => [...document.querySelectorAll('#tabstrip .tab')].map((t) => ({
  g: t.dataset.groupId || '-', title: t.querySelector('.title')?.textContent || '', w: Math.round(t.getBoundingClientRect().width),
})));
const settings = () => page.evaluate(() => JSON.parse(localStorage.getItem('vespera.settings')));
const rootVar = (n) => page.evaluate((k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim().slice(0, 70), n);
const navigateTo = async (url) => { await page.locator('#omni-input').fill(url); await page.locator('#omni-input').press('Enter'); };

const scenarios = {
  async home() {
    await shot('home-h');
    await page.click('.rail [data-vtabs]'); await page.waitForTimeout(600);
    await shot('home-v');
  },

  async wallpaper() {
    await navigateTo('vespera://settings'); await page.waitForSelector('.settings-layout'); await page.waitForTimeout(700);
    await shot('wp-settings');
    await page.setInputFiles('#wallpaper-file', OUT + 'wp-test.png'); await page.waitForTimeout(1000);
    await page.waitForSelector('.custom-wallpaper-choice');
    console.log('afterUpload', JSON.stringify({ wp: (await settings()).wallpaper, img: await rootVar('--wallpaper-image'), customCount: await page.locator('.custom-wallpaper-choice').count() }));
    await shot('wp-custom');
    await page.click('[data-wallpaper="aurora"]'); await page.waitForTimeout(700);
    console.log('afterBuiltin', JSON.stringify({ wp: (await settings()).wallpaper, img: await rootVar('--wallpaper-image') }));
    await shot('wp-builtin');
    const custom = page.locator('.custom-wallpaper-choice').first();
    console.log('customWallpaperAvailable', await custom.count() > 0);
    if (await custom.count()) { await custom.click(); await page.waitForTimeout(700); }
    console.log('afterCustomClick', JSON.stringify({ wp: (await settings()).wallpaper, img: await rootVar('--wallpaper-image') }));
    await shot('wp-back-to-custom');
  },

  async tabs() {
    for (let i = 0; i < 3; i++) { await page.click('#btn-newtab'); await page.waitForTimeout(280); }
    console.log('start', JSON.stringify(await dump()));
    await page.click('#tabstrip .tab:nth-child(1)', { button: 'right' }); await page.waitForTimeout(350);
    await page.click('[data-tab-act="group"]'); await page.waitForTimeout(400);
    await page.click('#tabstrip .tab:nth-child(3)', { button: 'right' }); await page.waitForTimeout(350);
    const joins = await page.$$('[data-tab-act="join"]');
    if (joins.length) { await joins[0].click(); await page.waitForTimeout(400); }
    console.log('grouped', JSON.stringify(await dump()));
    await shot('tabs-grouped');
    await page.dragAndDrop('#tabstrip .tab:nth-child(4)', '#tabstrip .tab:nth-child(1)', { targetPosition: { x: 45, y: 15 } }).catch((e) => console.log('drag err', e.message));
    await page.waitForTimeout(500);
    console.log('afterDragNoAlt', JSON.stringify(await dump()));
    await shot('tabs-drag');
    // Dropping in the MIDDLE of another tab must group it (no Alt needed).
    await page.dragAndDrop('#tabstrip .tab:nth-child(4)', '#tabstrip .tab:nth-child(1)', { targetPosition: { x: 115, y: 15 } }).catch((e) => console.log('drag2 err', e.message));
    await page.waitForTimeout(500);
    console.log('afterDragCenter', JSON.stringify(await dump()));
    await shot('tabs-draggroup');
    await page.click('#tabstrip .tab:nth-child(1)', { button: 'right' }); await page.waitForTimeout(350);
    await page.click('[data-tab-act="pin"]'); await page.waitForTimeout(450);
    console.log('pinned', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#tabstrip .tab')].map((t) => ({
      cls: t.className, w: Math.round(t.getBoundingClientRect().width), title: t.querySelector('.title')?.textContent || '',
    })))));
    await shot('tabs-pinned');
    // A pinned tab has no close button — its ⋮ must open the tab menu.
    await page.click('#tabstrip .tab.pinned [data-more]'); await page.waitForTimeout(400);
    console.log('pinnedMenu', await page.$$eval('.context-menu .menu-item', (n) => n.length));
    await shot('tabs-pinned-menu');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  },

  async settings() {
    // Browser-menu Settings now navigates the active tab to the full internal page.
    const beforeUrl = page.url();
    await page.click('#btn-menu'); await page.click('[data-act="settings"]'); await page.waitForSelector('.settings-layout');
    console.log('pageOpen', await page.$('.settings-layout').then(Boolean), 'navigated', page.url() !== beforeUrl, 'overlay', await page.$('.settings-layer').then(Boolean));
    await shot('s-settings-page');
    await page.click('.settings-layout .settings-nav [data-section="privacy"]'); await page.waitForTimeout(700);
    console.log('activeSection', await page.$eval('.settings-layout .settings-nav a.active', (a) => a.dataset.section));
    await shot('s-privacy');
    const toggle = await page.$('.settings-layout .settings-content [data-setting]');
    if (toggle) { await toggle.click(); await page.waitForTimeout(150); console.log('pulse', await page.$eval('.settings-layout .settings-content .row-pulse', (el) => el.className).catch(() => 'none')); }
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    console.log('pageStaysOnEscape', await page.$('.settings-layout').then(Boolean));
    await page.keyboard.press('Control+,'); await page.waitForTimeout(600);
    console.log('hotkeyKeepsSettingsPage', await page.$('.settings-layout').then(Boolean));
    await shot('s-hotkey');
  },

  async ext() {
    await page.click('.rail [data-nav="vespera://extensions"]'); await page.waitForTimeout(700);
    const ids = await page.evaluate(() => ['general', 'built-in', 'installed', 'catalog'].map((id) => Boolean(document.getElementById(id))));
    console.log('sections', JSON.stringify(ids), 'cards', await page.$$eval('.extension-card', (n) => n.length));
    await shot('ext-page');
    await page.click('.settings-nav [data-section="installed"]'); await page.waitForTimeout(700);
    await shot('ext-installed');
    const tabsBefore = await page.evaluate(() => document.querySelectorAll('#tabstrip .tab').length);
    await page.click('#catalog-grid [data-catalog-url]'); await page.waitForTimeout(700);
    console.log('linkOpensTab', tabsBefore, '->', await page.evaluate(() => document.querySelectorAll('#tabstrip .tab').length));
    await shot('ext-catalog');
  },

  async rail() {
    await shot('rail-on');
    await page.click('[data-rail-collapse]'); await page.waitForTimeout(500);
    console.log('hidden', await page.evaluate(() => ({ body: document.body.className, sidebar: !!document.querySelector('.sidebar') && getComputedStyle(document.querySelector('.sidebar')).display, reveal: !document.querySelector('#btn-show-rail').hidden })));
    await shot('rail-off');
    await page.click('#btn-show-rail'); await page.waitForTimeout(500);
    console.log('restored', await page.evaluate(() => document.body.classList.contains('rail-hidden')));
    await shot('rail-restored');
  },
};

try {
  await page.goto(server.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await (scenarios[scenario] || scenarios.home)();
} catch (err) {
  console.log('SCENARIO FAILED:', err.message);
}
console.log('ERRORS', JSON.stringify(errors.slice(0, 15), null, 1));
await browser.close();
server.stop();
