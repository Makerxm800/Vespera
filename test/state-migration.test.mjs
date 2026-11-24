import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://vespera.test/' });
dom.window.localStorage.setItem('vespera.settings', JSON.stringify({
  shields: { enabled: false, antiFingerprint: true },
  askDownloadLocation: false,
}));

const setGlobal = (name, value) => {
  try { globalThis[name] = value; }
  catch { Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); }
};
setGlobal('window', dom.window);
setGlobal('document', dom.window.document);
setGlobal('localStorage', dom.window.localStorage);
setGlobal('navigator', dom.window.navigator);
setGlobal('fetch', globalThis.fetch);

const { state } = await import('../src/renderer/js/state.js');

test('legacy nonfunctional fingerprint setting is removed without resetting other preferences', () => {
  assert.equal(state.settings.shields.enabled, false);
  assert.equal(state.settings.shields.blockTrackers, true, 'missing shield fields retain their defaults');
  assert.equal(state.settings.askDownloadLocation, false, 'existing download preference is preserved');
  assert.equal(Object.hasOwn(state.settings.shields, 'antiFingerprint'), false);

  state.saveSettings();
  const saved = JSON.parse(dom.window.localStorage.getItem('vespera.settings'));
  assert.equal(Object.hasOwn(saved.shields, 'antiFingerprint'), false, 'migration is persisted on the next save');
});

test.after(() => dom.window.close());
