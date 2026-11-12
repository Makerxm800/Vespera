const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const preload = fs.readFileSync(path.join(__dirname, '../electron/webview-preload.js'), 'utf8');

function createGuest(url) {
  const listeners = new Map();
  const messages = [];
  const window = {
    addEventListener(type, listener) {
      const list = listeners.get(type) || [];
      list.push(listener);
      listeners.set(type, list);
    },
  };
  vm.runInNewContext(preload, {
    URL,
    location: new URL(url),
    window,
    require(id) {
      assert.equal(id, 'electron');
      return {
        ipcRenderer: { sendToHost: (...args) => messages.push(args) },
        webFrame: { executeJavaScript: () => Promise.resolve() },
      };
    },
  }, { filename: 'webview-preload.js' });
  return { listeners, messages };
}

function makeAnchor(href, { target = '', download = false } = {}) {
  return {
    href,
    getAttribute(name) { return name === 'href' ? href : name === 'target' ? target : null; },
    hasAttribute(name) { return name === 'download' && download; },
    closest(selector) { return selector === 'a[href]' ? this : null; },
  };
}

function dispatch(guest, type, anchor, options = {}) {
  let prevented = false, stopped = false;
  const event = {
    isTrusted: options.isTrusted !== false,
    button: options.button ?? (type === 'auxclick' ? 1 : 0),
    target: anchor,
    ctrlKey: Boolean(options.ctrlKey), metaKey: Boolean(options.metaKey), shiftKey: Boolean(options.shiftKey),
    preventDefault() { prevented = true; },
    stopImmediatePropagation() { stopped = true; },
  };
  for (const listener of guest.listeners.get(type) || []) listener(event);
  return { prevented, stopped };
}

test('webview preload routes explicit _blank and modifier link gestures to the tab controller', () => {
  const guest = createGuest('https://site.example/article');
  const anchor = makeAnchor('https://example.com/next', { target: '_BLANK' });
  assert.deepEqual(dispatch(guest, 'click', anchor), { prevented: true, stopped: true });
  assert.equal(guest.messages.length, 1);
  assert.equal(guest.messages[0][0], 'vespera:open-link');
  assert.equal(guest.messages[0][1].url, 'https://example.com/next');
  assert.equal(guest.messages[0][1].newTab, true);
  assert.equal(guest.messages[0][1].foreground, true);

  dispatch(guest, 'click', makeAnchor('https://example.com/background'), { ctrlKey: true });
  assert.equal(guest.messages[1][1].foreground, false);
  assert.equal(guest.messages[1][1].gesture, 'modifier');
});

test('webview preload routes user-clicked local files safely and keeps middle-click backgrounded', () => {
  const guest = createGuest('https://site.example/article');
  const click = dispatch(guest, 'click', makeAnchor('file:///tmp/report.html'));
  assert.equal(click.prevented, true);
  assert.equal(guest.messages[0][1].url, 'file:///tmp/report.html');
  assert.equal(guest.messages[0][1].foreground, true);

  dispatch(guest, 'auxclick', makeAnchor('https://example.com/next'), { button: 1 });
  assert.equal(guest.messages[1][1].foreground, false);
  assert.equal(guest.messages[1][1].gesture, 'middle');
});

test('webview preload ignores synthetic, unsafe, downloadable and extension-popup links', () => {
  const guest = createGuest('https://site.example/article');
  const synthetic = dispatch(guest, 'click', makeAnchor('https://example.com/'), { isTrusted: false });
  assert.deepEqual(synthetic, { prevented: false, stopped: false });
  const unsafe = dispatch(guest, 'click', makeAnchor('javascript:alert(1)', { target: '_blank' }));
  assert.deepEqual(unsafe, { prevented: false, stopped: false });
  const ambiguousFile = dispatch(guest, 'click', makeAnchor('file:///%2fetc/passwd', { target: '_blank' }));
  assert.deepEqual(ambiguousFile, { prevented: false, stopped: false });
  const download = dispatch(guest, 'click', makeAnchor('https://example.com/file.zip', { target: '_blank', download: true }));
  assert.deepEqual(download, { prevented: false, stopped: false });
  assert.equal(guest.messages.length, 0);

  const extension = createGuest('chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html');
  assert.deepEqual(dispatch(extension, 'click', makeAnchor('https://example.com/', { target: '_blank' })), { prevented: false, stopped: false });
  assert.equal(extension.messages.length, 0);
});
