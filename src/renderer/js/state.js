/** Vespera state — settings, bookmarks, history; local-first with account sync. */
import * as api from './api.js';
import { applyWallpaper } from './wallpaper.js';
import { SEARCH_ENGINES } from '../../shared/privacy-utils.mjs';

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
  tabBehavior: {
    middleClickOpensTab: true,
    middleClickClosesTab: true,
    openTabsNextToCurrent: true,
    scrollableTabStrip: true,
    hideCloseButtons: false,
    tabGroupsEnabled: true,
    tabAudioMode: 'click-to-mute', // click-to-mute | indicator | hidden
    tabHoverMode: 'card',          // card | preview | tooltip
    memoryUsageOnHover: true,
    inactiveTabAppearance: 'balanced', // balanced | dimmed | minimal
  },
  railHidden: false,             // hide the icon rail so pages get the full width
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
  wallpaper: { type: 'builtin', id: 'twilight' },
  wallpaperDim: 40,
  wallpaperAdjust: { zoom: 1, x: 50, y: 50, blur: 0, brightness: 100, saturation: 100 },
  wallpaperDrift: true,
  showWallpaper: true,
  customAccent: '#f6b93b',
  clockSeconds: true,
  clock24: false,
  extensions: { darkPages: false, focusMode: false },
  downloadPath: '',
  askDownloadLocation: true,
  onboarded: false,
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(fallback);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return structuredClone(fallback);
    return { ...fallback, ...parsed };
  } catch {
    return structuredClone(fallback);
  }
}

function normalizedTabBehavior(value = {}) {
  const behavior = { ...DEFAULT_SETTINGS.tabBehavior, ...(value || {}) };
  if (!['click-to-mute', 'indicator', 'hidden'].includes(behavior.tabAudioMode)) behavior.tabAudioMode = DEFAULT_SETTINGS.tabBehavior.tabAudioMode;
  if (!['card', 'preview', 'tooltip'].includes(behavior.tabHoverMode)) behavior.tabHoverMode = DEFAULT_SETTINGS.tabBehavior.tabHoverMode;
  if (!['balanced', 'dimmed', 'minimal'].includes(behavior.inactiveTabAppearance)) behavior.inactiveTabAppearance = DEFAULT_SETTINGS.tabBehavior.inactiveTabAppearance;
  for (const key of ['middleClickOpensTab', 'middleClickClosesTab', 'openTabsNextToCurrent', 'scrollableTabStrip', 'hideCloseButtons', 'tabGroupsEnabled', 'memoryUsageOnHover']) behavior[key] = Boolean(behavior[key]);
  return behavior;
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { queueMicrotask(() => bus.emit('storage-error', 'Device storage is full or unavailable. This change could not be saved.')); return false; }
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

const initialSettings = load(SETTINGS_KEY, DEFAULT_SETTINGS);
initialSettings.tabBehavior = normalizedTabBehavior(initialSettings.tabBehavior);

export const state = {
  private: Boolean(window.vespera?.window?.isPrivate),
  settings: initialSettings,
  bookmarks: load(BOOKMARKS_KEY, { items: [] }).items || [],
  history: load(HISTORY_KEY, { items: [] }).items || [],
  stats: load(STATS_KEY, { trackers: 0, ads: 0, linksCleaned: 0, httpsUpgrades: 0, bySite: {} }),
  user: api.getToken() ? api.getCachedUser() : null,

  saveSettings() {
    // Deep-merge shields so partial objects don't drop keys.
    if (!SEARCH_ENGINES[this.settings.searchEngine]) this.settings.searchEngine = 'startpage';
    const merged = { ...DEFAULT_SETTINGS, ...this.settings,
      shields: { ...DEFAULT_SETTINGS.shields, ...(this.settings.shields || {}) },
      extensions: { ...DEFAULT_SETTINGS.extensions, ...(this.settings.extensions || {}) },
      tabBehavior: normalizedTabBehavior(this.settings.tabBehavior),
      allowlist: { ...(this.settings.allowlist || {}) },
    };
    this.settings = merged;
    const saved = save(SETTINGS_KEY, merged);
    window.vespera?.prefs?.save(merged);
    bus.emit('settings', merged);
    this.pushSync('settings', merged);
    return saved;
  },

  set(path, value) {
    const parts = path.split('.');
    let obj = this.settings;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts.at(-1)] = value;
    return this.saveSettings();
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
    if (this.private || url.startsWith('vespera://') || !/^https?:/.test(url)) return;
    const previous = this.history.find((h) => h.url === url);
    this.history = this.history.filter((h) => h.url !== url);
    this.history.unshift({ title: title && title !== url ? title : (previous?.title || url), url, visitedAt: Date.now() });
    if (this.history.length > 500) this.history.length = 500;
    save(HISTORY_KEY, { items: this.history });
    bus.emit('history', this.history);
    this.pushSync('history', { items: this.history.slice(0, 200) });
  },
  removeHistory(url) {
    this.history = this.history.filter((h) => h.url !== url);
    save(HISTORY_KEY, { items: this.history });
    bus.emit('history', this.history);
    this.pushSync('history', { items: this.history });
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
    if (host && (kind === 'tracker' || kind === 'ad')) {
      this.stats.bySite[host] = (this.stats.bySite[host] || 0) + 1;
    }
    if (!this.private) save(STATS_KEY, this.stats);
    bus.emit('stats', this.stats);
  },

  // ---- account sync (last-write-wins) ----
  syncTimers: {},
  pushSync(part, value) {
    if (!this.user || this.private) return;
    clearTimeout(this.syncTimers[part]);
    this.syncTimers[part] = setTimeout(async () => {
      const r = await api.sync.putPart(part, value);
      if (r.status === 401) this.clearSession();
      else if (!r.ok) bus.emit('sync-error', r.message || 'Sync is unavailable right now.');
    }, 700);
  },

  clearSession() {
    for (const timer of Object.values(this.syncTimers)) clearTimeout(timer);
    this.syncTimers = {};
    api.setSession(null, null);
    this.user = null;
    bus.emit('user', null);
  },

  async pullSync() {
    if (!this.user || this.private) return { ok: false, skipped: true };
    const r = await api.sync.get();
    if (r.status === 401) { this.clearSession(); return { ok: false, message: 'Your session expired. Please sign in again.' }; }
    if (!r.ok || !r.collections) return { ok: false, message: r.message || 'Could not reach your sync store.' };
    const { settings, bookmarks, history } = r.collections;
    if (settings && typeof settings === 'object' && Object.keys(settings).length) {
      this.settings = {
        ...DEFAULT_SETTINGS, ...settings,
        shields: { ...DEFAULT_SETTINGS.shields, ...(settings.shields || {}) },
        extensions: { ...DEFAULT_SETTINGS.extensions, ...(settings.extensions || {}) },
        tabBehavior: normalizedTabBehavior(settings.tabBehavior),
        allowlist: { ...(settings.allowlist || {}) },
      };
      save(SETTINGS_KEY, this.settings);
      bus.emit('settings', this.settings);
    }
    if (bookmarks && Array.isArray(bookmarks.items)) {
      const remote = bookmarks.items.filter((b) => b && typeof b.url === 'string');
      const seen = new Set(remote.map((b) => b.url));
      this.bookmarks = [...remote, ...this.bookmarks.filter((b) => !seen.has(b.url))];
      save(BOOKMARKS_KEY, { items: this.bookmarks });
      bus.emit('bookmarks', this.bookmarks);
    }
    if (history && Array.isArray(history.items)) {
      const remote = history.items.filter((h) => h && typeof h.url === 'string' && Number.isFinite(h.visitedAt));
      this.history = [...remote, ...this.history.filter((h) => !remote.some((r2) => r2.url === h.url))]
        .sort((a, b) => b.visitedAt - a.visitedAt).slice(0, 500);
      save(HISTORY_KEY, { items: this.history });
      bus.emit('history', this.history);
    }
    return { ok: true };
  },

  async syncNow() {
    if (!this.user || this.private) return { ok: false, message: 'Sign in to sync your data.' };
    const pulled = await this.pullSync();
    if (!pulled.ok) return pulled;
    const parts = [
      ['settings', this.settings],
      ['bookmarks', { items: this.bookmarks }],
      ['history', { items: this.history.slice(0, 200) }],
    ];
    for (const [part, value] of parts) {
      clearTimeout(this.syncTimers[part]);
      const r = await api.sync.putPart(part, value);
      if (!r.ok) {
        if (r.status === 401) this.clearSession();
        return { ok: false, message: r.message || 'Sync failed. Please try again.' };
      }
    }
    return { ok: true };
  },

  async setUser(user) {
    this.user = user;
    api.setSession(api.getToken(), user);
    if (!user) {
      for (const timer of Object.values(this.syncTimers)) clearTimeout(timer);
      this.syncTimers = {};
    }
    bus.emit('user', user);
    if (user && !this.private) return this.pullSync();
    return { ok: true };
  },
};

/** Apply theme + accent to <html>. Custom image bytes never enter settings/sync. */
export function applyAppearance() {
  const s = state.settings;
  const media = matchMedia('(prefers-color-scheme: light)');
  const theme = s.theme === 'system' ? (media.matches ? 'light' : 'dark') : s.theme;
  const root = document.documentElement;
  root.dataset.theme = ['light', 'dark'].includes(theme) ? theme : 'dark';
  root.dataset.accent = ['gold', 'violet', 'teal', 'rose'].includes(s.accent) ? s.accent : 'custom';
  root.dataset.density = s.density === 'compact' ? 'compact' : 'comfortable';
  if (s.accent === 'custom' && /^#[0-9a-f]{6}$/i.test(s.customAccent || '')) {
    const hex = s.customAccent;
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const ink = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 150 ? '#101522' : '#ffffff';
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-2', hex);
    root.style.setProperty('--accent-ink', ink);
    root.style.setProperty('--accent-soft', `rgba(${rgb.join(',')}, .17)`);
  } else {
    for (const key of ['--accent', '--accent-2', '--accent-ink', '--accent-soft']) root.style.removeProperty(key);
  }
  document.body.classList.toggle('vertical-tabs', s.tabLayout === 'vertical');
  document.body.classList.toggle('focus-mode', Boolean(s.extensions?.focusMode));
  document.documentElement.dataset.wpDrift = s.wallpaperDrift === false ? 'off' : 'on';
  void applyWallpaper(s);
}
