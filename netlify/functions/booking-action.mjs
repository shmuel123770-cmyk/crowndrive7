import {getAdmin, verify, json, isAdmin, booking, audit, cleanText, notifyAdmin, parseBody, maintenanceBlocked} from './_firebase-admin.mjs';
import {smsUser} from './_sms.mjs';
import {rateLimit, tooMany} from './_ratelimit.mjs';
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
    if (!(await rateLimit(token.uid, 'booking-action', 40, 60 * 60 * 1000))) throw tooMany();
    if (await maintenanceBlocked(token.uid)) return json(503, {error: 'האתר בתחזוקה כרגע — נסו שוב בעוד מספר דקות'});
    const body = parseBody(event);
    if (!body) return json(400, {error: 'בקשה לא תקינה — נסו שוב'});
    const db = getAdmin().database();
    const current = await booking(body.bookingId);
    if (!current) return json(404, {error: 'הזמנה לא נמצאה'});
    const admin = await isAdmin(token.uid);
    const owner = current.ownerUid === token.uid;
    const renter = current.renterUid === token.uid;
    if (!admin && !owner && !renter) return json(403, {error: 'אין הרשאה'});
    const ref = db.ref(`bookings/${body.bookingId}`);
    // Owner (or admin) explicitly confirms/rejects the renter's payment proof. Until 'approved' the rental
    // cannot start; a 'rejected' proof asks the renter to re-send.
    if (body.action === 'payment-review') {
      if (!owner && !admin) return json(403, {error: 'רק בעל הרכב או המנהל יכול לאשר תשלום'});
      const decision = body.decision === 'approved' ? 'approved' : body.decision === 'rejected' ? 'rejected' : null;
      if (!decision) return json(400, {error: 'החלטה לא תקינה'});
      const pref = db.ref(`payments/${body.bookingId}`);
      const payment = (await pref.once('value')).val();
      if (!payment) return json(404, {error: 'לא נמצאה הוכחת תשלום'});
      if (payment.status !== 'pending') return json(409, {error: 'אפשר לבדוק רק תשלום שממתין לאישור'});
      await pref.update({status: decision, reviewedBy: token.uid, reviewedAt: Date.now()});
      await audit(token.uid, 'payment_review', 'booking', body.bookingId, {decision});
      const ref7 = String(body.bookingId).slice(-7);
      await smsUser(current.renterUid, decision === 'approved'
        ? `CrownDrive: התשלום שלך על ההזמנה (${ref7}) אושר על ידי בעל הרכב.`
        : `CrownDrive: התשלום שלך על ההזמנה (${ref7}) נדחה — פנו לבעל הרכב ושלחו הוכחה מעודכנת.`);
      await notifyAdmin('payment', decision === 'approved' ? `תשלום אושר (${ref7})` : `תשלום נדחה (${ref7})`, {bookingId: body.bookingId, decision, by: token.uid});
      return json(200, {ok: true, status: decision});
    }
    if (body.action === 'status') {
      const next = body.status;
      const present = current.status || 'pending';
      let reservationCreated = false;
      // Whitelist the status for EVERYONE (audit #23) — an admin (or a buggy client) can no longer store
      // an arbitrary string and corrupt the record.
      if (!['pending', 'approved', 'rejected', 'active', 'done', 'cancelled'].includes(next)) return json(400, {error: 'סטטוס לא תקין'});
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
        // Payment must exist AND be confirmed by the owner. Legacy proofs (saved before approval existed, no
        // status field) are grandfathered as OK so in-progress rentals don't break.
        if (!payment) missing.push('הוכחת תשלום');
        else if (payment.status === 'pending') missing.push('אישור התשלום (בעל הרכב עדיין לא אישר את ההוכחה)');
        else if (payment.status === 'rejected') missing.push('הוכחת תשלום תקינה (הקודמת נדחתה)');
        if (missing.length) return json(409, {error: `אי אפשר להתחיל את ההשכרה, חסר: ${missing.join(', ')}`});
      }
      if (next === 'approved') {
        const start = new Date(current.startAt).getTime();
        const end = new Date(current.endAt).getTime();
        // First line: check against the actual bookings (covers any approved/active booking not yet in
        // the reservations index, e.g. from before this feature).
        const other = await db.ref('bookings').orderByChild('carId').equalTo(current.carId).once('value');
        const conflict = Object.entries(other.val() || {}).some(([id, b]) => id !== body.bookingId && ['approved', 'active'].includes(b.status) && overlaps(start, end, new Date(b.startAt).getTime(), new Date(b.endAt).getTime()));
        if (conflict) return json(409, {error: 'קיימת הזמנה חופפת לרכב'});
        // Atomic guard (audit #10): a transaction on reservations/<carId> closes the race where two
        // concurrent approvals both pass the read-check above and both get written.
        const result = await db.ref(`reservations/${current.carId}`).transaction(map => {
          const reservations = map || {};
          for (const [bid, r] of Object.entries(reservations)) {
            if (bid === body.bookingId) continue;
            if (overlaps(start, end, new Date(r.startAt).getTime(), new Date(r.endAt).getTime())) return;  // abort → conflict
          }
          reservations[body.bookingId] = {startAt: current.startAt, endAt: current.endAt};
          return reservations;
        });
        if (!result.committed) return json(409, {error: 'קיימת הזמנה חופפת לרכב'});
        reservationCreated = true;
      }
      const stamps = next === 'active' ? {startedAt: Date.now()} : next === 'done' ? {endedAt: Date.now()} : {};
      try { await ref.update({status: next, done: next === 'done', updatedAt: Date.now(), ...stamps}); }
      catch (error) {
        if (reservationCreated) await db.ref(`reservations/${current.carId}/${body.bookingId}`).remove().catch(cleanupError => console.error('reservation rollback failed', cleanupError));
        throw error;
      }
      // Free the slot the moment the booking leaves the reserved set, so the car opens up again.
      if (['done', 'rejected', 'cancelled'].includes(next)) await db.ref(`reservations/${current.carId}/${body.bookingId}`).remove().catch(() => {});
      await audit(token.uid, 'booking_status', 'booking', body.bookingId, {from: present, to: next});
      const statusText = {approved: 'בעל הרכב אישר הזמנה', rejected: 'בעל הרכב דחה הזמנה', active: 'השכרה התחילה', done: 'השכרה הסתיימה', cancelled: 'הזמנה בוטלה'}[next];
      if (statusText) await notifyAdmin('status', `${statusText} (${body.bookingId.slice(-7)})`, {bookingId: body.bookingId, to: next, by: token.uid});
      // SMS: renter on approve/reject; BOTH sides when the rental ends. Best-effort.
      const ref7 = body.bookingId.slice(-7);
      if (next === 'approved') await smsUser(current.renterUid, `CrownDrive: ההזמנה שלך אושרה (${ref7})! היכנסו לצ׳אט להשלמת התיעוד ותחילת ההשכרה.`);
      else if (next === 'rejected') await smsUser(current.renterUid, `CrownDrive: לצערנו ההזמנה שלך (${ref7}) לא אושרה על ידי בעל הרכב.`);
      else if (next === 'done') {
        await smsUser(current.renterUid, `CrownDrive: ההשכרה (${ref7}) הסתיימה. תודה שנסעתם איתנו — נשמח לדירוג!`);
        await smsUser(current.ownerUid, `CrownDrive: ההשכרה (${ref7}) של הרכב שלך הסתיימה.`);
      }
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
        if (payment?.status !== 'approved' && !admin) return json(409, {error: 'יש לקבל אישור תשלום לפני תיעוד האיסוף'});
      }
      const data = body.data || {};
      if (!data.videoPath || !data.dashboardPhotoPath || !Number.isFinite(Number(data.mileage)) || !data.fuel) return json(400, {error: 'חסר תיעוד חובה'});
      const allowedPrefix = `bookings/${body.bookingId}/media/${token.uid}/`;
      if (!String(data.videoPath).startsWith(allowedPrefix) || !String(data.dashboardPhotoPath).startsWith(allowedPrefix)
        || String(data.videoPath).includes('..') || String(data.dashboardPhotoPath).includes('..')) return json(400, {error: 'נתיב תיעוד לא תקין'});
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
    // Owner (or admin) ends the conversation: after this the RENTER can no longer send in this thread.
    if (body.action === 'end-chat') {
      if (!owner && !admin) return json(403, {error: 'פעולה לבעל הרכב או מנהל בלבד'});
      await ref.update({chatEnded: true, updatedAt: Date.now()});
      await audit(token.uid, 'chat_end', 'booking', body.bookingId, {});
      return json(200, {ok: true});
    }
    return json(400, {error: 'פעולה לא מוכרת'});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
