// CrownDrive auth-stable no-cache service worker
self.addEventListener('install', event => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    try{
      const keys=await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
      await self.clients.claim();
      await self.registration.unregister();
    }catch(e){}
  })());
});
self.addEventListener('fetch', ()=>{});
