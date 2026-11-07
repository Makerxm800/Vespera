/** Vespera tab manager — horizontal strip + vertical sidebar tabs. */
import { icon } from './icons.js';
import { platform } from './platform.js';

let nextId = 1;

export function createTabModel(url = 'vespera://newtab', opts = {}) {
  return {
    id: 'tab' + nextId++,
    url,
    title: opts.title || 'New Tab',
    favicon: null,
    loading: false,
    pinned: false,
    view: null,           // live HTMLElement (webview/iframe/page container)
    pageCleanup: null,    // internal page unmount hook
    shields: { blocked: 0, ads: 0, trackers: 0, cleaned: 0 },
    createdAt: Date.now(),
    _internal: url.startsWith('vespera://'),
  };
}

export class TabManager {
  constructor({ onActiveChange, onClose, onNavigate } = {}) {
    this.tabs = [];
    this.activeId = null;
    this.onActiveChange = onActiveChange || (() => {});
    this.onClose = onClose || (() => {});
    this.onNavigate = onNavigate || (() => {});
    this.strip = document.getElementById('tabstrip');
    this.vlist = document.getElementById('vtabs-list');
  }

  get active() { return this.tabs.find((t) => t.id === this.activeId) || null; }

  add(url, { activate = true, title } = {}) {
    const tab = createTabModel(url, { title });
    this.tabs.push(tab);
    this.render();
    if (activate) this.activate(tab.id);
    return tab;
  }

  close(id) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    const [tab] = this.tabs.splice(i, 1);
    if (tab.pageCleanup) { try { tab.pageCleanup(); } catch { /* noop */ } }
    if (tab.view) tab.view.remove();
    this.onClose(tab);
    if (!this.tabs.length) {
      // Always keep at least one tab.
      const t = this.add('vespera://newtab');
      this.activate(t.id);
      return;
    }
    if (this.activeId === id) {
      const next = this.tabs[Math.min(i, this.tabs.length - 1)];
      this.activate(next.id);
    } else {
      this.render();
    }
  }

  activate(id) {
    this.activeId = id;
    const tab = this.active;
    if (!tab) return;
    // Show only the active view.
    for (const t of this.tabs) {
      if (t.view) t.view.classList.toggle('hidden', t.id !== id);
    }
    this.render();
    this.onActiveChange(tab);
  }

  update(tab, patch) {
    Object.assign(tab, patch);
    this.render();
  }

  move(fromId, toId) {
    const from = this.tabs.findIndex((t) => t.id === fromId);
    const to = this.tabs.findIndex((t) => t.id === toId);
    if (from === -1 || to === -1 || from === to) return;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, tab);
    this.render();
  }

  next() {
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    this.activate(this.tabs[(i + 1) % this.tabs.length].id);
  }
  prev() {
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    this.activate(this.tabs[(i - 1 + this.tabs.length) % this.tabs.length].id);
  }
  reopenClosed() {
    // Reopen last closed (kept in a small stack by app.js if desired).
    this._lastClosed && this.add(this._lastClosed.url, { title: this._lastClosed.title });
  }

  faviconHtml(tab) {
    if (tab.loading) return '<div class="spinner"></div>';
    if (tab.favicon) return `<img src="${tab.favicon}" alt="" onerror="this.remove()">`;
    return icon(tab.url.startsWith('vespera://') ? 'sparkle' : 'globe');
  }

  tabHtml(tab, vertical = false) {
    const cls = vertical ? 'vtab' : 'tab';
    return `
      <div class="${cls} ${tab.id === this.activeId ? 'active' : ''}" data-id="${tab.id}" draggable="true">
        <div class="favicon">${this.faviconHtml(tab)}</div>
        <div class="title">${escapeAttr(tab.title)}</div>
        <button class="close" data-close="${tab.id}" title="Close tab">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 2l8 8M10 2L2 10"/></svg>
        </button>
      </div>`;
  }

  render() {
    const vertical = document.body.classList.contains('vertical-tabs');
    // Horizontal strip
    if (this.strip) {
      this.strip.innerHTML = this.tabs.map((t) => this.tabHtml(t, false)).join('');
    }
    // Vertical list
    if (this.vlist) {
      this.vlist.innerHTML = this.tabs.map((t) => this.tabHtml(t, true)).join('');
    }
    // Wire clicks (both lists share class names by mode)
    const active = vertical ? this.vlist : this.strip;
    if (!active) return;
    active.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.close;
        this._lastClosed = this.tabs.find((t) => t.id === id);
        this.close(id);
      });
    });
    active.querySelectorAll('[data-id]').forEach((el) => {
      el.addEventListener('click', () => this.activate(el.dataset.id));
      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) { e.preventDefault(); this.close(el.dataset.id); }
      });
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/tab-id', el.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.classList.add('drag-over');
      });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');
        const fromId = e.dataTransfer.getData('text/tab-id');
        if (fromId) this.move(fromId, el.dataset.id);
      });
    });
  }
}

function escapeAttr(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
