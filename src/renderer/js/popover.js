/** One dismissible, viewport-clamped popover at a time. */
let current = null;
export function closePopover() { current?.close(); }
export function openPopover(anchor, html, { className = 'menu', label = 'Menu', onClose, align = 'end' } = {}) {
  if (current?.anchor === anchor) { closePopover(); return null; }
  closePopover();
  const el = document.createElement('div');
  el.className = className;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', label);
  el.innerHTML = html;
  document.body.appendChild(el);
  anchor.setAttribute('aria-expanded', 'true');
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const margin = 8, gap = 7;
    const width = el.offsetWidth;
    const wantedLeft = align === 'context' ? r.left : r.right - width;
    let wantedTop = align === 'context' ? r.top : r.bottom + gap;
    if (align !== 'context') {
      const below = Math.max(120, innerHeight - r.bottom - gap - margin);
      const above = Math.max(120, r.top - gap - margin);
      const useAbove = el.offsetHeight > below && above > below;
      el.style.maxHeight = (useAbove ? above : below) + 'px';
      el.style.overflowY = 'auto';
      wantedTop = useAbove ? Math.max(margin, r.top - gap - el.offsetHeight) : r.bottom + gap;
    }
    const height = el.offsetHeight;
    el.style.left = Math.max(margin, Math.min(wantedLeft, innerWidth - width - margin)) + 'px';
    el.style.top = Math.max(margin, Math.min(wantedTop, innerHeight - height - margin)) + 'px';
  };
  place();
  const controller = new AbortController();
  const opts = { signal: controller.signal };
  const close = () => {
    controller.abort(); el.remove(); anchor.setAttribute('aria-expanded', 'false');
    if (current?.el === el) current = null;
    onClose?.();
  };
  current = { el, anchor, close };
  document.addEventListener('pointerdown', (e) => {
    if (!e.composedPath().includes(el) && !e.composedPath().includes(anchor)) close();
  }, opts);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); anchor.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const buttons = [...el.querySelectorAll('button:not(:disabled),input,select')];
      if (!buttons.length) return;
      e.preventDefault();
      const i = buttons.indexOf(document.activeElement);
      buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    }
  }, opts);
  window.addEventListener('resize', close, opts);
  el.addEventListener('click', (e) => { if (e.target.closest('[data-dismiss]')) close(); });
  el.querySelector('button,input,select')?.focus({ preventScroll: true });
  return { el, close };
}
