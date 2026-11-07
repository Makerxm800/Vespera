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
const { handleProxy } = require('./lib/proxy');
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

function createServer({ port = Number(process.env.PORT) || 4600, host = '0.0.0.0' } = {}) {
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

  router.get('/api/health', (req, res) => json(res, 200, { ok: true, app: 'vespera', version: '0.1.0' }));

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

    // Static renderer files (SPA fallback for convenience).
    return serveStatic(req, res, RENDERER, url.pathname, true);
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      console.log(`\n  Vespera server running → http://${host}:${addr.port}`);
      console.log(`  UI: /   API: /api   Proxy: /proxy?url=...\n`);
      resolve({ server, db, port: addr.port, secret });
    });
  });
}

if (require.main === module) {
  createServer().catch((err) => {
    console.error('Failed to start Vespera server:', err);
    process.exit(1);
  });
}

module.exports = { createServer };
