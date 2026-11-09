/** Personal Vespera account — compact email/password auth, profile and sync. */
import { icon } from '../icons.js';
import { state } from '../state.js';
import * as api from '../api.js';
import { escapeHtml, toast } from '../toasts.js';

export function renderAccount(container, ctx) {
  return state.user ? renderProfile(container, ctx) : renderAuth(container, ctx);
}

function passwordField(id, label, autocomplete, placeholder = 'At least 8 characters', required = true) {
  return `<div class="form-field"><label for="${id}">${label}</label>
    <div class="password-field"><input class="input" id="${id}" type="password" placeholder="${placeholder}" autocomplete="${autocomplete}" minlength="8" maxlength="128" ${required ? 'required' : ''}>
      <button class="icon-btn soft-close password-toggle" type="button" data-toggle-password="${id}" aria-label="Show password" aria-pressed="false">${icon('eye')}</button>
    </div></div>`;
}
function wirePasswordToggles(container) {
  container.querySelectorAll('[data-toggle-password]').forEach((button) => button.addEventListener('click', () => {
    const input = container.querySelector('#' + button.dataset.togglePassword);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.innerHTML = icon(show ? 'eyeOff' : 'eye');
    button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    button.setAttribute('aria-pressed', String(show));
  }));
}

function renderAuth(container, ctx) {
  let mode = 'login', alive = true, busy = false;
  container.innerHTML = `
    <div class="page page-narrow account-page">
      <header class="account-header"><span class="account-mark">${icon('user')}</span><div><span class="eyebrow">PERSONAL ACCOUNT</span><h1 class="page-title">Your Vespera account</h1></div></header>
      <p class="page-sub">Sign in with your email and a password to sync settings, bookmarks and history with this Vespera service. No third-party sign-in required.</p>
      <div class="auth-card">
        <div class="auth-tabs" role="tablist" aria-label="Account access">
          <button id="tab-login" type="button" role="tab" aria-selected="true" class="active">Sign in</button>
          <button id="tab-register" type="button" role="tab" aria-selected="false">Create account</button>
        </div>
        <form id="auth-form" autocomplete="on">
          <div class="form-field" id="f-name" hidden>
            <label for="a-name">Display name <span class="faint">(optional)</span></label>
            <input class="input" id="a-name" maxlength="40" placeholder="What should we call you?" autocomplete="nickname">
          </div>
          <div class="form-field"><label for="a-email">Email</label>
            <input class="input" id="a-email" type="email" placeholder="you@example.com" autocomplete="username" maxlength="254" required>
          </div>
          ${passwordField('a-pass', 'Password', 'current-password')}
          <div class="form-error" id="a-error" role="alert"></div>
          <div class="auth-actions"><span class="small faint" id="a-hint">Use your Vespera password.</span><button class="btn btn-primary btn-sm" id="a-submit" type="submit">${icon('user')} <span>Sign in</span></button></div>
        </form>
        <p class="auth-note">${icon('lock')} Passwords are stored as scrypt hashes by your Vespera service, never as plain text. Use HTTPS when hosting remotely.</p>
      </div>
    </div>`;

  const $ = (selector) => container.querySelector(selector);
  const form = $('#auth-form');
  function setMode(next) {
    if (busy) return;
    mode = next;
    const register = mode === 'register';
    $('#tab-login').classList.toggle('active', !register);
    $('#tab-register').classList.toggle('active', register);
    $('#tab-login').setAttribute('aria-selected', String(!register));
    $('#tab-register').setAttribute('aria-selected', String(register));
    $('#f-name').hidden = !register;
    $('#a-pass').autocomplete = register ? 'new-password' : 'current-password';
    $('#a-submit span').textContent = register ? 'Create account' : 'Sign in';
    $('#a-hint').textContent = register ? '8–128 characters.' : 'Use your Vespera password.';
    $('#a-error').textContent = '';
    form.classList.remove('mode-switch'); void form.offsetWidth; form.classList.add('mode-switch');
    (register ? $('#a-name') : $('#a-email')).focus();
  }
  $('#tab-login').addEventListener('click', () => setMode('login'));
  $('#tab-register').addEventListener('click', () => setMode('register'));
  wirePasswordToggles(container);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const submitMode = mode;
    const email = $('#a-email').value.trim();
    const password = $('#a-pass').value;
    const displayName = $('#a-name').value.trim();
    $('#a-error').textContent = '';
    busy = true;
    $('#a-submit').disabled = true;
    $('#tab-login').disabled = true; $('#tab-register').disabled = true;
    $('#a-submit span').textContent = submitMode === 'register' ? 'Creating…' : 'Signing in…';
    try {
      const r = submitMode === 'register'
        ? await api.auth.register(email, password, displayName)
        : await api.auth.login(email, password);
      if (!alive) return;
      if (!r.ok) {
        $('#a-error').textContent = r.message || (r.status === 0 ? 'Cannot reach the Vespera service. Check the preview connection and try again.' : 'Something went wrong. Please try again.');
        return;
      }
      api.setSession(r.token, r.user);
      const sync = await state.setUser(r.user);
      if (!alive) return;
      toast(`Welcome ${submitMode === 'register' ? 'to Vespera' : 'back'}, ${r.user.displayName}!`, 'ok');
      if (sync?.ok === false && sync.message) toast(sync.message, 'info');
      ctx.rerenderPage(); ctx.refreshChrome();
    } finally {
      if (alive) {
        busy = false;
        $('#a-submit').disabled = false;
        $('#tab-login').disabled = false; $('#tab-register').disabled = false;
        $('#a-submit span').textContent = mode === 'register' ? 'Create account' : 'Sign in';
      }
    }
  });
  return () => { alive = false; };
}

function renderProfile(container, ctx) {
  const u = state.user;
  const hue = Number.isFinite(u.avatarHue) ? u.avatarHue : 40;
  let alive = true, newHue = hue;
  const joined = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '';
  container.innerHTML = `
    <div class="page page-narrow account-page">
      <header class="account-header"><span class="account-mark">${icon('user')}</span><div><span class="eyebrow">PERSONAL ACCOUNT</span><h1 class="page-title">Account</h1></div></header>
      <p class="page-sub">Signed in as ${escapeHtml(u.email)}${joined ? ' · member since ' + escapeHtml(joined) : ''}</p>
      <section class="card account-card">
        <div class="profile-head">
          <div class="avatar" style="--hue:${hue}">${escapeHtml((u.displayName || '?').slice(0, 1).toUpperCase())}</div>
          <div class="grow"><div class="profile-name">${escapeHtml(u.displayName)}</div><div class="muted small">${escapeHtml(u.email)} ${u.isAdmin ? '<span class="chip chip-accent">Moderator</span>' : ''}</div></div>
          <button class="btn btn-sm" id="p-signout">${icon('logout')} Sign out</button>
        </div>
      </section>
      <section class="card account-card">
        <div class="account-card-head"><h2>${icon('palette')} Profile</h2></div>
        <div class="form-field"><label for="p-name">Display name</label><input class="input" id="p-name" maxlength="40" value="${escapeHtml(u.displayName)}"></div>
        <div class="form-field"><label>Avatar color</label><div class="hue-picker" id="p-hues">${[20, 45, 90, 150, 195, 230, 275, 320].map((h) => `<button type="button" class="hue-dot ${h === hue ? 'active' : ''}" data-h="${h}" aria-label="Avatar color ${h}" aria-pressed="${h === hue}" style="background:linear-gradient(150deg,hsl(${h} 80% 62%),hsl(${h} 70% 48%))"></button>`).join('')}</div></div>
        ${passwordField('p-pass', 'New password', 'new-password', 'Leave blank to keep current', false)}
        <div class="account-actions"><span class="small faint">Changing your password signs out other sessions.</span><button class="btn btn-primary btn-sm" id="p-save">${icon('check')} Save profile</button></div>
      </section>
      <section class="card account-card">
        <div class="account-card-head"><h2>${icon('refresh')} Sync</h2><span class="chip" id="p-sync-status">Ready</span></div>
        <p class="small muted" id="p-sync-counts">${state.bookmarks.length} bookmarks · ${state.history.length} history entries · settings</p>
        <div class="account-actions"><span class="small faint">Syncs with this Vespera service while signed in.</span><button class="btn btn-sm" id="p-sync-now">${icon('refresh')} Sync now</button></div>
      </section>
      <section class="card account-card">
        <div class="account-card-head"><h2>${icon('lock')} Security</h2></div>
        <div class="account-actions"><span class="small muted">Revoke every session token for this account.</span><button class="btn btn-danger btn-sm" id="p-signout-all">${icon('logout')} Sign out everywhere</button></div>
      </section>
    </div>`;

  const $ = (selector) => container.querySelector(selector);
  wirePasswordToggles(container);
  $('#p-hues').addEventListener('click', (event) => {
    const dot = event.target.closest('.hue-dot');
    if (!dot) return;
    $('#p-hues').querySelectorAll('.hue-dot').forEach((button) => { button.classList.toggle('active', button === dot); button.setAttribute('aria-pressed', String(button === dot)); });
    newHue = Number(dot.dataset.h);
  });
  $('#p-save').addEventListener('click', async () => {
    const button = $('#p-save');
    const password = $('#p-pass').value;
    if (password && (password.length < 8 || password.length > 128)) return toast('Use a password between 8 and 128 characters.', 'error');
    button.disabled = true;
    try {
      const patch = { displayName: $('#p-name').value.trim(), avatarHue: newHue };
      if (password) patch.password = password;
      const r = await api.auth.updateProfile(patch);
      if (!alive) return;
      if (!r.ok) return toast(r.message || 'Update failed', 'error');
      if (r.token) api.setSession(r.token, r.user);
      await state.setUser(r.user);
      if (!alive) return;
      toast(password ? 'Profile updated. Other sessions signed out.' : 'Profile updated', 'ok');
      ctx.rerenderPage();
    } finally { if (alive) button.disabled = false; }
  });
  $('#p-sync-now').addEventListener('click', async () => {
    const button = $('#p-sync-now'), status = $('#p-sync-status');
    button.disabled = true; status.textContent = 'Syncing…'; status.className = 'chip';
    try {
      const result = await state.syncNow();
      if (!alive) return;
      status.textContent = result.ok ? 'Synced' : 'Unavailable';
      status.className = 'chip ' + (result.ok ? 'chip-ok' : 'chip-warn');
      $('#p-sync-counts').textContent = `${state.bookmarks.length} bookmarks · ${state.history.length} history entries · settings`;
      toast(result.ok ? 'Synced with your account' : result.message || 'Sync failed', result.ok ? 'ok' : 'error');
      if (!result.ok && !state.user) { ctx.rerenderPage(); ctx.refreshChrome(); }
    } finally { if (alive) button.disabled = false; }
  });
  async function doSignOut(all) {
    const buttons = [$('#p-signout'), $('#p-signout-all')];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const r = await api.auth.logout(all);
      api.setSession(null, null);
      await state.setUser(null);
      if (!alive) return;
      if (all) toast(r.ok ? 'Signed out everywhere — all tokens revoked' : 'Signed out on this device, but other sessions could not be revoked.', r.ok ? 'ok' : 'error');
      else toast('Signed out', 'ok');
      ctx.rerenderPage(); ctx.refreshChrome();
    } finally { if (alive) buttons.forEach((button) => { button.disabled = false; }); }
  }
  $('#p-signout').addEventListener('click', () => doSignOut(false));
  $('#p-signout-all').addEventListener('click', () => doSignOut(true));
  return () => { alive = false; };
}
