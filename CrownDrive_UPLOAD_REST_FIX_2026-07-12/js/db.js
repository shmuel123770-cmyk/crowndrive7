import {api} from './api.js';
import {db} from './firebase.js';
import {store, myRole} from './store.js';

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

export async function saveUser(patch) {
  if (!store.user) throw new Error('נדרשת התחברות');
  return api('profile-save', {action: 'update', ...patch});
}
export async function createCar(data) {
  if (myRole() !== 'owner' && !store.isAdmin) throw new Error('אין הרשאה');
  return (await api('car-action', {action: 'create', data})).id;
}
export async function updateCar(id, patch) { return api('car-action', {action: 'update', id, patch}); }
export async function deleteCar(id) { return api('car-action', {action: 'delete', id}); }
export async function createBooking(car, data) { return (await api('booking-create', {carId: car.id, ...data})).id; }
export async function setBookingStatus(id, status) { return api('booking-action', {action: 'status', bookingId: id, status}); }
export async function savePayment(id, data) { return api('payment-submit', {bookingId: id, ...data}); }
export async function registerDocument(documentType, path) { return api('document-register', {documentType, path}); }
export async function approveVerification(uid, status, note = '') { return api('verification-review', {uid, status, note}); }
export async function sendMessage(payload) { return api('message-send', payload); }
export async function carMediaPublic(path) { return (await api('car-media-public', {path})).url; }
export async function adminAction(action, payload = {}) { return api('admin-action', {action, ...payload}); }
export async function saveHandover(id, stage, data) { return api('booking-action', {action: 'handover', bookingId: id, stage, data}); }
export async function submitRating(data) { return api('rating-submit', data); }
