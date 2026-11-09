/**
 * Sync routes — end-to-end account sync for bookmarks, settings, history.
 * Data is stored per-user in the local Vespera data store; nothing leaves
 * the machine unless the user points Vespera at a self-hosted sync server.
 */

'use strict';

const { readJsonBody, json } = require('../lib/router');

const PARTS = new Set(['bookmarks', 'settings', 'history', 'preferences']);

function registerRoutes(router, db, authenticate) {
  router.get('/api/sync/:part', (req, res, params) => {
    const user = authenticate(req);
    if (!user) return json(res, 401, { error: 'unauthorized' });
    if (!PARTS.has(params.part)) return json(res, 400, { error: 'unknown_part' });
    const c = db.getCollection(user.id);
    return json(res, 200, { part: params.part, value: c[params.part] ?? null, updatedAt: c.updatedAt || null });
  });

  router.put('/api/sync/:part', async (req, res, params) => {
    const user = authenticate(req);
    if (!user) return json(res, 401, { error: 'unauthorized' });
    if (!PARTS.has(params.part)) return json(res, 400, { error: 'unknown_part' });
    const body = await readJsonBody(req).catch(() => null);
    if (!body || !('value' in body)) return json(res, 400, { error: 'invalid_body' });
    const value = db.setCollectionPart(user.id, params.part, body.value);
    return json(res, 200, { part: params.part, value, ok: true });
  });

  router.get('/api/sync', (req, res) => {
    const user = authenticate(req);
    if (!user) return json(res, 401, { error: 'unauthorized' });
    const c = db.getCollection(user.id);
    return json(res, 200, {
      collections: {
        bookmarks: c.bookmarks || null,
        settings: c.settings || null,
        history: c.history || null,
        preferences: c.preferences || null,
      },
      updatedAt: c.updatedAt || null,
    });
  });
}

module.exports = { registerRoutes };
