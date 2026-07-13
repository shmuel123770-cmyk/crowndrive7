/* CrownDrive service worker — CACHE-FREE.
   Requirement: "keep ONLY the login in cache, nothing else." So this worker caches NOTHING.
   - The login (email/password session) is stored by Firebase in the browser's own IndexedDB —
     per-browser, NOT in this worker — so users stay signed in in the same browser.
   - No app code (HTML/JS/CSS) is ever cached here, so the site can NEVER get stuck on an old
     version. There is no 'fetch' handler, so every request goes straight to the network, fresh.
   - Every cache left behind by previous (cache-heavy) versions is wiped on activate. */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.map(key => caches.delete(key)));   // wipe EVERYTHING — nothing stays cached
  await self.clients.claim();
})()));

// NO 'fetch' handler on purpose → the browser always fetches the freshest code from the network,
// and this service worker never stores a single response.
