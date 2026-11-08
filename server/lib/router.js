/**
 * Vespera Router — minimal HTTP routing over node:http.
 * Supports JSON bodies, cookies-free Bearer auth, and static file serving.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

class Router {
  constructor() {
    /** @type {Array<{method:string, pattern:RegExp, keys:string[], handler:Function}>} */
    this.routes = [];
    this.middlewares = [];
  }

  use(fn) { this.middlewares.push(fn); }

  add(method, pattern, handler) {
    const keys = [];
    const rx = new RegExp('^' + pattern.replace(/:[a-zA-Z_]+/g, (m) => {
      keys.push(m.slice(1));
      return '([^/]+)';
    }) + '$');
    this.routes.push({ method, pattern: rx, keys, handler });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  del(p, h) { return this.add('DELETE', p, h); }

  async handle(req, res, url) {
    for (const mw of this.middlewares) {
      const done = await mw(req, res, url);
      if (done === false) return;
    }
    for (const route of this.routes) {
      if (route.method !== req.method && route.method !== 'ANY') continue;
      const m = url.pathname.match(route.pattern);
      if (!m) continue;
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return route.handler(req, res, params, url);
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  }
}

/** Read and parse a JSON request body (limit 5 MB). */
function readJsonBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body_too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

/** Serve a file from a root dir with path-traversal protection. */
function serveStatic(req, res, root, urlPath, spaFallback) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(root, safe);
  if (!file.startsWith(path.resolve(root))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (spaFallback) file = path.join(root, 'index.html');
    else { res.writeHead(404); res.end('Not found'); return; }
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=300',
  });
  fs.createReadStream(file).pipe(res);
}

/** Very small in-memory rate limiter: max N hits per window per key. */
function rateLimit({ windowMs = 60000, max = 20 } = {}) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return false;
    arr.push(now);
    hits.set(key, arr);
    return true;
  };
}

module.exports = { Router, readJsonBody, json, serveStatic, rateLimit, MIME };
