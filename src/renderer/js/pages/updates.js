/** Release notes for the running build; never implies an installer was published. */
import { icon } from '../icons.js';
import { escapeHtml } from '../toasts.js';

const RELEASES = 'https://github.com/Makerxm800/Vespera-beta/releases';
const NOTES = [
  ['Smoother tabs', 'Tabs animate when opened, closed, switched and reordered. Close buttons are softer, rounded and keyboard accessible.'],
  ['Privacy Hub', 'A compact hub with live counters, working protection toggles, per-site exceptions and honest privacy notes.'],
  ['Personal accounts', 'Smaller account controls with working email/password registration, sign-in, profile updates, sync and sign-out.'],
  ['Live preview repairs', 'Usable tabs and window controls, Home clock, wallpapers, themes, right-click menus, animated search, downloads and built-in extensions.'],
  ['Extension manager', 'A toolbar menu for installed extensions, quick access to extension management, and a safer unpacked-extension loading flow. Chrome Web Store extensions are not installed directly; compatibility depends on Electron support.'],
];

export function renderUpdates(container, ctx) {
  const version = ctx.version?.() || '0.1.3';
  container.innerHTML = `
    <div class="page page-narrow updates-page">
      <header class="account-header"><span class="account-mark">${icon('sparkle')}</span><div><span class="eyebrow">RELEASE NOTES</span><h1 class="page-title">What’s new in Vespera</h1></div></header>
      <p class="page-sub">You’re running build ${escapeHtml(version)}. These notes describe this build. Published desktop installers are available on GitHub Releases.</p>
      <section class="card account-card">
        <div class="account-card-head"><h2>Vespera ${escapeHtml(version)}</h2><span class="chip chip-accent">${window.vespera ? 'Desktop build' : 'Web preview'}</span></div>
        <div class="release-notes">${NOTES.map(([title, body]) => `<div class="release-note">${icon('check')}<div><b>${title}</b><p>${body}</p></div></div>`).join('')}</div>
        <div class="account-actions"><span class="small faint">Desktop downloads for Windows, macOS and Linux.</span><a class="btn btn-primary btn-sm" href="${RELEASES}" target="_blank" rel="noopener noreferrer">${icon('download')} Open Releases</a></div>
      </section>
      <section class="card account-card">
        <div class="account-card-head"><h2>Earlier releases</h2></div>
        <div class="release-links"><a href="${RELEASES}/tag/v0.1.2" target="_blank" rel="noopener noreferrer">v0.1.2 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.1" target="_blank" rel="noopener noreferrer">v0.1.1 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.0" target="_blank" rel="noopener noreferrer">v0.1.0 ${icon('external')}</a></div>
      </section>
    </div>`;
}
