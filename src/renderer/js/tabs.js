/** Tab model + accessible horizontal/vertical tab strips. Views are owned by app.js. */
import { icon } from './icons.js';
import { escapeHtml } from './toasts.js';
import { safeTabUrl } from '../../shared/privacy-utils.mjs';

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
  constructor({ onActiveChange, onClose, onMount, onChange } = {}) {
    this.tabs = [];
    this.activeId = null;
    this.closedStack = [];
    this.groupCounter = 0;
    this.onActiveChange = onActiveChange || (() => {});
    this.onClose = onClose || (() => {});
    this.onMount = onMount || (() => {});
    this.onChange = onChange || (() => {});
    this.strip = document.getElementById('tabstrip');
    this.vlist = document.getElementById('vtabs-list');
    for (const el of [this.strip, this.vlist]) el?.addEventListener('click', (e) => this.handleClick(e));
    for (const el of [this.strip, this.vlist]) {
      el?.addEventListener('auxclick', (e) => {
        if (e.button !== 1) return;
        const tab = e.target.closest('[data-id]');
        if (tab) { e.preventDefault(); this.close(tab.dataset.id); }
      });
      el?.addEventListener('keydown', (e) => {
        const row = e.target.closest('[data-id]');
        if (!row || e.target.closest('button')) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.activate(row.dataset.id); }
        if (e.key === 'Delete') this.close(row.dataset.id);
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); this.next(); this.focusActive(); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); this.prev(); this.focusActive(); }
      });
      el?.addEventListener('dragstart', (e) => {
        const row = e.target.closest('[data-id]');
        if (!row) return;
        e.dataTransfer.setData('text/tab-id', row.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
      });
      el?.addEventListener('dragover', (e) => {
        const row = e.target.closest('[data-id]');
        if (row) { e.preventDefault(); row.classList.add('drag-over'); }
      });
      el?.addEventListener('dragleave', (e) => e.target.closest('[data-id]')?.classList.remove('drag-over'));
      el?.addEventListener('drop', (e) => {
        e.preventDefault();
        const row = e.target.closest('[data-id]');
        row?.classList.remove('drag-over');
        if (!row) return;
        const fromId = e.dataTransfer.getData('text/tab-id');
        const rect = row.getBoundingClientRect();
        const vertical = el === this.vlist;
        const start = vertical ? rect.top : rect.left;
        const extent = vertical ? rect.height : rect.width;
        const ratio = extent ? ((vertical ? e.clientY : e.clientX) - start) / extent : 0;
        if (fromId !== row.dataset.id && ratio > .32 && ratio < .68) this.groupWith(fromId, row.dataset.id);
        else this.move(fromId, row.dataset.id);
      });
      el?.addEventListener('contextmenu', (e) => {
        const row = e.target.closest('[data-id]');
        if (row) { e.preventDefault(); this.onContextMenu?.(row.dataset.id, e.clientX, e.clientY); }
      });
    }
  }
  get active() { return this.tabs.find((t) => t.id === this.activeId) || null; }
  handleClick(e) {
    const close = e.target.closest('[data-close]');
    if (close) { e.stopPropagation(); this.close(close.dataset.close); return; }
    const row = e.target.closest('[data-id]');
    if (row) this.activate(row.dataset.id);
  }
  add(url = 'vespera://newtab', { activate = true, title, pinned = false, groupId = null, groupName = '', groupColor = '' } = {}) {
    url = safeTabUrl(url);
    if (!url) throw new Error('This address cannot be opened in a tab.');
    if (this.tabs.length >= 60) { this.close(this.tabs.find((t) => !t.pinned && t.id !== this.activeId)?.id); }
    const tab = createTabModel(url, { title, pinned, groupId, groupName, groupColor });
    this.tabs.push(tab);
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
    this.closedStack.push({ url: tab.url, title: tab.title });
    if (this.closedStack.length > 20) this.closedStack.shift();
    this.dispose(tab);
    this.onClose(tab);
    if (!this.tabs.length) { this.add('vespera://newtab'); return; }
    if (this.activeId === id) this.activate(this.tabs[Math.min(i, this.tabs.length - 1)].id);
    else { this.render(); this.onChange(); }
  }
  closeOthers(id) { for (const t of [...this.tabs]) if (t.id !== id && !t.pinned) this.close(t.id); this.activate(id); }
  duplicate(id) { const t = this.tabs.find((t) => t.id === id); if (t) this.add(t.url, { title: t.title }); }
  togglePin(id) { const t = this.tabs.find((t) => t.id === id); if (t) { t.pinned = !t.pinned; this.render(); this.onChange(); } }
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
    this.move(fromId, toId); this.render(); this.onChange();
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
  move(fromId, toId) {
    const from = this.tabs.findIndex((t) => t.id === fromId), to = this.tabs.findIndex((t) => t.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    this.tabs.splice(to, 0, this.tabs.splice(from, 1)[0]);
    this.render(); this.onChange();
  }
  next() { const i = this.tabs.findIndex((t) => t.id === this.activeId); this.activate(this.tabs[(i + 1) % this.tabs.length].id); }
  prev() { const i = this.tabs.findIndex((t) => t.id === this.activeId); this.activate(this.tabs[(i - 1 + this.tabs.length) % this.tabs.length].id); }
  reopenClosed() { const t = this.closedStack.pop(); return t ? this.add(t.url, { title: t.title }) : null; }
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
