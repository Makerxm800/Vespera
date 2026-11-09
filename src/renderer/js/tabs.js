/** Tab model + accessible horizontal/vertical tab strips. Views are owned by app.js. */
import { icon } from './icons.js';
import { escapeHtml } from './toasts.js';
import { safeTabUrl } from '../../shared/privacy-utils.mjs';
import { computeDrop, clampedInsertion, moveTabAfter, moveIntoGroup, pinnedFirst } from '../../shared/tab-order.mjs';

let nextId = 1;
export function createTabModel(url = 'vespera://newtab', opts = {}) {
  return {
    id: 'tab' + nextId++, url, title: opts.title || 'New Tab', favicon: null,
    loading: false, pinned: Boolean(opts.pinned), groupId: opts.groupId || null, groupName: opts.groupName || '', groupColor: opts.groupColor || '', view: null, pageCleanup: null,
    disposeView: null, loadTimer: null, error: null, zoom: 1,
    entries: [{ url, title: opts.title || 'New Tab' }], entryIndex: 0,
    shields: { blocked: 0, ads: 0, trackers: 0, cleaned: 0 },
    createdAt: Date.now(), _internal: url.startsWith('vespera://'),
  };
}

export class TabManager {
  constructor({ onActiveChange, onClose, onMount, onChange, onContextMenu, onNewTab, onFocusPage } = {}) {
    this.tabs = [];
    this.activeId = null;
    this.closedStack = [];
    this.groupCounter = 0;
    this.onActiveChange = onActiveChange || (() => {});
    this.onClose = onClose || (() => {});
    this.onMount = onMount || (() => {});
    this.onChange = onChange || (() => {});
    this.onContextMenu = onContextMenu || (() => {});
    this.onNewTab = onNewTab || (() => {});
    this.onFocusPage = onFocusPage || (() => {});
    this.strip = document.getElementById('tabstrip');
    this.vlist = document.getElementById('vtabs-list');
    this._drag = null; // { fromId, list, mode, index, targetId }
    for (const el of [this.strip, this.vlist]) el?.addEventListener('click', (e) => this.handleClick(e));
    for (const el of [this.strip, this.vlist]) {
      // Activate on mousedown so switching tabs feels instant, like a native browser.
      el?.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('[data-close]')) return; // closing must not steal focus first
        const row = e.target.closest('[data-id]');
        if (row && row.dataset.id !== this.activeId) this.activate(row.dataset.id);
      });
      el?.addEventListener('auxclick', (e) => {
        if (e.button !== 1) return;
        const tab = e.target.closest('[data-id]');
        if (tab) { e.preventDefault(); this.close(tab.dataset.id); }
      });
      el?.addEventListener('keydown', (e) => {
        const row = e.target.closest('[data-id]');
        if (!row || e.target.closest('button')) return;
        const vertical = el === this.vlist;
        const forwardKey = vertical ? 'ArrowDown' : 'ArrowRight';
        const backKey = vertical ? 'ArrowUp' : 'ArrowLeft';
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.activate(row.dataset.id); this.onFocusPage(this.active); }
        else if (e.key === 'Delete') this.close(row.dataset.id);
        else if (e.shiftKey && (e.key === forwardKey || e.key === backKey)) {
          // Shift+Arrow reorders the focused tab, mirroring keyboard tab-moving in Chrome.
          e.preventDefault();
          this.moveTabRelative(row.dataset.id, e.key === forwardKey ? 1 : -1);
          el.querySelector(`[data-id="${row.dataset.id}"]`)?.focus();
        }
        else if (e.key === forwardKey) { e.preventDefault(); this.next(); this.focusActive(); }
        else if (e.key === backKey) { e.preventDefault(); this.prev(); this.focusActive(); }
        else if (e.key === 'Home') { e.preventDefault(); this.selectIndex(0); this.focusActive(); }
        else if (e.key === 'End') { e.preventDefault(); this.selectIndex(-1); this.focusActive(); }
      });
      el?.addEventListener('dragstart', (e) => {
        const row = e.target.closest('[data-id]');
        if (!row) return;
        this._drag = { fromId: row.dataset.id, list: el, mode: null, index: -1, targetId: null };
        for (const list of [this.strip, this.vlist]) list?.querySelectorAll(`[data-id="${row.dataset.id}"]`).forEach((n) => n.classList.add('dragging'));
        e.dataTransfer.setData('text/tab-id', row.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
      });
      el?.addEventListener('dragover', (e) => {
        const drag = this._drag;
        if (!drag) return; // A foreign drag (e.g. a file) keeps default behaviour.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        this.autoScrollStrip(el, e);
        this.updateDropTarget(el, e); // Alt held = drop onto a tab to group
      });
      el?.addEventListener('dragleave', (e) => {
        if (e.relatedTarget && el.contains(e.relatedTarget)) return;
        this.clearDropUi(el);
        if (this._drag?.list === el) { this._drag.mode = null; this._drag.index = -1; this._drag.targetId = null; }
      });
      el?.addEventListener('drop', (e) => {
        const fromId = this._drag?.fromId || e.dataTransfer.getData('text/tab-id');
        if (!fromId) return;
        e.preventDefault();
        this.updateDropTarget(el, e); // resolve the final slot under the pointer
        const drag = this._drag || {};
        if (drag.mode === 'group' && drag.targetId && drag.targetId !== fromId) this.groupWith(fromId, drag.targetId);
        else if (drag.mode === 'move' && drag.index >= 0) this.moveToIndex(fromId, drag.index);
        this.endDrag();
      });
      el?.addEventListener('dragend', () => this.endDrag());
      el?.addEventListener('wheel', (e) => {
        // Vertical wheel scrolls an overflowing horizontal strip, like a native browser.
        if (el === this.vlist || el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        e.preventDefault(); el.scrollLeft += e.deltaY;
      }, { passive: false });
      el?.addEventListener('dblclick', (e) => { if (e.target === el) this.onNewTab(); });
      el?.addEventListener('contextmenu', (e) => {
        const row = e.target.closest('[data-id]');
        e.preventDefault();
        // Right-clicking empty strip space offers strip-level actions.
        this.onContextMenu?.(row ? row.dataset.id : null, e.clientX, e.clientY);
      });
    }
    // A cancelled drag (Escape, window blur) must never leave ghost styling behind.
    window.addEventListener('dragend', () => this.endDrag());
    window.addEventListener('blur', () => this.endDrag());
  }
  get active() { return this.tabs.find((t) => t.id === this.activeId) || null; }

  /* ---- Drag & drop helpers ---- */
  stripRows(list) {
    return [...list.children]
      .filter((n) => n.dataset?.id && !n.classList.contains('tab-exit-ghost'))
      .map((n) => {
        const rect = n.getBoundingClientRect();
        const vertical = list === this.vlist;
        return { el: n, id: n.dataset.id, start: vertical ? rect.top : rect.left, extent: vertical ? rect.height : rect.width };
      });
  }
  updateDropTarget(list, e) {
    const vertical = list === this.vlist;
    const rows = this.stripRows(list);
    const coord = vertical ? e.clientY : e.clientX;
    const drop = computeDrop(rows, coord, { allowGroup: Boolean(e.altKey) });
    const drag = this._drag;
    if (drag) { drag.list = list; drag.mode = drop.mode; drag.index = drop.mode === 'move' ? drop.index : -1; drag.targetId = drop.mode === 'group' ? drop.id : null; }
    for (const r of rows) r.el.classList.toggle('drag-over', drop.mode === 'group' && r.id === drop.id && r.id !== drag?.fromId);
    const indicator = this.ensureIndicator(list);
    if (drop.mode === 'move' && rows.length) {
      // Absolutely positioned marker: never disturbs the keyed row ordering.
      const host = list.getBoundingClientRect();
      const atEnd = drop.index >= rows.length;
      const last = rows[rows.length - 1];
      const pos = atEnd ? last.start + last.extent : rows[drop.index].start;
      if (vertical) { indicator.style.top = `${pos - host.top + list.scrollTop}px`; indicator.style.left = ''; }
      else { indicator.style.left = `${pos - host.left + list.scrollLeft}px`; indicator.style.top = ''; }
      indicator.hidden = false;
    } else {
      indicator.hidden = true;
    }
  }
  ensureIndicator(list) {
    let indicator = list.querySelector('.drop-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'drop-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      indicator.hidden = true;
      list.appendChild(indicator);
    }
    return indicator;
  }
  autoScrollStrip(list, e) {
    const rect = list.getBoundingClientRect();
    const edge = 28, step = 9;
    if (list === this.vlist) {
      if (e.clientY > rect.bottom - edge) list.scrollTop += step;
      else if (e.clientY < rect.top + edge) list.scrollTop -= step;
    } else {
      if (e.clientX > rect.right - edge) list.scrollLeft += step;
      else if (e.clientX < rect.left + edge) list.scrollLeft -= step;
    }
  }
  clearDropUi(list) {
    list?.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
    const indicator = list?.querySelector('.drop-indicator');
    if (indicator) indicator.hidden = true;
  }
  endDrag() {
    this._drag = null;
    for (const list of [this.strip, this.vlist]) {
      list?.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging'));
      this.clearDropUi(list);
    }
  }

  /* ---- Model ---- */
  handleClick(e) {
    const close = e.target.closest('[data-close]');
    if (close) { e.stopPropagation(); this.close(close.dataset.close); return; }
    const row = e.target.closest('[data-id]');
    if (!row) return;
    if (row.dataset.id !== this.activeId) this.activate(row.dataset.id);
    this.onFocusPage(this.active); // so page shortcuts (YouTube's F, Space…) work straight away
  }
  add(url = 'vespera://newtab', { activate = true, title, pinned = false, groupId = null, groupName = '', groupColor = '', afterId = null, index = null } = {}) {
    url = safeTabUrl(url);
    if (!url) throw new Error('This address cannot be opened in a tab.');
    if (this.tabs.length >= 60) { this.close(this.tabs.find((t) => !t.pinned && t.id !== this.activeId)?.id); }
    const tab = createTabModel(url, { title, pinned, groupId, groupName, groupColor });
    // Pinned tabs live in their own leading section; other tabs honour an
    // explicit slot (afterId / index) or append to the end like Chrome.
    const pinnedCount = this.tabs.filter((t) => t.pinned).length;
    let at = this.tabs.length;
    if (pinned) at = pinnedCount;
    else if (afterId) { const i = this.tabs.findIndex((t) => t.id === afterId); if (i >= 0) at = i + 1; }
    else if (Number.isInteger(index)) at = Math.max(pinnedCount, Math.min(index, this.tabs.length));
    this.tabs.splice(at, 0, tab);
    this.onMount(tab);
    this.render();
    if (activate || !this.activeId) this.activate(tab.id);
    else this.onChange();
    return tab;
  }
  dispose(tab) {
    clearTimeout(tab.loadTimer);
    try { tab.pageCleanup?.(); } catch (err) { console.error('[vespera] page cleanup', err); }
    try { tab.disposeView?.(); } catch { /* already detached */ }
    tab.pageCleanup = null;
    tab.view?.remove();
    tab.view = null;
  }
  close(id) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    const [tab] = this.tabs.splice(i, 1);
    this.closedStack.push({ url: tab.url, title: tab.title, pinned: tab.pinned, index: i, groupId: tab.groupId, groupName: tab.groupName, groupColor: tab.groupColor });
    if (this.closedStack.length > 20) this.closedStack.shift();
    this.dispose(tab);
    this.onClose(tab);
    if (!this.tabs.length) { this.add('vespera://newtab'); return; }
    if (this.activeId === id) this.activate(this.tabs[Math.min(i, this.tabs.length - 1)].id);
    else { this.render(); this.onChange(); }
  }
  closeOthers(id) { for (const t of [...this.tabs]) if (t.id !== id && !t.pinned) this.close(t.id); this.activate(id); }
  closeToRight(id) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    for (const t of this.tabs.slice(i + 1)) if (!t.pinned) this.close(t.id);
    if (this.activeId !== id && !this.tabs.some((t) => t.id === this.activeId)) this.activate(id);
  }
  /** Existing groups as [{ id, name, color }] for "Add to group" menus. */
  groups() {
    const seen = new Map();
    for (const t of this.tabs) if (t.groupId && !seen.has(t.groupId)) seen.set(t.groupId, { id: t.groupId, name: t.groupName || 'Group', color: t.groupColor || '#8b7cf6' });
    return [...seen.values()];
  }
  addToGroup(id, groupId) {
    const tab = this.tabs.find((t) => t.id === id), ref = this.tabs.find((t) => t.groupId === groupId);
    if (!tab || !ref || tab.groupId === groupId) return;
    tab.groupId = groupId; tab.groupName = ref.groupName; tab.groupColor = ref.groupColor;
    this.tabs = moveIntoGroup(this.tabs, id, groupId);
    this.render(); this.onChange();
  }
  /** Move the active (or given) tab by ±1 slot — Ctrl+Shift+PageUp/PageDown. */
  moveActive(dir) { if (this.activeId) this.moveTabRelative(this.activeId, dir); }
  duplicate(id) { const t = this.tabs.find((t) => t.id === id); if (t) this.add(t.url, { title: t.title, pinned: t.pinned, afterId: id, groupId: t.groupId, groupName: t.groupName, groupColor: t.groupColor }); }
  togglePin(id) {
    const t = this.tabs.find((t) => t.id === id);
    if (!t) return;
    t.pinned = !t.pinned;
    this.tabs = pinnedFirst(this.tabs);
    this.render(); this.onChange();
  }
  createGroup(id, name = '') {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return null;
    const number = ++this.groupCounter;
    const groupId = 'group-' + Date.now().toString(36) + '-' + number;
    const colors = ['#8b7cf6', '#42b6a8', '#e6a23c', '#e879a8', '#60a5fa', '#8cbd64'];
    tab.groupId = groupId; tab.groupName = String(name || 'Group ' + number).trim().slice(0, 24) || 'Group ' + number;
    tab.groupColor = colors[(number - 1) % colors.length];
    this.render(); this.onChange();
    return groupId;
  }
  groupWith(fromId, toId) {
    const from = this.tabs.find((t) => t.id === fromId), to = this.tabs.find((t) => t.id === toId);
    if (!from || !to || from === to) return;
    let groupId = to.groupId || from.groupId;
    if (!groupId) groupId = this.createGroup(toId);
    const reference = this.tabs.find((t) => t.groupId === groupId);
    for (const tab of [from, to]) { tab.groupId = groupId; tab.groupName = reference?.groupName || 'Group'; tab.groupColor = reference?.groupColor || '#8b7cf6'; }
    this.tabs = pinnedFirst(moveTabAfter(this.tabs, fromId, toId));
    this.render(); this.onChange();
  }
  renameGroup(id, name) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab?.groupId) return;
    const label = String(name || '').trim().slice(0, 24);
    if (!label) return;
    for (const item of this.tabs) if (item.groupId === tab.groupId) item.groupName = label;
    this.render(); this.onChange();
  }
  ungroup(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab?.groupId) return;
    delete tab.groupId; tab.groupName = ''; tab.groupColor = '';
    this.render(); this.onChange();
  }
  activate(id) {
    if (!this.tabs.some((t) => t.id === id)) return;
    this.activeId = id;
    for (const t of this.tabs) t.view?.classList.toggle('hidden', t.id !== id);
    this.render();
    this.onActiveChange(this.active);
    this.onChange();
    this.focusActiveStrip();
  }
  /** Activate by position; negative indexes count from the end (Ctrl+9 = last). */
  selectIndex(i) {
    if (!this.tabs.length) return;
    const idx = i < 0 ? this.tabs.length + i : i;
    const tab = this.tabs[Math.max(0, Math.min(idx, this.tabs.length - 1))];
    if (tab) this.activate(tab.id);
  }
  focusActiveStrip() {
    const list = document.body.classList.contains('vertical-tabs') ? this.vlist : this.strip;
    list?.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  focusActive() {
    const list = document.body.classList.contains('vertical-tabs') ? this.vlist : this.strip;
    list?.querySelector('.active')?.focus();
  }
  update(tab, patch = {}) {
    Object.assign(tab, patch);
    if (tab.entries?.[tab.entryIndex]) tab.entries[tab.entryIndex].title = tab.title;
    this.render();
    if (tab.id === this.activeId) this.onActiveChange(tab);
    this.onChange();
  }
  /** Move a tab to a pre-removal insertion index (as produced by computeDrop). */
  moveToIndex(fromId, index) {
    const from = this.tabs.findIndex((t) => t.id === fromId);
    if (from < 0) return;
    const ins = clampedInsertion(this.tabs, fromId, index);
    const [item] = this.tabs.splice(from, 1);
    this.tabs.splice(ins, 0, item);
    this.render(); this.onChange();
  }
  /** Move a tab one slot left/right (keyboard reordering), respecting pin sections. */
  moveTabRelative(id, dir) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0 || !dir) return;
    this.moveToIndex(id, dir > 0 ? i + 2 : i - 1);
  }
  /** @deprecated kept for external callers; prefer moveToIndex/moveTabAfter. */
  move(fromId, toId) {
    const to = this.tabs.findIndex((t) => t.id === toId);
    if (to < 0) return;
    this.tabs = moveTabAfter(this.tabs, fromId, toId);
    this.render(); this.onChange();
  }
  next() { if (!this.tabs.length) return; const i = this.tabs.findIndex((t) => t.id === this.activeId); this.activate(this.tabs[(i + 1) % this.tabs.length].id); }
  prev() { if (!this.tabs.length) return; const i = this.tabs.findIndex((t) => t.id === this.activeId); this.activate(this.tabs[(i - 1 + this.tabs.length) % this.tabs.length].id); }
  reopenClosed() {
    const t = this.closedStack.pop();
    if (!t) return null;
    const sameGroup = t.groupId && this.tabs.some((x) => x.groupId === t.groupId);
    return this.add(t.url, { title: t.title, pinned: t.pinned, index: t.index, ...(sameGroup ? { groupId: t.groupId, groupName: t.groupName, groupColor: t.groupColor } : {}) });
  }
  faviconHtml(tab) {
    if (tab.loading) return '<div class="spinner"></div>';
    if (tab.favicon && /^(https?:|data:image\/)/.test(tab.favicon)) return `<img src="${escapeHtml(tab.favicon)}" alt="" referrerpolicy="no-referrer">`;
    return icon(tab.url.startsWith('vespera://') ? 'sparkle' : 'globe');
  }
  tabHtml(tab, vertical = false) {
    const cls = vertical ? 'vtab' : 'tab';
    const grouped = Boolean(tab.groupId);
    const color = /^#[0-9a-f]{6}$/i.test(tab.groupColor) ? tab.groupColor : '#8b7cf6';
    return `<div class="${cls} ${tab.id === this.activeId ? 'active' : ''} ${tab.pinned ? 'pinned' : ''} ${grouped ? 'grouped' : ''}" data-id="${tab.id}" data-group-id="${escapeHtml(tab.groupId || '')}" draggable="true" role="tab" tabindex="${tab.id === this.activeId ? 0 : -1}" aria-selected="${tab.id === this.activeId}" title="${escapeHtml(tab.title)}">
      <div class="favicon">${this.faviconHtml(tab)}</div>
      ${grouped ? `<span class="tab-group-label" style="--tab-group-color:${color}">${escapeHtml(tab.groupName || 'Group')}</span>` : ''}
      <div class="title">${escapeHtml(tab.title)}</div>
      ${tab.pinned ? '<span class="pin-marker" aria-label="Pinned">•</span>' : ''}
      <button class="close" data-close="${tab.id}" title="Close tab" aria-label="Close ${escapeHtml(tab.title)}">${icon('x')}</button>
    </div>`;
  }
  render() {
    // Keyed updates keep the pressed close button, focus and drag target alive.
    this.renderStrip(this.strip, false);
    this.renderStrip(this.vlist, true);
    document.querySelectorAll('[data-tab-count]').forEach((el) => { el.textContent = this.tabs.length; });
  }
  renderStrip(list, vertical) {
    if (!list) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const existing = new Map(), before = new Map();
    for (const row of [...list.children]) {
      if (!row.dataset.id) continue;
      existing.set(row.dataset.id, row);
      before.set(row.dataset.id, row.getBoundingClientRect());
    }
    const alive = new Set(this.tabs.map((t) => t.id));
    for (const [id, row] of existing) {
      if (alive.has(id)) continue;
      const rect = before.get(id);
      row.remove();
      if (!reduce && list.offsetParent !== null) this.animateTabExit(list, row, rect, vertical);
    }
    const ordered = [];
    for (const tab of this.tabs) {
      let row = existing.get(tab.id);
      if (!row) {
        const template = document.createElement('template');
        template.innerHTML = this.tabHtml(tab, vertical).trim();
        row = template.content.firstElementChild;
        if (!reduce && list.offsetParent !== null) {
          row.classList.add('tab-enter');
          row.addEventListener('animationend', () => row.classList.remove('tab-enter'), { once: true });
        }
      }
      const active = tab.id === this.activeId;
      row.classList.toggle('active', active);
      row.classList.toggle('pinned', tab.pinned);
      row.classList.toggle('grouped', Boolean(tab.groupId));
      row.dataset.groupId = tab.groupId || '';
      const groupLabel = row.querySelector('.tab-group-label');
      if (tab.groupId && !groupLabel) { const marker = document.createElement('span'); marker.className = 'tab-group-label'; marker.textContent = tab.groupName || 'Group'; row.querySelector('.favicon')?.after(marker); }
      else if (!tab.groupId && groupLabel) groupLabel.remove();
      else if (groupLabel) groupLabel.textContent = tab.groupName || 'Group';
      row.style.setProperty('--tab-group-color', /^#[0-9a-f]{6}$/i.test(tab.groupColor) ? tab.groupColor : '#8b7cf6');
      row.tabIndex = active ? 0 : -1;
      row.setAttribute('aria-selected', String(active));
      row.title = tab.title;
      const title = row.querySelector('.title');
      if (title && title.textContent !== tab.title) title.textContent = tab.title;
      const faviconKey = `${tab.loading ? 'loading' : 'idle'}|${tab.favicon || ''}|${tab._internal ? 'internal' : 'web'}`;
      if (row.dataset.faviconKey !== faviconKey) {
        row.dataset.faviconKey = faviconKey;
        const favicon = row.querySelector('.favicon');
        if (favicon) favicon.innerHTML = this.faviconHtml(tab);
      }
      const close = row.querySelector('.close');
      if (close) { close.title = 'Close tab'; close.setAttribute('aria-label', `Close ${tab.title}`); }
      const pin = row.querySelector('.pin-marker');
      if (tab.pinned && !pin) close?.insertAdjacentHTML('beforebegin', '<span class="pin-marker" aria-label="Pinned">•</span>');
      else if (!tab.pinned && pin) pin.remove();
      ordered.push(row);
    }
    ordered.forEach((row, index) => {
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
    });
    if (reduce) return;
    for (const row of ordered) {
      const first = before.get(row.dataset.id);
      if (!first) continue;
      const last = row.getBoundingClientRect();
      const x = first.left - last.left, y = first.top - last.top;
      if (Math.abs(x) < .5 && Math.abs(y) < .5) continue;
      row._vesperaMove?.cancel();
      row._vesperaMove = row.animate(
        [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 220, easing: 'cubic-bezier(.22, .8, .28, 1)' }
      );
    }
  }
  animateTabExit(list, row, rect, vertical) {
    if (!rect?.width) return;
    const host = list.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.className = 'tab-exit-ghost' + (vertical ? ' vertical' : '');
    ghost.removeAttribute('data-id'); ghost.removeAttribute('role'); ghost.removeAttribute('tabindex');
    ghost.removeAttribute('aria-selected'); ghost.removeAttribute('draggable'); ghost.removeAttribute('title');
    ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
    ghost.querySelectorAll('[data-close]').forEach((button) => { button.removeAttribute('data-close'); button.tabIndex = -1; });
    Object.assign(ghost.style, {
      left: `${rect.left - host.left + list.scrollLeft}px`, top: `${rect.top - host.top + list.scrollTop}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    });
    list.appendChild(ghost);
    ghost.addEventListener('animationend', () => ghost.remove(), { once: true });
    setTimeout(() => ghost.remove(), 320);
  }
}
