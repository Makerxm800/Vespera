/** Platform bridge. Website frames are isolated from the privileged browser UI. */
import { state } from './state.js';
import { safeTabUrl } from '../../shared/privacy-utils.mjs';

export function previewPrefsMask(docUrl) {
  const s = state.settings.shields;
  let mask = (s.enabled ? 1 : 0) | (s.blockTrackers ? 2 : 0) | (s.blockAds ? 4 : 0) | (s.blockAnnoyances ? 8 : 0) | (s.gpc ? 16 : 0);
  try { if (state.settings.allowlist[new URL(docUrl).hostname]) mask |= 32; } catch {}
  return mask;
}
export function proxyUrl(url, docUrl = url) {
  const u = new URL('/proxy', location.origin);
  u.searchParams.set('url', url);
  if (state.settings.extensions?.darkPages) u.searchParams.set('vespera_dark', '1');
  u.searchParams.set('vp', String(previewPrefsMask(docUrl)));
  return u.href;
}

export const platform = {
  get isElectron() { return typeof window.vespera === 'object' && window.vespera !== null; },
  get isPrivate() { return Boolean(window.vespera?.window?.isPrivate); },
  minimize() { window.vespera?.window?.minimize(); },
  maximize() { window.vespera?.window?.maximize(); },
  close() { window.vespera?.window?.close(); },
  inner(view) { return view?.querySelector('.content-frame') || null; },
  isWebview(view) { return this.inner(view)?.tagName === 'WEBVIEW'; },
  setAudioMuted(view, muted) {
    const frame = this.inner(view);
    if (frame?.tagName === 'WEBVIEW') {
      try { if (typeof frame.setAudioMuted === 'function') { frame.setAudioMuted(Boolean(muted)); return true; } } catch {}
      return false;
    }
    if (frame?.tagName === 'IFRAME' && frame.contentWindow) {
      try { frame.contentWindow.postMessage({ type: 'vespera:mute', muted: Boolean(muted) }, '*'); return true; } catch {}
    }
    return false;
  },
  async memoryBytes(view) {
    const frame = this.inner(view);
    if (!this.isElectron || frame?.tagName !== 'WEBVIEW' || typeof frame.getWebContentsId !== 'function') return null;
    try {
      const result = await window.vespera.app.tabMemory(frame.getWebContentsId());
      return result?.ok && Number.isFinite(result.bytes) ? result.bytes : null;
    } catch { return null; }
  },
  async capturePreview(view) {
    const frame = this.inner(view);
    if (frame?.tagName !== 'WEBVIEW' || typeof frame.capturePage !== 'function') return null;
    try {
      const image = await frame.capturePage();
      if (!image || image.isEmpty?.()) return null;
      const size = image.getSize?.();
      if (size?.width && size?.height && typeof image.resize === 'function') {
        const scale = Math.min(320 / size.width, 180 / size.height, 1);
        return image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }).toDataURL();
      }
      return image.toDataURL?.() || null;
    } catch { return null; }
  },
  createView(tab) {
    const wrapper = document.createElement('div');
    wrapper.className = 'web-frame';
    wrapper.dataset.tabId = tab.id;
    let frame;
    if (this.isElectron) {
      frame = document.createElement('webview');
      frame.setAttribute('src', tab.url);
      frame.setAttribute('partition', this.isPrivate ? 'incognito' : 'persist:vespera');
      frame.setAttribute('allowpopups', '');
    } else {
      frame = document.createElement('iframe');
      frame.src = proxyUrl(tab.url, tab.url);
      // Never combine allow-scripts with allow-same-origin for proxied websites.
      frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-downloads allow-modals');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.setAttribute('allow', 'fullscreen');
    }
    frame.className = 'content-frame';
    frame.setAttribute('title', 'Website: ' + tab.title);
    wrapper.appendChild(frame);
    return wrapper;
  },
  bindView(view, tab, handlers) {
    const frame = this.inner(view);
    const controller = new AbortController();
    const options = { signal: controller.signal };
    if (frame.tagName === 'WEBVIEW') {
      const reportAudio = (hint) => {
        let audible;
        try { if (typeof frame.isCurrentlyAudible === 'function') audible = frame.isCurrentlyAudible(); } catch {}
        if (typeof audible !== 'boolean') audible = hint;
        if (typeof audible === 'boolean') handlers.onAudioState?.({ audible });
      };
      frame.addEventListener('dom-ready', () => { if (tab.muted) this.setAudioMuted(view, true); reportAudio(false); }, options);
      frame.addEventListener('audio-state-changed', (e) => reportAudio(typeof e.audible === 'boolean' ? e.audible : e.detail?.audible), options);
      frame.addEventListener('media-started-playing', () => reportAudio(true), options);
      frame.addEventListener('media-paused', () => reportAudio(false), options);
      frame.addEventListener('did-start-loading', () => handlers.onLoading(true), options);
      frame.addEventListener('did-stop-loading', () => handlers.onLoading(false), options);
      frame.addEventListener('page-title-updated', (e) => handlers.onTitle(e.title), options);
      frame.addEventListener('did-navigate', (e) => handlers.onUrl(e.url), options);
      frame.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) handlers.onUrl(e.url); }, options);
      frame.addEventListener('page-favicon-updated', (e) => { if (e.favicons?.[0]) handlers.onFavicon(e.favicons[0]); }, options);
      frame.addEventListener('did-fail-load', (e) => {
        if (e.errorCode !== -3 && e.isMainFrame) handlers.onError(e.errorDescription || 'Failed to load page', e.errorCode);
      }, options);
      frame.addEventListener('ipc-message', (event) => {
        if (event.channel !== 'vespera:open-link') return;
        const request = event.args?.[0];
        if (!request || request.newTab !== true) return;
        const url = safeTabUrl(request.url, { allowFile: true });
        if (!url) return;
        const parsed = new URL(url);
        if (!['http:', 'https:', 'file:'].includes(parsed.protocol) || parsed.username || parsed.password) return;
        const gesture = request.gesture === 'middle' || request.gesture === 'modifier' ? request.gesture : '';
        handlers.onLink?.(url, true, request.foreground !== false, gesture);
      }, options);
      frame.addEventListener('found-in-page', (e) => handlers.onFound?.(e.result), options);
    } else {
      frame.addEventListener('load', () => {
        handlers.onLoading(false);
        if (tab.muted) this.setAudioMuted(view, true);
      }, options);
      const onMessage = (e) => {
        // Only this tab's opaque-origin frame may report its navigation.
        if (e.source !== frame.contentWindow || !e.data || typeof e.data !== 'object') return;
        const data = e.data;
        if (data.type === 'vespera:page') {
          if (typeof data.title === 'string') handlers.onTitle(data.title.slice(0, 500));
          if (typeof data.url === 'string' && /^https?:/.test(data.url)) handlers.onUrl(data.url);
          handlers.onLoading(false);
          if (data.error) handlers.onError(String(data.error).slice(0, 300));
        } else if (data.type === 'vespera:audio') {
          handlers.onAudioState?.({ audible: Boolean(data.audible) });
        } else if (data.type === 'vespera:navigate' && typeof data.url === 'string' && /^https?:\/\//i.test(data.url)) {
          handlers.onLink?.(data.url, Boolean(data.newTab), data.foreground !== false, data.gesture || '');
        } else if (data.type === 'vespera:context') {
          const rect = frame.getBoundingClientRect();
          const scale = tab.zoom || 1;
          handlers.onContext?.({ link: data.link, image: data.image, selection: data.selection }, rect.left + (Number(data.x) || 0) * scale, rect.top + (Number(data.y) || 0) * scale);
        } else if (data.type === 'vespera:shield' && ['tracker', 'ad'].includes(data.kind)) {
          handlers.onShield?.(data.kind, Math.max(0, Math.min(1000, Number(data.count) || 0)));
        } else if (data.type === 'vespera:download') {
          handlers.onDownload?.(data.url, data.name);
        }
      };
      window.addEventListener('message', onMessage, options);
    }
    return () => controller.abort();
  },
  navigateView(view, url) {
    const frame = this.inner(view);
    if (!frame) return;
    if (frame.tagName === 'WEBVIEW') frame.loadURL(url).catch(() => {});
    else frame.src = proxyUrl(url, url);
  },
  canGoBack(view) { const f = this.inner(view); return f?.tagName === 'WEBVIEW' && f.canGoBack(); },
  canGoForward(view) { const f = this.inner(view); return f?.tagName === 'WEBVIEW' && f.canGoForward(); },
  reload(view) {
    const frame = this.inner(view);
    if (!frame) return;
    if (frame.tagName === 'WEBVIEW') frame.reload();
    else frame.src = frame.getAttribute('src'); // Actually reload; never synthesize a load event.
  },
  /** Give the page keyboard focus so site shortcuts (YouTube's F, Space, arrows) work without an extra click. */
  focus(view) { try { this.inner(view)?.focus(); } catch { /* view not attached yet */ } },
  stop(view) { const f = this.inner(view); if (f?.tagName === 'WEBVIEW') f.stop(); else f?.setAttribute('src', 'about:blank'); },
  async injectCss(view, css, key = '__vespera_cosmetic') {
    const f = this.inner(view);
    if (f?.tagName !== 'WEBVIEW') return;
    try {
      if (css) await f.insertCSS(css);
      else await f.removeInsertedCSS(await f.executeJavaScript(`window[${JSON.stringify(key)}] || ''`));
    } catch { /* A navigation may have detached the frame. */ }
  },
  async setZoom(view, factor) {
    const f = this.inner(view);
    if (f?.tagName === 'WEBVIEW') f.setZoomFactor(factor);
    else if (view) {
      view.style.setProperty('--page-zoom', factor);
      if (f) { f.style.width = `${100 / factor}%`; f.style.height = `${100 / factor}%`; f.style.transform = `scale(${factor})`; }
      else { view.style.zoom = factor; }
    }
  },
  find(view, text, opts = {}) { const f = this.inner(view); if (f?.tagName === 'WEBVIEW') { if (text) f.findInPage(text, opts); else f.stopFindInPage('clearSelection'); } },
  stopFind(view) { const f = this.inner(view); if (f?.tagName === 'WEBVIEW') f.stopFindInPage('clearSelection'); },
  print(view) { const f = this.inner(view); if (f?.tagName === 'WEBVIEW') f.print(); },
  download(url) { const f = this.inner(viewOrCurrent()); if (f?.tagName === 'WEBVIEW') f.downloadURL(url); },
};
function viewOrCurrent() { return document.querySelector('.web-frame:not(.hidden)'); }
