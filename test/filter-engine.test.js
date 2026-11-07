'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { FilterEngine } = require('../src/shared/filter-engine');
const { defaultRules } = require('../src/shared/blocklists');
const {
  cleanTrackingParams, classifyInput, isThirdParty, buildSearchUrl, isInternal,
} = require('../src/shared/privacy-utils');

function engine() {
  return new FilterEngine(defaultRules());
}

test('blocks known trackers by domain anchor', () => {
  const e = engine();
  const r = e.match('https://www.google-analytics.com/collect?v=1', 'image',
    { thirdParty: true, documentHost: 'news.example.com' });
  assert.equal(r.blocked, true);
  assert.ok(r.rule.includes('google-analytics'));
});

test('allows first-party requests not matching rules', () => {
  const e = engine();
  const r = e.match('https://news.example.com/main.css', 'stylesheet',
    { thirdParty: false, documentHost: 'news.example.com' });
  assert.equal(r.blocked, false);
});

test('exceptions allow-list matching urls', () => {
  const e = new FilterEngine([
    '||tracker.io^',
    '@@||tracker.io/allowed.js$script',
  ]);
  const blocked = e.match('https://tracker.io/blocked.js', 'script',
    { thirdParty: true, documentHost: 'site.com' });
  const allowed = e.match('https://tracker.io/allowed.js', 'script',
    { thirdParty: true, documentHost: 'site.com' });
  assert.equal(blocked.blocked, true);
  assert.equal(allowed.blocked, false);
  assert.ok(allowed.exception);
});

test('$important beats exceptions', () => {
  const e = new FilterEngine([
    '||evil.io^$important',
    '@@||evil.io^',
  ]);
  const r = e.match('https://evil.io/x', 'other', { thirdParty: true, documentHost: 'site.com' });
  assert.equal(r.blocked, true);
});

test('type options restrict matching', () => {
  const e = new FilterEngine(['||cdn.io^$script']);
  assert.equal(e.match('https://cdn.io/a.js', 'script', { thirdParty: true, documentHost: 's.com' }).blocked, true);
  assert.equal(e.match('https://cdn.io/a.png', 'image', { thirdParty: true, documentHost: 's.com' }).blocked, false);
});

test('third-party option restricts matching', () => {
  const e = new FilterEngine(['||widgets.io^$third-party']);
  assert.equal(e.match('https://widgets.io/x.js', 'script',
    { thirdParty: true, documentHost: 'site.com' }).blocked, true);
  assert.equal(e.match('https://widgets.io/x.js', 'script',
    { thirdParty: false, documentHost: 'widgets.io' }).blocked, false);
});

test('wildcards and separators work', () => {
  const e = new FilterEngine(['*/ads/banner*']);
  assert.equal(e.match('https://x.com/ads/banner1.png', 'image',
    { thirdParty: true, documentHost: 'x.com' }).blocked, true);
  assert.equal(e.match('https://x.com/news/article', 'document',
    { thirdParty: true, documentHost: 'x.com' }).blocked, false);
});

test('badfilter disables a rule', () => {
  const e = new FilterEngine(['||ads.io^', '||ads.io^$badfilter']);
  assert.equal(e.match('https://ads.io/x', 'other', { thirdParty: true, documentHost: 's.com' }).blocked, false);
});

test('cosmetic rules resolve per host with exceptions', () => {
  const e = new FilterEngine([
    '##.sponsored',
    'news.com##.sidebar-ad',
    'news.com#@#.sponsored',
  ]);
  const c = e.cosmeticFor('news.com');
  assert.ok(c.hide.includes('.sidebar-ad'));
  assert.ok(!c.hide.includes('.sponsored'), 'exception removes the hide');
});

test('domain option restricts rule to page domains', () => {
  const e = new FilterEngine(['||cdn.io^$domain=news.com']);
  assert.equal(e.match('https://cdn.io/x.js', 'script',
    { thirdParty: true, documentHost: 'www.news.com' }).blocked, true);
  assert.equal(e.match('https://cdn.io/x.js', 'script',
    { thirdParty: true, documentHost: 'other.org' }).blocked, false);
});

test('blocklist blocks real-world tracker urls', () => {
  const e = engine();
  const cases = [
    ['https://connect.facebook.net/en_US/fbevents.js', 'script', 'shop.example.com', true],
    ['https://sb.scorecardresearch.com/beacon.js', 'script', 'blog.example.com', true],
    ['https://static.hotjar.com/c/hotjar.js', 'script', 'blog.example.com', true],
    ['https://cdn.segment.com/analytics.js', 'script', 'app.example.com', true],
    ['https://assets.example.com/app.js', 'script', 'www.example.com', false],
  ];
  for (const [url, type, host, expectBlocked] of cases) {
    const r = e.match(url, type, { thirdParty: true, documentHost: host });
    assert.equal(r.blocked, expectBlocked, url + ' should be ' + (expectBlocked ? 'blocked' : 'allowed'));
  }
});

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

test('engine benchmark: 50k matches stay fast (optimized core)', () => {
  const e = engine();
  const t0 = process.hrtime.bigint();
  const url = 'https://www.google-analytics.com/collect?v=1&t=pageview';
  for (let i = 0; i < 50000; i++) {
    e.match(url, 'image', { thirdParty: true, documentHost: 'news.example.com' });
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  // Generous bound — the point is we don't scan the full list linearly per host.
  assert.ok(ms < 3000, `50k matches took ${ms.toFixed(0)}ms`);
});
