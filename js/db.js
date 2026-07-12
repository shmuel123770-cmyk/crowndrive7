import {api} from './api.js';
import {store, myRole} from './store.js';

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
export async function sendMessage(bookingId, text) { return api('message-send', {bookingId, text}); }
export async function saveHandover(id, stage, data) { return api('booking-action', {action: 'handover', bookingId: id, stage, data}); }
export async function submitRating(data) { return api('rating-submit', data); }
