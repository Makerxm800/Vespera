import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://vespera.test/' });
const { window } = dom;
const setGlobal = (name, value) => {
  try { globalThis[name] = value; }
  catch { Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); }
};
setGlobal('window', window);
setGlobal('document', window.document);
setGlobal('location', window.location);
setGlobal('navigator', window.navigator);
setGlobal('localStorage', window.localStorage);
setGlobal('matchMedia', window.matchMedia?.bind(window) || (() => ({ matches: false })));
setGlobal('fetch', window.fetch?.bind(window) || globalThis.fetch);

const { platform } = await import('../src/renderer/js/platform.js');

function makeIframe(reply) {
  const contentWindow = {
    postMessage(message) {
      if (reply) reply(message, this);
    },
  };
  const frame = { tagName: 'IFRAME', contentWindow };
  const view = { querySelector: (selector) => selector === '.content-frame' ? frame : null };
  return { view, frame, contentWindow };
}
function sendPreview(id, image, source) {
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { type: 'vespera:preview', id, image },
    source,
  }));
}

test('Tauri proxy iframe returns a validated preview image to its requesting tab', async () => {
  let requestId = '';
  const { view, contentWindow } = makeIframe((message, source) => {
    requestId = message.id;
    assert.equal(message.type, 'vespera:capture-preview');
    // Ignore a forged message from another frame, then deliver the real reply.
    sendPreview(requestId, 'data:image/jpeg;base64,Zm9yZ2Vk', {});
    setTimeout(() => sendPreview(requestId, 'data:image/jpeg;base64,cHJldmlldw==', source), 0);
  });

  const image = await platform.capturePreview(view);
  assert.match(requestId, /^[a-z0-9]+-[a-z0-9]+$/);
  assert.equal(image, 'data:image/jpeg;base64,cHJldmlldw==');
  assert.equal(contentWindow, view.querySelector('.content-frame').contentWindow);
});

test('Tauri proxy iframe rejects non-image preview payloads', async () => {
  const { view } = makeIframe((message, source) => {
    setTimeout(() => sendPreview(message.id, '<img src=x onerror=alert(1)>', source), 0);
  });
  assert.equal(await platform.capturePreview(view), null);
});

test('Tauri proxy iframe capture times out when a page does not reply', async () => {
  const { view } = makeIframe(() => {});
  const started = Date.now();
  assert.equal(await platform.capturePreview(view), null);
  assert.ok(Date.now() - started >= 2700, 'host stops waiting after its bounded preview timeout');
});

test.after(() => dom.window.close());
