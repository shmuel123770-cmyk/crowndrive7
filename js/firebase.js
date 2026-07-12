const cfg = window.CROWNDRIVE_FIREBASE_CONFIG;
if (!cfg) throw new Error('Firebase config missing');

const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
export const auth = firebase.auth();
export const db = firebase.database();

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
  legacy: db.ref('crowndrive-live/state/data'),
};
