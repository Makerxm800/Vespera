'use strict';
/** Webview guest identity patch — runs before any page script.
 *
 * Two things Google's account risk check can see that differ from stock
 * Chrome (verified by probing Chrome/Edge vs Electron side by side):
 *   1. `window.chrome` exists but is empty — Chrome exposes app/csi/loadTimes.
 *   2. `navigator.userAgentData.brands` lists only "Chromium" while the
 *      user-agent says Chrome/130 — real Chrome also lists "Google Chrome".
 * The matching sec-ch-ua *header* rewrite lives in client-hints.js.
 *
 * contextIsolation stays on, so the patch is pushed into the page's main
 * world through webFrame.executeJavaScript. It must never break the page.
 */
const { webFrame, ipcRenderer } = require('electron');

// Chromium guest views have no parent DOM access. Capture the actual user
// gesture in this isolated preload and send only a validated URL to the host.
function safeLinkTarget(anchor) {
  try {
    const url = new URL(anchor.href || anchor.getAttribute('href'), location.href);
    if (url.username || url.password) return null;
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    if (url.protocol === 'file:' && !url.host && url.pathname.startsWith('/') && !url.pathname.startsWith('//')) {
      if (/%(?:2f|5c)/i.test(url.pathname)) return null;
      const decodedPath = decodeURIComponent(url.pathname);
      if (!decodedPath.startsWith('/') || /^[/\\]{2}/.test(decodedPath) || decodedPath.includes('\0')) return null;
      return url.href;
    }
  } catch { /* Bad or relative-to-an-unsupported-scheme link. */ }
  return null;
}
function routeNewTab(event, middle = false) {
  if (!event.isTrusted || location.protocol === 'chrome-extension:') return;
  const anchor = event.target?.closest?.('a[href]');
  if (!anchor || anchor.hasAttribute('download')) return;
  const url = safeLinkTarget(anchor);
  if (!url) return;
  const modified = Boolean(event.ctrlKey || event.metaKey);
  const targetBlank = String(anchor.getAttribute('target') || '').toLowerCase() === '_blank';
  const localFile = url.startsWith('file:');
  if (!middle && !modified && !targetBlank && !localFile) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  try {
    ipcRenderer.sendToHost('vespera:open-link', {
      url, newTab: true,
      foreground: localFile ? (!middle && (!modified || Boolean(event.shiftKey))) : (middle ? false : (!modified || Boolean(event.shiftKey))),
      gesture: middle ? 'middle' : (modified ? 'modifier' : ''),
    });
  } catch { /* The embedder may be closing during navigation. */ }
}
window.addEventListener('click', (event) => { if (event.button === 0) routeNewTab(event); }, true);
window.addEventListener('auxclick', (event) => { if (event.button === 1) routeNewTab(event, true); }, true);

const PATCH = `(() => {
  try {
    // ---- 1. window.chrome: give it Chrome's shape ----------------------
    if (window.chrome && typeof window.chrome.loadTimes !== 'function') {
      const timing = performance.timing || {};
      const sec = (v) => (typeof v === 'number' && v > 0 ? v / 1000 : 0);
      const nowSec = () => (performance.timeOrigin + performance.now()) / 1000;
      window.chrome.loadTimes = () => ({
        requestTime: sec(timing.requestStart) || nowSec(),
        startLoadTime: sec(timing.navigationStart) || nowSec(),
        commitLoadTime: sec(timing.responseStart) || nowSec(),
        finishDocumentLoadTime: sec(timing.domContentLoadedEventEnd) || nowSec(),
        finishLoadTime: sec(timing.loadEventEnd) || nowSec(),
        firstPaintTime: (() => {
          const fp = performance.getEntriesByType && performance.getEntriesByType('paint').find((p) => p.name === 'first-paint');
          return fp ? (performance.timeOrigin + fp.startTime) / 1000 : 0;
        })(),
        firstPaintAfterLoadTime: 0,
        navigationType: 'Navigate',
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
        npnNegotiatedProtocol: 'h2',
        wasAlternateProtocolAvailable: false,
        connectionInfo: 'h2',
      });
      window.chrome.csi = () => ({
        startE: timing.navigationStart || Date.now(),
        onloadT: timing.loadEventEnd || (performance.timeOrigin + performance.now()),
        pageT: Math.round(performance.now()),
        tran: 15,
      });
      window.chrome.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: () => null,
        getIsInstalled: () => false,
        runningState: () => 'cannot_run',
      };
    }

    // ---- 2. UA-CH brands: add "Google Chrome" ---------------------------
    const proto = typeof NavigatorUAData !== 'undefined' ? NavigatorUAData.prototype : null;
    if (proto) {
      const withChrome = (list) => {
        if (!Array.isArray(list) || list.some((b) => b && b.brand === 'Google Chrome')) return list;
        const chromium = list.find((b) => b && b.brand === 'Chromium');
        if (!chromium) return list;
        return [...list, { brand: 'Google Chrome', version: chromium.version }];
      };
      const desc = Object.getOwnPropertyDescriptor(proto, 'brands');
      if (desc && desc.get && !desc.get.__vespera) {
        const orig = desc.get;
        const patched = function () { return withChrome(orig.call(this)); };
        patched.__vespera = true;
        Object.defineProperty(proto, 'brands', Object.assign({}, desc, { get: patched }));
      }
      const origGet = proto.getHighEntropyValues;
      if (typeof origGet === 'function' && !origGet.__vespera) {
        const patchedGet = function (hints) {
          return origGet.call(this, hints).then((v) => {
            if (v && v.brands) v.brands = withChrome(v.brands);
            if (v && v.fullVersionList) v.fullVersionList = withChrome(v.fullVersionList);
            return v;
          });
        };
        patchedGet.__vespera = true;
        proto.getHighEntropyValues = patchedGet;
      }
    }
  } catch (e) { /* identity patch must never break the page */ }
})();`;

try { webFrame.executeJavaScript(PATCH).catch(() => {}); } catch { /* frame may be gone */ }
