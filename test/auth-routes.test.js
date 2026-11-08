'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.VESPERA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'vespera-auth-routes-'));
const { createServer } = require('../server/server');

async function request(base, route, { method = 'GET', token, body } = {}) {
  const res = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
function close(server) {
  return new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); });
}

test('personal account registration, login, session revocation and sync work end to end', async () => {
  const service = await createServer({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${service.port}`;
  try {
    const weak = await request(base, '/api/auth/register', { method: 'POST', body: { email: 'weak@example.com', password: 'short' } });
    assert.equal(weak.status, 400);

    const registered = await request(base, '/api/auth/register', { method: 'POST', body: { email: 'Person@Example.com', password: 'correct-horse-battery', displayName: 'Person' } });
    assert.equal(registered.status, 201);
    assert.equal(registered.body.user.email, 'person@example.com');
    assert.equal(registered.body.user.passwordHash, undefined);
    assert.ok(registered.body.token);

    const duplicate = await request(base, '/api/auth/register', { method: 'POST', body: { email: 'person@example.com', password: 'correct-horse-battery' } });
    assert.equal(duplicate.status, 409);

    const badLogin = await request(base, '/api/auth/login', { method: 'POST', body: { email: 'person@example.com', password: 'wrong-password' } });
    assert.equal(badLogin.status, 401);
    const login = await request(base, '/api/auth/login', { method: 'POST', body: { email: 'person@example.com', password: 'correct-horse-battery' } });
    assert.equal(login.status, 200);
    const first = registered.body.token, second = login.body.token;
    assert.notEqual(first, second);
    assert.equal((await request(base, '/api/auth/me', { token: first })).status, 200);

    const synced = await request(base, '/api/sync/bookmarks', { method: 'PUT', token: second, body: { value: { items: [{ title: 'Vespera', url: 'https://github.com/Makerxm800/Vespera-beta' }] } } });
    assert.equal(synced.status, 200);
    const pulled = await request(base, '/api/sync', { token: second });
    assert.equal(pulled.body.collections.bookmarks.items[0].title, 'Vespera');

    const logout = await request(base, '/api/auth/logout', { method: 'POST', token: second, body: { all: false } });
    assert.equal(logout.status, 200);
    assert.equal((await request(base, '/api/auth/me', { token: second })).status, 401);
    assert.equal((await request(base, '/api/auth/me', { token: first })).status, 200, 'normal sign-out must not revoke other devices');

    const changed = await request(base, '/api/auth/profile', { method: 'PATCH', token: first, body: { password: 'new-correct-horse' } });
    assert.equal(changed.status, 200);
    assert.ok(changed.body.token);
    assert.equal((await request(base, '/api/auth/me', { token: first })).status, 401, 'password change revokes old sessions');
    assert.equal((await request(base, '/api/auth/me', { token: changed.body.token })).status, 200);

    const everywhere = await request(base, '/api/auth/logout', { method: 'POST', token: changed.body.token, body: { all: true } });
    assert.equal(everywhere.status, 200);
    assert.equal((await request(base, '/api/auth/me', { token: changed.body.token })).status, 401);
  } finally {
    await close(service.server);
  }
});
