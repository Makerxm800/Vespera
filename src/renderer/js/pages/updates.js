/** Release notes for the running build; never implies an installer was published. */
import { icon } from '../icons.js';
import { escapeHtml } from '../toasts.js';

const RELEASES = 'https://github.com/Makerxm800/Vespera/releases';
const NOTES = [
  ['Settings is now a panel', 'Settings opens as a floating drawer over whatever you are doing — Ctrl+, toggles it, Escape closes it, and the section pills jump you around. No more navigating away to change a preference.'],
  ['Wallpapers that stick', 'Uploading an image, switching presets and coming back to your custom wallpaper all work again, and the Custom tile stays put so your image is always one click away.'],
  ['Tab groups you can actually drag', 'Dropping a tab in the middle of another one groups it (hold Alt to make the whole row a target), the drop target is highlighted, and grouped tabs are tinted in their group colour.'],
  ['Pinned tabs got a menu', 'A pinned tab is only a few pixels wide, so it now shows a ⋮ that opens the full tab menu — pin, unpin, group, close and rename.'],
  ['Collapsible sidebar', 'Hide the icon rail so pages and the home screen get the full width, then bring it back with the tab on the left edge or from the browser menu.'],
  ['Extensions, sorted', 'The Extensions page is split into General, Built-in, Installed and Catalog, with buttons that open the Chrome Web Store and each extension’s download page in a new tab.'],
  ['A calmer home', 'Tighter spacing, a staggered entrance for the shortcuts, and a full-width layout once the sidebar is hidden.'],
  ['Google sign-in', 'Client hints are rewritten and the webview identity patched so Google no longer blocks the sign-in page.'],
];

export function renderUpdates(container, ctx) {
  const version = ctx.version?.() || '0.1.6';
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
        <div class="release-links"><a href="${RELEASES}/tag/v0.1.5" target="_blank" rel="noopener noreferrer">v0.1.5 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.4" target="_blank" rel="noopener noreferrer">v0.1.4 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.3" target="_blank" rel="noopener noreferrer">v0.1.3 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.2" target="_blank" rel="noopener noreferrer">v0.1.2 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.1" target="_blank" rel="noopener noreferrer">v0.1.1 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.0" target="_blank" rel="noopener noreferrer">v0.1.0 ${icon('external')}</a></div>
      </section>
    </div>`;
}
