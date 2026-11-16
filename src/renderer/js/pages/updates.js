/** Release notes for the running build, plus a working check-for-updates button. */
import { icon } from '../icons.js';
import { escapeHtml } from '../toasts.js';

const RELEASES = 'https://github.com/Makerxm800/Vespera/releases';
const NOTES = [
  ['Extensions, pinned and in control', 'The Extensions page is remade: pin extensions to the toolbar or turn them off right from each card, see exactly what every extension can access — "On all sites", "On this site" or no site access — and open a per-extension permissions view. A new Access panel shows which extensions can act on the website in your active tab.'],
  ['Inspect any tab', 'Right-click any page — or any tab — and choose Inspect to open the page inspector for that site, on every tab.'],
  ['Tab previews for every tab', 'Hover cards now show a page preview for all tabs, captured while each tab is active, and crossfade smoothly as you move the mouse between tabs.'],
  ['Updates from the browser', 'A new Check for updates button on this page and in Settings downloads and installs the latest Vespera release for your platform.'],
  ['Tab controls live in Settings', 'Tab behavior toggles moved out of the browser menu and into the Tabs & groups section, where they belong.'],
];

function formatDate(value) {
  try { return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; }
}

export function renderUpdates(container, ctx) {
  const version = ctx.version?.() || '0.1.8';
  const desktop = Boolean(window.vespera?.app?.checkUpdate);
  container.innerHTML = `
    <div class="page page-narrow updates-page">
      <header class="account-header"><span class="account-mark">${icon('sparkle')}</span><div><span class="eyebrow">RELEASE NOTES</span><h1 class="page-title">What’s new in Vespera</h1></div></header>
      <p class="page-sub">You’re running build ${escapeHtml(version)}. These notes describe this build. Published desktop installers are available on GitHub Releases.</p>
      <section class="card account-card update-card">
        <div class="account-card-head"><h2>Vespera ${escapeHtml(version)}</h2><span class="chip chip-accent" id="update-status">${desktop ? 'Checking…' : 'Web preview'}</span></div>
        <div class="update-actions">
          <button class="btn btn-primary" id="update-check" ${!desktop ? 'disabled title="Updates are installed by the desktop app"' : ''}>${icon('update')} Check for updates</button>
          <button class="btn hidden" id="update-install">${icon('download')} Download &amp; install</button>
          <a class="btn btn-ghost" href="${RELEASES}" target="_blank" rel="noopener noreferrer">${icon('external')} Open Releases</a>
        </div>
        <div id="update-detail" class="update-detail"></div>
        ${!desktop ? '<p class="small faint">The live preview can’t install desktop builds. Open the releases page to download the latest Vespera for your system.</p>' : ''}
      </section>
      <section class="card account-card">
        <div class="account-card-head"><h2>Vespera ${escapeHtml(version)} notes</h2></div>
        <div class="release-notes">${NOTES.map(([title, body]) => `<div class="release-note">${icon('check')}<div><b>${title}</b><p>${body}</p></div></div>`).join('')}</div>
      </section>
      <section class="card account-card">
        <div class="account-card-head"><h2>Earlier releases</h2></div>
        <div class="release-links"><a href="${RELEASES}/tag/v0.1.7" target="_blank" rel="noopener noreferrer">v0.1.7 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.6" target="_blank" rel="noopener noreferrer">v0.1.6 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.5" target="_blank" rel="noopener noreferrer">v0.1.5 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.4" target="_blank" rel="noopener noreferrer">v0.1.4 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.3" target="_blank" rel="noopener noreferrer">v0.1.3 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.2" target="_blank" rel="noopener noreferrer">v0.1.2 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.1" target="_blank" rel="noopener noreferrer">v0.1.1 ${icon('external')}</a><a href="${RELEASES}/tag/v0.1.0" target="_blank" rel="noopener noreferrer">v0.1.0 ${icon('external')}</a></div>
      </section>
    </div>`;
  const status = container.querySelector('#update-status');
  const detail = container.querySelector('#update-detail');
  const checkButton = container.querySelector('#update-check');
  const installButton = container.querySelector('#update-install');
  let release = null;
  const setStatus = (text, cls = 'chip') => { status.textContent = text; status.className = `chip ${cls}`; };

  const runCheck = async () => {
    checkButton.disabled = true;
    setStatus('Checking…', 'chip');
    detail.innerHTML = '';
    try {
      const result = await window.vespera.app.checkUpdate();
      if (!result?.ok) {
        setStatus('Check failed', 'chip');
        detail.innerHTML = `<p class="small muted">${escapeHtml(result?.message || 'Could not reach the update service.')} Try again in a moment, or download the latest build from GitHub Releases.</p>`;
        return;
      }
      release = result;
      if (result.hasUpdate) {
        setStatus(`Update available · v${escapeHtml(result.latest)}`, 'chip-accent');
        detail.innerHTML = `<p class="small muted">Vespera ${escapeHtml(result.latest)} is available${result.publishedAt ? ` (released ${escapeHtml(formatDate(result.publishedAt))})` : ''}. You’re on ${escapeHtml(result.current)}. Downloading installs the new build over your current one.</p>${result.notes ? `<details class="update-notes"><summary>Read the release notes</summary><p class="small muted">${escapeHtml(result.notes.slice(0, 1200))}${result.notes.length > 1200 ? '…' : ''}</p></details>` : ''}`;
        installButton.classList.remove('hidden');
      } else {
        setStatus(`Up to date · v${escapeHtml(result.latest || result.current)}`, 'chip-ok');
        detail.innerHTML = `<p class="small muted">You’re running the latest Vespera build. New releases appear here automatically.</p>`;
        installButton.classList.add('hidden');
      }
    } catch (err) {
      setStatus('Check failed', 'chip');
      detail.innerHTML = `<p class="small muted">${escapeHtml(err.message || 'Could not check for updates.')}</p>`;
    } finally {
      checkButton.disabled = false;
    }
  };

  checkButton.onclick = runCheck;
  installButton.onclick = async () => {
    if (!release?.hasUpdate) return;
    installButton.disabled = true;
    setStatus('Downloading…', 'chip-accent');
    try {
      const result = await window.vespera.app.installUpdate(release);
      if (result?.ok) {
        setStatus('Installing…', 'chip-ok');
        detail.innerHTML = `<p class="small muted">${escapeHtml(result.message)} The update finishes in the background; Vespera restarts when it’s done.</p>`;
        ctx.toast(`Vespera ${escapeHtml(result.latest || release.latest)} is installing.`, 'ok', 6000);
      } else {
        setStatus('Update failed', 'chip');
        detail.innerHTML = `<p class="small muted">${escapeHtml(result?.message || 'The update could not be installed.')} You can download the build from GitHub Releases.</p>`;
        ctx.toast(result?.message || 'The update could not be installed.', 'error', 6500);
      }
    } catch (err) {
      setStatus('Update failed', 'chip');
      detail.innerHTML = `<p class="small muted">${escapeHtml(err.message || 'The update could not be installed.')}</p>`;
      ctx.toast(err.message || 'The update could not be installed.', 'error', 6500);
    } finally {
      installButton.disabled = false;
    }
  };

  if (desktop) runCheck();
}
