/* CrownDrive service worker — fast AND update-proof.
   Strategy:
   - HTML + non-versioned JS modules  -> network-first (always fresh; offline fallback).
     The always-current index.html decides which asset versions to load, so a deploy
     can never leave a user on a stale/mismatched bundle.
   - Versioned assets (…?v=N: app.css / app.js) -> cache-first (instant on repeat visits).
     Safe because a new deploy changes ?v=, which is a new cache key -> auto-refetch.
   - Cross-origin (Firebase SDK, fonts, storage) -> not intercepted at all.
   install does NOT pre-cache (a single 404 there would break the whole worker). */
const CACHE = 'crowndrive-2026-07-13-v13';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // never touch API writes (POST)
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;             // Firebase/fonts go straight to network

  // Versioned assets: cache-first (instant), refetched automatically when ?v= changes.
  if (url.search.includes('v=')) {
    event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  // Everything else (HTML + non-versioned JS/CSS): network-first with a 6s cap. Without the cap a
  // stalled network could hang navigation on a blank screen; with it we fall back to cache / shell.
  event.respondWith((async () => {
    try {
      const res = await Promise.race([
        fetch(req),
        new Promise((_, reject) => setTimeout(() => reject(new Error('slow-network')), 6000)),
      ]);
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    } catch (error) {
      const cached = await caches.match(req);
      return cached || (await caches.match('/index.html')) || fetch(req);
    }
  })());
});
