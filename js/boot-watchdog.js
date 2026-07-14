/* Boot watchdog (adapted from the Codex rev51_FIXED build). A tiny, dependency-free guard that turns a
   dead loading spinner into a helpful, retryable message when the app can't start — e.g. the Firebase CDN
   is blocked (in-app browsers / strict networks) or a module fails to load. It registers BEFORE the Firebase
   scripts so it can see their load errors, and the app cancels it via window.__CD_BOOT_READY__() on first
   paint, so this only ever shows on a genuine boot failure. */
(function () {
  'use strict';
  var finished = false;
  var timer = null;

  function showFailure() {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    var app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = '<section class="boot-failure" role="alert"><h1>לא הצלחנו לטעון את האתר</h1><p>ייתכן שהחיבור לרשת אינו יציב או ששירות ההתחברות נחסם (למשל בדפדפן פנימי של אפליקציה). נסו שוב — אין צורך למחוק נתונים.</p><button type="button" id="boot-retry">ניסיון נוסף</button></section>';
    var retry = document.getElementById('boot-retry');
    if (retry) retry.addEventListener('click', function () { window.location.reload(); });
  }

  // A resource-load error is NOT a normal JS exception — listen in the capture phase so this fires even when
  // the Firebase CDN (or the app module) never ran.
  window.addEventListener('error', function (event) {
    var target = event && event.target;
    if (target && target.tagName === 'SCRIPT') showFailure();
  }, true);

  // The app calls this on its first successful paint to stand the watchdog down.
  window.__CD_BOOT_READY__ = function () {
    finished = true;
    if (timer) clearTimeout(timer);
  };

  timer = setTimeout(showFailure, 15000);
}());
