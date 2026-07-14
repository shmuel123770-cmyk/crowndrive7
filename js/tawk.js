// Tawk.to live-chat widget loader. In an EXTERNAL file so it satisfies CSP `script-src 'self'`; the
// widget script itself is fetched from embed.tawk.to (allow-listed in _headers). It stays a NO-OP until
// a property/widget id is configured, so the site works fine before the chat is set up.
//
// TO ENABLE: sign up (free) at https://tawk.to → create a property → Administration → Chat Widget →
// copy the two ids from the widget URL (…/embed.tawk.to/PROPERTY_ID/WIDGET_ID), then in firebase-config.js
// set:  window.CROWNDRIVE_TAWK = 'PROPERTY_ID/WIDGET_ID';
(function () {
  var id = window.CROWNDRIVE_TAWK;
  if (!id || !/^[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(String(id))) return;  // not configured yet → do nothing
  window.Tawk_API = window.Tawk_API || {};
  window.Tawk_LoadStart = new Date();
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://embed.tawk.to/' + id;
  s.charset = 'UTF-8';
  s.setAttribute('crossorigin', '*');
  document.head.appendChild(s);
})();
