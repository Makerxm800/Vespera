/** New Tab page — clock, search, quick links, privacy stats. */
import { icon } from '../icons.js';
import { state } from '../state.js';
import { escapeHtml } from '../toasts.js';

export function renderNewtab(container, ctx) {
  const topSites = [...state.history.reduce((map, h) => {
    let host = h.url;
    try { host = new URL(h.url).hostname; } catch { /* keep */ }
    if (!map.has(host)) map.set(host, { host, url: h.url, visits: 0 });
    map.get(host).visits++;
    return map;
  }, new Map()).values()].slice(0, 8);

  container.innerHTML = `
    <div class="newtab-page">
      ${starBg()}
      <div class="nt-clock">
        <div class="time" id="nt-time">--:--</div>
        <div class="date" id="nt-date"></div>
      </div>
      <div class="nt-search">
        <div class="omnibox">
          <div class="site-info">${icon('search')}</div>
          <input id="nt-input" type="text" placeholder="Search the web with Startpage — privately" spellcheck="false">
          <button class="icon-btn go-btn" id="nt-go">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
          </button>
        </div>
      </div>
      <div class="nt-stats">
        <div class="nt-stat">${icon('shield')} <b id="nt-blocked">0</b> trackers &amp; ads blocked</div>
        <div class="nt-stat">${icon('link')} <b id="nt-links">0</b> tracking links cleaned</div>
        <div class="nt-stat">${icon('bolt')} <b>0</b> bytes of telemetry sent</div>
      </div>
      ${topSites.length ? `
        <div class="nt-stats" style="margin-top:2px">
          ${topSites.map((s) => `
            <button class="nt-stat" data-url="${escapeHtml(s.url)}" style="cursor:pointer">
              ${icon('globe')} <span>${escapeHtml(s.host)}</span>
            </button>`).join('')}
        </div>` : ''}
    </div>`;

  function tick() {
    const now = new Date();
    const t = container.querySelector('#nt-time');
    const d = container.querySelector('#nt-date');
    if (t) t.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d) d.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }
  tick();
  const timer = setInterval(tick, 10000);

  const blocked = container.querySelector('#nt-blocked');
  const links = container.querySelector('#nt-links');
  const syncStats = () => {
    if (blocked) blocked.textContent = String(state.stats.trackers + state.stats.ads);
    if (links) links.textContent = String(state.stats.linksCleaned);
  };
  syncStats();

  const input = container.querySelector('#nt-input');
  const go = () => {
    const v = input.value.trim();
    if (v) ctx.navigate(v, { kind: 'auto' });
  };
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  container.querySelector('#nt-go')?.addEventListener('click', go);
  container.querySelectorAll('[data-url]').forEach((el) => {
    el.addEventListener('click', () => ctx.navigate(el.dataset.url, { kind: 'url' }));
  });

  return () => clearInterval(timer);
}

function starBg() {
  let s = '<div class="starfield">';
  for (let i = 0; i < 18; i++) {
    s += `<i style="left:${Math.random() * 100}%;top:${Math.random() * 100}%;animation-delay:${(Math.random() * 5).toFixed(1)}s"></i>`;
  }
  return s + '</div>';
}
