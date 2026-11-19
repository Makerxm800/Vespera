/** Toolbar profile button + menu: account, sync, private window. Can be hidden in Settings. */
import { icon } from './icons.js';
import { state, bus } from './state.js';
import { escapeHtml, toast } from './toasts.js';
import { openPopover } from './popover.js';
import * as api from './api.jsx';

const nameOf = (user) => user?.displayName || user?.name || (user?.email ? user.email.split('@')[0] : '');
const initialOf = (user) => (nameOf(user).trim().charAt(0) || '?').toUpperCase();

export function initProfileMenu({ navigate, refreshChrome = () => {} }) {
  const button = document.getElementById('btn-profile');
  if (!button) return { refresh() {} };

  function refresh() {
    const user = state.user;
    button.hidden = state.settings.showProfileButton === false;
    button.classList.toggle('is-signed-in', Boolean(user));
    const label = user ? `${nameOf(user)} — your profile` : state.private ? 'Private window' : 'Profile — not signed in';
    button.title = label; button.setAttribute('aria-label', label);
    button.innerHTML = user ? `<span class="profile-avatar">${escapeHtml(initialOf(user))}</span>` : icon('user');
  }

  function html() {
    const user = state.user;
    const head = user
      ? `<span class="profile-avatar large">${escapeHtml(initialOf(user))}</span><b>${escapeHtml(nameOf(user))}</b><span class="small faint">${escapeHtml(user.email || '')}</span>`
      : `<span class="profile-avatar large guest">${icon('user')}</span><b>${state.private ? 'Private window' : 'Guest'}</b><span class="small faint">${state.private ? 'Nothing here is saved or synced.' : 'Sign in to sync bookmarks, history and settings.'}</span>`;
    const item = (act, ic, label, disabled = false) => `<button class="menu-item" data-profile="${act}" ${disabled ? 'disabled' : ''}>${icon(ic)} ${label}</button>`;
    return `<div class="profile-card">${head}</div>
      ${item('customize', 'palette', 'Customize profile')}
      ${user ? item('sync', 'update', 'Sync now', state.private) : item('signin', 'user', 'Sign in or create account')}
      <div class="menu-sep"></div>
      ${item('private', 'lock', 'Open private window', !window.vespera?.window?.incognito)}
      ${item('manage', 'gear', user ? 'Manage account' : 'Account settings')}
      ${user ? item('signout', 'logout', 'Sign out') : ''}`;
  }

  button.onclick = () => {
    const pop = openPopover(button, html(), { className: 'menu profile-menu', label: 'Profile' });
    if (!pop) return;
    pop.el.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-profile]')?.dataset.profile;
      if (!action) return;
      pop.close();
      if (action === 'customize' || action === 'manage' || action === 'signin') navigate('vespera://account');
      else if (action === 'private') window.vespera?.window?.incognito();
      else if (action === 'sync') {
        const result = await state.syncNow();
        toast(result.ok ? 'Everything is synced.' : (result.message || 'Sync is unavailable right now.'), result.ok ? 'ok' : 'error');
      } else if (action === 'signout') {
        try { await api.auth.logout(false); } catch { /* The local session is cleared either way. */ }
        api.setSession(null, null);
        await state.setUser(null);
        toast('Signed out', 'ok'); refreshChrome();
      }
    });
  };

  bus.on('user', refresh);
  bus.on('settings', refresh);
  refresh();
  return { refresh };
}
