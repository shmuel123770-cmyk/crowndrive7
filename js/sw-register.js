// Service-worker registration, in an EXTERNAL file so it satisfies CSP `script-src 'self'` (the old
// inline <script> in index.html was blocked by CSP — which also disabled the auto-recovery below).
if ('serviceWorker' in navigator) {
  // Auto-recover from a stale cached version: when a NEW service worker takes control (i.e. a deploy
  // happened), reload ONCE so the user immediately runs the fresh code instead of an old cached bundle.
  // Guarded so it never loops and never reloads on the very first install.
  var hadController = !!navigator.serviceWorker.controller, swRefreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (swRefreshing || !hadController) return;
    swRefreshing = true;
    location.reload();
  });
  addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
}
