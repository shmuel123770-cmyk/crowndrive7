import {refs} from './firebase.js';

export const store = {
  user: null,
  profile: null,
  profileLoaded: false,
  isAdmin: false,
  adminChecked: false,
  authSettled: false,
  publicReady: false,
  cars: {},
  bookings: {},
  payments: {},
  ratings: {},
  users: {},
  verificationStatuses: {},
  adminNotifications: {},
  config: {},
  route: 'home',
  publicUnsubs: [],
  privateUnsubs: [],
};

const value = snap => snap.val() || {};
function emit(key) { window.dispatchEvent(new CustomEvent('storechange', {detail: key})); }
function listen(ref, setter, key, onErr) {
  const handler = snap => { setter(value(snap)); emit(key); };
  const onError = error => { console.error(`firebase listener ${key}`, error); if (onErr) onErr(error); emit(`${key}:error`); };
  ref.on('value', handler, onError);
  return () => ref.off('value', handler);
}

export async function startPublic() {
  if (store.publicUnsubs.length) return;
  // publicReady flips true the moment the cars snapshot arrives OR the read fails — either way the
  // loading state is OVER, so the UI stops waiting and shows the cars (or an empty state) instead of
  // an endless skeleton (audit: a known Firebase error must end loading, not stall the full timeout).
  store.publicUnsubs.push(listen(refs.cars, v => { store.cars = v; store.publicReady = true; }, 'cars',
    () => { if (!store.publicReady) { store.publicReady = true; emit('cars'); } }));
  // Read the SANITIZED public projection (carId/targetUid/type/score/review/date) — the full ratings
  // node (with authorUid + bookingId) is no longer public (audit #3).
  store.publicUnsubs.push(listen(refs.publicRatings, v => { store.ratings = v; }, 'ratings'));
  store.publicUnsubs.push(listen(refs.config, v => { store.config = v; }, 'config'));
}

export async function startPrivate(user) {
  stopPrivate();
  store.user = user;
  // Resilient admin-flag read: a denied OR slow read must never crash / stall the rest of
  // startPrivate — that used to strand the whole personal area on an endless "loading" spinner
  // (the profile listener below never got attached, so profileLoaded stayed false forever).
  try {
    store.isAdmin = await Promise.race([
      refs.admins.child(user.uid).once('value').then(snap => snap.val() === true),
      new Promise((_, reject) => setTimeout(() => reject(new Error('admin-check-timeout')), 6000)),
    ]);
  } catch (error) {
    console.error('admin check failed — continuing as non-admin', error);
    store.isAdmin = false;
  }
  store.adminChecked = true;  // admin status is now known — safe to decide renter/owner vs admin

  // FIX (owner-first-session): the bookings/payments query field depends on the role,
  // but on registration the profile does not exist yet when startPrivate runs, so the
  // role was unknown and an owner got locked onto the renterUid query. This subscribes
  // by the current role and re-subscribes once the real role arrives via the profile listener.
  let ownFeedUnsubs = [];
  let subscribedField = null;
  function subscribeOwnFeeds(role) {
    const field = role === 'owner' ? 'ownerUid' : 'renterUid';
    if (subscribedField === field) return;
    subscribedField = field;
    ownFeedUnsubs.splice(0).forEach(unsub => unsub());
    ownFeedUnsubs = [
      listen(refs.bookings.orderByChild(field).equalTo(user.uid), v => { store.bookings = v; }, 'bookings'),
      listen(refs.payments.orderByChild(field).equalTo(user.uid), v => { store.payments = v; }, 'payments'),
    ];
    store.privateUnsubs.push(...ownFeedUnsubs);
  }

  // Own-profile listener. profileLoaded MUST end up true whatever happens — data, an empty row, a
  // permission error, or a stalled read — otherwise dashboard() spins forever.
  {
    const profileRef = refs.users.child(user.uid);
    const onProfile = snap => {
      const v = snap.val();
      const oldStatus = store.profile?.verification?.status || 'missing';
      store.profile = {...(v || {}), verification: {...(v?.verification || {}), status: oldStatus}};
      store.profileLoaded = true;  // the real profile row (or its absence) has now arrived
      if (!store.isAdmin) subscribeOwnFeeds(store.profile.role);
      emit('profile');
    };
    const onProfileError = error => { console.error('firebase listener profile', error); store.profileLoaded = true; emit('profile'); };
    profileRef.on('value', onProfile, onProfileError);
    store.privateUnsubs.push(() => profileRef.off('value', onProfile));
  }
  // Last-resort safety net: never let the personal area spin for more than a few seconds.
  setTimeout(() => { if (!store.profileLoaded) { store.profileLoaded = true; emit('profile'); } }, 5000);
  store.privateUnsubs.push(listen(refs.verificationStatus.child(user.uid), status => {
    store.profile = store.profile || {};
    // The listen() helper coerces empty snapshots to {} — keep status a string.
    store.profile.verification = {...(store.profile.verification || {}), status: typeof status === 'string' && status ? status : 'missing'};
  }, 'verification-status'));

  if (store.isAdmin) {
    store.privateUnsubs.push(listen(refs.users, v => { store.users = v; }, 'users'));
    store.privateUnsubs.push(listen(refs.verificationStatus, v => { store.verificationStatuses = v; }, 'verification-statuses'));
    store.privateUnsubs.push(listen(refs.bookings, v => { store.bookings = v; }, 'bookings'));
    store.privateUnsubs.push(listen(refs.payments, v => { store.payments = v; }, 'payments'));
    store.privateUnsubs.push(listen(refs.adminNotifications.limitToLast(200), v => { store.adminNotifications = v; }, 'admin-notifications'));
  } else {
    try {
      const profile = (await refs.users.child(user.uid).once('value')).val() || {};
      // FIX (verification status race): merge instead of overwriting so the status already
      // delivered by the verificationStatus listener is not clobbered back to undefined.
      store.profile = {...profile, verification: {...(profile.verification || {}), status: store.profile?.verification?.status || 'missing'}};
      subscribeOwnFeeds(profile.role);
    } catch (error) { console.error('initial profile read failed — listener will cover it', error); }
  }
  emit('private-ready');
}

export function stopPrivate() {
  store.privateUnsubs.splice(0).forEach(unsub => unsub());
  store.user = null;
  store.profile = null;
  store.profileLoaded = false;
  store.isAdmin = false;
  store.adminChecked = false;
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
