/** Welcome page — first-run hero with the Vespera story. */
import { icon, icons } from '../icons.js';
import { state } from '../state.js';

function starfield(n = 26) {
  let html = '<div class="starfield">';
  for (let i = 0; i < n; i++) {
    const x = Math.random() * 100, y = Math.random() * 100;
    const d = (Math.random() * 4 + 2).toFixed(1);
    const delay = (Math.random() * 4).toFixed(1);
    html += `<i style="left:${x}%;top:${y}%;animation-delay:${delay}s;animation-duration:${d}s"></i>`;
  }
  return html + '</div>';
}

export function renderWelcome(container, ctx) {
  container.innerHTML = `
    <div class="page">
      <div class="welcome-hero">
        ${starfield()}
        <div class="hero-kicker">${icon('sparkle')} Welcome to Vespera</div>
        <h1>The browser that works <span class="grad">for you</span>,<br>not for advertisers.</h1>
        <p class="hero-sub">
          Vespera is a community-first Chromium browser: zero telemetry, built-in tracker
          and ad blocking, tracking-link cleanup, and a sleek interface that stays out of your way.
          Different from Chrome and every other browser — on purpose.
        </p>
        <div class="hero-actions">
          <button class="btn btn-primary" id="w-make-default">${icon('bolt')} Make Vespera my default</button>
          <button class="btn" id="w-explore">${icon('shield')} See what we block</button>
          <button class="btn btn-ghost" id="w-community">${icon('users')} Vote on features</button>
        </div>
      </div>

      <div class="section">
        <h2>${icon('shield')} Private by default — nothing to configure</h2>
        <div class="feature-grid">
          <div class="feature-card">
            <div class="f-icon">${icon('eyeOff')}</div>
            <h3>Zero telemetry, forever</h3>
            <p>No usage pings, no crash-phone-home, no hidden analytics. Vespera never talks to anyone about you.</p>
          </div>
          <div class="feature-card">
            <div class="f-icon">${icon('shield')}</div>
            <h3>Trackers &amp; ads blocked</h3>
            <p>A curated, bundled blocklist kills known trackers, ad networks and fingerprinting scripts before they load.</p>
          </div>
          <div class="feature-card">
            <div class="f-icon">${icon('link')}</div>
            <h3>Tracking links cleaned</h3>
            <p>utm_*, fbclid, gclid and friends are stripped from every URL you follow. You keep the content, lose the leash.</p>
          </div>
          <div class="feature-card">
            <div class="f-icon">${icon('bolt')}</div>
            <h3>Fast &amp; light</h3>
            <p>Pages load without the ad-bloat weight. Lazy tabs, throttled backgrounds, and a shell that stays snappy.</p>
          </div>
          <div class="feature-card">
            <div class="f-icon">${icon('users')}</div>
            <h3>Community-governed</h3>
            <p>Feature requests are public and voted on. The roadmap is literally decided by the people using it.</p>
          </div>
          <div class="feature-card">
            <div class="f-icon">${icon('code')}</div>
            <h3>Open source &amp; auditable</h3>
            <p>Every line is public. No obfuscation, no backdoors, no "trust us". Verify it yourself.</p>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>${icon('keyboard')} Get around fast</h2>
        <div class="card">
          <div class="setting-row" style="border:none;background:transparent;padding:10px 0">
            <div><div class="s-label">Command palette</div><div class="s-desc">Everything, one keystroke away</div></div>
            <div class="s-control"><span class="chip">Ctrl</span><span class="chip">K</span></div>
          </div>
          <div class="setting-row" style="border:none;background:transparent;padding:10px 0">
            <div><div class="s-label">New tab / close tab</div></div>
            <div class="s-control"><span class="chip">Ctrl</span><span class="chip">T</span><span class="chip">/</span><span class="chip">Ctrl</span><span class="chip">W</span></div>
          </div>
          <div class="setting-row" style="border:none;background:transparent;padding:10px 0">
            <div><div class="s-label">Focus address bar</div></div>
            <div class="s-control"><span class="chip">Ctrl</span><span class="chip">L</span></div>
          </div>
          <div class="setting-row" style="border:none;background:transparent;padding:10px 0">
            <div><div class="s-label">Bookmark page</div></div>
            <div class="s-control"><span class="chip">Ctrl</span><span class="chip">D</span></div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="pledge">
          ${icon('heart')}
          <div>
            <b>The Vespera pledge.</b>
            <p class="muted" style="margin-top:6px;line-height:1.7">
              We will never sell your data, add advertising, or quietly introduce telemetry.
              If we ever change course, it will be announced loudly — and the code will show it first.
            </p>
          </div>
        </div>
      </div>
    </div>`;

  container.querySelector('#w-make-default')?.addEventListener('click', () => {
    ctx.toast('Vespera is now your default browser on this device.', 'ok');
  });
  container.querySelector('#w-explore')?.addEventListener('click', () => ctx.navigate('vespera://privacy'));
  container.querySelector('#w-community')?.addEventListener('click', () => ctx.navigate('vespera://community'));
}
