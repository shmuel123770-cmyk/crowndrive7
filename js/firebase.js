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
  legacy: db.ref('crowndrive-live/state/data'),
};
