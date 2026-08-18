import {refs, readViaREST} from './firebase.js';
import {firstToAnswer, createFloodTracker} from './core.js';

export const store = {
  user: null,
  profile: null,
  profileLoaded: false,
  // profileLoaded means "stop waiting"; profileKnown means "the read actually answered". They differ
  // exactly when a read fails or times out — and conflating them let the app treat "we could not
  // reach your profile" as "you have no account type yet".
  profileKnown: false,
  isAdmin: false,
  adminChecked: false,
  authSettled: false,
  publicReady: false,
  // How the catalog actually arrived: 'realtime' | 'rest' | 'failed' | null (still loading).
  // Lets the UI tell "loaded, genuinely no cars" apart from "we could not load the cars" — two very
  // different things to show a customer.
  catalogTransport: null,
  // store.cars is a MERGED view (audit #45 phase B): the public mirror (no hidden cars) + the legacy
  // public node during the transition + the signed-in user's own cars (incl. their hidden ones) + the
  // admin's full tree. Everything else in the app keeps reading store.cars as before.
  cars: {},
  publicCatalog: {},
  legacyCatalog: {},
  ownCars: {},
  adminCars: {},
  bookings: {},
  inquiries: {},
  payments: {},
  ratings: {},
  users: {},
  verificationStatuses: {},
  adminNotifications: {},
  config: {},
  reservations: {},
  userNotifications: {},
  externalRentals: {},
  // uid → {name, photoURL} for the people the signed-in user is in a conversation with.
  // users/$uid is unreadable to anyone but its owner and an admin, so this is filled by the
  // chat-people function rather than by a listener.
  chatPeople: {},
  route: 'home',
  dashTab: 'overview',  // which personal-area tab is active (shared: bottomNav in views.js + dashboard in views-app.js)
  publicUnsubs: [],
  privateUnsubs: [],
};

const value = snap => snap.val() || {};
function emit(key) { window.dispatchEvent(new CustomEvent('storechange', {detail: key})); }

// ---- Opening-flood tracking -------------------------------------------------------------------
// The owner counts the site "jumping eight times" when he opens it, and the cause is timing, not
// rendering: each listener that reports paints the screen again. On a fast connection they all land
// within a couple of hundred ms and the renderer's debounce folds them into one paint — which is why
// this was never visible while developing. On a slow phone they land SECONDS apart, every one alone,
// and every one repaints.
//
// A longer debounce cannot fix that (measured: identical paint counts), because the arrivals are
// further apart than any debounce worth having. What the renderer actually needs is to know that the
// opening flood is still in progress, so it can batch patiently until the screen is worth showing —
// and then go back to reacting immediately. That is what this counts: how many listeners registered
// during startup have yet to report for the first time.
const flood = createFloodTracker();
export const initialFloodActive = () => flood.active();
const trackListener = () => flood.track();

function listen(ref, setter, key, onErr) {
  const reported = trackListener();
  const handler = snap => { setter(value(snap)); reported(); emit(key); };
  const onError = error => { console.error(`firebase listener ${key}`, error); reported(); if (onErr) onErr(error); emit(`${key}:error`); };
  ref.on('value', handler, onError);
  return () => ref.off('value', handler);
}

// Delta listener for COLLECTIONS (a node of id → record). `on('value')` re-sends the WHOLE node on any
// child change, so with the admin subscribed to users/bookings/inquiries/payments/cars in full, one
// edit anywhere re-downloaded every record — repeatedly, for as long as the session stayed open.
// Child events carry only what actually changed.
//
// Deliberately NOT built on once('value') to detect "initial load finished": that would re-read the
// entire node and reintroduce the very download we are removing. Instead the burst of child_added
// events Firebase fires for existing children is coalesced by a short timer, so the first paint still
// happens once rather than once per record.
//
// Only for collections — listen() is still correct for scalars (e.g. verificationStatus/<uid>), where
// there are no children to iterate.
// Exported so it can be exercised against a real Firebase ref in a browser check — this sits in the
// data layer, where "the syntax is fine" is not evidence of anything.
export function listenCollection(ref, setter, key, onErr) {
  const map = {};
  let timer = null;
  const reported = trackListener();
  const onError = error => { console.error(`firebase listener ${key}`, error); reported(); if (onErr) onErr(error); emit(`${key}:error`); };
  const flush = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; setter({...map}); reported(); emit(key); }, 16);
  };
  const upsert = snap => { map[snap.key] = snap.val(); flush(); };
  const remove = snap => { delete map[snap.key]; flush(); };
  ref.on('child_added', upsert, onError);
  ref.on('child_changed', upsert, onError);
  ref.on('child_removed', remove, onError);
  // An EMPTY collection fires no child events at all, where on('value') would still deliver {} once.
  // Schedule the first flush unconditionally so a consumer always gets exactly one initial callback,
  // empty or not — anything waiting on that callback would otherwise wait forever.
  flush();
  return () => {
    if (timer) { clearTimeout(timer); timer = null; }
    ref.off('child_added', upsert); ref.off('child_changed', upsert); ref.off('child_removed', remove);
  };
}

function mergeCars() {
  store.cars = {...store.legacyCatalog, ...store.publicCatalog, ...store.ownCars, ...store.adminCars};
}

export async function startPublic() {
  if (store.publicUnsubs.length) return;
  // publicReady flips true the moment the FIRST catalog snapshot arrives OR the read fails — either
  // way the loading state is OVER, so the UI stops waiting and shows the cars (or an empty state)
  // instead of an endless skeleton.
  // PHASE B of audit #45: the public catalog comes from the server-maintained publicCars mirror
  // (hidden cars are absent from it). During the transition — mirror not yet seeded, or the locked-
  // down rules not yet published — the legacy world-readable cars node fills the gap; once cars is
  // locked its read simply fails, legacyCatalog empties, and only the mirror remains.
  // The legacy fallback is now attempted ONLY if the mirror comes back empty. Once the locked-down
  // rules are published (they are), reading `cars` as a visitor always fails — so firing it eagerly
  // cost every single page load, for every visitor, a doomed request and a console error. The safety
  // net still exists for a site whose mirror hasn't been seeded yet; it just no longer runs when
  // there is plainly nothing to rescue.
  let legacyTried = false;
  const tryLegacyCatalog = () => {
    if (legacyTried) return;
    legacyTried = true;
    store.publicUnsubs.push(listen(refs.cars, v => { store.legacyCatalog = v; mergeCars(); store.publicReady = true; }, 'cars',
      () => { store.legacyCatalog = {}; mergeCars(); if (!store.publicReady) { store.publicReady = true; } emit('cars'); }));
  };
  let catalogArrived = false;
  store.publicUnsubs.push(listen(refs.publicCars, v => {
    catalogArrived = true;
    store.catalogTransport = 'realtime';
    store.publicCatalog = v; mergeCars(); store.publicReady = true;
    if (!v || !Object.keys(v).length) tryLegacyCatalog();
  }, 'cars', () => { tryLegacyCatalog(); if (!store.publicReady) { store.publicReady = true; emit('cars'); } }));

  // WATCHDOG — this is the failure that showed customers an empty fleet.
  //
  // listen() above is ref.on('value'). When the RTDB WebSocket cannot be established (a filtered or
  // proxied network) Firebase falls back to a long-poll transport that injects <script> tags at the
  // database host; if the page CSP does not allow that host, the fallback dies too. With both
  // transports down the SDK calls NEITHER the value handler NOR the error handler — it stays silent
  // indefinitely. So tryLegacyCatalog() never runs, the error branch never runs, and app.js's own 5s
  // deadline settles the UI on "אין כרגע רכבים זמינים": a connectivity failure shown as a real answer.
  //
  // The same read over plain HTTPS, RACED AGAINST the realtime channel from the very first moment
  // rather than held back 2.5s. Waiting was a correct fix for the wrong problem: it rescued the
  // never-answers case but left the common slow case alone, and the realtime channel routinely takes
  // 1–3.5s to hand over the fleet. That is long after the page has painted, so the catalogue landed
  // while the customer was already reading — a full repaint under their eyes, which is the "the site
  // jumps when I open it" complaint. A single ~16KB GET usually answers in a few hundred ms, so the
  // fleet is there before the first look instead of arriving on top of it.
  //
  // Racing does not double the repaint: when the realtime copy lands afterwards with the same data it
  // produces byte-identical HTML, and paintApp()'s memo skips the DOM write entirely.
  const seedFromREST = async announceFailure => {
    if (catalogArrived || Object.keys(store.publicCatalog).length) return;
    try {
      const data = await readViaREST('publicCars');
      if (catalogArrived || Object.keys(store.publicCatalog).length) return;   // realtime won the race
      store.publicCatalog = data || {};
      store.catalogTransport = 'rest';
      mergeCars();
      store.publicReady = true;
      emit('cars');
    } catch (error) {
      // The EARLY attempt stays quiet on failure — realtime may still be on its way, and declaring
      // the catalogue dead at 300ms would turn a slow network into a visible error. Only the 2.5s
      // watchdog gets to announce it, which is the deadline the UI was already built around.
      if (!announceFailure) { console.warn('early catalog read over https failed — realtime may still answer', error); return; }
      // Both transports are down. Flag it so the UI can say "loading failed, try again" instead of
      // "there are no cars" — to a customer those are completely different statements.
      console.error('catalog unavailable over realtime AND rest', error);
      store.catalogTransport = 'failed';
      store.publicReady = true;
      emit('cars');
    }
  };
  seedFromREST(false);
  setTimeout(() => seedFromREST(true), 2500);
  // Read the SANITIZED public projection (carId/targetUid/type/score/review/date) — the full ratings
  // node (with authorUid + bookingId) is no longer public (audit #3).
  store.publicUnsubs.push(listen(refs.publicRatings, v => { store.ratings = v; }, 'ratings'));
  store.publicUnsubs.push(listen(refs.config, v => { store.config = v; }, 'config'));
  // Occupied date ranges per car (carId → bookingId → {startAt, endAt}; no personal data). Lets the
  // search mark a car as taken for the chosen dates instead of failing at booking time (audit #42).
  store.publicUnsubs.push(listen(refs.reservations, v => { store.reservations = v; }, 'reservations'));
}

export async function startPrivate(user) {
  stopPrivate();
  store.user = user;
  // Resilient admin-flag read: a denied OR slow read must never crash / stall the rest of
  // startPrivate — that used to strand the whole personal area on an endless "loading" spinner
  // (the profile listener below never got attached, so profileLoaded stayed false forever).
  if (user.isAnonymous) {
    // Anonymous guests (support-chat only) are never admins — skip the /admins read entirely. The rules deny
    // it, so it logged an "admin check failed" error and stalled setup for the full 6s timeout before falling through.
    store.isAdmin = false;
  } else {
    try {
      // Both transports from the start, not realtime-then-fall-back. This read is AWAITED — nothing
      // private is set up until it answers — so every second it spends is a second the personal area
      // shows nothing and then rebuilds when it finally lands.
      //
      // firstToAnswer, not Promise.race: it takes the first transport to ANSWER and ignores one that
      // merely fails, so a refused or offline read cannot settle the question as "not an admin" while
      // the other is still in flight. It rejects only once BOTH have failed, landing in the catch
      // below exactly as before. (Promise.any has these semantics but is ES2021; this site's visitors
      // are on phones of unknown vintage, and four lines cost less than an unknown.)
      store.isAdmin = await Promise.race([
        firstToAnswer(
          refs.admins.child(user.uid).once('value').then(snap => snap.val() === true),
          readViaREST(`admins/${user.uid}`).then(value => value === true),
        ),
        new Promise((_, reject) => setTimeout(() => reject(new Error('admin-check-timeout')), 6000)),
      ]);
    } catch (error) {
      // The read above goes over the realtime channel, which is exactly the transport this site has to
      // assume is blocked — it is why the catalogue and the profile both needed a plain-HTTPS escape
      // hatch. Without one here, an admin on such a network silently became a non-admin after the 6s
      // timeout: signed in correctly, but the app did not know they were an admin, so it routed them
      // by profile state and they could not reach the admin dashboard at all.
      console.warn('admin check over realtime failed — retrying over https', error);
      try {
        store.isAdmin = (await readViaREST(`admins/${user.uid}`)) === true;
      } catch (restError) {
        console.error('admin check failed over BOTH transports — continuing as non-admin', restError);
        store.isAdmin = false;
      }
    }
  }
  store.adminChecked = true;  // admin status is now known — safe to decide renter/owner vs admin

  // FIX (owner-first-session): the bookings/payments query field depends on the role,
  // but on registration the profile does not exist yet when startPrivate runs, so the
  // role was unknown and an owner got locked onto the renterUid query. This subscribes
  // by the current role and re-subscribes once the real role arrives via the profile listener.
  let ownFeedUnsubs = [];
  let subscribedField = null;
  function subscribeOwnFeeds(role) {
    // Anonymous guests (signInGuest, used only to open support chat) have no bookings/payments/inquiries,
    // and the DB rules deny them these reads — subscribing just spams permission_denied in the console. Skip.
    if (user.isAnonymous) return;
    const field = role === 'owner' ? 'ownerUid' : 'renterUid';
    if (subscribedField === field) return;
    subscribedField = field;
    ownFeedUnsubs.splice(0).forEach(unsub => unsub());
    ownFeedUnsubs = [
      listen(refs.bookings.orderByChild(field).equalTo(user.uid), v => { store.bookings = v; }, 'bookings'),
      listen(refs.payments.orderByChild(field).equalTo(user.uid), v => { store.payments = v; }, 'payments'),
      // Pre-booking inquiries (renter↔owner about a car, no booking): a renter sees ones they started
      // (renterUid), an owner sees ones about their cars (ownerUid) — same role-field split as bookings.
      listen(refs.inquiries.orderByChild(field).equalTo(user.uid), v => { store.inquiries = v; }, 'inquiries'),
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
      store.profileKnown = true;   // ...and it is a real answer, so an empty role really is empty
      if (!store.isAdmin) subscribeOwnFeeds(store.profile.role);
      emit('profile');
    };
    // A failed read is NOT an empty profile. Leave profileKnown false so the UI offers a retry
    // instead of asking an existing user to pick an account type again.
    const onProfileError = error => { console.error('firebase listener profile', error); store.profileLoaded = true; emit('profile'); };
    profileRef.on('value', onProfile, onProfileError);
    store.privateUnsubs.push(() => profileRef.off('value', onProfile));
  }
  // Last-resort safety net: never let the personal area spin for more than a few seconds.
  //
  // CAREFUL: profileLoaded only means "stop waiting" — NOT "we know who this user is". Treating the
  // two as the same is what turned renters into owners: on a network where the realtime channel is
  // blocked this timer fired, the role looked empty, and the personal area offered "choose your
  // account type" to someone who already had one. So before giving up, read the profile over plain
  // HTTPS — the same escape hatch the catalogue uses — and only then admit we do not know.
  // ...and, like the catalogue, run that HTTPS read FROM THE START rather than only after 5s. Waiting
  // is what makes the personal area appear in stages: blank, then the profile drops in seconds later
  // and the page is rebuilt under the reader. The realtime listener stays authoritative — when it
  // answers it overwrites this seed — but on a slow channel the screen is already correct by then,
  // and paintApp()'s memo means an identical answer costs no repaint at all.
  const seedProfileFromREST = async announceFailure => {
    if (store.profileLoaded) return;
    try {
      const data = await readViaREST(`users/${user.uid}`);
      if (store.profileLoaded) return;                 // realtime won the race after all
      const oldStatus = store.profile?.verification?.status || 'missing';
      store.profile = {...(data || {}), verification: {...(data?.verification || {}), status: oldStatus}};
      store.profileKnown = true;                       // a real answer, even if the row is empty
      if (!store.isAdmin) subscribeOwnFeeds(store.profile.role);
    } catch (error) {
      // The early attempt must stay silent. profileLoaded means "stop waiting", and setting it here
      // would end the wait on a transient failure at 300ms — the personal area would show its
      // could-not-load screen while the realtime listener was still perfectly on its way.
      if (!announceFailure) { console.warn('early profile read over https failed — realtime may still answer', error); return; }
      console.error('profile unavailable over realtime AND rest', error);
      store.profileKnown = false;                      // we genuinely do not know — do not guess a role
    }
    store.profileLoaded = true;
    emit('profile');
  };
  if (!user.isAnonymous) seedProfileFromREST(false);
  setTimeout(() => seedProfileFromREST(true), 5000);
  store.privateUnsubs.push(listen(refs.verificationStatus.child(user.uid), status => {
    store.profile = store.profile || {};
    // The listen() helper coerces empty snapshots to {} — keep status a string.
    store.profile.verification = {...(store.profile.verification || {}), status: typeof status === 'string' && status ? status : 'missing'};
  }, 'verification-status'));
  // Off-site rentals the owner logged manually (rules: own node + admins). Renters just get an empty
  // set; errors degrade gracefully until the externalRentals rules are published.
  if (!user.isAnonymous) {
    store.privateUnsubs.push(listen(refs.externalRentals.child(user.uid), v => { store.externalRentals = v; }, 'external-rentals',
      () => { store.externalRentals = {}; }));
  }

  if (store.isAdmin) {
    store.privateUnsubs.push(listenCollection(refs.users, v => { store.users = v; }, 'users'));
    store.privateUnsubs.push(listenCollection(refs.verificationStatus, v => { store.verificationStatuses = v; }, 'verification-statuses'));
    store.privateUnsubs.push(listenCollection(refs.bookings, v => { store.bookings = v; }, 'bookings'));
    store.privateUnsubs.push(listenCollection(refs.inquiries, v => { store.inquiries = v; }, 'inquiries'));
    store.privateUnsubs.push(listenCollection(refs.payments, v => { store.payments = v; }, 'payments'));
    store.privateUnsubs.push(listenCollection(refs.adminNotifications.limitToLast(200), v => { store.adminNotifications = v; }, 'admin-notifications'));
    // The admin manages EVERYTHING, including hidden cars — full source-of-truth tree (audit #45 phase B).
    store.privateUnsubs.push(listenCollection(refs.cars, v => { store.adminCars = v; mergeCars(); }, 'cars'));
  } else {
    // An owner must keep seeing their OWN cars (including hidden ones) after the cars node is locked
    // to the public — the rules allow exactly this ownerUid query. Renters simply get an empty set.
    if (!user.isAnonymous) {
      store.privateUnsubs.push(listen(refs.cars.orderByChild('ownerUid').equalTo(user.uid), v => { store.ownCars = v; mergeCars(); }, 'cars'));
      // The in-app inbox: booking/payment/reserve updates for this user (server-written).
      store.privateUnsubs.push(listen(refs.userNotifications.child(user.uid).limitToLast(50), v => { store.userNotifications = v; }, 'user-notifications'));
    }
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
  store.profileKnown = false;
  store.isAdmin = false;
  store.adminChecked = false;
  store.bookings = {};
  store.inquiries = {};
  store.payments = {};
  store.users = {};
  store.verificationStatuses = {};
  // Drop the signed-in-only car sources (own hidden cars / admin full tree) from the merged catalog.
  store.ownCars = {};
  store.adminCars = {};
  store.userNotifications = {};
  store.externalRentals = {};
  mergeCars();
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
export function carRatingCount(carId) {
  return list(store.ratings).filter(r => r.type === 'car' && r.carId === carId).length;
}
export function userRating(userId) {
  const rows = list(store.ratings).filter(r => r.type === 'user' && r.targetUid === userId);
  return rows.length ? rows.reduce((n, r) => n + Number(r.score || 0), 0) / rows.length : 0;
}
