// CrownDrive: legacy caching service worker neutralized.
// Older deploys registered this file as a caching SW, which could keep returning
// browsers stuck on a stale app after a refresh. This version caches nothing and
// unregisters itself so any client still pointing here cleans up on its next update.
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      await self.clients.claim();
      await self.registration.unregister();
    } catch (e) {}
  })());
});
self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => fetch(event.request)));
});
