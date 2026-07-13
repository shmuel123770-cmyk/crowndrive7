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
  addEventListener('load', function () {
    // updateViaCache:'none' → the browser NEVER serves sw.js from its HTTP cache, so a new worker is
    // always detected. Then force an immediate update check so a device on old code heals right away
    // (and re-check every time the tab regains focus).
    navigator.serviceWorker.register('/sw.js', {updateViaCache: 'none'}).then(function (reg) {
      reg.update().catch(function () {});
      document.addEventListener('visibilitychange', function () { if (!document.hidden) reg.update().catch(function () {}); });
    }).catch(function () {});
  });
}
