// CrownDrive stability-first service worker.
// It unregisters itself and clears old caches so Chrome/Safari do not keep stale JS that breaks buttons after refresh.
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k=>caches.delete(k)));
    await self.clients.claim();
    await self.registration.unregister();
  })());
});
self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request, {cache:'no-store'}).catch(()=>fetch(event.request)));
});
