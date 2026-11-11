/** Per-site privacy controls; counters come from actual navigation/network events. */
import { state } from './state.js';
import { icon } from './icons.js';
import { escapeHtml, toast } from './toasts.js';
import { openPopover } from './popover.js';
export function hostOf(url) { try { return /^https?:/i.test(url) ? new URL(url).hostname : null; } catch { return null; } }
export function closeShields() { document.querySelector('.shields-popover')?.remove(); }
export function toggleShields(anchor, tab, { onNavigate, onReload } = {}) {
  const host = hostOf(tab?.url);
  const enabled = state.settings.shields.enabled && !(host && state.settings.allowlist[host]);
  const s = tab?.shields || { blocked: 0, ads: 0, trackers: 0, cleaned: 0 };
  const pop = openPopover(anchor, `<div class="pop-head"><div class="row" style="justify-content:space-between"><div><div style="font-weight:700">${icon('shield')} Vespera Shields</div><div class="small muted">${host ? escapeHtml(host) : 'Global protection'}</div></div><span class="chip ${enabled ? 'chip-ok' : ''}">${enabled ? 'Up' : 'Down'}</span></div></div>
    <div class="pop-body"><div class="pop-row"><span>${host ? 'Shields for this site' : 'Shields on all sites'}</span><label class="switch"><input id="pop-site-toggle" type="checkbox" aria-label="Enable shields" ${enabled ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label></div>
    <div class="pop-stat"><span class="big">${s.blocked}</span><span class="small muted">requests blocked<br>on this page</span></div>
    <div class="pop-row"><span class="muted">Trackers / ads</span><b>${s.trackers} / ${s.ads}</b></div><div class="pop-row"><span class="muted">Tracking parameters removed</span><b>${s.cleaned}</b></div>
    <div class="pop-row"><span class="muted">HTTPS upgrades</span><b>${state.settings.shields.httpsOnly ? 'On' : 'Off'}</b></div>
    <button class="btn btn-sm" id="pop-open-privacy">${icon('shield')} Privacy Hub</button><button class="btn btn-ghost btn-sm" id="pop-global">${icon('gear')} Global shield settings</button></div>`, { className: 'popover shields-popover', label: 'Vespera Shields' });
  if (!pop) return;
  pop.el.querySelector('#pop-site-toggle').onchange = (e) => {
    if (host) { if (e.target.checked) delete state.settings.allowlist[host]; else state.settings.allowlist[host] = true; }
    else state.settings.shields.enabled = e.target.checked;
    state.saveSettings(); onReload?.(); toast(enabled ? 'Shields down. Reloading page…' : 'Shields up. Reloading page…', 'ok');
  };
  pop.el.querySelector('#pop-open-privacy').onclick = () => { pop.close(); onNavigate('vespera://privacy'); };
  pop.el.querySelector('#pop-global').onclick = () => { pop.close(); onNavigate('vespera://settings#privacy'); };
}
export function updateShieldBadge(tab) {
  const badge = document.getElementById('shield-count');
  const n = tab?.shields?.blocked || 0;
  badge.textContent = n > 999 ? '999+' : String(n); badge.dataset.zero = n === 0 ? 'true' : 'false';
  const host = hostOf(tab?.url);
  document.getElementById('btn-shields').classList.toggle('shields-off', !state.settings.shields.enabled || Boolean(host && state.settings.allowlist[host]));
}
