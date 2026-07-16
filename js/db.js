import {api} from './api.js';
import {db} from './firebase.js';
import {store, myRole} from './store.js';

// Whether a UID is a site admin (each user may read its own admins/<uid> row). Used to keep admins
// OUT of the regular personal-area login — they must use the dedicated "כניסת מנהל" entrance.
export async function checkIsAdmin(uid) {
  try { return (await db.ref(`admins/${uid}`).once('value')).val() === true; }
  catch { return false; }
}

// Maintenance toggle: write config/maintenance directly (rules allow admins only). This
// does not depend on a deployed server function, so the admin can always open/close the
// site. Falls back to the server endpoint if the client rule has not been published yet.
export async function setMaintenance(on) {
  const value = {on: on === true, updatedAt: Date.now(), by: store.user?.uid || 'admin'};
  try {
    await db.ref('config/maintenance').set(value); // client-write:admin-maintenance
  } catch (error) {
    await api('admin-action', {action: 'maintenance', on: on === true});
  }
}

// Edit own profile fields (name/phone/birthDate) DIRECTLY — rules allow the user to write only their
// own name/phone/birthDate. This is why "שמירת שינויים" now works reliably (it no longer goes through
// the serverless function). Falls back to the server only if the new rules aren't published yet.
export async function saveUser(patch) {
  const uid = store.user?.uid;
  if (!uid) throw new Error('נדרשת התחברות');
  const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
  const updates = {};
  if ('name' in patch) updates[`users/${uid}/name`] = txt(patch.name, 100);
  if ('phone' in patch) updates[`users/${uid}/phone`] = txt(patch.phone, 40);
  if ('birthDate' in patch) updates[`users/${uid}/birthDate`] = /^\d{4}-\d{2}-\d{2}$/.test(String(patch.birthDate || '')) ? String(patch.birthDate) : '';
  if (!Object.keys(updates).length) return {ok: true};
  try {
    await db.ref().update(updates); // client-write:own-profile
    return {ok: true};
  } catch (error) {
    if (/permission_denied/i.test(String(error?.message || ''))) return api('profile-save', {action: 'update', ...patch});
    throw new Error('שמירת הפרטים נכשלה — נסו שוב');
  }
}

// Profile picture: written DIRECTLY to the user's own node (rules allow only users/<uid>/photoURL
// for that user). Like car publishing, the big inline image never passes through a serverless
// function body — so the upload works reliably everywhere (in-app browsers included).
export async function setOwnPhoto(photoURL) {
  const uid = store.user?.uid;
  if (!uid) throw new Error('נדרשת התחברות');
  const url = String(photoURL || '');
  if (!/^(data:image\/|https:\/\/)/i.test(url)) throw new Error('תמונה לא תקינה');
  try {
    await db.ref(`users/${uid}/photoURL`).set(url.slice(0, 1400000)); // client-write:own-profile
  } catch (error) {
    if (/permission_denied/i.test(String(error?.message || ''))) throw new Error('אין הרשאה לשמור תמונה — יש לפרסם את חוקי ה-Firebase המעודכנים');
    throw new Error('שמירת התמונה נכשלה — נסו שוב');
  }
}

// ---- Client-side car sanitiser (mirrors netlify/functions/car-action.mjs publicCar). ----
// Cars are created/updated by writing DIRECTLY to the database (rules restrict it to the
// owner's own cars). This is what fixes publishing: the large inline photos go straight to
// Firebase and never pass through a serverless function body (Netlify was mangling the big body).
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
const num = (v, min, max, fb = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb; };
const mediaUrl = v => { const s = String(v || ''); if (/^data:image\//i.test(s)) return s.slice(0, 1000000); if (/^https:\/\//i.test(s)) return s.slice(0, 1000); return ''; };
const photoList = v => Array.isArray(v) ? [...new Set(v.map(mediaUrl).filter(Boolean))].slice(0, 6) : [];
function buildCar(data, ownerUid, existing = {}, ownerName = '') {
  const photos = data.photos !== undefined ? photoList(data.photos) : (Array.isArray(existing.photos) ? existing.photos : []);
  const main = mediaUrl(data.photoUrl ?? existing.photoUrl);
  const photoUrl = photos.length ? (photos.includes(main) ? main : photos[0]) : main;
  return {
    ...existing,
    make: txt(data.make ?? existing.make, 60),
    model: txt(data.model ?? existing.model, 60),
    year: num(data.year ?? existing.year, 1980, new Date().getFullYear() + 1, new Date().getFullYear()),
    trim: txt(data.trim ?? existing.trim, 80),
    dailyPrice: num(data.dailyPrice ?? existing.dailyPrice, 0, 100000, 0),
    priceHourly: num(data.priceHourly ?? existing.priceHourly, 0, 100000, 0),
    priceWeekly: num(data.priceWeekly ?? existing.priceWeekly, 0, 1000000, 0),
    minAge: num(data.minAge ?? existing.minAge, 18, 99, 21),
    category: txt(data.category ?? existing.category, 40),
    fuel: txt(data.fuel ?? existing.fuel, 40),
    gear: txt(data.gear ?? existing.gear, 40),
    seats: num(data.seats ?? existing.seats, 1, 20, 5),
    area: txt(data.area ?? existing.area, 120) || 'Crown Heights',
    deliveryEnabled: Boolean(data.deliveryEnabled ?? existing.deliveryEnabled),
    deliveryCost: num(data.deliveryCost ?? existing.deliveryCost, 0, 100000, 0),
    photoUrl,
    photos,
    videoUrl: mediaUrl(data.videoUrl ?? existing.videoUrl),
    rentalMode: ['hourly', 'hourly_daily', 'long_term'].includes(data.rentalMode) ? data.rentalMode : (existing.rentalMode || 'hourly_daily'),
    priceOnRequest: Boolean(data.priceOnRequest ?? existing.priceOnRequest),
    weekendEnabled: Boolean(data.weekendEnabled ?? existing.weekendEnabled),
    weekendPrice: num(data.weekendPrice ?? existing.weekendPrice, 0, 1000000, 0),
    ownerUid,
    ownerName: txt(ownerName || existing.ownerName, 80),
  };
}

export async function createCar(data) {
  const uid = store.user?.uid;
  if (!uid) throw new Error('נדרשת התחברות');
  if (myRole() !== 'owner' && !store.isAdmin) throw new Error('בעל רכב בלבד');
  const car = buildCar(data, uid, {}, store.profile?.name || '');
  if (!car.make || !car.model) throw new Error('יש לבחור יצרן ודגם');
  if (!car.photos.length) throw new Error('יש להוסיף לפחות תמונה אחת של הרכב');
  const result = await api('car-action', {action: 'create', data: {...car, fullAddress: txt(data.fullAddress, 500)}});
  return result.id;
}

export async function updateCar(id, patch) {
  const uid = store.user?.uid;
  if (!uid) throw new Error('נדרשת התחברות');
  const existing = store.cars[id];
  if (!existing) throw new Error('רכב לא נמצא');
  if (existing.ownerUid !== uid && !store.isAdmin) throw new Error('אין הרשאה');
  const car = buildCar(patch, existing.ownerUid, existing);
  car.updatedAt = Date.now();
  const update = {...car};
  // Send the address even when EMPTY — that's how the owner deletes a stale pickup address (audit #46).
  if (patch.fullAddress !== undefined) update.fullAddress = txt(patch.fullAddress, 500);
  await api('car-action', {action: 'update', id, patch: update});
}
// Delete a car by writing it out directly (rules allow the owner or an admin to remove it) — the
// same reliable path as publishing, so it works even when the serverless function misbehaves.
export async function deleteCar(id) {
  const uid = store.user?.uid;
  if (!uid) throw new Error('נדרשת התחברות');
  const car = store.cars[id];
  if (!car) throw new Error('רכב לא נמצא');
  if (car.ownerUid !== uid && !store.isAdmin) throw new Error('אין הרשאה');
  if (!store.isAdmin) {
    const hasActive = Object.values(store.bookings || {}).some(b => b.carId === id && ['pending', 'approved', 'active'].includes(b.status));
    if (hasActive) throw new Error('לא ניתן למחוק רכב עם הזמנה פתוחה');
  }
  await api('car-action', {action: 'delete', id});
}

// Owner or admin marks a car available / rented / hidden — a direct, tiny DB update.
export async function setCarStatus(id, status) {
  if (!['available', 'rented', 'hidden'].includes(status)) throw new Error('סטטוס לא תקין');
  const car = store.cars[id];
  if (!car) throw new Error('רכב לא נמצא');
  if (car.ownerUid !== store.user?.uid && !store.isAdmin) throw new Error('אין הרשאה');
  await api('car-action', {action: 'status', id, status});
}
// Admin-only: pin a car to the top of the listings (featured = timestamp) or unpin (null).
// Goes through the server (not a direct DB write) so the public catalog mirror stays in step.
export async function setCarFeatured(id, featured) {
  if (!store.isAdmin) throw new Error('מנהל בלבד');
  await api('car-action', {action: 'feature', id, featured: !!featured});
}
export async function createBooking(car, data) { return (await api('booking-create', {carId: car.id, ...data})).id; }
// Pre-booking inquiry: open (or reuse) a direct renter↔owner conversation about a car. Returns the inquiryId.
export async function startInquiry(carId) { return (await api('inquiry-start', {carId})).inquiryId; }
export async function setBookingStatus(id, status) { return api('booking-action', {action: 'status', bookingId: id, status}); }
export async function savePayment(id, data) { return api('payment-submit', {bookingId: id, ...data}); }
export async function registerDocument(documentType, path) { return api('document-register', {documentType, path}); }
export async function approveVerification(uid, status, note = '') { return api('verification-review', {uid, status, note}); }
// The admin↔user support thread is written DIRECTLY to the database (rules restrict messages/admin/<uid>
// to that user + admins), so it works without the serverless function — the same reliable path as
// publishing a car. Booking chats keep the function (their open/closed logic lives server-side).
export async function sendMessage(payload) {
  if (payload.thread === 'admin') {
    const uid = store.user?.uid;
    if (!uid) throw new Error('נדרשת התחברות');
    const text = String(payload.text ?? '').trim().slice(0, 2000);
    const rawAttachment = payload.attachment?.path;
    const attachment = /^data:image\//i.test(String(rawAttachment || '')) ? {type: 'photo', path: String(rawAttachment).slice(0, 1400000)} : null;
    if (!text && !attachment) throw new Error('לא ניתן לשלוח הודעה ריקה');
    // Admin support messages go through the SERVER (message-send, Admin SDK), which writes regardless of
    // whether the DB rules are published. The OLD path wrote client-side to messages/admin/<uid>, so it
    // needed the messages/admin rule LIVE — any rule drift silently broke "send a message to a user"
    // (the recurring bug). The server derives admin/guest from the verified token, enforces the guest
    // one-message-until-reply limit, sets the gate flags, and notifies/SMSes the other side.
    return api('message-send', {thread: 'admin', userUid: payload.userUid || uid, text, ...(attachment ? {attachment} : {})});
  }
  return api('message-send', payload);
}
export async function carMediaPublic(path) { return (await api('car-media-public', {path})).url; }
export async function adminAction(action, payload = {}) { return api('admin-action', {action, ...payload}); }
export async function saveHandover(id, stage, data) { return api('booking-action', {action: 'handover', bookingId: id, stage, data}); }
export async function submitRating(data) { return api('rating-submit', data); }
