// Test: the guest bridge script injected into every proxied page
// (src/shared/guest-bridge.js). This is the single source of truth — the Rust
// proxy in src-tauri embeds this exact script — so the preview's link routing,
// downloads, context menu and blocked-resource reporting stay covered.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { bridgeScript } = require('../src/shared/guest-bridge');

/** Compile the injected <script> into a runnable guest with a DOM-ish stub. */
function createGuest(pageUrl) {
  const html = bridgeScript(pageUrl, '', '', '');
  const inner = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');

  const messages = [];
  const listeners = new Map();
  const document = {
    title: 'Article title',
    documentElement: {},
    addEventListener(type, listener) {
      const list = listeners.get(type) || [];
      list.push(listener);
      listeners.set(type, list);
    },
    querySelectorAll() { return []; },
  };
  const parent = { postMessage: (msg) => messages.push(msg) };
  const windowStub = {
    fetch: () => Promise.resolve({ ok: true }),
    addEventListener() {},
    getSelection: () => '',
  };
  class XMLHttpRequest {}
  class MutationObserver { observe() {} }
  class HTMLFormElement {}
  class HTMLMediaElement {}
  vm.runInNewContext(inner, {
    URL,
    location: new URL(pageUrl),
    document,
    parent,
    window: windowStub,
    performance: { getEntriesByType: () => [] },
    XMLHttpRequest,
    MutationObserver,
    HTMLFormElement,
    HTMLMediaElement,
    FormData: class FormData {},
    alert: () => {},
    setTimeout,
    clearTimeout,
  }, { filename: 'guest-bridge.js' });
  return { listeners, messages };
}

function makeAnchor(href, { target = '', download = false } = {}) {
  return {
    href,
    getAttribute(name) {
      if (name === 'href') return href;
      if (name === 'target') return target;
      if (name === 'download') return download ? 'file.zip' : null;
      return null;
    },
    hasAttribute(name) { return name === 'download' && download; },
    closest(selector) {
      if (selector === 'a[href]') return this;
      return null;
    },
  };
}

function dispatch(guest, type, target, options = {}) {
  let prevented = false, stopped = false;
  const event = {
    button: options.button ?? (type === 'auxclick' ? 1 : 0),
    target,
    ctrlKey: Boolean(options.ctrlKey), metaKey: Boolean(options.metaKey), shiftKey: Boolean(options.shiftKey),
    clientX: options.clientX ?? 10, clientY: options.clientY ?? 20,
    preventDefault() { prevented = true; },
    stopImmediatePropagation() { stopped = true; },
  };
  for (const listener of guest.listeners.get(type) || []) listener(event);
  return { prevented, stopped };
}

test('guest bridge reports the page to the host on load', () => {
  const guest = createGuest('https://site.example/article');
  assert.equal(guest.messages.length, 1);
  assert.equal(guest.messages[0].type, 'vespera:page');
  assert.equal(guest.messages[0].title, 'Article title');
  assert.equal(guest.messages[0].url, 'https://site.example/article');
});

test('guest bridge routes click and modifier gestures to the host', () => {
  const guest = createGuest('https://site.example/article');
  guest.messages.length = 0;

  const plain = dispatch(guest, 'click', makeAnchor('https://example.com/next'));
  assert.deepEqual(plain, { prevented: true, stopped: true });
  assert.equal(guest.messages[0].type, 'vespera:navigate');
  assert.equal(guest.messages[0].url, 'https://example.com/next');
  assert.equal(guest.messages[0].newTab, false);
  assert.equal(guest.messages[0].foreground, true);

  const ctrl = dispatch(guest, 'click', makeAnchor('https://example.com/bg'), { ctrlKey: true });
  assert.equal(ctrl.prevented, true);
  assert.equal(guest.messages[1].newTab, true);
  assert.equal(guest.messages[1].foreground, false);
  assert.equal(guest.messages[1].gesture, 'modifier');

  dispatch(guest, 'click', makeAnchor('https://example.com/blank', { target: '_BLANK' }));
  assert.equal(guest.messages[2].newTab, true);
});

test('guest bridge routes middle-click, downloads and the context menu', () => {
  const guest = createGuest('https://site.example/article');
  guest.messages.length = 0;

  const middle = dispatch(guest, 'auxclick', makeAnchor('https://example.com/next'));
  assert.equal(middle.prevented, true);
  assert.equal(guest.messages[0].type, 'vespera:navigate');
  assert.equal(guest.messages[0].newTab, true);
  assert.equal(guest.messages[0].foreground, false);
  assert.equal(guest.messages[0].gesture, 'middle');

  dispatch(guest, 'click', makeAnchor('https://example.com/file.zip', { download: true }));
  assert.equal(guest.messages[1].type, 'vespera:download');
  assert.equal(guest.messages[1].url, 'https://example.com/file.zip');
  assert.equal(guest.messages[1].name, 'file.zip');

  dispatch(guest, 'contextmenu', makeAnchor('https://example.com/link'), { clientX: 5, clientY: 6 });
  assert.equal(guest.messages[2].type, 'vespera:context');
  assert.equal(guest.messages[2].link, 'https://example.com/link');
  assert.equal(guest.messages[2].x, 5);
  assert.equal(guest.messages[2].y, 6);
});

test('guest bridge ignores unsafe links and reports blocked resources', () => {
  const guest = createGuest('https://site.example/article');
  guest.messages.length = 0;

  const unsafe = dispatch(guest, 'click', makeAnchor('javascript:alert(1)', { target: '_blank' }));
  assert.deepEqual(unsafe, { prevented: false, stopped: false });
  const dataUrl = dispatch(guest, 'click', makeAnchor('data:text/html,x'));
  assert.deepEqual(dataUrl, { prevented: false, stopped: false });
  assert.equal(guest.messages.length, 0, 'no navigation reported for unsafe links');
});
