'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const perms = require('../electron/permissions');

test('fullscreen and clipboard copy work without prompting, even in private windows', () => {
  for (const privateMode of [false, true]) {
    assert.equal(perms.decide({ permission: 'fullscreen', origin: 'https://www.youtube.com', privateMode }), 'allow');
    assert.equal(perms.decide({ permission: 'clipboard-sanitized-write', origin: 'https://a.com', privateMode }), 'allow');
  }
});

test('camera, location and notifications ask first; unknown permissions are denied', () => {
  for (const permission of ['media', 'geolocation', 'notifications']) assert.equal(perms.decide({ permission, origin: 'https://a.com' }), 'ask');
  assert.equal(perms.decide({ permission: 'midi', origin: 'https://a.com' }), 'deny');
  assert.equal(perms.decide({ permission: 'media', origin: '' }), 'deny');
  assert.equal(perms.decide({ permission: 'media', origin: 'https://a.com', privateMode: true }), 'deny');
});

test('remembered choices and session grants are keyed by origin, not full URL', () => {
  const store = {};
  assert.ok(perms.setDecision(store, perms.originOf('https://meet.example.com/room/42?x=1'), 'media', 'allow'));
  assert.equal(perms.decide({ permission: 'media', origin: perms.originOf('https://meet.example.com/other'), remembered: store }), 'allow');
  assert.equal(perms.decide({ permission: 'media', origin: 'https://evil.example.com', remembered: store }), 'ask');
  perms.setDecision(store, 'https://a.com', 'geolocation', 'deny');
  assert.equal(perms.decide({ permission: 'geolocation', origin: 'https://a.com', remembered: store }), 'deny');
  assert.equal(perms.decide({ permission: 'notifications', origin: 'https://a.com', sessionGranted: new Set(['https://a.com|notifications']) }), 'allow');
});

test('store validation drops junk and reset clears everything', () => {
  const store = perms.normalizeStore({ 'https://ok.com': { media: 'allow', fullscreen: 'allow', geolocation: 'maybe' }, 'file:///x': { media: 'allow' }, bad: 1 });
  assert.deepEqual(store, { 'https://ok.com': { media: 'allow' } });
  assert.equal(perms.setDecision(store, 'not a url', 'media', 'allow'), false);
  assert.deepEqual(perms.summarize(store), [{ origin: 'https://ok.com', permission: 'media', verdict: 'allow' }]);
  perms.reset(store); assert.deepEqual(perms.summarize(store), []);
});
