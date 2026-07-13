/* CrownDrive service worker — anti-staleness edition.
   The site kept getting "stuck on an old version" because versioned assets (app.js/app.css) were
   served cache-first. Now EVERYTHING is NETWORK-FIRST: the browser always gets the freshest code on
   every load, and this cache is used ONLY as an offline fallback. It never stores anything that would
   make a user re-enter their email/password — the login lives in Firebase's own IndexedDB, separate
   from this cache — so users stay signed in in the same browser regardless of what happens here. */
const CACHE = 'crowndrive-2026-07-13-v14';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));  // purge old caches
  await self.clients.claim();
})()));

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // never touch API writes (POST)
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;             // Firebase / fonts go straight to network

  // Network-first for EVERYTHING, capped at 6s. A fresh deploy is therefore picked up immediately
  // (no more "stuck on the old version"); the cache/app-shell is used only when the network is
  // slow or the device is offline.
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
