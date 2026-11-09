/** Privacy Hub — compact, live protection controls with honest session stats. */
import { icon } from '../icons.js';
import { state, bus } from '../state.js';
import { hostOf } from '../shields.js';
import { escapeHtml } from '../toasts.js';

const CONTROLS = [
  ['blockTrackers', 'Block trackers', 'Stop known tracking scripts and pixels.'],
  ['blockAds', 'Block ads', 'Block listed ad networks and ad placeholders.'],
  ['blockAnnoyances', 'Block annoyances', 'Hide listed cookie walls, signup prompts and share bars.'],
  ['cleanLinks', 'Clean tracking links', 'Remove utm_*, fbclid, gclid and similar parameters.'],
  ['httpsOnly', 'Prefer HTTPS', 'Upgrade HTTP navigations when a secure connection is available.'],
  ['gpc', 'Global Privacy Control', 'Send Sec-GPC and DNT. Sites may choose whether to honor them.'],
];

export function renderPrivacy(container, ctx) {
  const tab = ctx.getActiveTab?.();
  const previous = tab?._internal ? tab.entries.slice(0, tab.entryIndex).reverse().find((entry) => /^https?:/i.test(entry.url)) : null;
  const siteUrl = tab && !tab._internal ? tab.url : previous?.url || '';
  const host = hostOf(siteUrl);
  let exceptionSignature = null;

  container.innerHTML = `
    <div class="page privacy-hub">
      <header class="hub-header">
        <div class="hub-title">
          <span class="hub-mark">${icon('shield')}</span>
          <div><span class="eyebrow">VESPERA SHIELDS</span><h1 class="page-title">Privacy Hub</h1></div>
        </div>
        <div class="hub-header-actions"><span class="chip" id="hub-status"></span><button class="btn btn-ghost btn-sm" id="hub-settings">${icon('gear')} Settings</button></div>
      </header>
      <p class="page-sub">Protection controls and real counts from this browser. Changes apply to new pages; reload open sites to apply them.</p>

      <section class="card hub-summary" aria-label="Session protection statistics">
        <div class="hub-total"><strong id="hub-total">0</strong><span>trackers &amp; ads blocked</span></div>
        <div class="hub-metrics">
          <div><b id="hub-trackers">0</b><span>Trackers</span></div>
          <div><b id="hub-ads">0</b><span>Ads</span></div>
          <div><b id="hub-links">0</b><span>Links cleaned</span></div>
          <div><b id="hub-https">0</b><span>HTTPS upgrades</span></div>
        </div>
      </section>

      <div class="hub-grid">
        <section class="card hub-controls" aria-labelledby="hub-protection-title">
          <div class="hub-card-head"><div><h2 id="hub-protection-title">Protection</h2><p class="small muted" id="hub-saved">Saved on this device</p></div>
            <label class="switch"><input type="checkbox" id="hub-enabled" aria-label="Enable Shields"><span class="track"></span><span class="thumb"></span></label>
          </div>
          <div class="hub-rows">${CONTROLS.map(([key, label, desc]) => `
            <div class="hub-row"><div><label for="hub-${key}">${label}</label><p>${desc}</p></div>
              <label class="switch"><input type="checkbox" id="hub-${key}" data-shield="${key}" aria-label="${label}"><span class="track"></span><span class="thumb"></span></label>
            </div>`).join('')}
          </div>
        </section>

        <aside class="hub-side">
          <section class="card hub-site" aria-labelledby="hub-site-title">
            <div class="hub-card-head"><h2 id="hub-site-title">Website</h2>${host ? '<span class="chip" id="hub-site-status"></span>' : ''}</div>
            ${host ? `<div class="hub-site-host">${icon('globe')}<span>${escapeHtml(host)}</span></div>
              <div class="hub-row"><div><label for="hub-site-enabled">Shields for this site</label><p>Turn off only for this website.</p></div>
                <label class="switch"><input type="checkbox" id="hub-site-enabled" aria-label="Shields for ${escapeHtml(host)}"><span class="track"></span><span class="thumb"></span></label>
              </div><button class="btn btn-sm" id="hub-return-site">${icon('arrowLeft')} Return to site</button>`
            : `<div class="hub-empty">${icon('globe')}<p>Open a website to manage its per-site protection.</p></div>`}
          </section>
          <section class="card hub-exceptions" aria-labelledby="hub-exceptions-title">
            <div class="hub-card-head"><h2 id="hub-exceptions-title">Site exceptions</h2><button class="text-btn" id="hub-clear-exceptions">Clear all</button></div>
            <div id="hub-exception-list" class="hub-exception-list"></div>
          </section>
        </aside>
      </div>

      <section class="hub-notes" aria-label="Privacy notes">
        <div>${icon('shield')}<p><b>Request blocking.</b> Known trackers and ads are stopped before they load. No blocklist catches every tracking technique.</p></div>
        <div>${icon('link')}<p><b>Cleaner navigation.</b> Tracking parameters are removed and HTTPS is preferred when possible.</p></div>
        <div>${icon('eyeOff')}<p><b>Private by design.</b> Vespera does not send usage telemetry. GPC/DNT are signals, not a guarantee that sites stop tracking.</p></div>
      </section>
    </div>`;

  const $ = (selector) => container.querySelector(selector);
  const setText = (selector, value) => { const el = $(selector); if (el) el.textContent = value; };
  function refresh() {
    const sh = state.settings.shields;
    const stats = state.stats;
    setText('#hub-total', (stats.trackers + stats.ads).toLocaleString());
    setText('#hub-trackers', stats.trackers.toLocaleString());
    setText('#hub-ads', stats.ads.toLocaleString());
    setText('#hub-links', stats.linksCleaned.toLocaleString());
    setText('#hub-https', (stats.httpsUpgrades || 0).toLocaleString());
    const status = $('#hub-status');
    status.textContent = sh.enabled ? 'Shields up' : 'Shields paused';
    status.className = 'chip ' + (sh.enabled ? 'chip-ok' : 'chip-warn');
    $('#hub-enabled').checked = sh.enabled;
    container.querySelectorAll('[data-shield]').forEach((input) => { input.checked = Boolean(sh[input.dataset.shield]); });
    container.querySelectorAll('[data-shield], #hub-enabled').forEach((input) => { input.disabled = false; });
    if (host) {
      const siteOn = sh.enabled && !state.settings.allowlist[host];
      $('#hub-site-enabled').checked = siteOn;
      const siteStatus = $('#hub-site-status');
      siteStatus.textContent = siteOn ? 'Protected' : 'Exception';
      siteStatus.className = 'chip ' + (siteOn ? 'chip-ok' : 'chip-warn');
    }
    const hosts = Object.entries(state.settings.allowlist || {}).filter(([, value]) => value).map(([key]) => key).sort();
    const signature = hosts.join('|');
    if (signature !== exceptionSignature) {
      exceptionSignature = signature;
      $('#hub-exception-list').innerHTML = hosts.length ? hosts.map((name) => `
        <span class="hub-exception">${escapeHtml(name)}<button class="icon-btn soft-close" data-remove-exception="${escapeHtml(name)}" aria-label="Remove exception for ${escapeHtml(name)}" title="Remove exception">${icon('x')}</button></span>`).join('')
        : '<p class="small muted">No exceptions. Global protection applies everywhere.</p>';
      $('#hub-clear-exceptions').disabled = !hosts.length;
    }
  }
  function save(path, value, input) {
    if (!state.set(path, value)) { input.checked = !value; return; }
    setText('#hub-saved', 'Saved just now');
    refresh();
  }
  $('#hub-enabled').addEventListener('change', (event) => {
    save('shields.enabled', event.target.checked, event.target);
    ctx.toast(event.target.checked ? 'Shields enabled' : 'Shields paused', 'ok');
  });
  container.querySelectorAll('[data-shield]').forEach((input) => input.addEventListener('change', (event) => save('shields.' + event.target.dataset.shield, event.target.checked, event.target)));
  $('#hub-site-enabled')?.addEventListener('change', (event) => {
    const allowlist = { ...state.settings.allowlist };
    if (event.target.checked) delete allowlist[host]; else allowlist[host] = true;
    if (state.set('allowlist', allowlist)) { refresh(); ctx.toast(event.target.checked ? 'Shields restored for ' + host : 'Exception added for ' + host, 'ok'); }
    else event.target.checked = !event.target.checked;
  });
  $('#hub-return-site')?.addEventListener('click', () => ctx.navigate(siteUrl, { kind: 'url' }));
  $('#hub-settings').addEventListener('click', () => ctx.navigate('vespera://settings#privacy'));
  $('#hub-clear-exceptions').addEventListener('click', () => { state.set('allowlist', {}); refresh(); ctx.toast('Site exceptions cleared', 'ok'); });
  $('#hub-exception-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-exception]');
    if (!button) return;
    const allowlist = { ...state.settings.allowlist };
    delete allowlist[button.dataset.removeException];
    state.set('allowlist', allowlist); refresh();
  });
  refresh();
  const offStats = bus.on('stats', refresh);
  const offSettings = bus.on('settings', refresh);
  return () => { offStats(); offSettings(); };
}
