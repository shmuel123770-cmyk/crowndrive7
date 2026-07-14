import {getAdmin, verify, json, profile, cleanText, audit, notifyAdmin, parseBody, maintenanceBlocked} from './_firebase-admin.mjs';
import {smsUser, smsAdmin} from './_sms.mjs';
import {rateLimit, tooMany} from './_ratelimit.mjs';

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
// Server-side mirror of the client's rental-mode matching (audit #14) — a malicious client can no longer
// book a range the owner never offered. Kept in sync with js/views.js (carBuckets/periodBucket/weekend).
const DAY = 86400000;
const MODE_BUCKETS = {hourly: ['hours'], hourly_daily: ['hours', 'days'], long_term: ['weeks']};
function periodBucket(ms) { return ms < 24 * 3600000 ? 'hours' : ms < 7 * DAY ? 'days' : 'weeks'; }
function carBuckets(car) {
  if (car.rentalMode && MODE_BUCKETS[car.rentalMode]) return MODE_BUCKETS[car.rentalMode];
  const b = [];
  if (car.priceHourly) b.push('hours');
  if (car.dailyPrice) b.push('days');
  if (car.priceWeekly) b.push('weeks');
  return b.length ? b : ['hours'];
}
function rangeIncludesSaturday(startRaw, endRaw) {
  // Work on the calendar dates at noon UTC so day-of-week is unambiguous regardless of timezone.
  let d = new Date(String(startRaw).slice(0, 10) + 'T12:00:00Z');
  const end = new Date(String(endRaw).slice(0, 10) + 'T12:00:00Z');
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) return false;
  while (d <= end) { if (d.getUTCDay() === 6) return true; d = new Date(d.getTime() + DAY); }
  return false;
}
function carServesPeriod(car, startRaw, endRaw, startMs, endMs) {
  if (carBuckets(car).includes(periodBucket(endMs - startMs))) return true;
  return !!car.weekendEnabled && Number(car.weekendPrice) > 0 && (endMs - startMs) <= 4 * DAY && (endMs - startMs) >= 20 * 3600000 && rangeIncludesSaturday(startRaw, endRaw);
}
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    if (!(await rateLimit(token.uid, 'booking-create', 10, 60 * 60 * 1000))) throw tooMany('נסו שוב בעוד זמן מה');
    if (await maintenanceBlocked(token.uid)) return json(503, {error: 'האתר בתחזוקה כרגע — נסו שוב בעוד מספר דקות'});
    const body = parseBody(event);
    if (!body) return json(400, {error: 'בקשה לא תקינה — נסו שוב'});
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
    if (!car || car.status !== 'available') return json(409, {error: 'הרכב אינו זמין להזמנה כרגע'});  // audit #12: was only blocking 'hidden'
    if (car.ownerUid === token.uid) return json(400, {error: 'אי אפשר להזמין את הרכב של עצמך'});
    const age = ageFromBirthDate(userProfile.birthDate);
    if (age === null) return json(400, {error: 'יש להזין תאריך לידה בפרופיל לפני הזמנה'});
    if (age < Number(car.minAge || 21)) return json(403, {error: `ההשכרה לרכב זה היא מגיל ${car.minAge || 21}`});
    // Booking times are LOCAL (Crown Heights). We keep the naive strings the client sent and store them
    // as-is, so every device shows exactly the time that was picked (audit #9 — no more UTC shift). The
    // parsed millis are used only for range validation + overlap, consistently on one clock.
    const startRaw = cleanText(body.startAt, 40);
    const endRaw = cleanText(body.endAt, 40);
    const startAt = new Date(startRaw).getTime();
    const endAt = new Date(endRaw).getTime();
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return json(400, {error: 'טווח התאריכים אינו תקין'});
    if (startAt < Date.now() - 18 * 60 * 60 * 1000) return json(400, {error: 'זמן האיסוף כבר עבר'});  // wide grace so timezone offsets never reject a valid same-day booking
    if (!carServesPeriod(car, startRaw, endRaw, startAt, endAt)) return json(409, {error: 'הרכב אינו מושכר לטווח שנבחר'});  // #14: enforce rental mode server-side
    if ((endAt - startAt) > 90 * DAY) return json(400, {error: 'משך ההשכרה ארוך מדי (עד 90 ימים)'});  // #40
    if (startAt > Date.now() + 365 * DAY) return json(400, {error: 'לא ניתן להזמין יותר משנה מראש'});  // #40
    const fulfillment = body.fulfillment === 'delivery' && car.deliveryEnabled ? 'delivery' : 'pickup';
    if (fulfillment === 'delivery' && !cleanText(body.deliveryAddress, 500)) return json(400, {error: 'יש להזין כתובת למסירה'});
    const existingSnap = await db.ref('bookings').orderByChild('carId').equalTo(carId).once('value');
    const hasOverlap = Object.values(existingSnap.val() || {}).some(b => ['approved', 'active'].includes(b.status) && overlaps(startAt, endAt, new Date(b.startAt).getTime(), new Date(b.endAt).getTime()));
    if (hasOverlap) return json(409, {error: 'הרכב תפוס בטווח שבחרת'});
    const id = db.ref('bookings').push().key;
    await db.ref(`bookings/${id}`).set({
      carId,
      ownerUid: car.ownerUid,
      renterUid: token.uid,
      startAt: startRaw,
      endAt: endRaw,
      fulfillment,
      deliveryAddress: fulfillment === 'delivery' ? cleanText(body.deliveryAddress, 500) : '',
      status: 'pending',
      // The request auto-expires if the owner doesn't respond within 48h (a scheduled fn flips it to
      // 'expired'), so a car isn't left with a stale pending request forever.
      pendingExpiresAt: Date.now() + 48 * 60 * 60 * 1000,
      createdAt: Date.now(),
    });
    await audit(token.uid, 'booking_create', 'booking', id, {carId});
    await notifyAdmin('booking', `הזמנה חדשה לרכב ${car.make} ${car.model}`, {bookingId: id, carId, renterUid: token.uid});
    // SMS: the owner gets told a booking came in (+ the admin). Best-effort — never blocks the response.
    await smsUser(car.ownerUid, `CrownDrive: התקבלה בקשת הזמנה חדשה לרכב ${car.make || ''} ${car.model || ''}. היכנסו לאזור האישי לאישור.`);
    await smsAdmin(`CrownDrive: הזמנה חדשה לרכב ${car.make || ''} ${car.model || ''}.`);
    return json(200, {ok: true, id});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
