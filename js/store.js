import {refs} from './firebase.js';

export const store = {
  user: null,
  profile: null,
  isAdmin: false,
  cars: {},
  bookings: {},
  payments: {},
  ratings: {},
  users: {},
  verificationStatuses: {},
  route: 'home',
  publicUnsubs: [],
  privateUnsubs: [],
};

const value = snap => snap.val() || {};
function emit(key) { window.dispatchEvent(new CustomEvent('storechange', {detail: key})); }
function listen(ref, setter, key) {
  const handler = snap => { setter(value(snap)); emit(key); };
  const onError = error => { console.error(`firebase listener ${key}`, error); emit(`${key}:error`); };
  ref.on('value', handler, onError);
  return () => ref.off('value', handler);
}

export async function startPublic() {
  if (store.publicUnsubs.length) return;
  store.publicUnsubs.push(listen(refs.cars, v => { store.cars = v; }, 'cars'));
  store.publicUnsubs.push(listen(refs.ratings, v => { store.ratings = v; }, 'ratings'));
}

export async function startPrivate(user) {
  stopPrivate();
  store.user = user;
  store.isAdmin = (await refs.admins.child(user.uid).once('value')).val() === true;

  store.privateUnsubs.push(listen(refs.users.child(user.uid), v => {
    const oldStatus = store.profile?.verification?.status || 'missing';
    store.profile = {...(v || {}), verification: {...(v?.verification || {}), status: oldStatus}};
  }, 'profile'));
  store.privateUnsubs.push(listen(refs.verificationStatus.child(user.uid), status => {
    store.profile = store.profile || {};
    store.profile.verification = {...(store.profile.verification || {}), status: status || 'missing'};
  }, 'verification-status'));

  if (store.isAdmin) {
    store.privateUnsubs.push(listen(refs.users, v => { store.users = v; }, 'users'));
    store.privateUnsubs.push(listen(refs.verificationStatus, v => { store.verificationStatuses = v; }, 'verification-statuses'));
    store.privateUnsubs.push(listen(refs.bookings, v => { store.bookings = v; }, 'bookings'));
    store.privateUnsubs.push(listen(refs.payments, v => { store.payments = v; }, 'payments'));
  } else {
    const profile = (await refs.users.child(user.uid).once('value')).val() || {};
    store.profile = profile;
    const field = profile.role === 'owner' ? 'ownerUid' : 'renterUid';
    store.privateUnsubs.push(listen(refs.bookings.orderByChild(field).equalTo(user.uid), v => { store.bookings = v; }, 'bookings'));
    store.privateUnsubs.push(listen(refs.payments.orderByChild(field).equalTo(user.uid), v => { store.payments = v; }, 'payments'));
  }
  emit('private-ready');
}

export function stopPrivate() {
  store.privateUnsubs.splice(0).forEach(unsub => unsub());
  store.user = null;
  store.profile = null;
  store.isAdmin = false;
  store.bookings = {};
  store.payments = {};
  store.users = {};
  store.verificationStatuses = {};
  emit('private-stopped');
}

export function list(obj) { return Object.entries(obj || {}).map(([id, value]) => ({id, ...value})); }
export function myRole() { return store.isAdmin ? 'admin' : store.profile?.role || null; }
export function myBookings() { return list(store.bookings); }
export function myCars() {
  const uid = store.user?.uid;
  return list(store.cars).filter(car => store.isAdmin || car.ownerUid === uid);
}
export function carRating(carId) {
  const rows = list(store.ratings).filter(r => r.type === 'car' && r.carId === carId);
  return rows.length ? rows.reduce((n, r) => n + Number(r.score || 0), 0) / rows.length : 0;
}
export function userRating(userId) {
  const rows = list(store.ratings).filter(r => r.type === 'user' && r.targetUid === userId);
  return rows.length ? rows.reduce((n, r) => n + Number(r.score || 0), 0) / rows.length : 0;
}
