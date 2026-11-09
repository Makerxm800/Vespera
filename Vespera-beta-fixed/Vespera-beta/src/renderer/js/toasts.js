/** Vespera toasts — lightweight notifications. */
import { icon } from './icons.js';

export function toast(message, kind = 'info', ms = 3200) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'error' ? ' toast-error' : kind === 'ok' ? ' toast-ok' : '');
  el.innerHTML = icon(kind === 'error' ? 'warning' : kind === 'ok' ? 'check' : 'info') +
    `<span>${escapeHtml(message)}</span>`;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }, ms);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
