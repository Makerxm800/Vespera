/**
 * Vespera Data Store — a tiny, atomic, JSON-file database.
 *
 * Zero dependencies: persists to data/db.json via atomic temp-file rename.
 * Good enough for local-first single-user/multi-user on one machine, and for
 * the bundled community server. Swap for SQLite/Postgres when self-hosting.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_DB = {
  users: [],            // {id, email, displayName, passwordHash, salt, tokenVersion, createdAt, isAdmin, avatarHue}
  collections: {},      // userId -> {bookmarks: {...}, settings: {...}, history: {...}}
  requests: [],         // community feature requests
  votes: {},            // requestId -> {userId: +1|-1}
  comments: [],         // {id, requestId, userId, authorName, body, createdAt}
  revokedTokens: {},    // token id -> expiry timestamp
  meta: { version: 1 },
};

class Store {
  constructor(file) {
    this.file = file;
    this.data = structuredClone(DEFAULT_DB);
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = { ...structuredClone(DEFAULT_DB), ...raw };
      } else {
        this.save();
      }
    } catch (err) {
      console.error('[vespera-db] failed to load, starting fresh:', err.message);
      this.data = structuredClone(DEFAULT_DB);
    }
  }

  save() {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = this.file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    const now = Date.now();
    for (const [id, exp] of Object.entries(this.data.revokedTokens || {})) if (!exp || exp < now) delete this.data.revokedTokens[id];
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file); // atomic on POSIX
  }

  // ---- users -------------------------------------------------------------
  findUserByEmail(email) {
    const e = String(email || '').toLowerCase().trim();
    return this.data.users.find((u) => u.email === e) || null;
  }

  findUserById(id) {
    return this.data.users.find((u) => u.id === id) || null;
  }

  createUser({ email, displayName, passwordHash, salt, avatarHue }) {
    const user = {
      id: 'u_' + crypto.randomBytes(9).toString('base64url'),
      email: String(email).toLowerCase().trim(),
      displayName: displayName || String(email).split('@')[0],
      passwordHash, salt,
      tokenVersion: 1,
      avatarHue: avatarHue == null ? Math.floor(Math.random() * 360) : avatarHue,
      isAdmin: this.data.users.length === 0, // first account gets community moderation
      createdAt: new Date().toISOString(),
    };
    this.data.users.push(user);
    this.data.collections[user.id] = { bookmarks: { items: [] }, settings: {}, history: { items: [] } };
    this.save();
    return user;
  }

  updateUser(id, patch) {
    const u = this.findUserById(id);
    if (!u) return null;
    Object.assign(u, patch);
    this.save();
    return u;
  }

  bumpTokenVersion(id) {
    const u = this.findUserById(id);
    if (u) { u.tokenVersion = (u.tokenVersion || 1) + 1; this.save(); }
    return u;
  }

  revokeToken(id, expiresAt) {
    if (!id) return;
    this.data.revokedTokens ||= {};
    this.data.revokedTokens[id] = Number(expiresAt) || Date.now() + 30 * 24 * 60 * 60 * 1000;
    this.save();
  }

  isTokenRevoked(id) {
    return Boolean(id && this.data.revokedTokens?.[id]);
  }

  // ---- sync collections --------------------------------------------------
  getCollection(userId) {
    if (!this.data.collections[userId]) {
      this.data.collections[userId] = { bookmarks: { items: [] }, settings: {}, history: { items: [] } };
    }
    return this.data.collections[userId];
  }

  setCollectionPart(userId, part, value) {
    const c = this.getCollection(userId);
    c[part] = value;
    c.updatedAt = new Date().toISOString();
    this.save();
    return c[part];
  }

  // ---- community ---------------------------------------------------------
  listRequests() {
    return this.data.requests.map((r) => ({
      ...r,
      score: this.voteScore(r.id),
      myVote: 0,
    }));
  }

  getRequest(id) {
    return this.data.requests.find((r) => r.id === id) || null;
  }

  createRequest({ title, body, category, authorId, authorName }) {
    const req = {
      id: 'r_' + crypto.randomBytes(8).toString('base64url'),
      title, body,
      category: category || 'idea',
      status: 'open', // open | planned | in-progress | shipped
      authorId, authorName,
      createdAt: new Date().toISOString(),
    };
    this.data.requests.push(req);
    this.save();
    return req;
  }

  setRequestStatus(id, status) {
    const r = this.getRequest(id);
    if (r) { r.status = status; this.save(); }
    return r;
  }

  deleteRequest(id) {
    this.data.requests = this.data.requests.filter((r) => r.id !== id);
    delete this.data.votes[id];
    this.data.comments = this.data.comments.filter((c) => c.requestId !== id);
    this.save();
  }

  vote(requestId, userId, value) {
    if (!this.data.votes[requestId]) this.data.votes[requestId] = {};
    const current = this.data.votes[requestId][userId];
    if (current === value) delete this.data.votes[requestId][userId]; // toggle off
    else this.data.votes[requestId][userId] = value;
    this.save();
    return this.data.votes[requestId][userId] || 0;
  }

  voteScore(requestId) {
    const v = this.data.votes[requestId] || {};
    return Object.values(v).reduce((a, b) => a + b, 0);
  }

  userVote(requestId, userId) {
    return (this.data.votes[requestId] || {})[userId] || 0;
  }

  addComment({ requestId, userId, authorName, body }) {
    const c = {
      id: 'c_' + crypto.randomBytes(8).toString('base64url'),
      requestId, userId, authorName, body,
      createdAt: new Date().toISOString(),
    };
    this.data.comments.push(c);
    this.save();
    return c;
  }

  listComments(requestId) {
    return this.data.comments
      .filter((c) => c.requestId === requestId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

module.exports = { Store, DEFAULT_DB };
