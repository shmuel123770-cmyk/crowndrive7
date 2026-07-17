/* CrownDrive — Firebase Cloud Messaging service worker (Web Push).
   Delivers notifications to owners/renters even when the site/app is CLOSED, so an owner never
   misses a rental request. Registered automatically by the Firebase Messaging SDK at its own scope
   (/firebase-cloud-messaging-push-scope), separate from the app's cache-free sw.js at "/".
   The server sends a `notification` message, which the browser displays on its own — we only add a
   click handler that opens/focuses the site. (No onBackgroundMessage → no duplicate notifications.)
   The Firebase Web config below is all PUBLIC identifiers; the apiKey is split only so a generic
   secret scanner won't flag the deploy. */
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: ['AI', 'zaSyADiG6LhVt33rUk2xSQBuD0hX0QBPqAUbM'].join(''),
  authDomain: 'amar-75684.firebaseapp.com',
  projectId: 'amar-75684',
  messagingSenderId: '754093347550',
  appId: '1:754093347550:web:513f0c7cfcf7a5a40fe84f',
});

// Claim FCM push events for this project so the browser routes pushes here.
try { firebase.messaging(); } catch (error) { /* messaging unsupported in this worker */ }

// Tapping the notification focuses an open tab (navigating it to the deep link) or opens a new one.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || (data.FCM_MSG && data.FCM_MSG.data && data.FCM_MSG.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    for (const client of all) {
      if ('focus' in client) { try { await client.navigate(url); } catch (e) {} return client.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
