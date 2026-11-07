/** Vespera omnibox — unified address & search bar with smart suggestions. */
import { state } from './state.js';
import { escapeHtml } from './toasts.js';
import { icon } from './icons.js';

const SEARCH_HINTS = [
  'privacy-focused browser',
  'how to block trackers',
  'best ad blocker 2026',
];

let selectedIndex = -1;
let items = [];
let blurTimer = null;

export function initOmnibox({ onNavigate }) {
  const input = document.getElementById('omni-input');
  const box = document.getElementById('omni-input') && document.getElementById('omnibox');
  const dropdown = document.getElementById('suggestions');
  const engineTag = document.getElementById('engine-tag');

  if (!input) return;

  const engineNames = {
    startpage: 'Startpage', duckduckgo: 'DuckDuckGo', brave: 'Brave',
    google: 'Google', ecosia: 'Ecosia', mojeek: 'Mojeek', wikipedia: 'Wikipedia',
  };
  engineTag.textContent = engineNames[state.settings.searchEngine] || 'Startpage';

  function render(q) {
    const query = q.trim();
    items = [];

    if (!query) {
      const recents = state.history.slice(0, 4);
      items = recents.map((h) => ({ kind: 'history', title: h.title || h.url, sub: h.url, url: h.url }));
      if (!items.length) {
        items = SEARCH_HINTS.map((t) => ({
          kind: 'search', title: t, sub: 'Search with ' + engineTag.textContent, query: t,
        }));
      }
    } else {
      // Internal pages first
      const internals = [
        ['vespera://newtab', 'New Tab'], ['vespera://welcome', 'Welcome'],
        ['vespera://settings', 'Settings'], ['vespera://privacy', 'Privacy Dashboard'],
        ['vespera://community', 'Community — vote on features'], ['vespera://account', 'Account & Sync'],
        ['vespera://history', 'History'], ['vespera://bookmarks', 'Bookmarks'], ['vespera://downloads', 'Downloads'],
      ].filter(([url, title]) => (url + ' ' + title).toLowerCase().includes(query.toLowerCase()))
        .slice(0, 3)
        .map(([url, title]) => ({ kind: 'internal', title, sub: url, url }));

      const hist = state.history
        .filter((h) => (h.title + ' ' + h.url).toLowerCase().includes(query.toLowerCase()))
        .slice(0, 4)
        .map((h) => ({ kind: 'history', title: h.title || h.url, sub: h.url, url: h.url }));

      const bms = state.bookmarks
        .filter((b) => (b.title + ' ' + b.url).toLowerCase().includes(query.toLowerCase()))
        .slice(0, 3)
        .map((b) => ({ kind: 'bookmark', title: b.title, sub: b.url, url: b.url }));

      items = [
        ...internals,
        ...bms,
        ...hist,
        { kind: 'search', title: query, sub: 'Search with ' + engineTag.textContent, query },
        { kind: 'url', title: guessUrl(query), sub: 'Open as website', url: guessUrl(query) },
      ];
    }

    if (!items.length) { dropdown.classList.add('hidden'); return; }
    selectedIndex = items.length ? 0 : -1;
    dropdown.innerHTML = items.map((it, i) => `
      <div class="suggestion ${i === selectedIndex ? 'selected' : ''}" data-i="${i}">
        ${icon(it.kind === 'search' ? 'search' : it.kind === 'internal' ? 'sparkle'
          : it.kind === 'bookmark' ? 'bookmark' : it.kind === 'url' ? 'globe' : 'clock')}
        <div class="s-main">
          <div class="s-title">${highlight(it.title, query)}</div>
          <div class="s-sub">${highlight(it.sub || '', query)}</div>
        </div>
        <span class="s-kind">${it.kind}</span>
      </div>`).join('');
    dropdown.classList.remove('hidden');

    dropdown.querySelectorAll('.suggestion').forEach((el) => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        choose(Number(el.dataset.i));
      });
    });
  }

  function guessUrl(q) {
    if (/^https?:/i.test(q)) return q;
    return 'https://' + q.replace(/^\/+/, '');
  }

  function highlight(text, q) {
    const t = escapeHtml(text);
    if (!q) return t;
    const i = t.toLowerCase().indexOf(escapeHtml(q).toLowerCase());
    if (i === -1) return t;
    const len = escapeHtml(q).length;
    return t.slice(0, i) + '<mark>' + t.slice(i, i + len) + '</mark>' + t.slice(i + len);
  }

  function choose(i) {
    const it = items[i];
    if (!it) return;
    close();
    if (it.kind === 'search') onNavigate({ kind: 'search', value: it.query || it.title });
    else onNavigate({ kind: 'url', value: it.url });
  }

  function close() {
    dropdown.classList.add('hidden');
    selectedIndex = -1;
  }

  input.addEventListener('focus', () => {
    clearTimeout(blurTimer);
    input.select();
    render(input.value);
  });
  input.addEventListener('blur', () => {
    blurTimer = setTimeout(close, 160);
  });
  input.addEventListener('input', () => render(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
      refreshSelection();
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      refreshSelection();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && items[selectedIndex] && input.value.trim()) choose(selectedIndex);
      else onNavigate({ kind: 'auto', value: input.value });
    } else if (e.key === 'Escape') {
      close();
      input.blur();
    }
  });

  function refreshSelection() {
    dropdown.querySelectorAll('.suggestion').forEach((el, i) => {
      el.classList.toggle('selected', i === selectedIndex);
      if (i === selectedIndex) el.scrollIntoView({ block: 'nearest' });
    });
  }

  document.getElementById('omni-go')?.addEventListener('click', () => {
    onNavigate({ kind: 'auto', value: input.value });
  });

  // Keep engine tag in sync with settings.
  return {
    setUrl(url, isInternal) {
      input.value = url;
      const lock = document.getElementById('lock-icon');
      if (lock) {
        const secure = isInternal || url.startsWith('https://');
        lock.classList.toggle('insecure', !secure);
      }
    },
    focus() { input.focus(); },
    refreshEngine() {
      engineTag.textContent = engineNames[state.settings.searchEngine] || 'Startpage';
    },
  };
}
