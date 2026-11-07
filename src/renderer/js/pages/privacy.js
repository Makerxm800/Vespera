/** Privacy Dashboard — live shield statistics & explanations. */
import { icon } from '../icons.js';
import { state } from '../state.js';
import { escapeHtml } from '../toasts.js';

export function renderPrivacy(container, ctx) {
  const s = state.stats;
  const total = s.trackers + s.ads;
  const sites = Object.entries(s.bySite || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);

  container.innerHTML = `
    <div class="page">
      <h1 class="page-title">Privacy Dashboard</h1>
      <p class="page-sub">Live statistics from this Vespera session. Every blocked request is a tracker,
        ad network or fingerprinting script that never got to see you.</p>

      <div class="dash-hero">
        <div class="dash-shield">${icon('shield')}</div>
        <div class="grow">
          <div class="dash-total">${total.toLocaleString()}</div>
          <div class="muted">trackers &amp; ads blocked this session</div>
          <div class="row" style="margin-top:14px;flex-wrap:wrap">
            <span class="chip chip-accent">${icon('eyeOff')} ${s.trackers} trackers</span>
            <span class="chip chip-warn">${icon('eye')} ${s.ads} ads</span>
            <span class="chip chip-info">${icon('link')} ${s.linksCleaned} links cleaned</span>
            <span class="chip chip-ok">${icon('lock')} HTTPS upgrades on</span>
          </div>
        </div>
      </div>

      <div class="dash-grid">
        <div class="dash-cell"><div class="d-num">${s.trackers}</div><div class="d-label">Tracker requests blocked</div></div>
        <div class="dash-cell"><div class="d-num">${s.ads}</div><div class="d-label">Ad requests blocked</div></div>
        <div class="dash-cell"><div class="d-num">${s.linksCleaned}</div><div class="d-label">Tracking parameters stripped</div></div>
        <div class="dash-cell"><div class="d-num">0</div><div class="d-label">Telemetry bytes sent (always)</div></div>
      </div>

      <div class="section">
        <h2>${icon('globe')} Top protected sites</h2>
        <div class="card sitelist">
          ${sites.length ? sites.map(([host, n]) => `
            <div class="sitelist-row">
              ${icon('shield')}
              <span class="sl-host">${escapeHtml(host)}</span>
              <span class="sl-count">${n} blocked</span>
              <button class="btn btn-ghost small" data-visit="${escapeHtml(host)}">Open</button>
            </div>`).join('') : `
            <div class="empty">${icon('shield')}<div>Browse a few sites and your protection stats will appear here.</div></div>`}
        </div>
      </div>

      <div class="section">
        <h2>${icon('flask')} How Vespera protects you</h2>
        <div class="feature-grid">
          <div class="feature-card">
            <div class="f-icon">${icon('shieldOff')}</div>
            <h3>Request-level blocking</h3>
            <p>Trackers and ad networks are stopped at the network layer — before any code runs on the page.</p>
          </div>
          <div class="feature-card">
            <div class="f-icon">${icon('link')}</div>
            <h3>Link sanitization</h3>
            <p>Tracking parameters (utm_*, fbclid, gclid…) are removed from URLs so your clicks can't be followed across sites.</p>
          </div>
          <div class="feature-card">
            <div class="f-icon">${icon('lock')}</div>
            <h3>HTTPS upgrades &amp; GPC</h3>
            <p>Connections upgrade to HTTPS when possible, and every request carries Global Privacy Control + DNT.</p>
          </div>
          <div class="feature-card">
            <div class="f-icon">${icon('eyeOff')}</div>
            <h3>Anti-fingerprinting</h3>
            <p>Automation flags are masked and optional canvas noise can be enabled in Settings → Privacy.</p>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>${icon('gear')} Quick controls</h2>
        <div class="card">
          <div class="setting-row" style="border:none;background:transparent">
            <div><div class="s-label">Shields master switch</div><div class="s-desc">Turn all blocking off/on globally</div></div>
            <label class="switch"><input type="checkbox" id="pd-shields" ${state.settings.shields.enabled ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label>
          </div>
          <div class="setting-row" style="border:none;background:transparent">
            <div><div class="s-label">Strip tracking links</div><div class="s-desc">Remove utm/fbclid/gclid parameters</div></div>
            <label class="switch"><input type="checkbox" id="pd-clean" ${state.settings.shields.cleanLinks ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label>
          </div>
          <div class="setting-row" style="border:none;background:transparent">
            <div><div class="s-label">Block annoyances</div><div class="s-desc">Cookie walls, newsletter popups, share bars</div></div>
            <label class="switch"><input type="checkbox" id="pd-annoy" ${state.settings.shields.blockAnnoyances ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label>
          </div>
        </div>
      </div>
    </div>`;

  container.querySelector('#pd-shields')?.addEventListener('change', (e) => {
    state.set('shields.enabled', e.target.checked);
    ctx.toast(e.target.checked ? 'Shields up globally' : 'Shields down globally', 'ok');
  });
  container.querySelector('#pd-clean')?.addEventListener('change', (e) => {
    state.set('shields.cleanLinks', e.target.checked);
  });
  container.querySelector('#pd-annoy')?.addEventListener('change', (e) => {
    state.set('shields.blockAnnoyances', e.target.checked);
  });
  container.querySelectorAll('[data-visit]').forEach((el) => {
    el.addEventListener('click', () => ctx.navigate('https://' + el.dataset.visit, { kind: 'url' }));
  });
}
