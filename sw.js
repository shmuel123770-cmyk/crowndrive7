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
  // Force any page still running OLD cached code to reload itself onto the fresh code the instant
  // this worker takes over — so users NEVER have to clear their cache by hand. Runs once per update.
  try {
    const windows = await self.clients.matchAll({type: 'window'});
    for (const client of windows) client.navigate(client.url);
  } catch (error) { /* older browsers: they'll just get fresh code on their next navigation */ }
})()));

// NO 'fetch' handler on purpose → the browser always fetches the freshest code from the network,
// and this service worker never stores a single response.
