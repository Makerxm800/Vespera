/** Delayed tab hover details; snapshots and process memory are best-effort desktop features.
 *  Every tab gets a cached page snapshot (captured while it is the visible tab), so
 *  previews work for any tab — not just the one you hover and stay on. Moving the
 *  mouse across tabs crossfades the card and slides it to the new tab. */
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function applyCardClass(card, mode) {
  card.className = `tab-hovercard${mode === 'tooltip' ? ' is-tooltip' : ''}${mode === 'preview' ? ' has-preview' : ''}`;
}

/** Snapshot a tab while it is the visible tab; every tab can then show a preview. */
export function initTabHover(tabs, getSettings) {
  let timer = null;
  let leaveTimer = null;
  let current = null;
  let generation = 0;
  const previewCache = new Map(); // tabId -> dataURL
  const lists = [tabs.strip, tabs.vlist].filter(Boolean);
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    clearTimeout(leaveTimer);
    timer = null;
    leaveTimer = null;
    generation++;
    if (current) {
      current.card.remove();
      current = null;
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    }
  }

  function faviconHtml(tab) {
    if (tab.favicon && /^(https?:|data:image\/)/.test(tab.favicon)) return `<img src="${escapeHtml(tab.favicon)}" alt="" referrerpolicy="no-referrer">`;
    return icon(tab._internal ? 'sparkle' : 'globe');
  }

  function previewPlaceholder(text) {
    return `<div class="tab-hovercard-placeholder">${icon('image')}<span>${text}</span></div>`;
  }

  function fillCard(card, tab, mode, showMemory) {
    const cached = mode === 'preview' ? previewCache.get(tab.id) : null;
    const preview = mode === 'preview'
      ? `<div class="tab-hovercard-preview" data-hover-preview>${cached
        ? `<img src="${escapeHtml(cached)}" alt="Preview of ${escapeHtml(tab.title)}" referrerpolicy="no-referrer">`
        : previewPlaceholder(platform.isElectron ? 'Capturing page preview…' : 'Page snapshots are available in the desktop app.')}</div>`
      : '';
    const stateLabel = tab.loading ? 'Loading' : tab.muted ? 'Muted' : tab.audible ? 'Playing audio' : 'Ready';
    card.innerHTML = `<div class="tab-hovercard-head"><div class="tab-hovercard-favicon">${faviconHtml(tab)}</div><div class="tab-hovercard-copy"><strong>${escapeHtml(tab.title)}</strong><span>${escapeHtml(siteLabel(tab.url))}</span></div></div>
      ${preview}
      <div class="tab-hovercard-meta"><span class="tab-hovercard-state">${escapeHtml(stateLabel)}</span>${showMemory ? '<span class="tab-hovercard-memory" data-hover-memory>Checking memory…</span>' : ''}</div>
      <div class="tab-hovercard-url">${escapeHtml(tab.url)}</div>`;
  }

  async function ensurePreview(card, tab, mode, token) {
    if (mode !== 'preview') return;
    const target = card.querySelector('[data-hover-preview]');
    if (!target) return;
    const cached = previewCache.get(tab.id);
    if (cached) {
      target.innerHTML = `<img src="${escapeHtml(cached)}" alt="Preview of ${escapeHtml(tab.title)}" referrerpolicy="no-referrer">`;
      return;
    }
    if (!platform.isElectron || !platform.isWebview(tab.view)) return;
    // Capture on demand when no automatic snapshot exists yet; if the page
    // wasn't ready, retry once shortly after so hover previews still appear.
    try {
      const image = await platform.capturePreview(tab.view);
      if (!current || current.token !== token) return;
      if (image) {
        previewCache.set(tab.id, image);
        target.innerHTML = `<img src="${escapeHtml(image)}" alt="Preview of ${escapeHtml(tab.title)}" referrerpolicy="no-referrer">`;
      } else if (!tab._previewRetried) {
        tab._previewRetried = true;
        setTimeout(() => {
          tab._previewRetried = false;
          if (current?.tab?.id === tab.id) ensurePreview(card, tab, mode, token);
        }, 600);
      } else {
        tab._previewRetried = false;
        target.innerHTML = previewPlaceholder('Preview not available for this page.');
      }
    } catch { /* The page may have navigated mid-capture. */ }
  }

  async function fetchMemory(card, tab, token) {
    const bytes = await platform.memoryBytes(tab.view);
    if (!current || current.token !== token) return;
    const target = card.querySelector('[data-hover-memory]');
    if (target) target.textContent = bytes === null
      ? (platform.isElectron ? 'Memory estimate unavailable' : 'Memory estimate unavailable in web preview')
      : `~${formatMemory(bytes)} renderer`;
    reposition();
  }

  async function show(row, { reuse = false } = {}) {
    const tab = tabs.tabs.find((item) => item.id === row.dataset.id);
    if (!tab) return;
    const behavior = getSettings()?.tabBehavior || {};
    const mode = behavior.tabHoverMode || 'card';
    const showMemory = behavior.memoryUsageOnHover !== false;
    if (mode === 'tooltip' && !showMemory) return;

    const token = ++generation;
    if (reuse && current?.card?.isConnected && current.token !== token) {
      // The pointer moved to another tab: keep the card, crossfade its contents
      // and slide it to the new tab instead of tearing it down.
      const card = current.card;
      card.classList.add('is-leaving');
      await wait(reduce() ? 0 : 80);
      card.classList.remove('is-leaving');
      fillCard(card, tab, mode, showMemory);
      applyCardClass(card, mode);
      card.classList.add('is-switching');
      setTimeout(() => card.classList.remove('is-switching'), 220);
      current = { tab, row, card, token };
      reposition();
      ensurePreview(card, tab, mode, token);
      if (showMemory) fetchMemory(card, tab, token);
      return;
    }
    close();
    const card = document.createElement('div');
    applyCardClass(card, mode);
    card.setAttribute('role', 'tooltip');
    card.setAttribute('aria-label', `${tab.title}, ${siteLabel(tab.url)}`);
    card.style.visibility = 'hidden';
    card.style.transition = 'left .2s var(--ease), top .2s var(--ease), opacity .15s var(--ease), transform .15s var(--ease)';
    fillCard(card, tab, mode, showMemory);
    document.body.appendChild(card);
    current = { tab, row, card, token };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    ensurePreview(card, tab, mode, token);
    if (showMemory) fetchMemory(card, tab, token);
  }

  function schedule(row) {
    if (!row) return;
    const behavior = getSettings()?.tabBehavior || {};
    if ((behavior.tabHoverMode || 'card') === 'tooltip' && behavior.memoryUsageOnHover === false) return;
    if (current?.row === row) return;
    clearTimeout(leaveTimer);
    const hoverMode = behavior.tabHoverMode || 'card';
    timer = setTimeout(() => { timer = null; show(row, { reuse: Boolean(current?.card?.isConnected) && !reduce() }); }, hoverMode === 'tooltip' ? 120 : 190);
  }

  function inStrip(node) {
    return Boolean(node && node.closest?.('#tabstrip,#vtabs-list'));
  }

  function onPointerOver(event) {
    if (event.pointerType === 'touch') return;
    const row = event.target.closest('[data-id]');
    if (row && !row.contains(event.relatedTarget)) schedule(row);
  }
  let pointerMoving = false;
  function onPointerMove(event) {
    if (!current?.card?.isConnected) return;
    if (event.pointerType === 'touch') return;
    if (current.card.contains(event.target)) return;
    if (pointerMoving) return;
    pointerMoving = true;
    requestAnimationFrame(() => { pointerMoving = false; reposition(); });
  }
  function onPointerOut(event) {
    const row = event.target.closest('[data-id]');
    if (!row || row.contains(event.relatedTarget)) return;
    if (inStrip(event.relatedTarget)) {
      // The pointer is still over the strip (moving to another tab): keep the
      // card briefly so the handoff crossfades instead of flickering away.
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => { if (current?.row !== row) close(); }, 150);
    } else {
      close();
    }
  }
  function onFocusIn(event) {
    const row = event.target.closest('[data-id]');
    if (row) schedule(row);
  }
  function onFocusOut(event) {
    const row = event.target.closest('[data-id]');
    if (row && !row.contains(event.relatedTarget)) {
      if (inStrip(event.relatedTarget)) {
        clearTimeout(leaveTimer);
        leaveTimer = setTimeout(() => { if (current?.row !== row) close(); }, 150);
      } else close();
    }
  }

  for (const list of lists) {
    list.addEventListener('pointerover', onPointerOver);
    list.addEventListener('pointerout', onPointerOut);
    list.addEventListener('pointermove', onPointerMove);
    list.addEventListener('focusin', onFocusIn);
    list.addEventListener('focusout', onFocusOut);
  }
  return {
    close,
    /** Capture (and cache) a snapshot for a tab — called when it is active. */
    async captureForTab(tab) {
      if (!tab || !platform.isElectron || !platform.isWebview(tab.view)) return;
      try {
        const image = await platform.capturePreview(tab.view);
        if (!image) {
          // The page may still have been loading — retry once shortly after.
          clearTimeout(tab._previewRetryTimer);
          tab._previewRetryTimer = setTimeout(() => {
            delete tab._previewRetryTimer;
            captureForTab(tab);
          }, 700);
          return;
        }
        previewCache.set(tab.id, image);
        if (current?.tab?.id === tab.id) {
          const target = current.card.querySelector('[data-hover-preview]');
          if (target && getSettings()?.tabBehavior?.tabHoverMode === 'preview') {
            target.innerHTML = `<img src="${escapeHtml(image)}" alt="Preview of ${escapeHtml(tab.title)}" referrerpolicy="no-referrer">`;
            reposition();
          }
        }
      } catch { /* The tab navigated mid-capture; the next activation retries. */ }
    },
    hasPreview(tabId) { return previewCache.has(tabId); },
    destroy() {
      close();
      for (const list of lists) {
        list.removeEventListener('pointerover', onPointerOver);
        list.removeEventListener('pointerout', onPointerOut);
        list.removeEventListener('pointermove', onPointerMove);
        list.removeEventListener('focusin', onFocusIn);
        list.removeEventListener('focusout', onFocusOut);
      }
    },
  };
}
