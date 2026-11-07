/** Vespera Shields popover — per-site privacy control panel. */
import { state } from './state.js';
import { icon } from './icons.js';
import { escapeHtml, toast } from './toasts.js';

let openEl = null;

export function closeShields() {
  openEl?.remove();
  openEl = null;
}

export function toggleShields(anchor, tab, { onToggleSite }) {
  if (openEl) return closeShields();
  const host = hostOf(tab?.url);
  const on = host ? !state.settings.allowlist[host] && state.settings.shields.enabled : state.settings.shields.enabled;
  const s = tab?.shields || { blocked: 0, ads: 0, trackers: 0, cleaned: 0 };

  const el = document.createElement('div');
  el.className = 'popover';
  const r = anchor.getBoundingClientRect();
  el.style.top = (r.bottom + 8) + 'px';
  el.style.right = (window.innerWidth - r.right) + 'px';

  el.innerHTML = `
    <div class="pop-head">
      <div class="row" style="justify-content:space-between">
        <div>
          <div style="font-weight:700;font-size:14.5px">Vespera Shields ${on ? '· Up' : '· Down'}</div>
          <div class="small muted">${host ? escapeHtml(host) : 'This page'}</div>
        </div>
        <div class="pop-stat">
          <span class="big">${s.blocked}</span>
          <span class="small muted">blocked<br>this page</span>
        </div>
      </div>
    </div>
    <div class="pop-body">
      <div class="pop-row">
        <span>Shields for this site</span>
        <label class="switch">
          <input type="checkbox" id="pop-site-toggle" ${on ? 'checked' : ''}>
          <span class="track"></span><span class="thumb"></span>
        </label>
      </div>
      <div class="pop-row"><span class="muted">Trackers &amp; ads</span><b>${s.trackers + s.ads}</b></div>
      <div class="pop-row"><span class="muted">Tracking links cleaned</span><b>${s.cleaned}</b></div>
      <div class="pop-row"><span class="muted">Upgrade to HTTPS</span><b>on</b></div>
      <button class="btn" id="pop-open-privacy">${icon('shield')} Open Privacy Dashboard</button>
      <button class="btn btn-ghost" id="pop-global">${icon('gear')} Global shield settings</button>
    </div>`;

  document.body.appendChild(el);
  openEl = el;

  el.querySelector('#pop-site-toggle')?.addEventListener('change', (e) => {
    if (!host) return;
    if (e.target.checked) delete state.settings.allowlist[host];
    else state.settings.allowlist[host] = true;
    state.saveSettings();
    onToggleSite?.(host);
    toast(e.target.checked ? `Shields up for ${host}` : `Shields down for ${host}`, 'ok');
  });
  el.querySelector('#pop-open-privacy')?.addEventListener('click', () => {
    closeShields();
    onToggleSite?.('__navigate:vespera://privacy');
  });
  el.querySelector('#pop-global')?.addEventListener('click', () => {
    closeShields();
    onToggleSite?.('__navigate:vespera://settings');
  });

  setTimeout(() => {
    const onDoc = (e) => {
      if (!el.contains(e.target) && e.target !== anchor) {
        closeShields();
        document.removeEventListener('mousedown', onDoc);
      }
    };
    document.addEventListener('mousedown', onDoc);
  }, 0);
}

export function hostOf(url) {
  try {
    if (url.startsWith('vespera://')) return null;
    return new URL(url).hostname;
  } catch { return null; }
}

/** Toolbar badge count. */
export function updateShieldBadge(tab) {
  const badge = document.getElementById('shield-count');
  if (!badge) return;
  const n = tab?.shields?.blocked || 0;
  badge.textContent = n > 999 ? '999+' : String(n);
  badge.dataset.zero = n === 0 ? 'true' : 'false';
}
