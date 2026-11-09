/** Private start page — explains what Vespera does and does not retain. */
import { icon } from '../icons.js';

export function renderPrivate(container, ctx) {
  container.innerHTML = `
    <div class="private-page">
      <div class="private-hero">
        <div class="private-mark">${icon('eyeOff')}</div>
        <span class="eyebrow">VESPERA PRIVATE WINDOW</span>
        <h1>You're browsing privately</h1>
        <p>Vespera won't save your browsing history, synced activity, or site data after this private window closes.</p>
        <button class="btn btn-primary" id="private-new-tab">${icon('plus')} Open a private tab</button>
      </div>
      <div class="private-info-grid">
        <section class="card">
          <h2>Vespera won't save</h2>
          <ul>
            <li>Browsing history in this private window</li>
            <li>Cookies and site data after the window closes</li>
            <li>Form entries or account sync activity</li>
          </ul>
          <p class="small muted">Files you download are still saved on your device. Extensions are disabled in private windows.</p>
        </section>
        <section class="card">
          <h2>Your activity may still be visible to</h2>
          <ul>
            <li>Websites you visit</li>
            <li>Your school, employer, or network administrator</li>
            <li>Your internet service provider</li>
          </ul>
          <p class="small muted">Private browsing doesn't make you anonymous or hide traffic from websites and networks.</p>
        </section>
      </div>
    </div>`;
  container.querySelector('#private-new-tab').addEventListener('click', () => ctx.openTab('vespera://newtab'));
}
