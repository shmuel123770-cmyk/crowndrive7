import {getAdmin, verify, json, profile, cleanText, audit, notifyAdmin} from './_firebase-admin.mjs';

function ageFromBirthDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const birth = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const month = now.getUTCMonth() - birth.getUTCMonth();
  if (month < 0 || (month === 0 && now.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    const body = JSON.parse(event.body || '{}');
    const db = getAdmin().database();
    const userProfile = await profile(token.uid);
    if (userProfile?.role !== 'renter') return json(403, {error: 'רק שוכר יכול לבצע הזמנה'});
    const verification = userProfile.verification || {};
    const status = (await db.ref(`verificationStatus/${token.uid}`).once('value')).val();
    if (!(verification.licenseFront && verification.licenseBack && verification.selfie && status === 'approved')) {
      return json(403, {error: 'יש להשלים רישיון וסלפי ולקבל אישור מנהל'});
    }
    const carId = cleanText(body.carId, 100);
    const car = (await db.ref(`cars/${carId}`).once('value')).val();
    if (!car || car.status === 'hidden') return json(404, {error: 'הרכב אינו זמין'});
    if (car.ownerUid === token.uid) return json(400, {error: 'אי אפשר להזמין את הרכב של עצמך'});
    const age = ageFromBirthDate(userProfile.birthDate);
    if (age === null) return json(400, {error: 'יש להזין תאריך לידה בפרופיל לפני הזמנה'});
    if (age < Number(car.minAge || 21)) return json(403, {error: `ההשכרה לרכב זה היא מגיל ${car.minAge || 21}`});
    const startAt = new Date(body.startAt).getTime();
    const endAt = new Date(body.endAt).getTime();
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return json(400, {error: 'טווח התאריכים אינו תקין'});
    if (startAt < Date.now() - 5 * 60 * 1000) return json(400, {error: 'זמן האיסוף כבר עבר'});
    const existingSnap = await db.ref('bookings').orderByChild('carId').equalTo(carId).once('value');
    const hasOverlap = Object.values(existingSnap.val() || {}).some(b => ['approved', 'active'].includes(b.status) && overlaps(startAt, endAt, new Date(b.startAt).getTime(), new Date(b.endAt).getTime()));
    if (hasOverlap) return json(409, {error: 'הרכב תפוס בטווח שבחרת'});
    const fulfillment = body.fulfillment === 'delivery' && car.deliveryEnabled ? 'delivery' : 'pickup';
    const id = db.ref('bookings').push().key;
    await db.ref(`bookings/${id}`).set({
      carId,
      ownerUid: car.ownerUid,
      renterUid: token.uid,
      startAt: new Date(startAt).toISOString(),
      endAt: new Date(endAt).toISOString(),
      fulfillment,
      deliveryAddress: fulfillment === 'delivery' ? cleanText(body.deliveryAddress, 500) : '',
      status: 'pending',
      createdAt: Date.now(),
    });
    await audit(token.uid, 'booking_create', 'booking', id, {carId});
    await notifyAdmin('booking', `הזמנה חדשה לרכב ${car.make} ${car.model}`, {bookingId: id, carId, renterUid: token.uid});
    return json(200, {ok: true, id});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
