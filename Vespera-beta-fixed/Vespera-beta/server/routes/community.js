/**
 * Community routes — the Vespera feature-request voting system.
 * Anyone with an account can propose features, vote, and discuss.
 * Votes are one-per-account and toggling your vote removes it.
 */

'use strict';

const { readJsonBody, json, rateLimit } = require('../lib/router');

const CATEGORIES = new Set(['idea', 'privacy', 'performance', 'design', 'sync', 'dev']);
const STATUSES = new Set(['open', 'planned', 'in-progress', 'shipped']);

function registerRoutes(router, db, authenticate) {
  const limitPost = rateLimit({ windowMs: 60000, max: 30 });

  /** Seed a few starter requests so the board isn't empty on first run. */
  function seedIfEmpty() {
    if (db.data.requests.length > 0) return;
    const seeds = [
      {
        title: 'Vertical tabs with tab groups',
        body: 'A sidebar tab layout with color-coded groups — easier to manage 30+ tabs than a horizontal strip.',
        category: 'design', status: 'shipped', votes: 24,
      },
      {
        title: 'Per-site shield settings panel',
        body: 'Click the shield icon to see what was blocked on the current page and allowlist specific categories per site.',
        category: 'privacy', status: 'shipped', votes: 19,
      },
      {
        title: 'Built-in split view',
        body: 'Two pages side by side in one tab, great for docs + editor or comparing products.',
        category: 'idea', status: 'planned', votes: 12,
      },
      {
        title: 'End-to-end encrypted sync',
        body: 'Sync bookmarks, history and settings across devices with a passphrase-derived key the server never sees.',
        category: 'sync', status: 'in-progress', votes: 31,
      },
      {
        title: 'Reader mode with typography controls',
        body: 'Distraction-free reading mode with font, width and theme controls.',
        category: 'idea', status: 'open', votes: 8,
      },
    ];
    for (const s of seeds) {
      const r = db.createRequest({
        title: s.title, body: s.body, category: s.category,
        authorId: 'seed', authorName: 'Vespera Team',
      });
      db.setRequestStatus(r.id, s.status);
      // Synthetic votes so ordering is interesting out of the box.
      for (let i = 0; i < s.votes; i++) db.vote(r.id, 'seed_voter_' + i, 1);
    }
    db.save();
  }

  router.get('/api/community/requests', (req, res) => {
    seedIfEmpty();
    const user = authenticate(req);
    const url = new URL(req.url, 'http://localhost');
    const sort = url.searchParams.get('sort') || 'votes';
    let list = db.listRequests().map((r) => ({
      ...r,
      myVote: user ? db.userVote(r.id, user.id) : 0,
      commentCount: db.listComments(r.id).length,
    }));
    if (sort === 'new') list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else if (sort === 'status') list.sort((a, b) => a.status.localeCompare(b.status) || b.score - a.score);
    else list.sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
    return json(res, 200, { requests: list });
  });

  router.post('/api/community/requests', async (req, res) => {
    const user = authenticate(req);
    if (!user) return json(res, 401, { error: 'unauthorized', message: 'Sign in to post ideas.' });
    const ip = req.socket.remoteAddress || 'anon';
    if (!limitPost('req:' + ip)) return json(res, 429, { error: 'too_many' });
    const body = await readJsonBody(req).catch(() => null);
    if (!body || !body.title || String(body.title).trim().length < 4) {
      return json(res, 400, { error: 'title_required', message: 'Give your idea a title of at least 4 characters.' });
    }
    const r = db.createRequest({
      title: String(body.title).trim().slice(0, 120),
      body: String(body.body || '').trim().slice(0, 2000),
      category: CATEGORIES.has(body.category) ? body.category : 'idea',
      authorId: user.id,
      authorName: user.displayName,
    });
    return json(res, 201, { request: { ...r, score: 0, myVote: 0 } });
  });

  router.post('/api/community/requests/:id/vote', async (req, res, params) => {
    const user = authenticate(req);
    if (!user) return json(res, 401, { error: 'unauthorized', message: 'Sign in to vote.' });
    const r = db.getRequest(params.id);
    if (!r) return json(res, 404, { error: 'not_found' });
    const body = await readJsonBody(req).catch(() => ({}));
    const value = body.value === 1 || body.value === -1 ? body.value : 0;
    const myVote = value === 0 ? 0 : db.vote(params.id, user.id, value);
    return json(res, 200, { score: db.voteScore(params.id), myVote });
  });

  router.post('/api/community/requests/:id/comments', async (req, res, params) => {
    const user = authenticate(req);
    if (!user) return json(res, 401, { error: 'unauthorized', message: 'Sign in to comment.' });
    const r = db.getRequest(params.id);
    if (!r) return json(res, 404, { error: 'not_found' });
    const body = await readJsonBody(req).catch(() => null);
    if (!body || !String(body.body || '').trim()) return json(res, 400, { error: 'empty_comment' });
    const c = db.addComment({
      requestId: params.id, userId: user.id,
      authorName: user.displayName,
      body: String(body.body).trim().slice(0, 1000),
    });
    return json(res, 201, { comment: c });
  });

  router.get('/api/community/requests/:id/comments', (req, res, params) => {
    return json(res, 200, { comments: db.listComments(params.id) });
  });

  router.patch('/api/community/requests/:id/status', async (req, res, params) => {
    const user = authenticate(req);
    if (!user || !user.isAdmin) return json(res, 403, { error: 'forbidden' });
    const body = await readJsonBody(req).catch(() => ({}));
    if (!STATUSES.has(body.status)) return json(res, 400, { error: 'bad_status' });
    const r = db.setRequestStatus(params.id, body.status);
    if (!r) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { request: r });
  });
}

module.exports = { registerRoutes, CATEGORIES, STATUSES };
