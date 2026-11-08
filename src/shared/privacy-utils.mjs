/**
 * Vespera Privacy Utilities — link cleaning, search engines, URL helpers.
 * Shared ESM module: imported by the browser renderer directly, and by the
 * Node/Electron side via `await import()` / `require()` (Node 22+).
 */

/**
 * Query parameters that exist purely for tracking/campaign attribution.
 * Removing them never changes the destination content.
 */
export const TRACKING_PARAMS = new Set([
  // UTM family (Google Analytics / Ads)
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_name', 'utm_cid', 'utm_reader', 'utm_place', 'utm_social',
  'utm_social-type', 'utm_viz_id', 'utm_region',
  // Click IDs
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid',
  'ttclid', 'twclid', 'yclid', 'igshid', 'srsltid', 'epik', 'mc_eid',
  'mkt_tok', 'vero_id', 'vero_conv', 'rb_clickid', 's_cid', 'ncid',
  'cmpid', 'spm', 'scid', 'wt_mc', 'cmpid', 'mbid', 'oly_anon_id',
  'oly_enc_id', 'ml_subscriber', 'ml_subscriber_hash',
  // HubSpot / Marketo / email
  '__hstc', '__hssc', '__hsfp', 'hsCtaTracking', 'hsa_cam', 'hsa_ad',
  'hsa_grp', 'hsa_kw', 'hsa_mt', 'hsa_src', 'hsa_ver', 'hsa_acc',
  '_hsenc', '_hsmi', 'ck_subscriber_id',
  // Misc analytics
  '_ga', '_gl', 'ga_source', 'ga_medium', 'ga_term', 'ga_content', 'ga_campaign',
  'zanpid', 'irgwc', 'click_id', 'aff_id', 'affiliate_id', 'affiliate',
  'partner_id', 'partner-type', 'ref_src', 'ref_url', 'trk', 'trkcampaign',
  'srcid', 'ncid', 'mbid', 'cid_source', 'cid_medium', 'cid_campaign',
]);

/**
 * Strip tracking parameters from a URL, keeping everything else intact.
 * @param {string} href
 * @returns {{url: string, removed: string[]}}
 */
export function cleanTrackingParams(href) {
  let url;
  try { url = new URL(href); } catch { return { url: href, removed: [] }; }
  if (!url.search || url.search.length < 2) return { url: href, removed: [] };

  const removed = [];
  const keys = [...url.searchParams.keys()];
  for (const key of keys) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      removed.push(key);
      url.searchParams.delete(key);
    }
  }
  return { url: url.toString(), removed };
}

/** Strip the tracking-heavy referrer down to the origin (or nothing). */
export function strictReferrer(fromUrl, toUrl) {
  try {
    const from = new URL(fromUrl);
    const to = new URL(toUrl);
    if (from.origin === to.origin) return from.href; // same-site: full referrer ok
    return from.origin + '/';                         // cross-site: origin only
  } catch {
    return null;
  }
}

/**
 * Vespera search engines. `{query}` is replaced with the URL-encoded query.
 * Startpage is the default — Google-quality results with zero tracking.
 */
export const SEARCH_ENGINES = {
  startpage: {
    id: 'startpage', name: 'Startpage',
    search: 'https://www.startpage.com/sp/search?query={query}',
    suggest: null,
  },
  duckduckgo: {
    id: 'duckduckgo', name: 'DuckDuckGo',
    search: 'https://duckduckgo.com/?q={query}',
    suggest: 'https://duckduckgo.com/ac/?q={query}',
  },
  brave: {
    id: 'brave', name: 'Brave Search',
    search: 'https://search.brave.com/search?q={query}',
    suggest: null,
  },
  google: {
    id: 'google', name: 'Google',
    search: 'https://www.google.com/search?q={query}',
    suggest: 'https://www.google.com/complete/search?client=firefox&q={query}',
  },
  ecosia: {
    id: 'ecosia', name: 'Ecosia',
    search: 'https://www.ecosia.org/search?q={query}',
    suggest: null,
  },
  mojeek: {
    id: 'mojeek', name: 'Mojeek',
    search: 'https://www.mojeek.com/search?q={query}',
    suggest: null,
  },
  wikipedia: {
    id: 'wikipedia', name: 'Wikipedia',
    search: 'https://en.wikipedia.org/w/index.php?search={query}',
    suggest: null,
  },
};

/** Build a search URL for `query` with the given engine id (default: startpage). */
export function buildSearchUrl(query, engineId = 'startpage') {
  const engine = SEARCH_ENGINES[engineId] || SEARCH_ENGINES.startpage;
  return engine.search.replace('{query}', encodeURIComponent(query));
}

/**
 * Decide whether omnibox input is a URL or a search query.
 * @returns {{kind:'url'|'search'|'internal', value:string}}
 */
export function classifyInput(input) {
  const text = input.trim();
  if (!text) return { kind: 'search', value: '' };

  // Internal vespera:// pages
  if (/^vespera:\/\//i.test(text)) return { kind: 'internal', value: 'vespera://' + text.slice(10) };
  if (/^(about|chrome|edge):/i.test(text)) {
    const m = text.toLowerCase().match(/^(?:about|chrome|edge):([\w-]*)/);
    const page = m ? m[1] : '';
    return { kind: 'internal', value: 'vespera://' + (page || 'newtab') };
  }

  // Explicit schemes
  if (/^[a-z][a-z0-9+.\-]*:\/\//i.test(text)) {
    if (/^https?:/i.test(text)) return { kind: 'url', value: text };
    // Block dangerous schemes (privacy/security hardening).
    if (/^(javascript|data|vbscript|file|blob):/i.test(text)) {
      return { kind: 'search', value: text };
    }
    return { kind: 'search', value: text };
  }

  // localhost / IPs / host:port
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(text) ||
      /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(text)) {
    return { kind: 'url', value: 'http://' + text };
  }

  if (/^[a-z][a-z0-9+.\-]*:/i.test(text)) return { kind: 'search', value: text };

  // domain.tld or domain.tld/path — must have a known-looking TLD and no spaces.
  if (!/\s/.test(text)) {
    const m = text.match(/^([\w\-]+(\.[\w\-]+)+)(:\d+)?([/?#].*)?$/);
    if (m) {
      const tld = m[1].split('.').pop();
      if (tld && tld.length >= 2 && /^[a-z]+$/i.test(tld)) {
        return { kind: 'url', value: 'https://' + text };
      }
    }
  }
  return { kind: 'search', value: text };
}

/** Is this an internal Vespera page? */
export function isInternal(url) {
  return /^vespera:\/\//i.test(url || '');
}

/** Internal page registry — label + icon key for the chrome UI. */
export const INTERNAL_PAGES = {
  'vespera://newtab': { title: 'New Tab', icon: 'sparkle' },
  'vespera://welcome': { title: 'Welcome', icon: 'sparkle' },
  'vespera://settings': { title: 'Settings', icon: 'gear' },
  'vespera://privacy': { title: 'Privacy Hub', icon: 'shield' },
  'vespera://community': { title: 'Community', icon: 'users' },
  'vespera://account': { title: 'Account', icon: 'user' },
  'vespera://history': { title: 'History', icon: 'clock' },
  'vespera://bookmarks': { title: 'Bookmarks', icon: 'bookmark' },
  'vespera://downloads': { title: 'Downloads', icon: 'download' },
  'vespera://shields': { title: 'Shields', icon: 'shield' },
  'vespera://extensions': { title: 'Extensions', icon: 'split' },
  'vespera://logs': { title: 'Logs', icon: 'flask' },
  'vespera://reader': { title: 'Reader View', icon: 'eye' },
  'vespera://search': { title: 'Preview Search', icon: 'search' },
  'vespera://updates': { title: 'What’s New', icon: 'sparkle' },
};

/**
 * Third-party check: does the request host differ from the document host
 * (registrable-domain level approximation)?
 */
export function isThirdParty(requestUrl, documentUrl) {
  try {
    const a = new URL(requestUrl);
    const b = new URL(documentUrl);
    const ha = a.hostname.toLowerCase().split('.').slice(-2).join('.');
    const hb = b.hostname.toLowerCase().split('.').slice(-2).join('.');
    return ha !== hb;
  } catch {
    return true;
  }
}

/** Keep queries intact while looking up an internal page renderer. */
export function internalPageKey(url) {
  return String(url || '').split(/[?#]/)[0].replace(/\/$/, '').toLowerCase();
}

/** Only web URLs and our own pages may become browser tabs. */
export function safeTabUrl(value) {
  const text = String(value || '').trim();
  if (/^vespera:\/\//i.test(text)) return text;
  try { const u = new URL(text); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; }
  catch { return null; }
}
