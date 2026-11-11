/** The Vespera home: a real local clock, private search, and useful places to start. */
import { icon } from '../icons.js';
import { state, bus } from '../state.js';
import { escapeHtml } from '../toasts.js';
import { SEARCH_ENGINES } from '../../../shared/privacy-utils.mjs';

const START_LINKS = [
  { title: 'Welcome to Vespera', sub: 'Meet your new browser', url: 'vespera://welcome', ic: 'sparkle', color: 'gold' },
  { title: 'Make it yours', sub: 'Wallpapers & colors', url: 'vespera://settings#appearance', ic: 'palette', color: 'violet' },
  { title: 'Extensions', sub: 'Small tools, big difference', url: 'vespera://extensions', ic: 'split', color: 'teal' },
  { title: 'Explore GitHub', sub: 'Build something great', url: 'https://github.com/explore', ic: 'code', color: 'blue' },
];
export function renderNewtab(container, ctx) {
  const engine = SEARCH_ENGINES[state.settings.searchEngine] || SEARCH_ENGINES.startpage;
  const recent = state.history.slice(0, 4);
  container.innerHTML = `<div class="newtab-page">
    <div class="nt-wallpaper"></div><div class="nt-shade"></div>
    <div class="nt-topline"><span class="nt-brand">${icon('sparkle')} Vespera</span><button class="nt-customize" id="nt-customize">${icon('palette')} Customize</button></div>
    <div class="nt-hero"><div class="nt-welcome">A little space. A better web.</div><h1>Welcome to <span>Vespera</span></h1>
      <div class="nt-clock"><time class="time" id="nt-time">--:--</time><div class="date" id="nt-date"></div></div>
      <form class="nt-search" id="nt-search"><div class="omnibox"><div class="site-info">${icon('search')}</div><input id="nt-input" type="text" placeholder="${ctx.previewRestricted() ? 'Search GitHub or enter a website…' : 'Search the web privately with ' + escapeHtml(engine.name) + '…'}" spellcheck="false" autocomplete="off" aria-label="Search from home"><button class="nt-go" id="nt-go" type="submit" aria-label="Search">${icon('search')}</button></div><div class="nt-search-note">${icon('lock')} ${ctx.previewRestricted() ? 'Preview search · public GitHub repositories' : escapeHtml(engine.name) + ' · Your search, your business'}</div></form>
    </div>
    <div class="nt-shortcuts">${START_LINKS.map((l, i) => `<button class="nt-shortcut" style="--i:${i}" data-url="${l.url}"><span class="shortcut-icon ${l.color}">${icon(l.ic)}</span><span><b>${l.title}</b><small>${l.sub}</small></span><span class="shortcut-arrow">↗</span></button>`).join('')}</div>
    ${recent.length ? `<div class="nt-recent"><div class="nt-section-label">Pick up where you left off</div><div class="nt-recent-list">${recent.map((h) => `<button data-url="${escapeHtml(h.url)}">${icon('clock')}<span>${escapeHtml(h.title || h.url)}</span><small>${escapeHtml(new URL(h.url).hostname)}</small></button>`).join('')}</div></div>` : ''}
    <div class="nt-bottom"><span>${icon('shield')} <b id="nt-blocked">0</b> trackers & ads blocked</span><i></i><span>${icon('eyeOff')} Zero telemetry. Always.</span><button id="nt-privacy">Your privacy ${icon('external')}</button></div>
  </div>`;
  const time = container.querySelector('#nt-time'), date = container.querySelector('#nt-date');
  function tick() {
    const now = new Date();
    time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: state.settings.clockSeconds ? '2-digit' : undefined, hour12: !state.settings.clock24 });
    time.dateTime = now.toISOString();
    date.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }
  tick();
  let lastSecond = Math.floor(Date.now() / 1000);
  const timer = setInterval(() => { const second = Math.floor(Date.now() / 1000); if (second !== lastSecond) { lastSecond = second; tick(); } }, 250);
  const syncStats = () => { container.querySelector('#nt-blocked').textContent = (state.stats.trackers + state.stats.ads).toLocaleString(); };
  syncStats(); const off = bus.on('stats', syncStats);
  const form = container.querySelector('#nt-search');
  const searchInput = container.querySelector('#nt-input');
  let searchTimer = null;
  searchInput.addEventListener('focus', () => form.classList.add('is-focused'));
  searchInput.addEventListener('blur', () => form.classList.remove('is-focused'));
  searchInput.addEventListener('input', () => { form.classList.toggle('has-value', Boolean(searchInput.value.trim())); form.classList.remove('is-empty'); });
  form.onsubmit = (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (!q) { form.classList.remove('is-empty'); void form.offsetWidth; form.classList.add('is-empty'); searchInput.focus(); return; }
    if (form.classList.contains('is-searching')) return;
    form.classList.add('is-searching'); form.setAttribute('aria-busy', 'true');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    searchTimer = setTimeout(() => {
      try { ctx.navigate(q, { kind: 'auto' }); }
      catch { /* handled by the reset below */ }
      // If navigation didn't leave this page (rejected address, no active tab…),
      // clear the state — otherwise the box would stay "busy" and ignore new input.
      if (form.isConnected) { form.classList.remove('is-searching'); form.removeAttribute('aria-busy'); }
    }, reduced ? 0 : 220);
  };
  container.querySelector('#nt-customize').onclick = () => ctx.navigate('vespera://settings#appearance');
  container.querySelector('#nt-privacy').onclick = () => ctx.navigate('vespera://privacy');
  container.querySelectorAll('[data-url]').forEach((el) => el.onclick = () => ctx.navigate(el.dataset.url));
  return () => { clearInterval(timer); clearTimeout(searchTimer); off(); };
}
