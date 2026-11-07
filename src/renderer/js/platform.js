/**
 * Vespera platform bridge — one API for both runtime targets.
 *
 *  - Electron (desktop, real Chromium webviews): window.vespera API from preload
 *  - Web preview / browser: iframes via the local /proxy endpoint
 */

export const platform = {
  get isElectron() {
    return typeof window.vespera === 'object' && window.vespera !== null;
  },

  /** Window controls (Electron only). */
  minimize() { window.vespera?.window?.minimize(); },
  maximize() { window.vespera?.window?.maximize(); },
  close() { window.vespera?.window?.close(); },

  /**
   * Create the live content element for a tab.
   * @returns {HTMLElement}
   */
  createView(tab) {
    const url = tab.url;
    if (url.startsWith('vespera://')) {
      const div = document.createElement('div');
      div.className = 'page-scroll';
      return div; // internal page DOM renders into this
    }
    if (this.isElectron) {
      const wv = document.createElement('webview');
      wv.setAttribute('src', url);
      wv.setAttribute('allowpopups', 'true');
      wv.style.width = '100%';
      wv.style.height = '100%';
      return wv;
    }
    const iframe = document.createElement('iframe');
    iframe.className = 'content-frame';
    iframe.src = '/proxy?url=' + encodeURIComponent(url);
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    return iframe;
  },

  /** Attach navigation/load listeners to a live view. */
  bindView(view, tab, handlers) {
    if (view.tagName === 'WEBVIEW') {
      view.addEventListener('did-start-loading', () => handlers.onLoading(true));
      view.addEventListener('did-stop-loading', () => handlers.onLoading(false));
      view.addEventListener('page-title-updated', (e) => handlers.onTitle(e.title));
      view.addEventListener('did-navigate', (e) => handlers.onUrl(e.url));
      view.addEventListener('did-navigate-in-page', (e) => {
        if (e.isMainFrame) handlers.onUrl(e.url);
      });
      view.addEventListener('page-favicon-updated', (e) => {
        if (e.favicons && e.favicons[0]) handlers.onFavicon(e.favicons[0]);
      });
      view.addEventListener('did-fail-load', (e) => {
        if (e.errorCode !== -3) handlers.onError(e.errorDescription || 'Failed to load page');
      });
    } else if (view.tagName === 'IFRAME') {
      view.addEventListener('load', () => {
        handlers.onLoading(false);
        try {
          const title = view.contentDocument?.title;
          if (title) handlers.onTitle(title);
        } catch { /* cross-origin proxy frame */ }
      });
    }
  },

  /** Navigate a live view. */
  navigateView(view, url) {
    if (!view) return;
    if (view.tagName === 'WEBVIEW') {
      if (view.getURL && view.getURL() === url) view.reload();
      else view.setAttribute('src', url);
    } else if (view.tagName === 'IFRAME') {
      view.src = '/proxy?url=' + encodeURIComponent(url);
    }
  },

  goBack(view) { if (view?.tagName === 'WEBVIEW' && view.canGoBack()) view.goBack(); },
  goForward(view) { if (view?.tagName === 'WEBVIEW' && view.canGoForward()) view.goForward(); },
  reload(view) { if (view) view.tagName === 'WEBVIEW' ? view.reload() : view.dispatchEvent(new Event('load')); },

  /** Execute cosmetic filtering CSS inside a page (Electron webviews only). */
  injectCss(view, css) {
    if (view?.tagName === 'WEBVIEW' && css) {
      const esc = JSON.stringify(css).replace(/'/g, "\\'");
      view.executeJavaScript(
        `(function(){var s=document.getElementById('__vespera_cosmetic');if(s)s.remove();
          s=document.createElement('style');s.id='__vespera_cosmetic';s.textContent=${JSON.stringify(css)};
          (document.head||document.documentElement).appendChild(s);})()`
      ).catch(() => {});
    }
  },
};
