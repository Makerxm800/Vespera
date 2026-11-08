import { escapeHtml } from './toasts.js';
import { icon } from './icons.js';
export function confirmAction({ title, message, confirmText = 'Continue', danger = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'confirm-dialog';
    dialog.setAttribute('aria-labelledby', 'confirm-title');
    dialog.innerHTML = `<div class="dialog-icon">${icon(danger ? 'warning' : 'info')}</div>
      <h2 id="confirm-title">${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p>
      <div class="dialog-actions"><button class="btn" data-cancel>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${escapeHtml(confirmText)}</button></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close('cancel');
    dialog.querySelector('[data-confirm]').onclick = () => dialog.close('confirm');
    dialog.addEventListener('cancel', () => { resolve(false); dialog.remove(); });
    dialog.addEventListener('close', () => { resolve(dialog.returnValue === 'confirm'); dialog.remove(); });
    dialog.showModal();
    dialog.querySelector('[data-cancel]').focus();
  });
}
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
