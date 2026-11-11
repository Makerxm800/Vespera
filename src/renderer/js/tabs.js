/** Tab model + accessible horizontal/vertical tab strips. Views are owned by app.js. */
import { icon } from './icons.js';
import { escapeHtml } from './toasts.js';
import { safeTabUrl } from '../../shared/privacy-utils.mjs';

let nextId = 1;
export const TAB_GROUP_COLORS = Object.freeze(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan']);
const validGroupColor = (color) => TAB_GROUP_COLORS.includes(color) ? color : 'blue';
const cleanGroupTitle = (title) => String(title || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || 'New group';

export function createTabModel(url = 'vespera://newtab', opts = {}) {
  return {
    id: 'tab' + nextId++, url, title: opts.title || 'New Tab', favicon: null,
    loading: false, pinned: Boolean(opts.pinned), groupId: opts.groupId || null,
    muted: Boolean(opts.muted), audible: false,
    view: null, pageCleanup: null, disposeView: null, loadTimer: null, error: null, zoom: 1,
    entries: [{ url, title: opts.title || 'New Tab' }], entryIndex: 0,
    shields: { blocked: 0, ads: 0, trackers: 0, cleaned: 0 },
    createdAt: Date.now(), _internal: url.startsWith('vespera://'),
  };
}

export class TabManager {
  constructor({ onActiveChange, onClose, onMount, onChange, onContextMenu, onGroupContextMenu, onToggleMute, getSettings } = {}) {
    this.tabs = [];
    this.groups = [];
    this.activeId = null;
    this.closedStack = [];
    this.onActiveChange = onActiveChange || (() => {});
    this.onClose = onClose || (() => {});
    this.onMount = onMount || (() => {});
    this.onChange = onChange || (() => {});
    this.onContextMenu = onContextMenu || (() => {});
    this.onGroupContextMenu = onGroupContextMenu || (() => {});
    this.onToggleMute = onToggleMute || (() => {});
    this.getSettings = getSettings || (() => ({}));
    this.strip = document.getElementById('tabstrip');
    this.vlist = document.getElementById('vtabs-list');

    for (const el of [this.strip, this.vlist]) {
      el?.addEventListener('click', (e) => this.handleClick(e));
      el?.addEventListener('auxclick', (e) => {
        if (e.button !== 1 || this.getSettings()?.tabBehavior?.middleClickClosesTab === false) return;
        const tab = e.target.closest('[data-id]');
        if (tab) { e.preventDefault(); e.stopPropagation(); this.close(tab.dataset.id); }
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
        const target = e.target.closest('[data-id],[data-group-header]');
        if (target) { e.preventDefault(); target.classList.add('drag-over'); }
      });
      el?.addEventListener('dragleave', (e) => e.target.closest('[data-id],[data-group-header]')?.classList.remove('drag-over'));
      el?.addEventListener('drop', (e) => {
        e.preventDefault();
        const target = e.target.closest('[data-id],[data-group-header]');
        target?.classList.remove('drag-over');
        const fromId = e.dataTransfer.getData('text/tab-id');
        if (!fromId || !target) return;
        if (target.dataset.groupHeader) this.moveToGroup(fromId, target.dataset.groupHeader);
        else this.move(fromId, target.dataset.id);
      });
      el?.addEventListener('contextmenu', (e) => {
        const group = e.target.closest('[data-group-header]');
        if (group) { e.preventDefault(); this.onGroupContextMenu(group.dataset.groupHeader, group); return; }
        const row = e.target.closest('[data-id]');
        if (row) { e.preventDefault(); this.onContextMenu(row.dataset.id, row); }
      });
    }
  }

  get active() { return this.tabs.find((t) => t.id === this.activeId) || null; }
  getGroup(id) { return this.groups.find((g) => g.id === id) || null; }
  groupTabs(id) { return this.tabs.filter((t) => t.groupId === id); }

  handleClick(e) {
    const audio = e.target.closest('[data-audio-toggle]');
    if (audio) { e.preventDefault(); e.stopPropagation(); this.onToggleMute(audio.dataset.audioToggle); return; }
    const toggle = e.target.closest('[data-group-toggle]');
    if (toggle) { this.toggleGroup(toggle.dataset.groupToggle); return; }
    const edit = e.target.closest('[data-group-menu]');
    if (edit) { this.onGroupContextMenu(edit.dataset.groupMenu, edit.closest('[data-group-header]')); return; }
    const close = e.target.closest('[data-close]');
    if (close) { e.stopPropagation(); this.close(close.dataset.close); return; }
    const row = e.target.closest('[data-id]');
    if (row) this.activate(row.dataset.id);
  }

  add(url = 'vespera://newtab', options = {}) {
    url = safeTabUrl(url);
    if (!url) throw new Error('This address cannot be opened in a tab.');
    if (this.tabs.length >= 60) {
      const candidate = this.tabs.find((t) => !t.pinned && t.id !== this.activeId);
      if (candidate) this.close(candidate.id);
      if (this.tabs.length >= 60) return null;
    }
    const { activate = true, title, pinned = false, muted = false } = options;
    const groupId = this.getGroup(options.groupId) ? options.groupId : null;
    const tab = createTabModel(url, { title, pinned, groupId, muted });
    const behavior = this.getSettings()?.tabBehavior || {};
    const defaultBeside = behavior.openTabsNextToCurrent !== false;
    const besideId = !defaultBeside ? null : (options.besideId !== undefined ? options.besideId : this.activeId);
    const beside = this.tabs.find((t) => t.id === besideId);
    let index = this.tabs.length;
    if (groupId) {
      const members = this.tabs.map((t, i) => t.groupId === groupId ? i : -1).filter((i) => i >= 0);
      if (beside?.groupId === groupId) index = this.tabs.indexOf(beside) + 1;
      else index = members.length ? members.at(-1) + 1 : (beside ? this.tabs.indexOf(beside) + 1 : this.tabs.length);
    } else if (beside?.groupId && this.getGroup(beside.groupId)) {
      const members = this.tabs.map((t, i) => t.groupId === beside.groupId ? i : -1).filter((i) => i >= 0);
      index = members.at(-1) + 1;
    } else if (beside) index = this.tabs.indexOf(beside) + 1;
    this.tabs.splice(index, 0, tab);
    this.normalizeGroupOrder();
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
    this.closedStack.push({ url: tab.url, title: tab.title, muted: tab.muted });
    if (this.closedStack.length > 20) this.closedStack.shift();
    this.dispose(tab);
    this.onClose(tab);
    this.pruneGroups();
    if (!this.tabs.length) { this.activeId = null; this.add('vespera://newtab'); return; }
    if (this.activeId === id) this.activate(this.tabs[Math.min(i, this.tabs.length - 1)].id);
    else { this.render(); this.onChange(); }
  }

  closeGroup(groupId) {
    const group = this.getGroup(groupId);
    if (!group) return;
    const index = this.tabs.findIndex((t) => t.groupId === groupId);
    const removed = this.groupTabs(groupId);
    this.tabs = this.tabs.filter((t) => t.groupId !== groupId);
    for (const tab of removed) {
      this.closedStack.push({ url: tab.url, title: tab.title, muted: tab.muted });
      this.dispose(tab); this.onClose(tab);
    }
    this.closedStack = this.closedStack.slice(-20);
    this.groups = this.groups.filter((g) => g.id !== groupId);
    if (!this.tabs.length) { this.activeId = null; this.add('vespera://newtab'); return; }
    if (removed.some((t) => t.id === this.activeId)) this.activate(this.tabs[Math.min(index, this.tabs.length - 1)].id);
    else { this.render(); this.onChange(); }
  }

  closeOthers(id) {
    for (const t of [...this.tabs]) if (t.id !== id && !t.pinned) this.close(t.id);
    this.activate(id);
  }

  duplicate(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab) this.add(tab.url, { title: tab.title, besideId: id, groupId: tab.groupId, muted: tab.muted });
  }

  togglePin(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab) { tab.pinned = !tab.pinned; this.render(); this.onChange(); }
  }

  createGroup(title = 'New group', tabId = this.activeId, color = 'blue') {
    if (this.getSettings()?.tabBehavior?.tabGroupsEnabled === false) return null;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return null;
    const group = { id: 'group-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), title: cleanGroupTitle(title), color: validGroupColor(color), collapsed: false };
    this.groups.push(group);
    tab.groupId = group.id;
    this.pruneGroups();
    this.normalizeGroupOrder();
    this.render(); this.onChange();
    return group;
  }

  updateGroup(id, patch = {}) {
    const group = this.getGroup(id);
    if (!group) return;
    if (patch.title !== undefined) group.title = cleanGroupTitle(patch.title);
    if (patch.color !== undefined) group.color = validGroupColor(patch.color);
    if (patch.collapsed !== undefined) group.collapsed = Boolean(patch.collapsed);
    this.render(); this.onChange();
  }

  toggleGroup(id) {
    const group = this.getGroup(id);
    if (!group) return;
    group.collapsed = !group.collapsed;
    this.render(); this.onChange();
  }

  moveToGroup(tabId, groupId) {
    const group = this.getGroup(groupId);
    const from = this.tabs.findIndex((t) => t.id === tabId);
    if (!group || from < 0) return;
    const [tab] = this.tabs.splice(from, 1);
    tab.groupId = group.id;
    const members = this.tabs.map((candidate, index) => candidate.groupId === group.id ? index : -1).filter((index) => index >= 0);
    this.tabs.splice(members.length ? members.at(-1) + 1 : this.tabs.length, 0, tab);
    this.normalizeGroupOrder(); this.pruneGroups();
    this.render(); this.onChange();
  }

  ungroupTab(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab?.groupId) return;
    tab.groupId = null;
    this.normalizeGroupOrder(); this.pruneGroups();
    this.render(); this.onChange();
  }

  ungroup(id) {
    if (!this.getGroup(id)) return;
    for (const tab of this.tabs) if (tab.groupId === id) tab.groupId = null;
    this.groups = this.groups.filter((g) => g.id !== id);
    this.normalizeGroupOrder();
    this.render(); this.onChange();
  }

  pruneGroups() {
    const used = new Set(this.tabs.map((t) => t.groupId).filter(Boolean));
    this.groups = this.groups.filter((g) => used.has(g.id));
    for (const tab of this.tabs) if (tab.groupId && !this.getGroup(tab.groupId)) tab.groupId = null;
  }

  normalizeGroupOrder() {
    const ordered = [];
    const seen = new Set();
    for (const tab of this.tabs) {
      if (!tab.groupId || !this.getGroup(tab.groupId)) { tab.groupId = null; ordered.push(tab); continue; }
      if (seen.has(tab.groupId)) continue;
      seen.add(tab.groupId);
      ordered.push(...this.tabs.filter((candidate) => candidate.groupId === tab.groupId));
    }
    this.tabs = ordered;
  }

  activate(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    const group = this.getGroup(tab.groupId);
    if (group?.collapsed) group.collapsed = false;
    this.activeId = id;
    for (const item of this.tabs) item.view?.classList.toggle('hidden', item.id !== id);
    this.render();
    this.onActiveChange(tab);
    this.onChange();
    this.focusActiveStrip();
  }

  focusActiveStrip() {
    const list = document.body.classList.contains('vertical-tabs') ? this.vlist : this.strip;
    (list?.querySelector('.active[data-id]') || list?.querySelector('[data-group-header].active'))?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  focusActive() {
    const list = document.body.classList.contains('vertical-tabs') ? this.vlist : this.strip;
    list?.querySelector('.active[data-id]')?.focus();
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
    const [tab] = this.tabs.splice(from, 1);
    const target = this.tabs.findIndex((t) => t.id === toId);
    tab.groupId = this.tabs[target]?.groupId || null;
    this.tabs.splice(target < 0 ? this.tabs.length : target, 0, tab);
    this.normalizeGroupOrder(); this.pruneGroups();
    this.render(); this.onChange();
  }

  next() { if (!this.tabs.length) return; const i = this.tabs.findIndex((t) => t.id === this.activeId); this.activate(this.tabs[(i + 1) % this.tabs.length].id); }
  prev() { if (!this.tabs.length) return; const i = this.tabs.findIndex((t) => t.id === this.activeId); this.activate(this.tabs[(i - 1 + this.tabs.length) % this.tabs.length].id); }
  reopenClosed() { const tab = this.closedStack.pop(); return tab ? this.add(tab.url, { title: tab.title, muted: tab.muted }) : null; }

  faviconHtml(tab) {
    if (tab.loading) return '<div class="spinner"></div>';
    if (tab.favicon && /^(https?:|data:image\/)/.test(tab.favicon)) return `<img src="${escapeHtml(tab.favicon)}" alt="" referrerpolicy="no-referrer">`;
    return icon(tab.url.startsWith('vespera://') ? 'sparkle' : 'globe');
  }

  audioHtml(tab) {
    const mode = this.getSettings()?.tabBehavior?.tabAudioMode || 'click-to-mute';
    if (mode === 'hidden' || (!tab.audible && !tab.muted)) return '';
    const label = tab.muted ? `Unmute ${tab.title}` : `Mute ${tab.title}`;
    const speaker = icon(tab.muted ? 'volumeOff' : 'volume');
    if (mode === 'indicator') return `<span class="tab-audio ${tab.muted ? 'is-muted' : ''}" role="img" aria-label="${escapeHtml(tab.muted ? `Muted: ${tab.title}` : `Playing audio: ${tab.title}`)}">${speaker}</span>`;
    return `<button class="tab-audio ${tab.muted ? 'is-muted' : ''}" type="button" data-audio-toggle="${escapeHtml(tab.id)}" aria-label="${escapeHtml(label)}" aria-pressed="${tab.muted}" title="${escapeHtml(label)}">${speaker}</button>`;
  }

  tabHtml(tab, vertical = false) {
    const cls = vertical ? 'vtab' : 'tab';
    const group = this.getGroup(tab.groupId);
    const behavior = this.getSettings()?.tabBehavior || {};
    const tooltip = behavior.tabHoverMode === 'tooltip' && behavior.memoryUsageOnHover === false ? `${tab.title}\n${tab.url}` : '';
    return `<div class="${cls} ${tab.id === this.activeId ? 'active' : ''} ${tab.pinned ? 'pinned' : ''}" data-id="${escapeHtml(tab.id)}" data-group-id="${escapeHtml(tab.groupId || '')}" ${group ? `data-group-color="${group.color}"` : ''} draggable="true" role="tab" tabindex="${tab.id === this.activeId ? 0 : -1}" aria-selected="${tab.id === this.activeId}" aria-label="${escapeHtml(tab.title)}" title="${escapeHtml(tooltip)}">
      <div class="favicon">${this.faviconHtml(tab)}</div>
      <div class="title">${escapeHtml(tab.title)}</div>
      ${tab.pinned ? '<span class="pin-marker" aria-label="Pinned">•</span>' : ''}
      ${this.audioHtml(tab)}
      <button class="close" data-close="${escapeHtml(tab.id)}" title="Close tab" aria-label="Close ${escapeHtml(tab.title)}">${icon('x')}</button>
    </div>`;
  }

  groupHeaderHtml(group, vertical = false) {
    const count = this.groupTabs(group.id).length;
    const active = this.groupTabs(group.id).some((tab) => tab.id === this.activeId);
    return `<div class="${vertical ? 'vtab-group-header' : 'tab-group-header'} ${active ? 'active' : ''}" data-group-header="${escapeHtml(group.id)}" data-group-color="${group.color}">
      <button class="tab-group-toggle" data-group-toggle="${escapeHtml(group.id)}" type="button" aria-expanded="${!group.collapsed}" aria-label="${group.collapsed ? 'Expand' : 'Collapse'} ${escapeHtml(group.title)}, ${count} tabs" title="${escapeHtml(group.title)} · ${count} ${count === 1 ? 'tab' : 'tabs'}">
        <span class="tab-group-dot"></span><span class="tab-group-title">${escapeHtml(group.title)}</span><span class="tab-group-count">${count}</span><span class="tab-group-chevron" aria-hidden="true">${group.collapsed ? '›' : '⌄'}</span>
      </button>
      <button class="tab-group-menu" data-group-menu="${escapeHtml(group.id)}" type="button" aria-label="Edit ${escapeHtml(group.title)}" title="Group options">···</button>
    </div>`;
  }

  render() {
    this.renderStrip(this.strip, false);
    this.renderStrip(this.vlist, true);
    document.querySelectorAll('[data-tab-count]').forEach((el) => { el.textContent = this.tabs.length; });
  }

  renderStrip(list, vertical) {
    if (!list) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const settings = this.getSettings()?.tabBehavior || {};
    const showGroups = settings.tabGroupsEnabled !== false;
    const hoverMode = settings.tabHoverMode || 'card';
    const existingTabs = new Map(), existingGroups = new Map(), before = new Map();
    const keyFor = (row) => row.dataset.id ? 'tab:' + row.dataset.id : row.dataset.groupHeader ? 'group:' + row.dataset.groupHeader : '';
    for (const row of [...list.children]) {
      const key = keyFor(row);
      if (!key) continue;
      if (row.dataset.id) existingTabs.set(row.dataset.id, row);
      else existingGroups.set(row.dataset.groupHeader, row);
      before.set(key, row.getBoundingClientRect());
    }

    const desired = [], visibleTabs = new Set(), visibleGroups = new Set(), seenGroups = new Set();
    for (const tab of this.tabs) {
      const group = showGroups ? this.getGroup(tab.groupId) : null;
      if (!group) { desired.push({ type: 'tab', tab }); visibleTabs.add(tab.id); continue; }
      if (seenGroups.has(group.id)) continue;
      seenGroups.add(group.id); visibleGroups.add(group.id);
      desired.push({ type: 'group', group });
      if (!group.collapsed) for (const member of this.groupTabs(group.id)) { desired.push({ type: 'tab', tab: member }); visibleTabs.add(member.id); }
    }

    const alive = new Set(this.tabs.map((tab) => tab.id));
    for (const [id, row] of existingTabs) {
      if (visibleTabs.has(id)) continue;
      const rect = before.get('tab:' + id);
      row.remove();
      if (!alive.has(id) && !reduce && list.offsetParent !== null) this.animateTabExit(list, row, rect, vertical);
    }
    for (const [id, row] of existingGroups) if (!visibleGroups.has(id)) row.remove();

    const ordered = [];
    for (const entry of desired) {
      if (entry.type === 'group') {
        const group = entry.group;
        let row = existingGroups.get(group.id);
        if (!row) {
          const template = document.createElement('template');
          template.innerHTML = this.groupHeaderHtml(group, vertical).trim();
          row = template.content.firstElementChild;
          if (!reduce && list.offsetParent !== null) {
            row.classList.add('group-enter');
            row.addEventListener('animationend', () => row.classList.remove('group-enter'), { once: true });
          }
        }
        row.classList.toggle('active', this.groupTabs(group.id).some((tab) => tab.id === this.activeId));
        row.dataset.groupColor = group.color;
        const toggle = row.querySelector('[data-group-toggle]');
        if (toggle) {
          toggle.setAttribute('aria-expanded', String(!group.collapsed));
          toggle.setAttribute('aria-label', `${group.collapsed ? 'Expand' : 'Collapse'} ${group.title}, ${this.groupTabs(group.id).length} tabs`);
          toggle.title = `${group.title} · ${this.groupTabs(group.id).length} ${this.groupTabs(group.id).length === 1 ? 'tab' : 'tabs'}`;
          const title = toggle.querySelector('.tab-group-title'); if (title) title.textContent = group.title;
          const count = toggle.querySelector('.tab-group-count'); if (count) count.textContent = this.groupTabs(group.id).length;
          const chevron = toggle.querySelector('.tab-group-chevron'); if (chevron) chevron.textContent = group.collapsed ? '›' : '⌄';
        }
        ordered.push(row);
        continue;
      }
      const tab = entry.tab;
      let row = existingTabs.get(tab.id);
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
      const group = this.getGroup(tab.groupId);
      row.classList.toggle('active', active);
      row.classList.toggle('pinned', tab.pinned);
      row.tabIndex = active ? 0 : -1;
      row.dataset.groupId = tab.groupId || '';
      if (group) row.dataset.groupColor = group.color;
      else delete row.dataset.groupColor;
      row.setAttribute('aria-selected', String(active));
      row.setAttribute('aria-label', tab.title);
      row.title = hoverMode === 'tooltip' && settings.memoryUsageOnHover === false ? `${tab.title}\n${tab.url}` : '';
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
      const audio = row.querySelector('.tab-audio');
      const desiredAudio = this.audioHtml(tab);
      if ((audio?.outerHTML || '') !== desiredAudio) {
        audio?.remove();
        if (desiredAudio) close?.insertAdjacentHTML('beforebegin', desiredAudio);
      }
      const pin = row.querySelector('.pin-marker');
      if (tab.pinned && !pin) close?.insertAdjacentHTML('beforebegin', '<span class="pin-marker" aria-label="Pinned">•</span>');
      else if (!tab.pinned && pin) pin.remove();
      ordered.push(row);
    }

    ordered.forEach((row, index) => { if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null); });
    if (reduce) return;
    for (const row of ordered) {
      const first = before.get(keyFor(row));
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
