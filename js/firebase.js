const cfg = window.CROWNDRIVE_FIREBASE_CONFIG;
if (!cfg) throw new Error('Firebase config missing');

const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
export const auth = firebase.auth();
export const db = firebase.database();
// Defensive: if the storage-compat script ever fails to load, keep the whole app alive
// (auth + database still work) and let uploads fail gracefully instead of white-screening.
export const storage = typeof firebase.storage === 'function' ? firebase.storage() : null;

// Keep the session in THIS browser (localStorage — survives restarts, per-browser not per-device).
// CRITICAL: do NOT `await` this at the top level. A top-level await blocks the ENTIRE module graph,
// so if setPersistence hangs OR rejects (slow/locked/blocked storage on some devices), the whole app
// would be stuck on the loading screen forever ("loads for an hour"). Fire it and move on — Firebase's
// default persistence is already LOCAL, so the login still persists per-browser regardless.
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(error => console.warn('LOCAL persistence unavailable — using the Firebase default (still per-browser)', error));

export const refs = {
  admins: db.ref('admins'),
  users: db.ref('users'),
  verificationStatus: db.ref('verificationStatus'),
  cars: db.ref('cars'),
  bookings: db.ref('bookings'),
  inquiries: db.ref('inquiries'),
  messages: db.ref('messages'),
  ratings: db.ref('ratings'),
  publicRatings: db.ref('publicRatings'),
  payments: db.ref('payments'),
  privateUserDocuments: db.ref('privateUserDocuments'),
  privateCarDetails: db.ref('privateCarDetails'),
  adminNotifications: db.ref('adminNotifications'),
  config: db.ref('config'),
  reservations: db.ref('reservations'),
  publicCars: db.ref('publicCars'),
  userNotifications: db.ref('userNotifications'),
  externalRentals: db.ref('externalRentals'),
  legacy: db.ref('crowndrive-live/state/data'),
};

// ---------------------------------------------------------------------------
// REST escape hatch for the Realtime Database.
//
// WHY THIS EXISTS: the SDK reaches the RTDB over a WebSocket, falling back to a
// long-poll transport that works by injecting <script> tags at the database
// host. On networks that block WebSockets — content filters, corporate proxies,
// captive portals — the primary transport dies, and if the page CSP does not
// list the database host under script-src the fallback cannot load either.
// When BOTH are down, `ref.on('value')` calls NEITHER the value handler NOR the
// error handler: it hangs silently forever. Every error path built around the
// listener is then dead code, and the catalog stays empty with no signal that
// anything went wrong.
//
// Measured against the live database from such a network:
//   ref.on('value')            → no callback ever, .info/connected === false
//   GET /publicCars.json       → 200 OK, 15 records, ~60ms
//
// A plain HTTPS fetch gets through where the realtime channel does not. This is
// the last-resort safety net; the realtime subscription stays primary and keeps
// live updates working wherever it can actually connect.
// ---------------------------------------------------------------------------
export const DB_URL = String(cfg.databaseURL || '').replace(/\/+$/, '');

export async function readViaREST(path, {timeoutMs = 8000} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Send the ID token when we have one so the same call also works for nodes
    // that require auth. publicCars is world-readable, so anonymous visitors
    // (the ones this fallback exists for) succeed without a token.
    let query = '';
    const user = auth.currentUser;
    if (user) {
      try { query = '?auth=' + encodeURIComponent(await user.getIdToken()); }
      catch { /* an unavailable token must not block a public read */ }
    }
    const res = await fetch(`${DB_URL}/${path}.json${query}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`rest-${path}-${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
