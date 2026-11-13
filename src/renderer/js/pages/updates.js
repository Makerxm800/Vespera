/** Release notes for the running build; never implies an installer was published. */
import { icon } from '../icons.js';
import { escapeHtml } from '../toasts.js';

const RELEASES = 'https://github.com/Makerxm800/Vespera/releases';
const NOTES = [
  ['Reorder whole tab groups', 'Drag a group by its grip in the horizontal strip or vertical sidebar. Drop before or after another group or tab; long strips auto-scroll as you drag. Group order is saved with your session.'],
  ['Group actions on right-click', 'Right-click a group to rename it, choose a color, add a tab, collapse it, ungroup it or close it. Save group writes its name and color immediately.'],
  ['Groups stay saved', 'Session restore keeps group names, colors, membership, order and collapsed state. The Tabs & groups setting hides or restores group headers without deleting your saved groups.'],
  ['Settings gets a full page', 'The floating drawer is replaced by a redesigned internal Settings page with a compact section navigator and responsive spacing. Open it from the browser menu or with Ctrl+comma; it stays in normal tab history.'],
  ['A cleaner left sidebar', 'Settings no longer takes a permanent slot in the left navigation. Site privacy settings remain available from site information.'],
  ['Audio controls stay focused', 'The mute toggle appears on tabs that are playing audio or are already muted. The existing settings still let you choose a button, an indicator or no speaker icon.'],
];

export function renderUpdates(container, ctx) {
  const version = ctx.version?.() || '0.1.8';
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
        <div class="release-links"><a href="${RELEASES}/tag/v0.1.7" target="_blank" rel="noopener noreferrer">v0.1.7 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.6" target="_blank" rel="noopener noreferrer">v0.1.6 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.5" target="_blank" rel="noopener noreferrer">v0.1.5 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.4" target="_blank" rel="noopener noreferrer">v0.1.4 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.3" target="_blank" rel="noopener noreferrer">v0.1.3 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.2" target="_blank" rel="noopener noreferrer">v0.1.2 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.1" target="_blank" rel="noopener noreferrer">v0.1.1 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.0" target="_blank" rel="noopener noreferrer">v0.1.0 ${icon('external')}</a></div>
      </section>
    </div>`;
}
