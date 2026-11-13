/** Tab model + accessible horizontal/vertical tab strips. Views are owned by app.js. */
import { icon } from './icons.js';
import { escapeHtml } from './toasts.js';
import { safeTabUrl } from '../../shared/privacy-utils.mjs';
import { computeDrop, clampedInsertion, moveTabAfter, moveIntoGroup, moveGroupRelative as reorderGroupRelative, pinnedFirst } from '../../shared/tab-order.mjs';

let nextId = 1;
export const TAB_GROUP_COLORS = Object.freeze(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan']);
const validGroupColor = (color) => TAB_GROUP_COLORS.includes(color) ? color : 'blue';
const cleanGroupTitle = (title) => String(title || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || 'New group';
/** Pinned tabs are ~60px wide: they trade title + close for this ⋮ menu button. */
const tabMoreHtml = (id) => `<button class="tab-more" data-more="${id}" title="Tab actions" aria-label="Tab actions"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg></button>`;
export function createTabModel(url = 'vespera://newtab', opts = {}) {
  return {
    id: 'tab' + nextId++, url, title: opts.title || 'New Tab', favicon: null,
    loading: false, pinned: Boolean(opts.pinned), groupId: opts.groupId || null, groupName: opts.groupName || '', groupColor: opts.groupColor || '',
    muted: Boolean(opts.muted), audible: false, view: null, pageCleanup: null,
    disposeView: null, loadTimer: null, error: null, zoom: 1,
    entries: [{ url, title: opts.title || 'New Tab' }], entryIndex: 0,
    shields: { blocked: 0, ads: 0, trackers: 0, cleaned: 0 },
    createdAt: Date.now(), _internal: url.startsWith('vespera://'),
  };
}

export class TabManager {
  constructor({ onActiveChange, onClose, onMount, onChange, onContextMenu, onGroupContextMenu, onNewTab, onFocusPage, onToggleMute, getSettings, allowFileUrls = false } = {}) {
    this.tabs = [];
    this.allowFileUrls = Boolean(allowFileUrls);
    this.groups = [];
    this.activeId = null;
    this.closedStack = [];
    this.groupCounter = 0;
    this.onActiveChange = onActiveChange || (() => {});
    this.onClose = onClose || (() => {});
    this.onMount = onMount || (() => {});
    this.onChange = onChange || (() => {});
    this.onContextMenu = onContextMenu || (() => {});
    this.onGroupContextMenu = onGroupContextMenu || (() => {});
    this.onNewTab = onNewTab || (() => {});
    this.onFocusPage = onFocusPage || (() => {});
    this.onToggleMute = onToggleMute || (() => {});
    this.getSettings = getSettings || (() => ({}));
    this.strip = document.getElementById('tabstrip');
    this.vlist = document.getElementById('vtabs-list');
    this._drag = null; // { fromId, list, mode, index, targetId }
    for (const el of [this.strip, this.vlist]) el?.addEventListener('click', (e) => this.handleClick(e));
    for (const el of [this.strip, this.vlist]) {
      // Activate on mousedown so switching tabs feels instant, like a native browser.
      el?.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('[data-close],[data-more]')) return; // closing must not steal focus first
        const row = e.target.closest('[data-id]');
        if (row && row.dataset.id !== this.activeId) this.activate(row.dataset.id);
      });
      el?.addEventListener('auxclick', (e) => {
        if (e.button !== 1) return;
        const tab = e.target.closest('[data-id]');
        if (!tab) return;
        e.preventDefault();
        if (this.getSettings()?.tabBehavior?.middleClickClosesTab !== false) this.close(tab.dataset.id);
      });
      el?.addEventListener('keydown', (e) => {
        const groupHeader = e.target.closest('[data-group-header]');
        if (groupHeader && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
          e.preventDefault();
          this.onGroupContextMenu(groupHeader.dataset.groupHeader, groupHeader);
          return;
        }
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
        const groupHeader = e.target.closest('[data-group-header]');
        if (groupHeader) {
          const groupId = groupHeader.dataset.groupHeader;
          this._drag = { kind: 'group', groupId, list: el, mode: null, targetId: null, after: false };
          for (const list of [this.strip, this.vlist]) list?.querySelectorAll('[data-group-header]').forEach((node) => {
            if (node.dataset.groupHeader === groupId) node.classList.add('dragging');
          });
          e.dataTransfer.setData('text/group-id', groupId);
          e.dataTransfer.effectAllowed = 'move';
          return;
        }
        const row = e.target.closest('[data-id]');
        if (!row) return;
        this._drag = { kind: 'tab', fromId: row.dataset.id, list: el, mode: null, index: -1, targetId: null };
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
        this.updateDropTarget(el, e); // middle of a tab groups, edges reorder
      });
      el?.addEventListener('dragleave', (e) => {
        if (e.relatedTarget && el.contains(e.relatedTarget)) return;
        this.clearDropUi(el);
        if (this._drag?.list === el) { this._drag.mode = null; this._drag.index = -1; this._drag.targetId = null; }
      });
      el?.addEventListener('drop', (e) => {
        const drag = this._drag || {};
        const fromId = drag.kind === 'group'
          ? drag.groupId
          : (drag.fromId || e.dataTransfer.getData('text/tab-id'));
        if (!fromId) return;
        e.preventDefault();
        this.updateDropTarget(el, e); // resolve the final slot under the pointer
        if (drag.kind === 'group' && drag.mode === 'move-group' && drag.targetId) {
          this.moveGroupRelative(drag.groupId, drag.targetId, drag.after);
        } else if (drag.kind !== 'group' && drag.mode === 'group-header' && drag.targetId) {
          this.moveToGroup(fromId, drag.targetId);
        } else if (drag.kind !== 'group' && drag.mode === 'group' && drag.targetId && drag.targetId !== fromId) {
          this.groupWith(fromId, drag.targetId);
        } else if (drag.kind !== 'group' && drag.mode === 'move' && drag.index >= 0) {
          this.moveToIndex(fromId, drag.index, drag.targetGroupId);
        }
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
        const group = e.target.closest('[data-group-header]');
        if (group) { e.preventDefault(); this.onGroupContextMenu(group.dataset.groupHeader, group); return; }
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
    const coord = vertical ? e.clientY : e.clientX;
    const drag = this._drag;
    if (drag?.kind === 'group') {
      const groupHeader = e.target.closest('[data-group-header]');
      const tabRow = e.target.closest('[data-id]');
      const targetGroupId = groupHeader?.dataset.groupHeader || tabRow?.dataset.groupId || '';
      const matchingHeader = targetGroupId
        ? [...list.querySelectorAll('[data-group-header]')].find((node) => node.dataset.groupHeader === targetGroupId)
        : null;
      const target = matchingHeader || groupHeader || tabRow;
      const targetId = targetGroupId || tabRow?.dataset.id || '';
      list.querySelectorAll('.drag-over, .group-drop-target').forEach((node) => {
        node.classList.remove('drag-over', 'group-drop-target');
        delete node.dataset.dropSide;
      });
      if (!target || !targetId || targetGroupId === drag.groupId || tabRow?.classList.contains('pinned')) {
        drag.list = list; drag.mode = null; drag.targetId = null; drag.index = -1;
        this.ensureIndicator(list).hidden = true;
        return;
      }
      const targetRect = target.getBoundingClientRect();
      const decisionRect = (groupHeader || tabRow).getBoundingClientRect();
      const targetMembers = targetGroupId
        ? [...list.querySelectorAll('[data-id]')].filter((node) => node.dataset.groupId === targetGroupId)
        : [];
      const lastMemberRect = targetMembers.length ? targetMembers.at(-1).getBoundingClientRect() : targetRect;
      const start = vertical ? targetRect.top : targetRect.left;
      const end = vertical ? lastMemberRect.bottom : lastMemberRect.right;
      const decisionStart = vertical ? decisionRect.top : decisionRect.left;
      const decisionExtent = vertical ? decisionRect.height : decisionRect.width;
      const after = coord >= decisionStart + decisionExtent / 2;
      const boundary = after ? end : start;
      drag.list = list; drag.mode = 'move-group'; drag.targetId = targetId; drag.after = after; drag.index = -1;
      target.classList.add('group-drop-target');
      target.dataset.dropSide = after ? 'after' : 'before';
      const indicator = this.ensureIndicator(list);
      const host = list.getBoundingClientRect();
      if (vertical) {
        indicator.style.top = `${boundary - host.top + list.scrollTop}px`;
        indicator.style.left = '';
      } else {
        indicator.style.left = `${boundary - host.left + list.scrollLeft}px`;
        indicator.style.top = '';
      }
      indicator.hidden = false;
      return;
    }
    const rows = this.stripRows(list);
    const groupHeader = e.target.closest('[data-group-header]');
    if (groupHeader) {
      for (const r of rows) r.el.classList.remove('drag-over');
      list.querySelectorAll('[data-group-header]').forEach((node) => node.classList.toggle('drag-over', node === groupHeader));
      if (drag) { drag.list = list; drag.mode = 'group-header'; drag.targetId = groupHeader.dataset.groupHeader; drag.targetGroupId = null; drag.index = -1; }
      this.ensureIndicator(list).hidden = true;
      return;
    }
    list.querySelectorAll('[data-group-header].drag-over').forEach((node) => node.classList.remove('drag-over'));
    // Dropping onto the middle of a tab groups it (Chrome behaviour); the
    // leading/trailing thirds reorder. Holding Alt makes the whole row a
    // group target so grouping never depends on a precise drop.
    const drop = computeDrop(rows, coord, { allowGroup: true });
    if (e.altKey && drop.mode === 'move') {
      const over = rows.find((r) => coord >= r.start && coord <= r.start + r.extent);
      if (over && over.id !== drag?.fromId) { drop.mode = 'group'; drop.id = over.id; }
    }
    const beforeRow = drop.mode === 'move' ? rows[drop.index] : null;
    const targetIndex = beforeRow ? this.tabs.findIndex((tab) => tab.id === beforeRow.id) : this.tabs.length;
    const targetGroup = beforeRow ? (this.tabs.find((tab) => tab.id === beforeRow.id)?.groupId || null) : null;
    if (drag) {
      drag.list = list; drag.mode = drop.mode;
      drag.index = drop.mode === 'move' ? Math.max(0, targetIndex) : -1;
      drag.targetId = drop.mode === 'group' ? drop.id : null;
      drag.targetGroupId = drop.mode === 'move' ? targetGroup : null;
    }
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
    list?.querySelectorAll('.drag-over, .group-drop-target').forEach((node) => {
      node.classList.remove('drag-over', 'group-drop-target');
      delete node.dataset.dropSide;
    });
    const indicator = list?.querySelector('.drop-indicator');
    if (indicator) indicator.hidden = true;
  }
  endDrag() {
    this._drag = null;
    for (const list of [this.strip, this.vlist]) {
      list?.querySelectorAll('.dragging').forEach((node) => node.classList.remove('dragging'));
      this.clearDropUi(list);
    }
  }

  /* ---- Model ---- */
  handleClick(e) {
    const toggle = e.target.closest('[data-group-toggle]');
    if (toggle) { e.preventDefault(); e.stopPropagation(); this.toggleGroup(toggle.dataset.groupToggle); return; }
    const audio = e.target.closest('[data-audio-toggle]');
    if (audio) { e.preventDefault(); e.stopPropagation(); this.onToggleMute(audio.dataset.audioToggle); return; }
    const close = e.target.closest('[data-close]');
    if (close) { e.stopPropagation(); this.close(close.dataset.close); return; }
    const more = e.target.closest('[data-more]');
    if (more) {
      // Pinned tabs are too narrow for a close button — a ⋮ opens their menu.
      e.stopPropagation();
      const host = more.closest('[data-id]');
      if (!host) return;
      const box = more.getBoundingClientRect();
      this.onContextMenu?.(host.dataset.id, Math.round(box.left), Math.round(box.bottom + 6));
      return;
    }
    const row = e.target.closest('[data-id]');
    if (!row) return;
    if (row.dataset.id !== this.activeId) this.activate(row.dataset.id);
    this.onFocusPage(this.active); // so page shortcuts (YouTube's F, Space…) work straight away
  }
  getGroup(id) { return this.groups.find((group) => group.id === id) || null; }
  groupTabs(id) { return this.tabs.filter((tab) => tab.groupId === id); }
  add(url = 'vespera://newtab', options = {}) {
    url = safeTabUrl(url, { allowFile: this.allowFileUrls });
    if (!url) throw new Error('This address cannot be opened in a tab.');
    if (this.tabs.length >= 60) {
      const candidate = this.tabs.find((t) => !t.pinned && t.id !== this.activeId);
      if (candidate) this.close(candidate.id);
      if (this.tabs.length >= 60) return null;
    }
    const { activate = true, title, pinned = false, afterId = null, index = null, muted = false } = options;
    const behavior = this.getSettings()?.tabBehavior || {};
    const group = !pinned ? this.getGroup(options.groupId) : null;
    const groupId = group?.id || null;
    const tab = createTabModel(url, {
      title, pinned, groupId, groupName: group?.title || '', groupColor: group?.color || '', muted,
    });
    const pinnedCount = this.tabs.filter((t) => t.pinned).length;
    let at = pinned ? pinnedCount : this.tabs.length;
    if (!pinned && Number.isInteger(index)) {
      at = Math.max(pinnedCount, Math.min(index, this.tabs.length));
    } else if (!pinned && afterId) {
      const i = this.tabs.findIndex((t) => t.id === afterId);
      if (i >= 0) at = Math.max(pinnedCount, i + 1);
    } else {
      const besideEnabled = behavior.openTabsNextToCurrent !== false;
      const nearId = besideEnabled ? (options.besideId !== undefined ? options.besideId : this.activeId) : null;
      const near = this.tabs.find((t) => t.id === nearId);
      if (groupId) {
        const members = this.tabs.map((t, i) => t.groupId === groupId ? i : -1).filter((i) => i >= 0);
        if (near?.groupId === groupId) at = this.tabs.indexOf(near) + 1;
        else at = members.length ? members.at(-1) + 1 : (near ? this.tabs.indexOf(near) + 1 : this.tabs.length);
      } else if (near?.groupId && this.getGroup(near.groupId)) {
        const members = this.tabs.map((t, i) => t.groupId === near.groupId ? i : -1).filter((i) => i >= 0);
        at = members.length ? members.at(-1) + 1 : this.tabs.indexOf(near) + 1;
      } else if (near) at = this.tabs.indexOf(near) + 1;
    }
    this.tabs.splice(at, 0, tab);
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
    this.closedStack.push({ url: tab.url, title: tab.title, pinned: tab.pinned, muted: tab.muted, index: i, groupId: tab.groupId, groupName: tab.groupName, groupColor: tab.groupColor, group: tab.groupId ? { ...this.getGroup(tab.groupId) } : null });
    if (this.closedStack.length > 20) this.closedStack.shift();
    this.dispose(tab);
    this.onClose(tab);
    this.pruneGroups();
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
  duplicate(id) {
    const tab = this.tabs.find((item) => item.id === id);
    if (tab) this.add(tab.url, { title: tab.title, pinned: tab.pinned, afterId: id, groupId: tab.groupId, muted: tab.muted });
  }
  togglePin(id) {
    const tab = this.tabs.find((item) => item.id === id);
    if (!tab) return;
    tab.pinned = !tab.pinned;
    if (tab.pinned) { tab.groupId = null; tab.groupName = ''; tab.groupColor = ''; }
    this.tabs = pinnedFirst(this.tabs);
    this.normalizeGroupOrder(); this.pruneGroups();
    this.render(); this.onChange();
  }
  moveActive(dir) { if (this.activeId) this.moveTabRelative(this.activeId, dir); }
  createGroup(title = 'New group', tabId = this.activeId, color = 'blue') {
    if (this.getSettings()?.tabBehavior?.tabGroupsEnabled === false) return null;
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab || tab.pinned) return null;
    const group = {
      id: 'group-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      title: cleanGroupTitle(title), color: validGroupColor(color), collapsed: false,
    };
    this.groups.push(group);
    tab.groupId = group.id;
    this.syncGroupMembers(group.id);
    this.pruneGroups(); this.normalizeGroupOrder();
    this.render(); this.onChange();
    return group;
  }
  updateGroup(id, patch = {}) {
    const group = this.getGroup(id);
    if (!group) return;
    if (patch.title !== undefined) group.title = cleanGroupTitle(patch.title);
    if (patch.color !== undefined) group.color = validGroupColor(patch.color);
    if (patch.collapsed !== undefined) group.collapsed = Boolean(patch.collapsed);
    this.syncGroupMembers(id);
    this.render(); this.onChange();
  }
  toggleGroup(id) {
    const group = this.getGroup(id);
    if (!group) return;
    group.collapsed = !group.collapsed;
    this.render(); this.onChange();
  }
  moveToGroup(tabId, groupId) {
    if (this.getSettings()?.tabBehavior?.tabGroupsEnabled === false) return;
    const group = this.getGroup(groupId);
    const tab = this.tabs.find((item) => item.id === tabId);
    const from = this.tabs.findIndex((item) => item.id === tabId);
    if (!group || !tab || from < 0 || tab.pinned) return;
    tab.groupId = group.id;
    this.syncGroupMembers(group.id);
    const [moved] = this.tabs.splice(from, 1);
    const members = this.tabs.map((item, index) => item.groupId === group.id ? index : -1).filter((index) => index >= 0);
    this.tabs.splice(members.length ? members.at(-1) + 1 : this.tabs.length, 0, moved);
    this.normalizeGroupOrder(); this.pruneGroups();
    this.render(); this.onChange();
  }
  addToGroup(tabId, groupId) { this.moveToGroup(tabId, groupId); }
  moveGroupRelative(groupId, targetId, after = false) {
    if (this.getSettings()?.tabBehavior?.tabGroupsEnabled === false) return;
    if (!this.getGroup(groupId)) return;
    const next = reorderGroupRelative(this.tabs, groupId, targetId, after);
    if (next.every((tab, index) => tab === this.tabs[index])) return;
    this.tabs = next;
    this.normalizeGroupOrder();
    this.render(); this.onChange();
  }
  ungroupTab(tabId) {
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab?.groupId) return;
    const groupId = tab.groupId;
    tab.groupId = null; tab.groupName = ''; tab.groupColor = '';
    this.normalizeGroupOrder(); this.pruneGroups();
    this.render(); this.onChange();
    return groupId;
  }
  ungroup(groupId) {
    if (!this.getGroup(groupId)) return;
    for (const tab of this.tabs) if (tab.groupId === groupId) { tab.groupId = null; tab.groupName = ''; tab.groupColor = ''; }
    this.groups = this.groups.filter((group) => group.id !== groupId);
    this.normalizeGroupOrder();
    this.render(); this.onChange();
  }
  closeGroup(groupId) {
    const group = this.getGroup(groupId);
    if (!group) return;
    const index = this.tabs.findIndex((tab) => tab.groupId === groupId);
    const removed = this.groupTabs(groupId);
    this.tabs = this.tabs.filter((tab) => tab.groupId !== groupId);
    for (const tab of removed) {
      this.closedStack.push({ url: tab.url, title: tab.title, muted: tab.muted, pinned: tab.pinned, index, groupId, groupName: group.title, groupColor: group.color, group: { ...group } });
      this.dispose(tab); this.onClose(tab);
    }
    this.closedStack = this.closedStack.slice(-20);
    this.groups = this.groups.filter((item) => item.id !== groupId);
    if (!this.tabs.length) { this.activeId = null; this.add('vespera://newtab'); return; }
    if (removed.some((tab) => tab.id === this.activeId)) this.activate(this.tabs[Math.min(Math.max(0, index), this.tabs.length - 1)].id);
    else { this.render(); this.onChange(); }
  }
  groupWith(fromId, toId) {
    if (this.getSettings()?.tabBehavior?.tabGroupsEnabled === false) return;
    const from = this.tabs.find((tab) => tab.id === fromId), to = this.tabs.find((tab) => tab.id === toId);
    if (!from || !to || from === to || from.pinned || to.pinned) return;
    let group = this.getGroup(to.groupId) || this.getGroup(from.groupId);
    if (!group) group = this.createGroup('New group', toId);
    if (!group) return;
    from.groupId = group.id;
    to.groupId = group.id;
    this.syncGroupMembers(group.id);
    this.moveToGroup(fromId, group.id);
  }
  renameGroup(id, name) { this.updateGroup(id, { title: name }); }
  syncGroupMembers(groupId) {
    const group = this.getGroup(groupId);
    for (const tab of this.tabs) if (tab.groupId === groupId) {
      tab.groupName = group?.title || '';
      tab.groupColor = group?.color || '';
    }
  }
  pruneGroups() {
    const used = new Set(this.tabs.map((tab) => tab.groupId).filter(Boolean));
    this.groups = this.groups.filter((group) => used.has(group.id));
    for (const tab of this.tabs) if (tab.groupId && !this.getGroup(tab.groupId)) {
      tab.groupId = null; tab.groupName = ''; tab.groupColor = '';
    }
    for (const group of this.groups) this.syncGroupMembers(group.id);
  }
  normalizeGroupOrder() {
    const pinned = this.tabs.filter((tab) => tab.pinned);
    const unpinned = this.tabs.filter((tab) => !tab.pinned);
    const ordered = [...pinned], seen = new Set();
    for (const tab of unpinned) {
      const group = this.getGroup(tab.groupId);
      if (!group) { tab.groupId = null; tab.groupName = ''; tab.groupColor = ''; ordered.push(tab); continue; }
      if (seen.has(group.id)) continue;
      seen.add(group.id);
      const members = unpinned.filter((candidate) => candidate.groupId === group.id);
      ordered.push(...members);
      this.syncGroupMembers(group.id);
    }
    this.tabs = ordered;
  }
  activate(id) {
    const tab = this.tabs.find((item) => item.id === id);
    if (!tab) return;
    const group = this.getGroup(tab.groupId);
    if (group?.collapsed) group.collapsed = false;
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
    (list?.querySelector('.active[data-id]') || list?.querySelector('[data-group-header].active'))?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
  moveToIndex(fromId, index, targetGroupId) {
    const from = this.tabs.findIndex((t) => t.id === fromId);
    if (from < 0) return;
    const item = this.tabs[from];
    const ins = clampedInsertion(this.tabs, fromId, index);
    if (!item.pinned && targetGroupId !== undefined) item.groupId = this.getGroup(targetGroupId)?.id || null;
    const [moved] = this.tabs.splice(from, 1);
    this.tabs.splice(ins, 0, moved);
    this.normalizeGroupOrder(); this.pruneGroups();
    this.render(); this.onChange();
  }
  /** Move a tab one slot left/right (keyboard reordering), respecting pin sections. */
  moveTabRelative(id, dir) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0 || !dir) return;
    const targetIndex = dir > 0 ? i + 2 : i - 1;
    const neighbor = this.tabs[dir > 0 ? i + 1 : i - 1];
    this.moveToIndex(id, targetIndex, neighbor?.groupId || null);
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
    let group = t.groupId ? this.getGroup(t.groupId) : null;
    if (!group && t.group) {
      group = { ...t.group, id: t.groupId || t.group.id, title: cleanGroupTitle(t.group.title), color: validGroupColor(t.group.color), collapsed: Boolean(t.group.collapsed) };
      this.groups.push(group);
    }
    const tab = this.add(t.url, { title: t.title, pinned: t.pinned, muted: t.muted, index: t.index, ...(group ? { groupId: group.id } : {}) });
    return tab;
  }
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
    const behavior = this.getSettings()?.tabBehavior || {};
    const group = behavior.tabGroupsEnabled === false ? null : this.getGroup(tab.groupId);
    const tooltip = behavior.tabHoverMode === 'tooltip' && behavior.memoryUsageOnHover === false ? `${tab.title}\n${tab.url}` : '';
    const pinnedControl = tab.pinned
      ? (vertical ? '<span class="pin-marker" aria-label="Pinned">•</span>' : tabMoreHtml(tab.id))
      : '';
    return `<div class="${cls} ${tab.id === this.activeId ? 'active' : ''} ${tab.pinned ? 'pinned' : ''} ${group ? 'grouped' : ''}" data-id="${escapeHtml(tab.id)}" data-group-id="${escapeHtml(tab.groupId || '')}" ${group ? `data-group-color="${group.color}" style="--tab-group-color:${group.color}"` : ''} draggable="true" role="tab" tabindex="${tab.id === this.activeId ? 0 : -1}" aria-selected="${tab.id === this.activeId}" aria-label="${escapeHtml(tab.title)}" title="${escapeHtml(tooltip)}">
      <div class="favicon">${this.faviconHtml(tab)}</div>
      <div class="title">${escapeHtml(tab.title)}</div>
      ${pinnedControl}
      ${this.audioHtml(tab)}
      <button class="close" data-close="${escapeHtml(tab.id)}" title="Close tab" aria-label="Close ${escapeHtml(tab.title)}">${icon('x')}</button>
    </div>`;
  }
  groupHeaderHtml(group, vertical = false) {
    const count = this.groupTabs(group.id).length;
    const active = this.groupTabs(group.id).some((tab) => tab.id === this.activeId);
    const countLabel = `${count} ${count === 1 ? 'tab' : 'tabs'}`;
    return `<div class="${vertical ? 'vtab-group-header' : 'tab-group-header'} ${active ? 'active' : ''}" data-group-header="${escapeHtml(group.id)}" data-group-color="${group.color}" draggable="true" role="group" aria-label="${escapeHtml(group.title)}, ${countLabel}. Drag to reorder; right-click for group actions." title="Drag to reorder · Right-click for group actions">
      <span class="tab-group-grip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
      <button class="tab-group-toggle" data-group-toggle="${escapeHtml(group.id)}" type="button" aria-expanded="${!group.collapsed}" aria-label="${group.collapsed ? 'Expand' : 'Collapse'} ${escapeHtml(group.title)}, ${countLabel}" title="${escapeHtml(group.title)} · ${countLabel}">
        <span class="tab-group-dot"></span><span class="tab-group-title">${escapeHtml(group.title)}</span><span class="tab-group-count" aria-hidden="true">${count}</span><span class="tab-group-chevron" aria-hidden="true">${group.collapsed ? '›' : '⌄'}</span>
      </button>
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
    const behavior = this.getSettings()?.tabBehavior || {};
    const showGroups = behavior.tabGroupsEnabled !== false;
    const hoverMode = behavior.tabHoverMode || 'card';
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
        const countValue = this.groupTabs(group.id).length;
        const countLabel = `${countValue} ${countValue === 1 ? 'tab' : 'tabs'}`;
        row.classList.toggle('active', this.groupTabs(group.id).some((tab) => tab.id === this.activeId));
        row.dataset.groupColor = group.color;
        row.setAttribute('aria-label', `${group.title}, ${countLabel}. Drag to reorder; right-click for group actions.`);
        row.title = 'Drag to reorder · Right-click for group actions';
        const toggle = row.querySelector('[data-group-toggle]');
        if (toggle) {
          toggle.setAttribute('aria-expanded', String(!group.collapsed));
          toggle.setAttribute('aria-label', `${group.collapsed ? 'Expand' : 'Collapse'} ${group.title}, ${countLabel}`);
          toggle.title = `${group.title} · ${countLabel}`;
          const title = toggle.querySelector('.tab-group-title'); if (title) title.textContent = group.title;
          const count = toggle.querySelector('.tab-group-count'); if (count) count.textContent = countValue;
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
      const group = showGroups ? this.getGroup(tab.groupId) : null;
      row.classList.toggle('active', active);
      row.classList.toggle('pinned', tab.pinned);
      row.classList.toggle('grouped', Boolean(group));
      row.dataset.groupId = tab.groupId || '';
      if (group) row.dataset.groupColor = group.color;
      else delete row.dataset.groupColor;
      if (group) row.style.setProperty('--tab-group-color', group.color);
      else row.style.removeProperty('--tab-group-color');
      row.tabIndex = active ? 0 : -1;
      row.setAttribute('aria-selected', String(active));
      row.setAttribute('aria-label', tab.title);
      row.title = hoverMode === 'tooltip' && behavior.memoryUsageOnHover === false ? `${tab.title}\n${tab.url}` : '';
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
      // Pinned horizontal tabs swap their title/close for a ⋮ menu button.
      const more = row.querySelector('.tab-more');
      if (tab.pinned && !vertical && !more) close?.insertAdjacentHTML('beforebegin', tabMoreHtml(tab.id));
      else if ((!tab.pinned || vertical) && more) more.remove();
      const pin = row.querySelector('.pin-marker');
      if (tab.pinned && vertical && !pin) close?.insertAdjacentHTML('beforebegin', '<span class="pin-marker" aria-label="Pinned">•</span>');
      else if ((!tab.pinned || !vertical) && pin) pin.remove();
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
