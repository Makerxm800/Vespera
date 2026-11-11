/** Session-level privacy enforcement for real Chromium webviews. */
'use strict';
const { FilterEngine } = require('../src/shared/filter-engine');
const { BASE_TRACKERS, AD_RULES } = require('../src/shared/blocklists');
const { rewriteClientHints } = require('./client-hints');
function toEngineType(details) {
  return ({ mainFrame: 'document', subFrame: 'subdocument', stylesheet: 'stylesheet', script: 'script', image: 'image', font: 'font', media: 'media', object: 'object', xhr: 'xmlhttprequest', fetch: 'xmlhttprequest', websocket: 'websocket', ping: 'ping' })[details.resourceType] || 'other';
}
function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } }
function siteMatches(host, allowed) { return Boolean(host && allowed && (allowed[host] || Object.keys(allowed).some((h) => host.endsWith('.' + h)))); }
function installPrivacy(session, getPrefs, log, pu) {
  const trackers = new FilterEngine(BASE_TRACKERS), ads = new FilterEngine(AD_RULES);
  const engine = new FilterEngine([...BASE_TRACKERS, ...AD_RULES]);
  const cosmeticKeys = new WeakMap();
  session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const prefs = getPrefs(), sh = prefs.shields || {};
    const docUrl = details.webContents?.getURL() || details.referrer || details.url;
    const docHost = hostOf(docUrl);
    if (sh.enabled === false || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostOf(details.url)) || siteMatches(docHost, prefs.allowlist)) return callback({});
    const type = toEngineType(details);
    if (type === 'document') return callback({});
    const context = { thirdParty: pu.isThirdParty(details.url, docUrl), documentHost: docHost };
    let kind = null, result;
    if (sh.blockTrackers !== false) { result = trackers.match(details.url, type, context); if (result.blocked) kind = 'tracker'; }
    if (!kind && sh.blockAds !== false) { result = ads.match(details.url, type, context); if (result.blocked) kind = 'ad'; }
    if (kind) { log({ kind, rule: result.rule, url: details.url, host: docHost, webContentsId: details.webContentsId, at: Date.now() }); return callback({ cancel: true }); }
    callback({});
  });
  session.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const sh = getPrefs().shields || {}, headers = { ...details.requestHeaders };
    for (const key of Object.keys(headers)) if (['sec-gpc', 'dnt'].includes(key.toLowerCase())) delete headers[key];
    if (sh.enabled !== false && sh.gpc !== false) { headers['Sec-GPC'] = '1'; headers.DNT = '1'; }
    const refKey = Object.keys(headers).find((k) => k.toLowerCase() === 'referer');
    if (refKey && sh.enabled !== false) {
      const ref = pu.strictReferrer(headers[refKey], details.url);
      if (ref) headers[refKey] = ref; else delete headers[refKey];
    }
    // Google sign-in: keep UA-CH brands consistent with the Chrome user-agent
    // (Electron only says "Chromium"; stock Chrome also names itself).
    rewriteClientHints(headers);
    callback({ requestHeaders: headers });
  });
  return {
    engine,
    protectWebContents(wc) {
      wc.on('will-navigate', (event, url) => {
        const prefs = getPrefs(), sh = prefs.shields || {};
        if (sh.enabled === false || !/^https?:/i.test(url) || siteMatches(hostOf(url), prefs.allowlist)) return;
        let target = url, changed = false;
        if (sh.httpsOnly !== false && target.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/)/i.test(target)) { target = 'https://' + target.slice(7); changed = true; }
        if (sh.cleanLinks !== false) {
          const clean = pu.cleanTrackingParams(target);
          if (clean.removed.length) { target = clean.url; changed = true; log({ kind: 'link', count: clean.removed.length, host: hostOf(target), webContentsId: wc.id, at: Date.now() }); }
        }
        if (changed) { event.preventDefault(); wc.loadURL(target).catch(() => {}); }
      });
      wc.on('did-navigate', () => { log({ kind: 'reset', webContentsId: wc.id, host: hostOf(wc.getURL()) }); });
      wc.on('did-finish-load', async () => {
        const prefs = getPrefs(), sh = prefs.shields || {}, host = hostOf(wc.getURL());
        try {
          const previous = cosmeticKeys.get(wc);
          if (previous) { await wc.removeInsertedCSS(previous); cosmeticKeys.delete(wc); }
          if (sh.enabled === false || siteMatches(host, prefs.allowlist) || !/^https?:/.test(wc.getURL())) return;
          let { hide } = engine.cosmeticFor(host);
          if (sh.blockAnnoyances === false) hide = hide.filter((s) => !/cookie|gdpr|newsletter|signup|share|social|follow-prompt/i.test(s));
          if (sh.blockAds === false) hide = hide.filter((s) => !/ad|ads|sponsor/i.test(s));
          if (hide.length) cosmeticKeys.set(wc, await wc.insertCSS(hide.map((s) => `${s}{display:none!important}`).join('\n')));
        } catch { /* Navigations can race cosmetic insertion. */ }
      });
    },
  };
}
module.exports = { installPrivacy, hostOf, siteMatches };
