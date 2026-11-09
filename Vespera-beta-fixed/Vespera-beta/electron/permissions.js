/** Site permission rules. Pure functions so the policy can be unit-tested without Electron. */
'use strict';

/** Harmless capabilities that pages expect to just work (video fullscreen, "Copy" buttons). */
const ALWAYS_ALLOWED = new Set(['fullscreen', 'clipboard-sanitized-write']);
/** Capabilities that need an explicit user choice. */
const ASKABLE = new Set(['media', 'geolocation', 'notifications']);

function originOf(url) {
  try { const u = new URL(String(url)); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; }
}

function normalizeStore(value) {
  const store = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return store;
  for (const [origin, perms] of Object.entries(value)) {
    if (!originOf(origin) || !perms || typeof perms !== 'object') continue;
    for (const [permission, verdict] of Object.entries(perms)) {
      if (ASKABLE.has(permission) && (verdict === 'allow' || verdict === 'deny')) (store[origin] ||= {})[permission] = verdict;
    }
  }
  return store;
}

/** @returns {'allow'|'deny'|'ask'} */
function decide({ permission, origin, privateMode = false, remembered = {}, sessionGranted = new Set() }) {
  if (ALWAYS_ALLOWED.has(permission)) return 'allow';
  if (!ASKABLE.has(permission) || privateMode || !origin) return 'deny';
  const saved = remembered?.[origin]?.[permission];
  if (saved === 'allow' || saved === 'deny') return saved;
  return sessionGranted.has(origin + '|' + permission) ? 'allow' : 'ask';
}

function setDecision(store, origin, permission, verdict) {
  if (!originOf(origin) || !ASKABLE.has(permission) || !['allow', 'deny'].includes(verdict)) return false;
  (store[origin] ||= {})[permission] = verdict;
  return true;
}

function reset(store) { for (const key of Object.keys(store)) delete store[key]; }

function summarize(store) {
  return Object.entries(store).flatMap(([origin, perms]) => Object.entries(perms).map(([permission, verdict]) => ({ origin, permission, verdict })));
}

module.exports = { ALWAYS_ALLOWED, ASKABLE, originOf, normalizeStore, decide, setDecision, reset, summarize };
