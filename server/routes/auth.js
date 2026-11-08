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

  function tokenPayload(req) {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    return token ? verifyToken(token, secret) : null;
  }

  function authenticate(req) {
    const payload = tokenPayload(req);
    if (!payload || (payload.jti && db.isTokenRevoked(payload.jti))) return null;
    const user = db.findUserById(payload.sub);
    if (!user || (user.tokenVersion || 1) !== payload.tv) return null;
    return user;
  }

  router.post('/api/auth/register', async (req, res) => {
    const ip = req.socket.remoteAddress || 'anon';
    if (!limitAuth('register:' + ip)) return json(res, 429, { error: 'too_many_attempts', message: 'Too many attempts. Please wait a minute and try again.' });
    const body = await readJsonBody(req).catch(() => null);
    if (!body) return json(res, 400, { error: 'invalid_body' });

    const email = String(body.email || '').toLowerCase().trim();
    const password = String(body.password || '');
    const displayName = String(body.displayName || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);

    if (email.length > 254 || !EMAIL_RX.test(email)) return json(res, 400, { error: 'invalid_email', message: 'Please enter a valid email address.' });
    if (password.length < 8 || password.length > 128) return json(res, 400, { error: 'weak_password', message: 'Use a password between 8 and 128 characters.' });
    if (db.findUserByEmail(email)) return json(res, 409, { error: 'email_taken', message: 'An account with this email already exists.' });

    const { salt, hash } = hashPassword(password);
    const user = db.createUser({ email, displayName, passwordHash: hash, salt });
    return json(res, 201, { token: issueToken(user, secret), user: publicUser(user) });
  });

  router.post('/api/auth/login', async (req, res) => {
    const ip = req.socket.remoteAddress || 'anon';
    if (!limitAuth('login:' + ip)) return json(res, 429, { error: 'too_many_attempts', message: 'Too many attempts. Please wait a minute and try again.' });
    const body = await readJsonBody(req).catch(() => null);
    if (!body) return json(res, 400, { error: 'invalid_body' });

    const password = String(body.password || '');
    const user = db.findUserByEmail(String(body.email || ''));
    if (password.length > 128 || !user || !verifyPassword(password, user.salt, user.passwordHash)) {
      return json(res, 401, { error: 'bad_credentials', message: 'Incorrect email or password.' });
    }
    return json(res, 200, { token: issueToken(user, secret), user: publicUser(user) });
  });

  router.get('/api/auth/me', (req, res) => {
    const user = authenticate(req);
    if (!user) return json(res, 401, { error: 'unauthorized' });
    return json(res, 200, { user: publicUser(user) });
  });

  router.post('/api/auth/logout', async (req, res) => {
    const user = authenticate(req);
    const payload = tokenPayload(req);
    const body = await readJsonBody(req).catch(() => ({}));
    if (user && body?.all === true) db.bumpTokenVersion(user.id);
    else if (user && payload?.jti) db.revokeToken(payload.jti, payload.exp);
    return json(res, 200, { ok: true, all: body?.all === true });
  });

  router.patch('/api/auth/profile', async (req, res) => {
    const user = authenticate(req);
    if (!user) return json(res, 401, { error: 'unauthorized' });
    const body = await readJsonBody(req).catch(() => ({}));
    const patch = {};
    if (body.displayName !== undefined) patch.displayName = String(body.displayName).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || user.displayName;
    if (body.avatarHue !== undefined) patch.avatarHue = Math.max(0, Math.min(359, Number(body.avatarHue) || 0));
    let changedPassword = false;
    if (body.password) {
      const password = String(body.password);
      if (password.length < 8 || password.length > 128) return json(res, 400, { error: 'weak_password', message: 'Use a password between 8 and 128 characters.' });
      const { salt, hash } = hashPassword(password);
      patch.salt = salt;
      patch.passwordHash = hash;
      changedPassword = true;
    }
    if (changedPassword) db.bumpTokenVersion(user.id);
    const updated = db.updateUser(user.id, patch);
    return json(res, 200, { user: publicUser(updated), ...(changedPassword ? { token: issueToken(updated, secret) } : {}) });
  });

  return { authenticate };
}

module.exports = { registerRoutes };
