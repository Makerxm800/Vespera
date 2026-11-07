/** Account page — sign in / register / profile & sync. */
import { icon } from '../icons.js';
import { state } from '../state.js';
import * as api from '../../js/api.js';
import { escapeHtml, toast } from '../toasts.js';

export function renderAccount(container, ctx) {
  if (state.user) renderProfile(container, ctx);
  else renderAuth(container, ctx);
}

function renderAuth(container, ctx) {
  let mode = 'login';
  container.innerHTML = `
    <div class="page page-narrow">
      <h1 class="page-title">Your Vespera account</h1>
      <p class="page-sub">Sync your settings, bookmarks and history — privately. Your password never leaves
        this device unhashed (scrypt), and your session token can be revoked anytime.</p>
      <div class="auth-card">
        <div class="auth-tabs">
          <button id="tab-login" class="active">Sign in</button>
          <button id="tab-register">Create account</button>
        </div>
        <form id="auth-form" autocomplete="on">
          <div class="form-field" id="f-name" style="display:none">
            <label for="a-name">Display name</label>
            <input class="input" id="a-name" placeholder="What should we call you?">
          </div>
          <div class="form-field">
            <label for="a-email">Email</label>
            <input class="input" id="a-email" type="email" placeholder="you@example.com" autocomplete="username" required>
          </div>
          <div class="form-field">
            <label for="a-pass">Password</label>
            <input class="input" id="a-pass" type="password" placeholder="At least 8 characters"
                   autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required>
          </div>
          <div class="form-error" id="a-error"></div>
          <button class="btn btn-primary" style="width:100%;justify-content:center" id="a-submit" type="submit">
            ${icon('user')} <span>Sign in</span>
          </button>
        </form>
        <p class="small faint center" style="margin-top:18px;line-height:1.7">
          Accounts live in your own Vespera data store.<br>No third parties, ever.
        </p>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  const setMode = (m) => {
    mode = m;
    $('#tab-login').classList.toggle('active', m === 'login');
    $('#tab-register').classList.toggle('active', m === 'register');
    $('#f-name').style.display = m === 'register' ? '' : 'none';
    $('#a-pass').autocomplete = m === 'register' ? 'new-password' : 'current-password';
    $('#a-submit span').textContent = m === 'register' ? 'Create account' : 'Sign in';
    $('#a-error').textContent = '';
  };
  $('#tab-login').addEventListener('click', () => setMode('login'));
  $('#tab-register').addEventListener('click', () => setMode('register'));

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#a-email').value.trim();
    const password = $('#a-pass').value;
    const displayName = $('#a-name').value.trim();
    $('#a-error').textContent = '';
    $('#a-submit').disabled = true;

    const r = mode === 'register'
      ? await api.auth.register(email, password, displayName)
      : await api.auth.login(email, password);

    $('#a-submit').disabled = false;
    if (!r.ok) {
      $('#a-error').textContent = r.message || 'Something went wrong. Please try again.';
      return;
    }
    api.setSession(r.token, r.user);
    state.setUser(r.user);
    toast(`Welcome ${mode === 'register' ? 'to Vespera' : 'back'}, ${r.user.displayName}!`, 'ok');
    ctx.rerenderPage();
  });
}

function renderProfile(container, ctx) {
  const u = state.user;
  const hue = u.avatarHue ?? 40;
  container.innerHTML = `
    <div class="page page-narrow">
      <h1 class="page-title">Account</h1>
      <p class="page-sub">Signed in as ${escapeHtml(u.email)} · member since ${new Date(u.createdAt).toLocaleDateString()}</p>

      <div class="card">
        <div class="profile-head">
          <div class="avatar" style="--hue:${hue}">${escapeHtml((u.displayName || '?').slice(0, 1).toUpperCase())}</div>
          <div class="grow">
            <div style="font-size:18px;font-weight:700">${escapeHtml(u.displayName)}</div>
            <div class="muted small">${escapeHtml(u.email)} ${u.isAdmin ? '<span class="chip chip-accent" style="margin-left:6px">Moderator</span>' : ''}</div>
          </div>
          <button class="btn" id="p-signout">${icon('logout')} Sign out</button>
        </div>

        <div class="section" style="margin-top:26px">
          <h2>${icon('palette')} Profile</h2>
          <div class="form-field">
            <label>Display name</label>
            <input class="input" id="p-name" value="${escapeHtml(u.displayName)}">
          </div>
          <div class="form-field">
            <label>Avatar color</label>
            <div class="hue-picker" id="p-hues">
              ${[20, 45, 90, 150, 195, 230, 275, 320].map((h) => `
                <button class="hue-dot ${h === hue ? 'active' : ''}" data-h="${h}"
                  style="background:linear-gradient(150deg,hsl(${h} 80% 62%),hsl(${h} 70% 48%))"></button>`).join('')}
            </div>
          </div>
          <div class="form-field">
            <label>New password (leave blank to keep current)</label>
            <input class="input" id="p-pass" type="password" placeholder="••••••••" autocomplete="new-password">
          </div>
          <button class="btn btn-primary" id="p-save">${icon('check')} Save profile</button>
        </div>

        <div class="section">
          <h2>${icon('refresh')} Sync</h2>
          <div class="setting-row" style="border-radius:var(--r-lg)">
            <div>
              <div class="s-label">Sync status</div>
              <div class="s-desc">Settings, bookmarks and history sync automatically while you're signed in. Last write wins.</div>
            </div>
            <div class="s-control"><span class="chip chip-ok">${icon('check')} Active</span></div>
          </div>
          <div class="setting-row">
            <div>
              <div class="s-label">Synced data</div>
              <div class="s-desc">${state.bookmarks.length} bookmarks · ${state.history.length} history entries · settings</div>
            </div>
            <div class="s-control">
              <button class="btn" id="p-sync-now">${icon('refresh')} Sync now</button>
            </div>
          </div>
        </div>

        <div class="section">
          <h2>${icon('warning')} Danger zone</h2>
          <div class="setting-row" style="border-radius:var(--r-lg)">
            <div>
              <div class="s-label">Sign out everywhere</div>
              <div class="s-desc">Invalidate every session token issued for this account</div>
            </div>
            <div class="s-control">
              <button class="btn btn-danger" id="p-signout-all">${icon('logout')} Revoke all</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  let newHue = hue;

  $('#p-hues').addEventListener('click', (e) => {
    const dot = e.target.closest('.hue-dot');
    if (!dot) return;
    $('#p-hues').querySelectorAll('.hue-dot').forEach((d) => d.classList.remove('active'));
    dot.classList.add('active');
    newHue = Number(dot.dataset.h);
  });

  $('#p-save').addEventListener('click', async () => {
    const patch = {
      displayName: $('#p-name').value.trim(),
      avatarHue: newHue,
    };
    const pw = $('#p-pass').value;
    if (pw) patch.password = pw;
    const r = await api.auth.updateProfile(patch);
    if (r.ok) {
      state.setUser(r.user);
      toast('Profile updated', 'ok');
      ctx.rerenderPage();
    } else {
      toast(r.message || 'Update failed', 'error');
    }
  });

  $('#p-sync-now').addEventListener('click', async () => {
    await state.pullSync();
    state.pushSync('settings', state.settings);
    state.pushSync('bookmarks', { items: state.bookmarks });
    state.pushSync('history', { items: state.history.slice(0, 200) });
    toast('Synced with your account', 'ok');
  });

  const doSignOut = async (all) => {
    await api.auth.logout();
    api.setSession(null, null);
    state.user = null;
    if (all) toast('Signed out everywhere — all tokens revoked', 'ok');
    else toast('Signed out', 'ok');
    ctx.rerenderPage();
    ctx.refreshChrome();
  };
  $('#p-signout').addEventListener('click', () => doSignOut(false));
  $('#p-signout-all').addEventListener('click', () => doSignOut(true));
}
