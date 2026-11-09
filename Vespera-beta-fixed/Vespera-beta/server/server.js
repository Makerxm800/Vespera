/**
 * Vespera server — serves the browser shell UI and its local API.
 *
 * Modes:
 *   `npm run preview`  → standalone on PORT (default 4600)
 *   inside Electron    → started by the main process on 127.0.0.1
 *
 * The API powers accounts, sync, and the community voting board.
 * The /proxy endpoint lets the web-preview embed real websites.
 */

'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const { Router, json, serveStatic } = require('./lib/router');
const { Store } = require('./lib/db');
const { registerRoutes: registerAuth } = require('./routes/auth');
const { registerRoutes: registerSync } = require('./routes/sync');
const { registerRoutes: registerCommunity } = require('./routes/community');
const { handleProxy, fetchRemote } = require('./lib/proxy');
const { extractArticle } = require('./lib/reader');
const { version } = require('../package.json');
const { defaultRules } = require('../src/shared/blocklists');

const ROOT = path.resolve(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');

/** Where user data lives. In the packaged desktop app the Electron main
 *  process points this at the OS userData folder (writable); in dev it
 *  defaults to ./data in the repo. */
function dataDir() {
  return process.env.VESPERA_DATA || path.join(ROOT, 'data');
}

function loadSecret() {
  const dir = dataDir();
  const file = path.join(dir, 'secret.key');
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  } catch { /* fall through */ }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

/**
 * Listen with graceful EADDRINUSE fallback: if the preferred port is taken
 * (second Vespera instance, or another app), walk up to the next free port
 * instead of crashing the process. Rejects only when the whole range is busy.
 */
function listenWithFallback(server, port, host, maxRetries) {
  return new Promise((resolve, reject) => {
    let retries = maxRetries;
    const tryPort = (p) => {
      const onError = (err) => {
        if (err.code === 'EADDRINUSE' && retries > 0) {
          retries -= 1;
          console.warn(`[vespera] port ${p} is busy — trying ${p + 1}`);
          tryPort(p + 1);
        } else {
          reject(err);
        }
      };
      server.once('error', onError);
      server.listen(p, host, () => {
        server.removeListener('error', onError);
        resolve(server.address().port);
      });
    };
    tryPort(port);
  });
}

function createServer({ port = Number(process.env.PORT) || 4600, host = '0.0.0.0', maxPortRetries = 10 } = {}) {
  const db = new Store(path.join(dataDir(), 'db.json'));
  const secret = loadSecret();
  const router = new Router();

  const { authenticate } = registerAuth(router, db, secret);
  registerSync(router, db, authenticate);
  registerCommunity(router, db, authenticate);

  // Filter list endpoint — the renderer gets the exact same rules the
  // Electron session uses, so shield counts always match reality.
  router.get('/api/filters', (req, res) => {
    return json(res, 200, {
      rules: defaultRules(),
      generatedAt: new Date().toISOString(),
    });
  });

  router.get('/api/health', (req, res) => json(res, 200, {
    ok: true, app: 'vespera', version,
    previewRestricted: Boolean(process.env.VESPERA_PROXY_ALLOWED_HOSTS),
    allowedHosts: (process.env.VESPERA_PROXY_ALLOWED_HOSTS || '').split(',').filter(Boolean),
  }));
  router.get('/api/reader', async (req, res, params, url) => {
    try {
      const result = await fetchRemote(url.searchParams.get('url') || '');
      if (!String(result.headers['content-type'] || '').includes('html')) return json(res, 415, { error: 'not_html', message: 'Reader View needs an article page.' });
      return json(res, 200, extractArticle(result.body.toString('utf8'), result.finalUrl));
    } catch (err) { return json(res, 502, { error: 'reader_failed', message: err.message }); }
  });

  // Proxy for the web-preview path (external sites).
  router.add('GET', '/proxy', (req, res, params, url) => handleProxy(req, res, url));

  const server = http.createServer((req, res) => {
    // Accept any Host header so live previews (proxied domains) work.
    let url;
    try { url = new URL(req.url, 'http://' + (req.headers.host || 'localhost')); }
    catch { res.writeHead(400); return res.end('Bad request'); }

    // Basic security headers for our own UI.
    res.setHeader('x-content-type-options', 'nosniff');

    if (url.pathname.startsWith('/api/') || url.pathname === '/proxy') {
      return router.handle(req, res, url).catch((err) => {
        console.error('[vespera-api]', err);
        json(res, 500, { error: 'internal' });
      });
    }

    // Shared ESM modules live outside the renderer root and must never receive SPA HTML.
    if (url.pathname.startsWith('/shared/')) {
      try { return serveStatic(req, res, path.join(ROOT, 'src', 'shared'), url.pathname.slice('/shared'.length), false); }
      catch { res.writeHead(400); return res.end('Bad request'); }
    }

    // Static renderer files (SPA fallback for convenience).
    try {
      return serveStatic(req, res, RENDERER, url.pathname, false);
    } catch { res.writeHead(400); return res.end('Bad request'); }
  });

  return new Promise((resolve, reject) => {
    listenWithFallback(server, port, host, maxPortRetries).then((actualPort) => {
      console.log(`\n  Vespera server running → http://${host}:${actualPort}`);
      console.log(`  UI: /   API: /api   Proxy: /proxy?url=...\n`);
      resolve({ server, db, port: actualPort, secret });
    }, reject);
  });
}

if (require.main === module) {
  createServer().catch((err) => {
    console.error('Failed to start Vespera server:', err);
    process.exit(1);
  });
}

module.exports = { createServer };
