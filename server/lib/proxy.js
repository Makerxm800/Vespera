/**
 * Vespera Preview Proxy — lets the browser shell embed arbitrary websites
 * even when the page itself forbids framing (X-Frame-Options / CSP).
 *
 * Used by the web preview (`npm run preview`) and the Electron shell's
 * fallback path. Strips frame-busting headers, injects <base>, and passes
 * the rest through. Sites can still behave oddly when framed — that's a
 * limitation of any browser-in-browser demo; the desktop app uses real
 * Chromium webviews and needs no proxy.
 */

'use strict';

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const STRIP_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-content-type-options',
  'strict-transport-security',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'content-encoding', // we decode
  'content-length',
  'transfer-encoding',
]);

function fetchRemote(targetUrl, method = 'GET', headers = {}, body = null, redirects = 5) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(targetUrl); } catch { return reject(new Error('invalid_url')); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return reject(new Error('unsupported_scheme'));

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method,
      headers: {
        'user-agent': headers['user-agent'] || 'Mozilla/5.0 (X11; Linux x86_64) Vespera/0.1',
        'accept': headers['accept'] || 'text/html,application/xhtml+xml,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'sec-gpc': '1',
        dnt: '1',
      },
      timeout: 15000,
    }, (res) => {
      // Follow redirects manually so we can rewrite relative ones.
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        return resolve(fetchRemote(next, method, headers, body, redirects - 1));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
        finalUrl: url.toString(),
      }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Rewrite an HTML document so it renders inside the Vespera proxy frame. */
function rewriteHtml(html, pageUrl) {
  const base = `<base href="${pageUrl}">`;
  const styles = `<style>
    html { scrollbar-width: thin; }
    body { margin: 0; }
  </style>`;
  let out = html.toString('utf8');
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>${base}${styles}`);
  } else {
    out = base + styles + out;
  }
  return out;
}

/**
 * Handle `GET /proxy?url=...`.
 */
async function handleProxy(req, res, url) {
  const target = url.searchParams.get('url');
  if (!target) {
    res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
    return res.end('<h3>Missing ?url=</h3>');
  }
  try {
    const result = await fetchRemote(target);
    const outHeaders = {};
    for (const [k, v] of Object.entries(result.headers)) {
      if (!STRIP_HEADERS.has(k.toLowerCase())) outHeaders[k] = v;
    }
    const ctype = String(result.headers['content-type'] || '');
    outHeaders['cache-control'] = 'no-store';
    if (ctype.includes('text/html') || ctype === '') {
      outHeaders['content-type'] = 'text/html; charset=utf-8';
      res.writeHead(result.status, outHeaders);
      res.end(rewriteHtml(result.body, result.finalUrl));
    } else {
      outHeaders['content-type'] = ctype || 'application/octet-stream';
      res.writeHead(result.status, outHeaders);
      res.end(result.body);
    }
  } catch (err) {
    res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8">
      <style>
        body{font-family:system-ui;display:grid;place-items:center;height:100vh;
             background:#0b0e1a;color:#e6e9f5;margin:0}
        .card{max-width:420px;text-align:center;padding:2.5rem;border-radius:20px;
              background:#141a2e;border:1px solid #26304d}
        h1{font-size:1.2rem;margin:0 0 .5rem}
        p{color:#9aa5c4;line-height:1.6;margin:0;font-size:.92rem}
      </style>
      <div class="card">
        <h1>Can't reach this site</h1>
        <p>${String(err.message || err)}<br><br>
        In the Vespera web preview, only certain hosts are reachable from the sandbox.
        The desktop app (<code>npm start</code>) browses the full web through Chromium.</p>
      </div>`);
  }
}

module.exports = { handleProxy, fetchRemote, rewriteHtml };
