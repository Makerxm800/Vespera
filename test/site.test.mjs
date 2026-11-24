import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');

test('standalone site points to the canonical Vespera releases and source', () => {
  assert.match(page, /<!doctype html>/i);
  assert.match(page, /Makerxm800\/Vespera\/releases\/latest/);
  assert.match(page, /Makerxm800\/Vespera\/issues/);
  assert.doesNotMatch(page, /Makerxm800\/Vespera-beta/i);
});

test('landing page download choices match published bundle types, not portable builds', () => {
  for (const suffix of [
    'x64-setup\\.exe', 'x64_en-US\\.msi', 'aarch64\\.dmg', 'x64\\.dmg', 'amd64\\.AppImage', 'amd64\\.deb',
  ]) assert.match(page, new RegExp(suffix, 'i'));
  assert.doesNotMatch(page, /portable/i);
});

test('landing page is static, local-only and accurately describes current limits', () => {
  assert.doesNotMatch(page, /<script\b/i, 'no remote script or mock toggle');
  const externalAssets = [...page.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi)]
    .map((match) => match[1]);
  assert.deepEqual(externalAssets, [], 'no remote scripts, stylesheets, or images are loaded');
  const externalLinks = [...page.matchAll(/<a\b[^>]*?\bhref=["']https?:\/\/([^/"']+)/gi)]
    .map((match) => match[1]);
  assert.ok(externalLinks.every((host) => host.toLowerCase() === 'github.com'), 'external links go only to GitHub');
  assert.match(page, /does not currently spoof or randomize browser fingerprinting signals/i);
  assert.match(page, /Chromium-based WebView2 on Windows/i);
  assert.match(page, /WKWebView on macOS/i);
  assert.match(page, /does not provide a Chrome extension runtime/i);
  assert.match(page, /sync is not end-to-end encrypted/i);
  assert.match(page, /Interface illustration · not a live browser control/);
  assert.doesNotMatch(page, /aria-pressed=/i, 'no presentation-only control is exposed as interactive');
});
