import {getAdmin, verify, json, isAdmin, booking, audit, cleanText, notifyAdmin} from './_firebase-admin.mjs';
const transitions = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['active', 'cancelled'],
  active: ['done'],
};
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    const body = JSON.parse(event.body || '{}');
    const db = getAdmin().database();
    const current = await booking(body.bookingId);
    if (!current) return json(404, {error: 'הזמנה לא נמצאה'});
    const admin = await isAdmin(token.uid);
    const owner = current.ownerUid === token.uid;
    const renter = current.renterUid === token.uid;
    if (!admin && !owner && !renter) return json(403, {error: 'אין הרשאה'});
    const ref = db.ref(`bookings/${body.bookingId}`);
    if (body.action === 'status') {
      const next = body.status;
      const present = current.status || 'pending';
      if (!admin) {
        if (['approved', 'rejected', 'active', 'done'].includes(next) && !owner) return json(403, {error: 'פעולה לבעל הרכב בלבד'});
        if (next === 'cancelled' && !owner && !renter) return json(403, {error: 'אין הרשאה'});
        if (!transitions[present]?.includes(next)) return json(400, {error: 'מעבר סטטוס לא חוקי'});
      }
      // Rental can only start after the renter sent, through the chat, the
      // exterior video + fuel photo + odometer photo, and a payment proof.
      if (next === 'active' && !admin) {
        const evidence = current.evidence || {};
        const payment = (await db.ref(`payments/${body.bookingId}`).once('value')).val();
        const missing = [];
        if (!evidence.video) missing.push('סרטון הרכב מבחוץ');
        if (!evidence.fuel) missing.push('תמונת דלק');
        if (!evidence.odometer) missing.push('תמונת קילומטראז׳');
        if (!payment) missing.push('הוכחת תשלום');
        if (missing.length) return json(409, {error: `אי אפשר להתחיל את ההשכרה, חסר: ${missing.join(', ')}`});
      }
      if (next === 'approved') {
        const other = await db.ref('bookings').orderByChild('carId').equalTo(current.carId).once('value');
        const start = new Date(current.startAt).getTime();
        const end = new Date(current.endAt).getTime();
        const conflict = Object.entries(other.val() || {}).some(([id, b]) => id !== body.bookingId && ['approved', 'active'].includes(b.status) && overlaps(start, end, new Date(b.startAt).getTime(), new Date(b.endAt).getTime()));
        if (conflict) return json(409, {error: 'קיימת הזמנה חופפת לרכב'});
      }
      const stamps = next === 'active' ? {startedAt: Date.now()} : next === 'done' ? {endedAt: Date.now()} : {};
      await ref.update({status: next, done: next === 'done', updatedAt: Date.now(), ...stamps});
      await audit(token.uid, 'booking_status', 'booking', body.bookingId, {from: present, to: next});
      const statusText = {approved: 'בעל הרכב אישר הזמנה', rejected: 'בעל הרכב דחה הזמנה', active: 'השכרה התחילה', done: 'השכרה הסתיימה', cancelled: 'הזמנה בוטלה'}[next];
      if (statusText) await notifyAdmin('status', `${statusText} (${body.bookingId.slice(-7)})`, {bookingId: body.bookingId, to: next, by: token.uid});
      return json(200, {ok: true});
    }
    if (body.action === 'handover') {
      if (!renter && !admin) return json(403, {error: 'התיעוד נשלח על ידי השוכר'});
      if (!['pickup', 'return'].includes(body.stage)) return json(400, {error: 'שלב לא תקין'});
      if (body.stage === 'pickup' && current.status !== 'approved' && !admin) return json(409, {error: 'אפשר לתעד איסוף רק לאחר אישור ההזמנה'});
      if (body.stage === 'return' && current.status !== 'active' && !admin) return json(409, {error: 'אפשר לתעד החזרה רק בזמן השכרה פעילה'});
      if (current.handover?.[body.stage] && !admin) return json(409, {error: 'התיעוד כבר הוגש'});
      if (body.stage === 'pickup') {
        const payment = (await db.ref(`payments/${body.bookingId}`).once('value')).val();
        if (!payment && !admin) return json(409, {error: 'יש לשלוח הוכחת תשלום לפני תיעוד האיסוף'});
      }
      const data = body.data || {};
      if (!data.videoPath || !data.dashboardPhotoPath || !Number.isFinite(Number(data.mileage)) || !data.fuel) return json(400, {error: 'חסר תיעוד חובה'});
      await ref.child(`handover/${body.stage}`).set({
        videoPath: cleanText(data.videoPath, 500),
        dashboardPhotoPath: cleanText(data.dashboardPhotoPath, 500),
        mileage: Number(data.mileage),
        fuel: cleanText(data.fuel, 40),
        notes: cleanText(data.notes, 2000),
        submittedBy: token.uid,
        submittedAt: Date.now(),
      });
      await audit(token.uid, 'handover_submit', 'booking', body.bookingId, {stage: body.stage});
      return json(200, {ok: true});
    }
    return json(400, {error: 'פעולה לא מוכרת'});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
