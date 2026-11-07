/** Settings page — appearance, search, privacy, sync, advanced, about. */
import { icon } from '../icons.js';
import { state } from '../state.js';
import { SEARCH_ENGINES } from '../../../shared/privacy-utils.mjs';
import { escapeHtml } from '../toasts.js';

export function renderSettings(container, ctx) {
  const s = state.settings;

  const engineOptions = Object.values(SEARCH_ENGINES)
    .map((e) => `<option value="${e.id}" ${s.searchEngine === e.id ? 'selected' : ''}>${e.name}</option>`)
    .join('');

  container.innerHTML = `
    <div class="page">
      <h1 class="page-title">Settings</h1>
      <p class="page-sub">Make Vespera yours. Everything is stored locally and — if you're signed in — synced to your account.</p>

      <div class="section">
        <h2>${icon('palette')} Appearance</h2>
        <div class="setting-row">
          <div><div class="s-label">Theme</div><div class="s-desc">Twilight dark, warm light, or follow your system</div></div>
          <div class="s-control">
            <div class="segmented" id="seg-theme">
              <button data-v="dark" class="${s.theme === 'dark' ? 'active' : ''}">${icon('moon')} Dark</button>
              <button data-v="light" class="${s.theme === 'light' ? 'active' : ''}">${icon('sun')} Light</button>
              <button data-v="system" class="${s.theme === 'system' ? 'active' : ''}">System</button>
            </div>
          </div>
        </div>
        <div class="setting-row">
          <div><div class="s-label">Accent color</div><div class="s-desc">The glow of your evening star</div></div>
          <div class="s-control">
            <div class="segmented" id="seg-accent">
              <button data-v="gold" class="${s.accent === 'gold' ? 'active' : ''}">Gold</button>
              <button data-v="violet" class="${s.accent === 'violet' ? 'active' : ''}">Violet</button>
              <button data-v="teal" class="${s.accent === 'teal' ? 'active' : ''}">Teal</button>
              <button data-v="rose" class="${s.accent === 'rose' ? 'active' : ''}">Rose</button>
            </div>
          </div>
        </div>
        <div class="setting-row">
          <div><div class="s-label">Tab layout</div><div class="s-desc">Classic horizontal strip or a vertical sidebar with drag-reorder</div></div>
          <div class="s-control">
            <div class="segmented" id="seg-tabs">
              <button data-v="horizontal" class="${s.tabLayout === 'horizontal' ? 'active' : ''}">Horizontal</button>
              <button data-v="vertical" class="${s.tabLayout === 'vertical' ? 'active' : ''}">Vertical</button>
            </div>
          </div>
        </div>
        <div class="setting-row">
          <div><div class="s-label">Density</div><div class="s-desc">Comfortable or compact chrome</div></div>
          <div class="s-control">
            <div class="segmented" id="seg-density">
              <button data-v="comfortable" class="${s.density !== 'compact' ? 'active' : ''}">Comfortable</button>
              <button data-v="compact" class="${s.density === 'compact' ? 'active' : ''}">Compact</button>
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>${icon('search')} Search</h2>
        <div class="setting-row">
          <div><div class="s-label">Default search engine</div><div class="s-desc">Used by the address bar and the new tab page. Startpage = Google results without tracking.</div></div>
          <div class="s-control">
            <select class="select" id="sel-engine">${engineOptions}</select>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>${icon('shield')} Privacy &amp; Shields</h2>
        ${toggleRow('shields.enabled', 'Shields master switch', 'Block trackers, ads and more on every site', s.shields.enabled)}
        ${toggleRow('shields.blockTrackers', 'Block trackers', 'Known tracking & telemetry endpoints (doubleclick, analytics, pixels…)', s.shields.blockTrackers)}
        ${toggleRow('shields.blockAds', 'Block ads', 'Advertising networks and ad-serving patterns', s.shields.blockAds)}
        ${toggleRow('shields.blockAnnoyances', 'Block annoyances', 'Cookie walls, newsletter popups, sticky share bars', s.shields.blockAnnoyances)}
        ${toggleRow('shields.cleanLinks', 'Clean tracking links', 'Strip utm_*, fbclid, gclid and friends from URLs', s.shields.cleanLinks)}
        ${toggleRow('shields.httpsOnly', 'HTTPS-only upgrades', 'Upgrade insecure connections automatically', s.shields.httpsOnly)}
        ${toggleRow('shields.gpc', 'Global Privacy Control', 'Send Sec-GPC + DNT headers on every request', s.shields.gpc)}
        ${toggleRow('shields.antiFingerprint', 'Anti-fingerprinting', 'Mask automation flags and reduce identifying surface', s.shields.antiFingerprint)}
        <div class="setting-row">
          <div><div class="s-label">Per-site allowlist</div><div class="s-desc">${allowlistSummary()}</div></div>
          <div class="s-control">
            <button class="btn btn-danger" id="btn-clear-allowlist">${icon('trash')} Clear allowlist</button>
          </div>
        </div>
        <div class="setting-row">
          <div><div class="s-label">Browsing data</div><div class="s-desc">History is stored only on this device (and your account if sync is on)</div></div>
          <div class="s-control">
            <button class="btn btn-danger" id="btn-clear-history">${icon('trash')} Clear history</button>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>${icon('user')} Account &amp; Sync</h2>
        <div class="setting-row">
          <div>
            <div class="s-label">${state.user ? escapeHtml(state.user.displayName) : 'Not signed in'}</div>
            <div class="s-desc">${state.user
              ? 'Your settings, bookmarks and history sync to your Vespera account.'
              : 'Sign in to sync settings, bookmarks and history across devices.'}</div>
          </div>
          <div class="s-control">
            <button class="btn ${state.user ? '' : 'btn-primary'}" id="btn-account">
              ${icon(state.user ? 'gear' : 'user')} ${state.user ? 'Manage account' : 'Sign in'}
            </button>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>${icon('flask')} Advanced</h2>
        ${toggleRow('telemetry', 'Telemetry', 'Permanently off. This switch exists to prove it — it cannot be turned on.', false, true)}
        <div class="setting-row">
          <div><div class="s-label">Homepage</div><div class="s-desc">Where the Home button takes you</div></div>
          <div class="s-control">
            <select class="select" id="sel-homepage">
              <option value="vespera://newtab" ${s.homepage === 'vespera://newtab' ? 'selected' : ''}>New Tab</option>
              <option value="vespera://welcome" ${s.homepage === 'vespera://welcome' ? 'selected' : ''}>Welcome</option>
              <option value="vespera://privacy" ${s.homepage === 'vespera://privacy' ? 'selected' : ''}>Privacy Dashboard</option>
            </select>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>${icon('info')} About</h2>
        <div class="card">
          <div class="row" style="gap:16px">
            <div class="f-icon" style="width:52px;height:52px;border-radius:16px;background:var(--accent-soft);display:grid;place-items:center;color:var(--accent)">${icon('sparkle')}</div>
            <div>
              <div style="font-weight:750;font-size:16px">Vespera Browser</div>
              <div class="muted small">Version 0.1.0 · Chromium core · MIT licensed</div>
            </div>
          </div>
          <div class="pledge" style="margin-top:18px">
            ${icon('heart')}
            <div>
              <b>Zero telemetry pledge</b>
              <p class="muted small" style="margin-top:5px;line-height:1.7">
                Vespera contains no analytics, no usage reporting and no crash phoning-home.
                Your data lives on your machine and — only with your account — in your own sync store.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  // Segmented controls
  wireSeg(container, 'seg-theme', (v) => { state.set('theme', v); ctx.refreshChrome(); });
  wireSeg(container, 'seg-accent', (v) => { state.set('accent', v); ctx.refreshChrome(); });
  wireSeg(container, 'seg-tabs', (v) => { state.set('tabLayout', v); ctx.refreshChrome(true); });
  wireSeg(container, 'seg-density', (v) => { state.set('density', v); ctx.refreshChrome(); });

  // Toggles
  container.querySelectorAll('[data-setting]').forEach((input) => {
    input.addEventListener('change', () => {
      state.set(input.dataset.setting, input.checked);
      if (input.dataset.setting === 'shields.enabled') {
        ctx.toast(input.checked ? 'Shields up' : 'Shields down', 'ok');
      }
    });
  });

  container.querySelector('#sel-engine')?.addEventListener('change', (e) => {
    state.set('searchEngine', e.target.value);
    ctx.refreshChrome();
  });
  container.querySelector('#sel-homepage')?.addEventListener('change', (e) => {
    state.set('homepage', e.target.value);
  });
  container.querySelector('#btn-account')?.addEventListener('click', () => ctx.navigate('vespera://account'));
  container.querySelector('#btn-clear-allowlist')?.addEventListener('click', () => {
    state.set('allowlist', {});
    ctx.toast('Site allowlist cleared', 'ok');
    ctx.rerenderPage();
  });
  container.querySelector('#btn-clear-history')?.addEventListener('click', () => {
    state.clearHistory();
    ctx.toast('Browsing history cleared', 'ok');
  });
}

function toggleRow(path, label, desc, checked, locked = false) {
  return `
    <div class="setting-row">
      <div><div class="s-label">${label}</div><div class="s-desc">${desc}</div></div>
      <div class="s-control">
        <label class="switch">
          <input type="checkbox" data-setting="${path}" ${checked ? 'checked' : ''} ${locked ? 'disabled checked' : ''}>
          <span class="track"></span><span class="thumb"></span>
        </label>
      </div>
    </div>`;
}

function allowlistSummary() {
  const hosts = Object.keys(state.settings.allowlist || {});
  if (!hosts.length) return 'Shields are up everywhere — no sites allowlisted';
  return hosts.map(escapeHtml).join(', ');
}

function wireSeg(container, id, cb) {
  container.querySelector('#' + id)?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-v]');
    if (!btn) return;
    const seg = e.currentTarget;
    seg.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    cb(btn.dataset.v);
  });
}
