/** Privacy-utils tests — ESM so the shared .mjs module is imported directly.
 *  Kept separate from filter-engine.test.js so every file runs on Node 20+
 *  (no top-level `test.before`, no glob CLI args). */
import test from 'node:test';
import assert from 'node:assert';
import {
  cleanTrackingParams, classifyInput, isThirdParty, buildSearchUrl, isInternal, safeTabUrl,
} from '../src/shared/privacy-utils.mjs';

test('tracking params are stripped, normal params kept', () => {
  const { url, removed } = cleanTrackingParams(
    'https://shop.example.com/item/1?utm_source=nl&utm_medium=email&color=red&size=m&fbclid=abc123');
  const u = new URL(url);
  assert.equal(u.searchParams.get('color'), 'red');
  assert.equal(u.searchParams.get('size'), 'm');
  assert.equal(u.searchParams.has('utm_source'), false);
  assert.equal(u.searchParams.has('fbclid'), false);
  assert.ok(removed.length >= 3);
});

test('classifyInput distinguishes urls, searches and internal pages', () => {
  assert.equal(classifyInput('example.com/page').kind, 'url');
  assert.equal(classifyInput('https://example.com').kind, 'url');
  assert.equal(classifyInput('how to make bread').kind, 'search');
  assert.equal(classifyInput('vespera://settings').kind, 'internal');
  assert.equal(classifyInput('about:privacy').kind, 'internal');
  assert.equal(classifyInput('localhost:3000').kind, 'url');
  assert.equal(classifyInput('javascript:alert(1)').kind, 'search');
});

test('isThirdParty compares registrable domains', () => {
  assert.equal(isThirdParty('https://cdn.example.com/x.js', 'https://www.example.com/'), false);
  assert.equal(isThirdParty('https://tracker.io/x.js', 'https://www.example.com/'), true);
});

test('search url builder defaults to startpage', () => {
  const u = buildSearchUrl('privacy browser');
  assert.ok(u.includes('startpage.com'));
  assert.ok(u.includes('privacy%20browser'));
});

test('isInternal recognizes vespera pages', () => {
  assert.equal(isInternal('vespera://welcome'), true);
  assert.equal(isInternal('https://example.com'), false);
});

test('safeTabUrl allows only opted-in local file URLs', () => {
  assert.equal(safeTabUrl('file:///tmp/notes.html'), null);
  assert.equal(safeTabUrl('file:///tmp/notes.html', { allowFile: true }), 'file:///tmp/notes.html');
  assert.equal(safeTabUrl('file://server/share/notes.html', { allowFile: true }), null);
  assert.equal(safeTabUrl('file:////server/share/notes.html', { allowFile: true }), null);
  assert.equal(safeTabUrl('file:///%2fetc/passwd', { allowFile: true }), null);
  assert.equal(safeTabUrl('file:///%5c%5cserver/share/notes.html', { allowFile: true }), null);
  assert.equal(safeTabUrl('javascript:alert(1)', { allowFile: true }), null);
});
