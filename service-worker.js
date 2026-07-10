const CACHE_NAME = 'crowndrive-v1';
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).catch(() => null));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/.netlify/functions/')) return;
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(res => {
    const clone = res.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)).catch(() => null);
    return res;
  }).catch(() => caches.match(event.request).then(cached => cached || caches.match('/index.html'))));
});
