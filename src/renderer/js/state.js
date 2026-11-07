/** Vespera state — settings, bookmarks, history; local-first with account sync. */
import * as api from './api.js';

const SETTINGS_KEY = 'vespera.settings';
const BOOKMARKS_KEY = 'vespera.bookmarks';
const HISTORY_KEY = 'vespera.history';
const STATS_KEY = 'vespera.stats';

export const DEFAULT_SETTINGS = {
  theme: 'dark',                 // dark | light | system
  accent: 'gold',                // gold | violet | teal | rose
  density: 'comfortable',        // comfortable | compact
  searchEngine: 'startpage',
  tabLayout: 'horizontal',       // horizontal | vertical
  homepage: 'vespera://newtab',
  showBookmarksBar: false,
  shields: {
    enabled: true,
    blockTrackers: true,
    blockAds: true,
    blockAnnoyances: false,
    cleanLinks: true,
    httpsOnly: true,
    gpc: true,                   // Global Privacy Control + DNT headers
    antiFingerprint: true,
  },
  allowlist: {},                 // hostname -> true (shields off for that site)
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

/** Simple event emitter for UI updates. */
class Emitter {
  constructor() { this.map = new Map(); }
  on(ev, fn) {
    if (!this.map.has(ev)) this.map.set(ev, new Set());
    this.map.get(ev).add(fn);
    return () => this.map.get(ev).delete(fn);
  }
  emit(ev, data) {
    for (const fn of this.map.get(ev) || []) {
      try { fn(data); } catch (err) { console.error('[vespera]', err); }
    }
  }
}

export const bus = new Emitter();

export const state = {
  settings: load(SETTINGS_KEY, DEFAULT_SETTINGS),
  bookmarks: load(BOOKMARKS_KEY, { items: [] }).items || [],
  history: load(HISTORY_KEY, { items: [] }).items || [],
  stats: load(STATS_KEY, { trackers: 0, ads: 0, linksCleaned: 0, httpsUpgrades: 0, bySite: {} }),
  user: api.getCachedUser(),

  saveSettings() {
    // Deep-merge shields so partial objects don't drop keys.
    const merged = { ...DEFAULT_SETTINGS, ...this.settings, shields: { ...DEFAULT_SETTINGS.shields, ...(this.settings.shields || {}) } };
    this.settings = merged;
    save(SETTINGS_KEY, merged);
    bus.emit('settings', merged);
    this.pushSync('settings', merged);
  },

  set(path, value) {
    const parts = path.split('.');
    let obj = this.settings;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts.at(-1)] = value;
    this.saveSettings();
  },

  // ---- bookmarks ----
  addBookmark({ title, url }) {
    if (this.bookmarks.some((b) => b.url === url)) return false;
    this.bookmarks.unshift({ id: 'b_' + Math.random().toString(36).slice(2, 10), title, url, createdAt: Date.now() });
    save(BOOKMARKS_KEY, { items: this.bookmarks });
    bus.emit('bookmarks', this.bookmarks);
    this.pushSync('bookmarks', { items: this.bookmarks });
    return true;
  },
  removeBookmark(id) {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
    save(BOOKMARKS_KEY, { items: this.bookmarks });
    bus.emit('bookmarks', this.bookmarks);
    this.pushSync('bookmarks', { items: this.bookmarks });
  },
  isBookmarked(url) {
    return this.bookmarks.some((b) => b.url === url);
  },

  // ---- history ----
  addHistory({ title, url }) {
    if (url.startsWith('vespera://')) return;
    this.history = this.history.filter((h) => h.url !== url);
    this.history.unshift({ title, url, visitedAt: Date.now() });
    if (this.history.length > 500) this.history.length = 500;
    save(HISTORY_KEY, { items: this.history });
    bus.emit('history', this.history);
    this.pushSync('history', { items: this.history.slice(0, 200) });
  },
  clearHistory() {
    this.history = [];
    save(HISTORY_KEY, { items: [] });
    bus.emit('history', []);
    this.pushSync('history', { items: [] });
  },

  // ---- privacy stats (session lifetime, per browser) ----
  recordBlock(kind, host) {
    if (kind === 'tracker') this.stats.trackers++;
    else if (kind === 'ad') this.stats.ads++;
    else if (kind === 'link') this.stats.linksCleaned++;
    else if (kind === 'https') this.stats.httpsUpgrades++;
    if (host) {
      this.stats.bySite[host] = (this.stats.bySite[host] || 0) + 1;
    }
    save(STATS_KEY, this.stats);
    bus.emit('stats', this.stats);
  },

  // ---- account sync (last-write-wins) ----
  syncTimer: null,
  pushSync(part, value) {
    if (!this.user) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(async () => {
      const r = await api.sync.putPart(part, value);
      if (r.status === 401) { api.setSession(null, null); this.user = null; bus.emit('user', null); }
    }, 700);
  },

  async pullSync() {
    if (!this.user) return;
    const r = await api.sync.get();
    if (!r.ok || !r.collections) return;
    const { settings, bookmarks, history } = r.collections;
    // Merge policy: adopt remote values if present (single-user LWW).
    if (settings && Object.keys(settings).length) {
      this.settings = { ...DEFAULT_SETTINGS, ...settings, shields: { ...DEFAULT_SETTINGS.shields, ...(settings.shields || {}) } };
      save(SETTINGS_KEY, this.settings);
      bus.emit('settings', this.settings);
    }
    if (bookmarks && Array.isArray(bookmarks.items)) {
      // Union by url, remote wins on conflict.
      const seen = new Set(bookmarks.items.map((b) => b.url));
      this.bookmarks = [...bookmarks.items, ...this.bookmarks.filter((b) => !seen.has(b.url))];
      save(BOOKMARKS_KEY, { items: this.bookmarks });
      bus.emit('bookmarks', this.bookmarks);
    }
    if (history && Array.isArray(history.items)) {
      this.history = [...history.items, ...this.history.filter((h) => !history.items.some((r2) => r2.url === h.url))]
        .sort((a, b) => b.visitedAt - a.visitedAt).slice(0, 500);
      save(HISTORY_KEY, { items: this.history });
      bus.emit('history', this.history);
    }
  },

  setUser(user) {
    this.user = user;
    api.setSession(api.getToken(), user);
    bus.emit('user', user);
    if (user) this.pullSync();
  },
};

/** Apply theme + accent to <html>. */
export function applyAppearance() {
  const s = state.settings;
  const theme = s.theme === 'system'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : s.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = s.accent;
  document.documentElement.dataset.density = s.density || 'comfortable';
  document.body.classList.toggle('vertical-tabs', s.tabLayout === 'vertical');
}
