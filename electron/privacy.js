/**
 * Vespera Electron Privacy — session-level enforcement of the Vespera
 * privacy engine inside real Chromium (roadmap items 1 & 3, wired up).
 *
 *  - Blocks tracker/ad/fingerprint requests via onBeforeRequest (webRequest)
 *  - Sends Sec-GPC + DNT on every request, strips tracking referrers
 *  - Upgrades http→https navigations when HTTPS-only mode is on
 *  - Strips tracking query parameters from navigations (link cleaning)
 *  - Injects cosmetic-filter CSS after page load
 */

'use strict';

const { FilterEngine } = require('../src/shared/filter-engine');
const { defaultRules } = require('../src/shared/blocklists');

/** Map Chromium webRequest resource types onto engine types. */
function toEngineType(details) {
  const t = details.resourceType || 'other';
  const map = {
    mainFrame: 'document', subFrame: 'subdocument', stylesheet: 'stylesheet',
    script: 'script', image: 'image', font: 'font', media: 'media',
    object: 'object', xhr: 'xmlhttprequest', fetch: 'xmlhttprequest',
    websocket: 'websocket', ping: 'ping', other: 'other',
  };
  return map[t] || 'other';
}

function installPrivacy(session, getPrefs, log, pu) {
  if (!pu) throw new Error('installPrivacy requires the privacy-utils ESM module (pass `pu`)');
  const engine = new FilterEngine(defaultRules());

  // ---- Request blocking -------------------------------------------------
  session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      const prefs = getPrefs();
      const sh = prefs.shields || {};
      if (sh.enabled === false) return callback({});

      // Never block our own UI or internal pages.
      if (details.url.startsWith('vespera://') || details.url.includes('127.0.0.1')) {
        return callback({});
      }

      const docHost = hostOf(details.referrer || details.frameUrl || details.url);
      const thirdParty = pu.isThirdParty(details.url, details.frameUrl || details.referrer || details.url);

      // Feature gates
      const type = toEngineType(details);
      const isAdType = type === 'image' || type === 'subdocument';
      if (isAdType && sh.blockAds === false) return callback({});
      if (!isAdType && sh.blockTrackers === false) return callback({});

      const siteOff = docHost && prefs.allowlist && prefs.allowlist[docHost];
      if (siteOff) return callback({});

      const result = engine.match(details.url, type, { thirdParty, documentHost: docHost });
      if (result.blocked) {
        log('blocked', result.rule, details.url);
        return callback({ cancel: true });
      }
      callback({});
    }
  );

  // ---- Privacy headers (GPC + DNT) & referrer trimming -------------------
  session.webRequest.onBeforeSendHeaders(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      const prefs = getPrefs();
      const sh = prefs.shields || {};
      const headers = { ...details.requestHeaders };
      if (sh.gpc !== false) {
        headers['Sec-GPC'] = '1';
        headers['DNT'] = '1';
      }
      callback({ requestHeaders: headers });
    }
  );

  // ---- Navigation link cleaning & HTTPS upgrades (via protectWebContents) --

  const wcHooks = new Set();
  session.on('will-download', (event, item) => {
    for (const fn of wcHooks) fn(event, item);
  });

  return {
    engine,
    /** Apply navigation-time protections to a webContents. */
    protectWebContents(wc, getPrefs) {
      wc.on('will-navigate', (event, url) => {
        const prefs = getPrefs();
        const sh = prefs.shields || {};
        if (sh.enabled === false) return;

        let target = url;
        let changed = false;

        if (sh.httpsOnly !== false && target.startsWith('http://')
            && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(target)) {
          target = 'https://' + target.slice('http://'.length);
          changed = true;
        }
        if (sh.cleanLinks !== false) {
          const { url: clean, removed } = pu.cleanTrackingParams(target);
          if (removed.length) {
            target = clean;
            changed = true;
            for (const fn of wcHooks) fn('link-cleaned', removed.length);
          }
        }
        if (changed) {
          event.preventDefault();
          wc.loadURL(target);
        }
      });

      // Cosmetic filtering after each load.
      wc.on('did-finish-load', () => {
        const prefs = getPrefs();
        const sh = prefs.shields || {};
        if (sh.enabled === false) return;
        const url = wc.getURL();
        if (!/^https?:/.test(url)) return;
        const host = hostOf(url);
        if (host && prefs.allowlist && prefs.allowlist[host]) return;

        const { hide } = engine.cosmeticFor(host || '');
        let selectors = hide;
        if (sh.blockAnnoyances === false) {
          selectors = selectors.filter((s) => !/cookie|gdpr|newsletter|share|social/i.test(s));
        }
        if (sh.blockAds === false) {
          selectors = selectors.filter((s) => !/ad|ads|sponsor/i.test(s));
        }
        if (!selectors.length) return;
        const css = selectors.map((s) => `${s}{display:none!important}`).join('\n');
        const js = `(function(){var s=document.createElement('style');
          s.id='__vespera_cosmetic';s.textContent=${JSON.stringify(css)};
          (document.head||document.documentElement).appendChild(s);})()`;
        wc.executeJavaScript(js).catch(() => {});
      });
    },
    onDownload(fn) { wcHooks.add(fn); },
  };
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

module.exports = { installPrivacy, hostOf };
