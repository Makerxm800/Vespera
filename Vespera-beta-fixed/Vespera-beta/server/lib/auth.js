/**
 * Vespera Auth — scrypt password hashing + HMAC-signed stateless tokens.
 * Node crypto only — no third-party crypto dependencies.
 */

'use strict';

const crypto = require('node:crypto');

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt: s, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

/** Sign a payload into a compact token: base64url(json).base64url(hmac). */
function signToken(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function issueToken(user, secret) {
  return signToken(
    {
      sub: user.id,
      jti: crypto.randomBytes(12).toString('base64url'),
      tv: user.tokenVersion || 1,
      exp: Date.now() + TOKEN_TTL_MS,
      iat: Date.now(),
    },
    secret
  );
}

/** Public-safe user shape (never leaks hash/salt). */
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarHue: u.avatarHue,
    isAdmin: !!u.isAdmin,
    createdAt: u.createdAt,
  };
}

module.exports = {
  hashPassword, verifyPassword,
  signToken, verifyToken, issueToken,
  publicUser, TOKEN_TTL_MS,
};
