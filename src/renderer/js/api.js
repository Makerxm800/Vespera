/** Vespera API client — talks to the bundled local server (relative /api). */

const TOKEN_KEY = 'vespera.token';
const USER_KEY = 'vespera.user';

export function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
export function getCachedUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}
export function setSession(token, user) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  const token = getToken();
  if (auth && token) headers.authorization = 'Bearer ' + token;
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: 'network', message: 'Cannot reach the Vespera service.' };
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  return { ok: res.ok, status: res.status, ...data };
}

export const auth = {
  register: (email, password, displayName) =>
    api('/api/auth/register', { method: 'POST', body: { email, password, displayName }, auth: false }),
  login: (email, password) =>
    api('/api/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  me: () => api('/api/auth/me'),
  logout: () => api('/api/auth/logout', { method: 'POST' }),
  updateProfile: (patch) => api('/api/auth/profile', { method: 'PATCH', body: patch }),
};

export const sync = {
  get: () => api('/api/sync'),
  getPart: (part) => api('/api/sync/' + part),
  putPart: (part, value) => api('/api/sync/' + part, { method: 'PUT', body: { value } }),
};

export const community = {
  list: (sort = 'votes') => api('/api/community/requests?sort=' + sort, { auth: true }),
  create: (title, body, category) =>
    api('/api/community/requests', { method: 'POST', body: { title, body, category } }),
  vote: (id, value) => api(`/api/community/requests/${id}/vote`, { method: 'POST', body: { value } }),
  comments: (id) => api(`/api/community/requests/${id}/comments`, { auth: true }),
  comment: (id, body) => api(`/api/community/requests/${id}/comments`, { method: 'POST', body: { body } }),
  setStatus: (id, status) => api(`/api/community/requests/${id}/status`, { method: 'PATCH', body: { status } }),
};
