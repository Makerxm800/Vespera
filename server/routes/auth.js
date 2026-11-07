/**
 * Account routes — register, login, session, profile.
 * Privacy-first: passwords are scrypt-hashed, tokens are HMAC-signed and
 * stateless, and nothing is ever sent to third parties.
 */

'use strict';

const { readJsonBody, json, rateLimit } = require('../lib/router');
const { hashPassword, verifyPassword, issueToken, verifyToken, publicUser } = require('../lib/auth');

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function registerRoutes(router, db, secret) {
  const limitAuth = rateLimit({ windowMs: 60000, max: 15 });

  function authenticate(req) {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return null;
    const payload = verifyToken(token, secret);
    if (!payload) return null;
    const user = db.findUserById(payload.sub);
    if (!user || (user.tokenVersion || 1) !== payload.tv) return null;
    return user;
  }

  router.post('/api/auth/register', async (req, res) => {
    const ip = req.socket.remoteAddress || 'anon';
    if (!limitAuth('register:' + ip)) return json(res, 429, { error: 'too_many_attempts' });
    const body = await readJsonBody(req).catch(() => null);
    if (!body) return json(res, 400, { error: 'invalid_body' });

    const email = String(body.email || '').toLowerCase().trim();
    const password = String(body.password || '');
    const displayName = String(body.displayName || '').trim().slice(0, 40);

    if (!EMAIL_RX.test(email)) return json(res, 400, { error: 'invalid_email', message: 'Please enter a valid email address.' });
    if (password.length < 8) return json(res, 400, { error: 'weak_password', message: 'Password must be at least 8 characters.' });
    if (db.findUserByEmail(email)) return json(res, 409, { error: 'email_taken', message: 'An account with this email already exists.' });

    const { salt, hash } = hashPassword(password);
    const user = db.createUser({ email, displayName, passwordHash: hash, salt });
    return json(res, 201, { token: issueToken(user, secret), user: publicUser(user) });
  });

  router.post('/api/auth/login', async (req, res) => {
    const ip = req.socket.remoteAddress || 'anon';
    if (!limitAuth('login:' + ip)) return json(res, 429, { error: 'too_many_attempts' });
    const body = await readJsonBody(req).catch(() => null);
    if (!body) return json(res, 400, { error: 'invalid_body' });

    const user = db.findUserByEmail(String(body.email || ''));
    if (!user || !verifyPassword(String(body.password || ''), user.salt, user.passwordHash)) {
      return json(res, 401, { error: 'bad_credentials', message: 'Incorrect email or password.' });
    }
    return json(res, 200, { token: issueToken(user, secret), user: publicUser(user) });
  });

  router.get('/api/auth/me', (req, res) => {
    const user = authenticate(req);
    if (!user) return json(res, 401, { error: 'unauthorized' });
    return json(res, 200, { user: publicUser(user) });
  });

  router.post('/api/auth/logout', (req, res) => {
    const user = authenticate(req);
    if (user) db.bumpTokenVersion(user.id); // invalidate all tokens for this account
    return json(res, 200, { ok: true });
  });

  router.patch('/api/auth/profile', async (req, res) => {
    const user = authenticate(req);
    if (!user) return json(res, 401, { error: 'unauthorized' });
    const body = await readJsonBody(req).catch(() => ({}));
    const patch = {};
    if (body.displayName !== undefined) patch.displayName = String(body.displayName).trim().slice(0, 40) || user.displayName;
    if (body.avatarHue !== undefined) patch.avatarHue = Math.max(0, Math.min(359, Number(body.avatarHue) || 0));
    if (body.password) {
      if (String(body.password).length < 8) return json(res, 400, { error: 'weak_password' });
      const { salt, hash } = hashPassword(String(body.password));
      patch.salt = salt;
      patch.passwordHash = hash;
    }
    const updated = db.updateUser(user.id, patch);
    return json(res, 200, { user: publicUser(updated) });
  });

  return { authenticate };
}

module.exports = { registerRoutes };
