const cfg = window.CROWNDRIVE_FIREBASE_CONFIG;
if (!cfg) throw new Error('Firebase config missing');

const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
export const auth = firebase.auth();
export const db = firebase.database();
// Defensive: if the storage-compat script ever fails to load, keep the whole app alive
// (auth + database still work) and let uploads fail gracefully instead of white-screening.
export const storage = typeof firebase.storage === 'function' ? firebase.storage() : null;

// Keep the session in THIS browser (localStorage — survives restarts, is per-browser not per-device).
// Some environments block storage (Safari Private, certain in-app browsers) and would make
// setPersistence REJECT — which, as a top-level await, used to crash the whole module and leave the
// site stuck on a blank/loading screen. Never let that happen: fall back gracefully and load anyway.
try {
  await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
} catch (error) {
  console.warn('LOCAL auth persistence unavailable — continuing with the default', error);
}

export const refs = {
  admins: db.ref('admins'),
  users: db.ref('users'),
  verificationStatus: db.ref('verificationStatus'),
  cars: db.ref('cars'),
  bookings: db.ref('bookings'),
  messages: db.ref('messages'),
  ratings: db.ref('ratings'),
  payments: db.ref('payments'),
  privateUserDocuments: db.ref('privateUserDocuments'),
  privateCarDetails: db.ref('privateCarDetails'),
  adminNotifications: db.ref('adminNotifications'),
  config: db.ref('config'),
  legacy: db.ref('crowndrive-live/state/data'),
};
