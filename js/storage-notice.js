// Small, honest, dismiss-once notice: this app sets no tracking/advertising cookies (verified —
// there is no analytics or ad script anywhere in the codebase), so there is nothing to ask consent
// for under GDPR/ePrivacy or CCPA. This exists purely for transparency about the functional
// localStorage use (favourites, staying signed in, seen-notification flags) described in
// privacy.html. Plain script, not a module — loads after the static shell so #storage-notice exists.
(function () {
  'use strict';
  var KEY = 'cd-storage-notice-seen';
  var el = document.getElementById('storage-notice');
  if (!el) return;
  try {
    if (localStorage.getItem(KEY)) return;
  } catch (e) { /* localStorage blocked — just show it; nothing to remember */ }
  el.hidden = false;
  requestAnimationFrame(function () { el.classList.add('is-shown'); });
  var ok = document.getElementById('storage-notice-ok');
  if (ok) ok.addEventListener('click', function () {
    el.classList.remove('is-shown');
    el.classList.add('is-leaving');
    try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
    setTimeout(function () { el.hidden = true; }, 220);
  });
})();
