/** Vespera command palette — Ctrl+K power-user launcher. */
import { icon } from './icons.js';
import { state } from './state.js';

export function openPalette({ actions }) {
  closePalette();
  const overlay = document.createElement('div');
  overlay.className = 'palette-overlay';
  overlay.id = 'palette-overlay';
  overlay.innerHTML = `
    <div class="palette">
      <div class="palette-input">
        ${icon('search')}
        <input id="palette-q" placeholder="Type a command, tab, or search…" spellcheck="false" autocomplete="off">
      </div>
      <div class="palette-list" id="palette-list"></div>
    </div>`;
  document.body.appendChild(overlay);

  const q = overlay.querySelector('#palette-q');
  const list = overlay.querySelector('#palette-list');
  let results = [];
  let sel = 0;

  function compute(query) {
    const f = query.trim().toLowerCase();
    const all = [
      ...actions,
      { id: 'search', title: `Search the web for "${query.trim() || '…'}"`, sub: 'Startpage', icon: 'search', kbd: 'Enter', run: (ctx) => ctx.search(query.trim()) , hiddenWhenEmpty: true },
    ];
    return all
      .filter((a) => (!f || (a.title + ' ' + (a.sub || '')).toLowerCase().includes(f)) && !(a.hiddenWhenEmpty && !f))
      .slice(0, 12);
  }

  function render() {
    results = compute(q.value);
    sel = Math.min(sel, Math.max(0, results.length - 1));
    list.innerHTML = results.map((r, i) => `
      <div class="palette-item ${i === sel ? 'selected' : ''}" data-i="${i}">
        ${icon(r.icon || 'sparkle')}
        <div>
          <div class="p-title">${escape(r.title)}</div>
          ${r.sub ? `<div class="p-sub">${escape(r.sub)}</div>` : ''}
        </div>
        ${r.kbd ? `<span class="p-kbd">${escape(r.kbd)}</span>` : ''}
      </div>`).join('') || '<div class="empty" style="padding:22px">No matches</div>';
    list.querySelectorAll('.palette-item').forEach((el) => {
      el.addEventListener('click', () => run(Number(el.dataset.i)));
      el.addEventListener('mouseenter', () => { sel = Number(el.dataset.i); highlight(); });
    });
  }

  function highlight() {
    list.querySelectorAll('.palette-item').forEach((el, i) => {
      el.classList.toggle('selected', i === sel);
    });
  }

  function run(i) {
    const r = results[i];
    if (!r) return;
    closePalette();
    r.run({ search: () => window.__vesperaNavigate?.({ kind: 'search', value: q.value.trim() }) });
  }

  q.addEventListener('input', render);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, results.length - 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    else if (e.key === 'Escape') closePalette();
  });
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closePalette();
  });

  render();
  q.focus();
}

export function closePalette() {
  document.getElementById('palette-overlay')?.remove();
}

export function paletteOpen() {
  return !!document.getElementById('palette-overlay');
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
