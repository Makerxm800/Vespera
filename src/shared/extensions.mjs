/** Small, auditable extensions shipped with Vespera. No third-party code is installed silently. */
export const BUILTIN_EXTENSIONS = [
  {
    id: 'shields', name: 'Vespera Shields', version: '1.0', icon: 'shield', category: 'Privacy',
    description: 'Network-level tracker and ad blocking, cleaner links, and per-site controls.',
    detail: 'Included in Vespera. Uses the bundled filter lists; no remote filter-list downloads or analytics.', setting: 'shields.enabled'
  },
  {
    id: 'darkPages', name: 'Dark Pages', version: '1.0', icon: 'moon', category: 'Appearance',
    description: 'Give bright websites a dark reading surface. Images keep their original colors.',
    detail: 'A local stylesheet applied to websites. Some complex sites may need this switched off. Your browser theme is controlled separately.', setting: 'extensions.darkPages'
  },
  {
    id: 'reader', name: 'Reader View', version: '1.0', icon: 'eye', category: 'Reading',
    description: 'Extract an article into a quiet, readable page, with adjustable text size.',
    detail: 'Articles are extracted only when you choose Reader View. Preview extraction is limited to reachable sites; the desktop app can read pages loaded in Chromium.', action: 'reader'
  },
  {
    id: 'focusMode', name: 'Focus Mode', version: '1.0', icon: 'split', category: 'Productivity',
    description: 'Hide the side rail and bookmarks bar for a little more room to think.',
    detail: 'Changes only the Vespera interface. All your tabs stay open, and you can leave Focus Mode from the menu at any time.', setting: 'extensions.focusMode'
  },
];

/**
 * Site-access helpers shared by the Extensions page and the toolbar menu.
 * Chrome reports an extension's reach as "On all sites", "On this site" or
 * no site access, based on its host permissions and content-script matches.
 */

/** Hostname of a tab URL, or '' for non-web pages. */
export function hostFromUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.toLowerCase() : '';
  } catch { return ''; }
}

/**
 * Minimal Chrome match-pattern check for the schemes extensions actually use
 * (http/https, plus file: for unpacked dev extensions). Supports "*", exact
 * hosts, "*.example.com" subdomain wildcards and path suffixes.
 */
export function matchPattern(pattern, host) {
  const raw = String(pattern || '').trim();
  if (!raw || !host) return false;
  if (raw === '<all_urls>') return true;
  let value = raw;
  let path = '/';
  const schemeIdx = value.indexOf('://');
  if (schemeIdx === -1) return false;
  const scheme = value.slice(0, schemeIdx).toLowerCase();
  // "*" is the match-pattern wildcard for http/https.
  if (!['*', 'http', 'https', 'file', 'ftp'].includes(scheme)) return false;
  value = value.slice(schemeIdx + 3);
  const slash = value.indexOf('/');
  if (slash !== -1) { path = value.slice(slash); value = value.slice(0, slash); }
  if (scheme === 'file') return host === 'localhost' || host === '';
  let patternHost = value.toLowerCase();
  if (patternHost === '*') return true;
  if (patternHost.startsWith('*.')) patternHost = patternHost.slice(2);
  if (patternHost !== host && !host.endsWith('.' + patternHost)) return false;
  if (!path || path === '/') return true;
  // Path matching: a trailing * matches any suffix; otherwise exact prefix.
  if (path.endsWith('*')) return true;
  return path === '/' || host !== ''; // Host-only patterns cover the whole origin.
}

/**
 * Classify one extension's reach for a given site.
 * level: 'all' (On all sites) | 'site' (On this site) | 'none'.
 */
export function extensionSiteAccess(ext, host = '') {
  const patterns = Array.isArray(ext?.hostPermissions) ? ext.hostPermissions : [];
  const enabled = Boolean(ext?.enabled);
  const all = patterns.some((p) => ['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*'].includes(String(p).trim()));
  const onSite = !all && patterns.some((p) => matchPattern(p, host));
  if (!enabled) return { level: 'none', enabled: false, all: false, onSite: false, access: 'Disabled' };
  if (all) return { level: 'all', enabled: true, all: true, onSite: true, access: 'On all sites' };
  if (onSite) return { level: 'site', enabled: true, all: false, onSite: true, access: 'On this site' };
  return { level: 'none', enabled: true, all: false, onSite: false, access: 'No site access' };
}

/** Plain-language summary of what an extension needs to run. */
export function extensionNeedsSummary(ext, host = '') {
  const permissions = Array.isArray(ext?.permissions) ? ext.permissions : [];
  const access = extensionSiteAccess(ext, host);
  const parts = [];
  if (permissions.length) parts.push(`${permissions.length} permission${permissions.length === 1 ? '' : 's'} declared`);
  parts.push(access.access);
  return parts.join(' · ');
}

/**
 * Curated catalog: trusted, popular extensions users most often want.
 * Each entry links to the developer's official download/store page — Vespera
 * never hosts or repackages anyone's code. The user downloads the package and
 * installs it locally, with a full permission review before it loads.
 */
export const EXTENSION_CATALOG = [
  {
    name: 'uBlock Origin', developer: 'Raymond Hill (gorhill)', category: 'Privacy',
    description: 'Efficient, wide-spectrum content blocker. The gold standard of ad blockers.',
    url: 'https://github.com/gorhill/uBlock/releases'
  },
  {
    name: 'uBlock Origin Lite', developer: 'Raymond Hill (gorhill)', category: 'Privacy',
    description: 'Permission-light experimental version of uBlock Origin, MV3-native.',
    url: 'https://github.com/uBlockOrigin/uBOL-home/releases'
  },
  {
    name: 'Dark Reader', developer: 'Dark Reader Ltd', category: 'Appearance',
    description: 'Dark mode for every website, with brightness and contrast controls.',
    url: 'https://github.com/darkreader/darkreader/releases'
  },
  {
    name: 'Bitwarden', developer: 'Bitwarden Inc.', category: 'Security',
    description: 'Free, open-source password manager with end-to-end encryption.',
    url: 'https://bitwarden.com/download/'
  },
  {
    name: 'SponsorBlock', developer: 'ajay', category: 'Productivity',
    description: 'Skip sponsor segments, intros and self-promotion in YouTube videos.',
    url: 'https://github.com/ajayyy/SponsorBlock/releases'
  },
  {
    name: 'Return YouTube Dislike', developer: 'Anarios & JRWR', category: 'Productivity',
    description: 'Restores the dislike counter on YouTube videos.',
    url: 'https://github.com/Anarios/return-youtube-dislike'
  },
  {
    name: 'Decentraleyes', developer: 'Thomas Rientjes', category: 'Privacy',
    description: 'Serves popular CDN libraries locally to avoid third-party requests.',
    url: 'https://github.com/ThomasRientjes/decentraleyes'
  },
  {
    name: 'Privacy Badger', developer: 'EFF', category: 'Privacy',
    description: 'Automatically learns to block invisible trackers as you browse.',
    url: 'https://github.com/EFForg/privacybadger'
  },
  {
    name: 'I don\'t care about cookies', developer: 'Gen Login BV', category: 'Browsing',
    description: 'Hides cookie warnings from almost all websites.',
    url: 'https://www.genlogin.com/icac'
  },
  {
    name: 'Stylus', developer: 'Stylus Team', category: 'Appearance',
    description: 'Userstyle manager: redesign any website with community themes.',
    url: 'https://github.com/openstyles/stylus/releases'
  },
  {
    name: 'LocalCDN', developer: 'nosync', category: 'Privacy',
    description: 'Keeps web requests local to protect your privacy against CDNs.',
    url: 'https://www.localcdn.de'
  },
  {
    name: 'Violentmonkey', developer: 'Gerald Chen', category: 'Productivity',
    description: 'Open-source userscript manager for custom site tweaks.',
    url: 'https://github.com/violentmonkey/violentmonkey/releases'
  },
];
