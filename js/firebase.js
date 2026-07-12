const cfg = window.CROWNDRIVE_FIREBASE_CONFIG;
if (!cfg) throw new Error('Firebase config missing');

const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
export const auth = firebase.auth();
export const db = firebase.database();
// Defensive: if the storage-compat script ever fails to load, keep the whole app alive
// (auth + database still work) and let uploads fail gracefully instead of white-screening.
export const storage = typeof firebase.storage === 'function' ? firebase.storage() : null;

await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

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
