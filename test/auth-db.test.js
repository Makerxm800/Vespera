'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../server/lib/db');
const {
  hashPassword, verifyPassword, issueToken, verifyToken, publicUser,
} = require('../server/lib/auth');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespera-test-'));
  return new Store(path.join(dir, 'db.json'));
}

test('password hashing: correct password verifies, wrong does not', () => {
  const { salt, hash } = hashPassword('correct-horse-battery');
  assert.equal(verifyPassword('correct-horse-battery', salt, hash), true);
  assert.equal(verifyPassword('wrong-password', salt, hash), false);
});

test('tokens round-trip and tamper detection', () => {
  const secret = 'test-secret';
  const user = { id: 'u_1', tokenVersion: 1 };
  const token = issueToken(user, secret);
  const payload = verifyToken(token, secret);
  assert.equal(payload.sub, 'u_1');
  assert.equal(verifyToken(token + 'x', secret), null);
  assert.equal(verifyToken(token, 'other-secret'), null);
});

test('expired tokens are rejected', () => {
  const secret = 's';
  const { signToken } = require('../server/lib/auth');
  const token = signToken({ sub: 'u', tv: 1, exp: Date.now() - 1000 }, secret);
  assert.equal(verifyToken(token, secret), null);
});

test('store: create user, find by email, public shape hides secrets', () => {
  const db = tmpStore();
  const { salt, hash } = hashPassword('hunter2222');
  const u = db.createUser({ email: 'A@Example.com', displayName: 'A', passwordHash: hash, salt });
  assert.equal(db.findUserByEmail('a@example.com').id, u.id);
  const pub = publicUser(u);
  assert.equal(pub.passwordHash, undefined);
  assert.equal(pub.salt, undefined);
  assert.equal(pub.email, 'a@example.com');
});

test('store: token version bump invalidates old tokens', () => {
  const db = tmpStore();
  const { salt, hash } = hashPassword('password123');
  const u = db.createUser({ email: 'x@y.z', passwordHash: hash, salt });
  const secret = 's';
  const t = issueToken(u, secret);
  assert.ok(verifyToken(t, secret));
  db.bumpTokenVersion(u.id);
  const payload = verifyToken(t, secret);
  assert.notEqual(payload.tv, db.findUserById(u.id).tokenVersion);
});

test('store: sync collections persist across reload', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespera-test-'));
  const file = path.join(dir, 'db.json');
  let db = new Store(file);
  const { salt, hash } = hashPassword('password123');
  const u = db.createUser({ email: 'a@b.c', passwordHash: hash, salt });
  db.setCollectionPart(u.id, 'bookmarks', { items: [{ title: 'Vespera', url: 'https://v.dev' }] });
  db = new Store(file); // reload from disk
  const c = db.getCollection(u.id);
  assert.equal(c.bookmarks.items[0].title, 'Vespera');
});

test('community: votes aggregate and toggle', () => {
  const db = tmpStore();
  const r = db.createRequest({ title: 'Test idea', body: 'b', authorId: 'u1', authorName: 'U' });
  db.vote(r.id, 'u1', 1);
  db.vote(r.id, 'u2', 1);
  db.vote(r.id, 'u3', -1);
  assert.equal(db.voteScore(r.id), 1);
  assert.equal(db.userVote(r.id, 'u3'), -1);
  db.vote(r.id, 'u3', -1); // toggle off
  assert.equal(db.voteScore(r.id), 2);
  assert.equal(db.userVote(r.id, 'u3'), 0);
});

test('community: comments persist and order oldest-first', () => {
  const db = tmpStore();
  const r = db.createRequest({ title: 'Idea', body: '', authorId: 'u1', authorName: 'U' });
  db.addComment({ requestId: r.id, userId: 'u1', authorName: 'U', body: 'first' });
  db.addComment({ requestId: r.id, userId: 'u2', authorName: 'V', body: 'second' });
  const comments = db.listComments(r.id);
  assert.equal(comments.length, 2);
  assert.equal(comments[0].body, 'first');
});
