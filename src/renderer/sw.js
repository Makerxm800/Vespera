/** App-shell cache only. Never cache website proxy responses, accounts, or sync APIs. */
const CACHE = 'vespera-shell-v6';
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/styles/tab-settings.css', '/styles/default-browser.css', '/assets/icon-256.png', '/assets/icon-512.png'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('vespera-shell-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/proxy') || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') return (await caches.match('/index.html')) || Response.error();
      return Response.error();
    })
  );
});
