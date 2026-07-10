// CrownDrive no-cache service worker cleanup — 2026-07-10 (fixed)
const CACHE_BUST = 'crowndrive-no-cache-20260710-fix';
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      await self.clients.claim();
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) client.postMessage({ type: 'CROWNDRIVE_SW_CLEARED', version: CACHE_BUST });
    } catch (e) {}
  })());
});
self.addEventListener('fetch', event => {
  // FIX: מטפלים רק ב-GET. בקשות POST נכשלו בניסיון החוזר כי ה-body כבר נצרך.
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => fetch(event.request)));
});
