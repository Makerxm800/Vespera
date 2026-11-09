/** Address/search input. Typed URLs navigate as URLs; arrows explicitly select a suggestion. */
import { state, bus } from './state.js';
import { escapeHtml } from './toasts.js';
import { icon } from './icons.js';
import { INTERNAL_PAGES, classifyInput } from '../../shared/privacy-utils.mjs';

export function initOmnibox({ onNavigate, isPreviewSearch = () => false }) {
  const input = document.getElementById('omni-input');
  const dropdown = document.getElementById('suggestions');
  const engineTag = document.getElementById('engine-tag');
  let selectedIndex = -1, items = [], currentUrl = '', blurTimer, renderFrame = 0;
  let bookmarkIndex = [], historyIndex = [];
  const rebuildIndex = () => {
    bookmarkIndex = state.bookmarks.map((item) => ({ ...item, searchKey: (String(item.title || '') + ' ' + String(item.url || '')).toLowerCase() }));
    historyIndex = state.history.map((item) => ({ ...item, searchKey: (String(item.title || '') + ' ' + String(item.url || '')).toLowerCase() }));
  };
  rebuildIndex();
  const offBookmarks = bus.on('bookmarks', rebuildIndex);
  const offHistory = bus.on('history', rebuildIndex);
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'suggestions'); input.setAttribute('aria-expanded', 'false');
  dropdown.setAttribute('role', 'listbox');
  const engineName = () => isPreviewSearch() ? 'GitHub preview' : ({ startpage: 'Startpage', duckduckgo: 'DuckDuckGo', brave: 'Brave', google: 'Google', ecosia: 'Ecosia', mojeek: 'Mojeek', wikipedia: 'Wikipedia' }[state.settings.searchEngine] || 'Startpage');
  function refreshEngine() {
    engineTag.textContent = engineName();
    input.placeholder = isPreviewSearch() ? 'Search GitHub or enter an allowed website' : 'Search the web or type a URL';
  }
  function highlight(text, q) {
    const raw = String(text || ''), i = raw.toLowerCase().indexOf(q.toLowerCase());
    if (!q || i < 0) return escapeHtml(raw);
    return escapeHtml(raw.slice(0, i)) + '<mark>' + escapeHtml(raw.slice(i, i + q.length)) + '</mark>' + escapeHtml(raw.slice(i + q.length));
  }
  function render(q) {
    const query = q.trim(), lower = query.toLowerCase();
    if (!query) {
      items = historyIndex.slice(0, 5).map((h) => ({ kind: 'history', title: h.title || h.url, sub: h.url, url: h.url }));
      if (!items.length) items = Object.entries(INTERNAL_PAGES).filter(([url]) => ['vespera://welcome', 'vespera://settings', 'vespera://extensions'].includes(url)).map(([url, p]) => ({ kind: 'internal', title: p.title, sub: url, url }));
    } else {
      const internals = Object.entries(INTERNAL_PAGES).filter(([url, p]) => (url + ' ' + p.title).toLowerCase().includes(lower)).slice(0, 3).map(([url, p]) => ({ kind: 'internal', title: p.title, sub: url, url }));
      const bms = bookmarkIndex.filter((b) => b.searchKey.includes(lower)).slice(0, 3).map((b) => ({ kind: 'bookmark', title: b.title, sub: b.url, url: b.url }));
      const hist = historyIndex.filter((h) => h.searchKey.includes(lower)).slice(0, 4).map((h) => ({ kind: 'history', title: h.title || h.url, sub: h.url, url: h.url }));
      const classified = classifyInput(query);
      items = [...internals, ...bms, ...hist];
      if (classified.kind === 'url' || classified.kind === 'internal') items.unshift({ kind: 'url', title: query, sub: 'Open website · Enter', url: query });
      else items.push({ kind: 'search', title: query, sub: 'Search with ' + engineName() + ' · Enter', query });
    }
    selectedIndex = -1;
    dropdown.innerHTML = items.map((it, i) => `<div class="suggestion" id="suggestion-${i}" role="option" aria-selected="false" data-i="${i}">${icon(it.kind === 'search' ? 'search' : it.kind === 'internal' ? 'sparkle' : it.kind === 'bookmark' ? 'bookmark' : it.kind === 'url' ? 'globe' : 'clock')}<div class="s-main"><div class="s-title">${highlight(it.title, query)}</div><div class="s-sub">${highlight(it.sub, query)}</div></div><span class="s-kind">${it.kind}</span></div>`).join('');
    dropdown.classList.toggle('hidden', !items.length);
    input.setAttribute('aria-expanded', String(Boolean(items.length)));
    dropdown.querySelectorAll('.suggestion').forEach((el) => el.addEventListener('mousedown', (e) => { e.preventDefault(); choose(Number(el.dataset.i)); }));
  }
  function close() { dropdown.classList.add('hidden'); selectedIndex = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
  function choose(i) {
    const it = items[i]; if (!it) return;
    close(); input.blur();
    onNavigate(it.kind === 'search' ? { kind: 'search', value: it.query || it.title } : { kind: 'url', value: it.url });
  }
  function refreshSelection() {
    dropdown.querySelectorAll('.suggestion').forEach((el, i) => {
      el.classList.toggle('selected', i === selectedIndex); el.setAttribute('aria-selected', String(i === selectedIndex));
      if (i === selectedIndex) { el.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', el.id); }
    });
  }
  input.addEventListener('focus', () => { clearTimeout(blurTimer); input.select(); render(input.value); });
  input.addEventListener('blur', () => { blurTimer = setTimeout(close, 160); });
  input.addEventListener('input', () => {
    cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(() => render(input.value));
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (dropdown.classList.contains('hidden')) render(input.value);
      selectedIndex = Math.max(0, Math.min(selectedIndex + (e.key === 'ArrowDown' ? 1 : -1), items.length - 1));
      refreshSelection();
    } else if (e.key === 'Enter' && input.value.trim()) {
      e.preventDefault();
      if (selectedIndex >= 0) choose(selectedIndex);
      else { close(); input.blur(); onNavigate({ kind: 'auto', value: input.value }); }
    } else if (e.key === 'Escape') { close(); input.value = currentUrl === 'vespera://newtab' ? '' : currentUrl; input.blur(); }
  });
  document.getElementById('omni-go').addEventListener('click', () => { if (input.value.trim()) { close(); onNavigate({ kind: 'auto', value: input.value }); } });
  refreshEngine();
  return {
    setUrl(url, internal) {
      currentUrl = url; input.dataset.currentUrl = url; input.value = url === 'vespera://newtab' ? '' : url;
      const lock = document.getElementById('lock-icon');
      lock.classList.toggle('insecure', !internal && !url.startsWith('https://'));
      document.getElementById('site-info').title = internal ? 'Vespera internal page' : url.startsWith('https://') ? 'HTTPS connection · site privacy controls' : 'Connection settings';
      close();
    },
    focus() { input.focus(); input.select(); }, refreshEngine,
    dispose() { cancelAnimationFrame(renderFrame); offBookmarks(); offHistory(); },
  };
}
