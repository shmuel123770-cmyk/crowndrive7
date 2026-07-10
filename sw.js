const CACHE_NAME='crowndrive-mobile-admin-v1';
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req=event.request;
  if(req.mode==='navigate' || req.url.endsWith('/index.html') || req.url.includes('firebase-config.js')){
    event.respondWith(fetch(req, {cache:'no-store'}).catch(()=>fetch(req)));
    return;
  }
  event.respondWith(fetch(req).catch(()=>caches.match(req)));
});
