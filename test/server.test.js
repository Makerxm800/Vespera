'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

// Isolate user data from the dev repo's ./data
process.env.VESPERA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'vespera-srv-'));

const { createServer } = require('../server/server');

function close(server) {
  return new Promise((resolve) => {
    // Drop keep-alive sockets (e.g. from fetch) or close() waits forever.
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(resolve);
  });
}

/** Find a block of `count` consecutive free ports; occupy them; return info. */
async function occupyBlock(count) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const base = 40000 + Math.floor(Math.random() * 20000);
    const blockers = [];
    let ok = true;
    for (let p = base; p < base + count; p++) {
      const s = net.createServer();
      try {
        await new Promise((resolve, reject) => {
          s.once('error', reject);
          s.listen(p, '127.0.0.1', resolve);
        });
        blockers.push(s);
      } catch {
        ok = false;
        break;
      }
    }
    if (ok) return { base, blockers };
    for (const s of blockers) await close(s);
  }
  throw new Error('could not find a free port block');
}

test('server falls back to the next free port instead of crashing (EADDRINUSE)', async () => {
  const { base, blockers } = await occupyBlock(1);
  try {
    // Preferred port `base` is busy — server must land on base+1.
    const s = await createServer({ port: base, host: '127.0.0.1', maxPortRetries: 5 });
    assert.equal(s.port, base + 1, 'fallback should pick the next port');
    await close(s.server);
  } finally {
    for (const b of blockers) await close(b);
  }
});

test('server rejects (not crashes) when no port in range is free', async () => {
  const { base, blockers } = await occupyBlock(3);
  try {
    await assert.rejects(
      createServer({ port: base, host: '127.0.0.1', maxPortRetries: 2 }),
      (err) => err.code === 'EADDRINUSE'
    );
  } finally {
    for (const b of blockers) await close(b);
  }
});

test('server responds on the resolved port', async () => {
  const s = await createServer({ port: 0, host: '127.0.0.1', maxPortRetries: 5 });
  const res = await fetch(`http://127.0.0.1:${s.port}/api/health`);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.app, 'vespera');
  await close(s.server);
});
