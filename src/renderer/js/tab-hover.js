import { escapeHtml } from './toasts.js';
import { icon } from './icons.js';
import { platform } from './platform.js';

function siteLabel(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'vespera:' ? `Vespera · ${parsed.hostname || 'browser page'}` : parsed.hostname;
  } catch { return url; }
}

function formatMemory(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Delayed tab hover details; snapshots and process memory are best-effort desktop features. */
export function initTabHover(tabs, getSettings) {
  let timer = null;
  let current = null;
  let generation = 0;
  const lists = [tabs.strip, tabs.vlist].filter(Boolean);

  function reposition() {
    if (!current) return;
    const { row, card } = current;
    if (!row.isConnected) return close();
    const anchor = row.getBoundingClientRect();
    const bounds = card.getBoundingClientRect();
    const width = bounds.width || 276, height = bounds.height || 100, gap = 9, edge = 10;
    const vertical = row.classList.contains('vtab');
    let left = vertical ? anchor.right + gap : anchor.left;
    let top = vertical ? anchor.top + (anchor.height - height) / 2 : anchor.bottom + gap;
    if (top + height > innerHeight - edge) top = anchor.top - height - gap;
    if (top < edge) top = edge;
    if (left + width > innerWidth - edge) left = vertical ? anchor.left - width - gap : innerWidth - width - edge;
    left = Math.max(edge, Math.min(left, innerWidth - width - edge));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.visibility = 'visible';
  }

  function close() {
    clearTimeout(timer);
    timer = null;
    generation++;
    if (current) {
      current.card.remove();
      current = null;
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    }
  }

  async function show(row) {
    const tab = tabs.tabs.find((item) => item.id === row.dataset.id);
    if (!tab) return;
    const behavior = getSettings()?.tabBehavior || {};
    const mode = behavior.tabHoverMode || 'card';
    const showMemory = behavior.memoryUsageOnHover !== false;
    if (mode === 'tooltip' && !showMemory) return;

    close();
    const token = ++generation;
    const favicon = tab.favicon && /^(https?:|data:image\/)/.test(tab.favicon)
      ? `<img src="${escapeHtml(tab.favicon)}" alt="" referrerpolicy="no-referrer">`
      : icon(tab._internal ? 'sparkle' : 'globe');
    const preview = mode === 'preview'
      ? `<div class="tab-hovercard-preview" data-hover-preview><div class="tab-hovercard-placeholder">${icon('image')}<span>${platform.isElectron ? 'Capturing page preview…' : 'Page snapshots are available in the desktop app.'}</span></div></div>`
      : '';
    const stateLabel = tab.loading ? 'Loading' : tab.muted ? 'Muted' : tab.audible ? 'Playing audio' : 'Ready';
    const card = document.createElement('div');
    card.className = `tab-hovercard${mode === 'tooltip' ? ' is-tooltip' : ''}${mode === 'preview' ? ' has-preview' : ''}`;
    card.setAttribute('role', 'tooltip');
    card.setAttribute('aria-label', `${tab.title}, ${siteLabel(tab.url)}`);
    card.style.visibility = 'hidden';
    card.innerHTML = `<div class="tab-hovercard-head"><div class="tab-hovercard-favicon">${favicon}</div><div class="tab-hovercard-copy"><strong>${escapeHtml(tab.title)}</strong><span>${escapeHtml(siteLabel(tab.url))}</span></div></div>
      ${preview}
      <div class="tab-hovercard-meta"><span class="tab-hovercard-state">${escapeHtml(stateLabel)}</span>${showMemory ? '<span class="tab-hovercard-memory" data-hover-memory>Checking memory…</span>' : ''}</div>
      <div class="tab-hovercard-url">${escapeHtml(tab.url)}</div>`;
    document.body.appendChild(card);
    current = { row, card, token };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);

    if (mode === 'preview') {
      if (platform.isElectron) {
        platform.capturePreview(tab.view).then((image) => {
          if (!current || current.token !== token) return;
          const target = card.querySelector('[data-hover-preview]');
          if (!target) return;
          if (!image) {
            target.innerHTML = `<div class="tab-hovercard-placeholder">${icon('image')}<span>Preview not available for this page.</span></div>`;
            return;
          }
          const img = document.createElement('img');
          img.src = image; img.alt = `Preview of ${tab.title}`;
          target.replaceChildren(img);
          reposition();
        });
      }
    }
    if (showMemory) {
      const bytes = await platform.memoryBytes(tab.view);
      if (!current || current.token !== token) return;
      const target = card.querySelector('[data-hover-memory]');
      if (target) target.textContent = bytes === null
        ? (platform.isElectron ? 'Memory estimate unavailable' : 'Memory estimate unavailable in web preview')
        : `~${formatMemory(bytes)} renderer`;
      reposition();
    }
  }

  function schedule(row) {
    if (!row) return;
    const behavior = getSettings()?.tabBehavior || {};
    if ((behavior.tabHoverMode || 'card') === 'tooltip' && behavior.memoryUsageOnHover === false) return;
    if (current?.row === row) return;
    close();
    timer = setTimeout(() => { timer = null; show(row); }, behavior.tabHoverMode === 'tooltip' ? 180 : 320);
  }

  function onPointerOver(event) {
    if (event.pointerType === 'touch') return;
    const row = event.target.closest('[data-id]');
    if (row && !row.contains(event.relatedTarget)) schedule(row);
  }
  function onPointerOut(event) {
    const row = event.target.closest('[data-id]');
    if (row && !row.contains(event.relatedTarget)) close();
  }
  function onFocusIn(event) {
    const row = event.target.closest('[data-id]');
    if (row) schedule(row);
  }
  function onFocusOut(event) {
    const row = event.target.closest('[data-id]');
    if (row && !row.contains(event.relatedTarget)) close();
  }

  for (const list of lists) {
    list.addEventListener('pointerover', onPointerOver);
    list.addEventListener('pointerout', onPointerOut);
    list.addEventListener('focusin', onFocusIn);
    list.addEventListener('focusout', onFocusOut);
  }
  return {
    close,
    destroy() {
      close();
      for (const list of lists) {
        list.removeEventListener('pointerover', onPointerOver);
        list.removeEventListener('pointerout', onPointerOut);
        list.removeEventListener('focusin', onFocusIn);
        list.removeEventListener('focusout', onFocusOut);
      }
    },
  };
}
