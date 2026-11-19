/** "What's new" slideshow: shown once after an update, and any time from the Updates page. */
import { icon } from './icons.js';
import { escapeHtml } from './toasts.js';

const SEEN_KEY = 'vespera.whatsNewSeen';

export const SLIDES = [
  { icon: 'user', title: 'Your profile, one click away', body: 'The new profile button sits next to Downloads. Sign in to sync, jump to your account, or open a private window. Don’t want it? Turn it off in Settings.' },
  { icon: 'bolt', title: 'Lighter on your PC', body: 'Tabs you haven’t used for a while now go to sleep and wake the moment you click them, and visual effects ease off automatically on slower computers.' },
  { icon: 'update', title: 'Updates that just work', body: 'Check for updates from Settings or the Updates page. Vespera downloads the latest GitHub release for your system and starts its installer for you.' },
  { icon: 'puzzle', title: 'A clearer Extensions page', body: 'Built-in tools sit up front with simple switches, and the page says plainly what this version of Vespera can and can’t run.' },
];

export function showWhatsNew({ version = '', slides = SLIDES } = {}) {
  if (document.querySelector('dialog.whats-new')) return;
  let index = 0;
  const dialog = document.createElement('dialog');
  dialog.className = 'whats-new';
  dialog.setAttribute('aria-labelledby', 'wn-title');
  document.body.appendChild(dialog);

  function paint() {
    const slide = slides[index], last = index === slides.length - 1;
    dialog.innerHTML = `
      <header class="wn-head"><span class="wn-mark">${icon('sparkle')}</span><h2 id="wn-title">What’s new in Vespera${version ? ' ' + escapeHtml(version) : ''}</h2><button class="icon-btn" data-wn="close" aria-label="Close">${icon('x')}</button></header>
      <div class="wn-art" aria-hidden="true"><span class="wn-art-icon">${icon(slide.icon)}</span></div>
      <h3 class="wn-title">${escapeHtml(slide.title)}</h3>
      <p class="wn-body">${escapeHtml(slide.body)}</p>
      <div class="wn-foot">
        <div class="wn-dots" role="tablist" aria-label="Slides">${slides.map((_, i) => `<button class="wn-dot ${i === index ? 'on' : ''}" data-wn-dot="${i}" role="tab" aria-selected="${i === index}" aria-label="Slide ${i + 1} of ${slides.length}"></button>`).join('')}</div>
        <div class="wn-actions">${index > 0 ? '<button class="btn" data-wn="back">Back</button>' : ''}<button class="btn btn-primary" data-wn="next">${last ? 'Done' : 'Next'}</button></div>
      </div>`;
    dialog.querySelector('[data-wn="next"]').focus({ preventScroll: true });
  }
  dialog.addEventListener('click', (event) => {
    const dot = event.target.closest('[data-wn-dot]');
    if (dot) { index = Number(dot.dataset.wnDot); paint(); return; }
    const act = event.target.closest('[data-wn]')?.dataset.wn;
    if (act === 'close') dialog.close();
    else if (act === 'back') { index = Math.max(0, index - 1); paint(); }
    else if (act === 'next') { if (index >= slides.length - 1) dialog.close(); else { index++; paint(); } }
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' && index < slides.length - 1) { index++; paint(); }
    else if (event.key === 'ArrowLeft' && index > 0) { index--; paint(); }
  });
  dialog.addEventListener('close', () => dialog.remove());
  paint();
  dialog.showModal();
}

/** Show the slideshow once per version. A first install only records the version (the welcome page covers it). */
export function maybeShowWhatsNew(version) {
  if (!version) return;
  let seen = null;
  try { seen = localStorage.getItem(SEEN_KEY); localStorage.setItem(SEEN_KEY, version); } catch { return; }
  if (seen && seen !== version) setTimeout(() => showWhatsNew({ version }), 900);
}
