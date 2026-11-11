/** Release notes for the running build; never implies an installer was published. */
import { icon } from '../icons.js';
import { escapeHtml } from '../toasts.js';

const RELEASES = 'https://github.com/Makerxm800/Vespera/releases';
const NOTES = [
  ['Tabs & groups, your way', 'The new Tabs & groups section lets you choose layout, where new tabs open, strip scrolling or compression, close buttons, middle-click actions, group visibility, and inactive-tab styling.'],
  ['Groups stay organized', 'Rename, recolor and collapse groups; hiding group headers keeps membership intact. Session restore remembers group state and tab order.'],
  ['Audio controls on tabs', 'Mute a noisy tab from its speaker control, and choose whether tabs show a mute button, an audio indicator or no speaker icon.'],
  ['Hover for the right amount of detail', 'Choose a card, preview or simple tooltip. Desktop builds can also estimate a tab’s renderer memory when enabled.'],
  ['Sessions remember more', 'Pinned and muted tabs, ordering, active tab and collapsed groups come back together after a restart.'],
];

export function renderUpdates(container, ctx) {
  const version = ctx.version?.() || '0.1.7';
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
        <div class="release-links"><a href="${RELEASES}/tag/v0.1.6" target="_blank" rel="noopener noreferrer">v0.1.6 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.5" target="_blank" rel="noopener noreferrer">v0.1.5 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.4" target="_blank" rel="noopener noreferrer">v0.1.4 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.3" target="_blank" rel="noopener noreferrer">v0.1.3 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.2" target="_blank" rel="noopener noreferrer">v0.1.2 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.1" target="_blank" rel="noopener noreferrer">v0.1.1 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.0" target="_blank" rel="noopener noreferrer">v0.1.0 ${icon('external')}</a></div>
      </section>
    </div>`;
}
