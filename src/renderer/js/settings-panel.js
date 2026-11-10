/** Floating Settings panel — a UI you toggle over whatever you are doing,
 *  rather than a page you navigate away to. The content itself is rendered
 *  by `pages/settings.js`, so the page URL (vespera://settings) still works. */
import { icon } from './icons.js';
import { toast } from './toasts.js';
import { renderSettings } from './pages/settings.js';
import { bridge } from './app-bridge.js';

const SECTIONS = [
  ['appearance', 'Appearance'],
  ['search', 'Search & home'],
  ['privacy', 'Privacy'],
  ['extensions', 'Extensions'],
  ['downloads', 'Downloads'],
  ['account', 'Account'],
  ['about', 'About'],
];

let layer = null;
let closing = null;
let activeSection = 'appearance';

export const settingsPanelOpen = () => layer !== null;

export function closeSettingsPanel() {
  if (!layer) return;
  const el = layer;
  layer = null;
  el.classList.remove('open');
  document.removeEventListener('keydown', onKey, true);
  closing?.remove();
  closing = el;
  setTimeout(() => { if (closing === el) { el.remove(); closing = null; } }, 380);
  bridge.settingsClosed?.();
  bridge.settingsToggled?.();
}

function onKey(event) {
  if (event.key !== 'Escape') return;
  event.stopPropagation();
  closeSettingsPanel();
}

/** The ctx pages/settings.js expects, bound to app services via the bridge. */
function panelCtx() {
  return {
    previewRestricted: () => bridge.previewRestricted(),
    version: () => bridge.version(),
    toast,
    openTab: (value) => bridge.openTab(value),
    navigate: (value, opts) => { closeSettingsPanel(); bridge.navigate(value, opts); },
    refreshChrome: (rebuild) => bridge.refreshChrome(rebuild),
    reader: () => bridge.reader(),
    download: (...args) => bridge.download(...args),
    rerenderPage: () => renderBody(),
  };
}

function bodyEl() { return layer?.querySelector('.settings-body') || null; }

function renderBody() {
  const body = bodyEl();
  if (!body) return;
  const keep = body.scrollTop;
  renderSettings(body, panelCtx(), { embedded: true });
  body.scrollTop = keep;
  syncPills();
}

function scrollToSection(id) {
  const body = bodyEl();
  const target = body?.querySelector('#' + CSS.escape(id));
  if (!body || !target) return;
  activeSection = id;
  syncPills();
  const top = target.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 6;
  body.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function syncPills() {
  const body = bodyEl();
  if (!body || !layer) return;
  const sections = [...body.querySelectorAll('.section[id]')];
  if (!sections.length) return;
  const edge = body.getBoundingClientRect().top + 72;
  let current = sections[0].id;
  for (const section of sections) if (section.getBoundingClientRect().top <= edge) current = section.id;
  activeSection = current;
  layer.querySelectorAll('.settings-pills button').forEach((btn) => {
    const on = btn.dataset.section === current;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-current', on ? 'true' : 'false');
  });
}

export function openSettingsPanel(section = '') {
  if (layer) {
    if (section) scrollToSection(section);
    layer.querySelector('.settings-close')?.focus();
    return;
  }
  closing?.remove();
  closing = null;
  const node = document.createElement('div');
  node.className = 'settings-layer';
  node.innerHTML = `
    <div class="settings-scrim" aria-hidden="true"></div>
    <aside class="settings-panel" role="dialog" aria-modal="false" aria-label="Settings">
      <header class="settings-head">
        <span class="settings-mark">${icon('gear')}</span>
        <span class="settings-head-copy"><b>Settings</b><small>Every change applies straight away and stays on this device</small></span>
        <button class="icon-btn soft-close settings-close" data-close title="Close settings" aria-label="Close settings">${icon('x')}</button>
      </header>
      <nav class="settings-pills" aria-label="Settings sections">${SECTIONS.map(([id, label]) => `<button type="button" data-section="${id}">${label}</button>`).join('')}</nav>
      <div class="settings-body"></div>
    </aside>`;
  document.body.appendChild(node);
  layer = node;
  node.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeSettingsPanel));
  node.querySelectorAll('[data-section]').forEach((btn) => btn.addEventListener('click', () => scrollToSection(btn.dataset.section)));
  node.querySelector('.settings-body').addEventListener('scroll', syncPills, { passive: true });
  document.addEventListener('keydown', onKey, true);
  renderBody();
  requestAnimationFrame(() => { if (layer === node) { node.classList.add('open'); bridge.settingsToggled?.(); } });
  if (section) setTimeout(() => { if (layer === node) scrollToSection(section); }, 80);
  else setTimeout(() => { if (layer === node && activeSection !== 'appearance') scrollToSection(activeSection); }, 80);
  node.querySelector('.settings-close')?.focus();
}
