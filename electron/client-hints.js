/** User-Agent Client Hints consistency for Google sign-in.
 *
 * Electron brands outgoing UA-CH headers as plain "Chromium" while the
 * user-agent string says "Chrome/130". Real Chrome always sends its own
 * brand, and Google's account risk check compares the two — a Chrome UA
 * with a Chromium-only sec-ch-ua is a mismatch no stock Chrome produces.
 *
 * `rewriteClientHints` inserts the Google Chrome brand (same version as the
 * Chromium entry) into `sec-ch-ua` and `sec-ch-ua-full-version-list`.
 * It is called from the session's single onBeforeSendHeaders hook
 * (privacy.js) — Electron allows only one listener per webRequest event.
 */
'use strict';

function headerKey(headers, name) {
  return Object.keys(headers).find((k) => k.toLowerCase() === name);
}

/** Insert `"Google Chrome";v="<version>"` right after the Chromium entry. */
function addChromeBrand(value) {
  if (!value || /"Google Chrome"/i.test(value)) return value;
  // sec-ch-ua uses the major version, full-version-list the complete one.
  const m = value.match(/"Chromium";v="([\d.]+)"/i);
  if (!m) return value;
  return value.replace(/("Chromium";v="[\d.]+")/i, `$1, "Google Chrome";v="${m[1]}"`);
}

function rewriteClientHints(headers) {
  const uaKey = headerKey(headers, 'sec-ch-ua');
  if (uaKey) headers[uaKey] = addChromeBrand(headers[uaKey]);
  const listKey = headerKey(headers, 'sec-ch-ua-full-version-list');
  if (listKey) headers[listKey] = addChromeBrand(headers[listKey]);
  return headers;
}

module.exports = { rewriteClientHints, addChromeBrand };
