import {getAdmin, verify, json, booking, cleanText, audit, parseBody, maintenanceBlocked} from './_firebase-admin.mjs';
import {rateLimit, tooMany} from './_ratelimit.mjs';
import crypto from 'node:crypto';
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    if (!(await rateLimit(token.uid, 'rating', 12, 60 * 60 * 1000))) throw tooMany();
    if (await maintenanceBlocked(token.uid)) return json(503, {error: 'האתר בתחזוקה כרגע — נסו שוב בעוד מספר דקות'});
    const body = parseBody(event);
    if (!body) return json(400, {error: 'בקשה לא תקינה — נסו שוב'});
    const value = await booking(body.bookingId);
    if (!value || value.status !== 'done') return json(409, {error: 'אפשר לדרג רק לאחר סיום ההשכרה'});
    if (![value.ownerUid, value.renterUid].includes(token.uid)) return json(403, {error: 'אין הרשאה'});
    const score = Number(body.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) return json(400, {error: 'דירוג לא תקין'});
    const type = body.type;
    let targetUid = '', carId = '';
    if (type === 'car') {
      if (token.uid !== value.renterUid) return json(403, {error: 'רק השוכר יכול לדרג את הרכב'});
      carId = value.carId;
    } else if (type === 'user') {
      targetUid = token.uid === value.ownerUid ? value.renterUid : value.ownerUid;
      if (targetUid === token.uid) return json(400, {error: 'אי אפשר לדרג את עצמך'});
    } else return json(400, {error: 'סוג דירוג לא תקין'});
    const id = `${body.bookingId}_${type}_${token.uid}`;
    const db = getAdmin().database();
    const ref = db.ref(`ratings/${id}`);
    const review = cleanText(body.review, 1000);
    const createdAt = Date.now();
    // Two records: the FULL private one (with authorUid + bookingId, admin-only) and a SANITIZED public
    // projection with no bookingId / authorUid, so public reads can't enumerate bookings (audit #3).
    // Transaction (audit #13): the duplicate check IS the write — a double-tap can't land twice.
    const result = await ref.transaction(existing => {
      if (existing) return;  // abort — already rated
      return {bookingId: body.bookingId, type, authorUid: token.uid, targetUid, carId, score, review, createdAt};
    });
    if (!result.committed) return json(409, {error: 'כבר דירגת הזמנה זו'});
    // The public projection strips bookingId + authorUid — but publicRatings is world-readable, so a
    // key of `<bookingId>_<type>_<authorUid>` would hand back both to anyone who lists the node. Hash
    // it: still deterministic (a re-write overwrites rather than duplicating), no longer readable.
    await db.ref(`publicRatings/${crypto.createHash('sha1').update(id).digest('hex')}`).set({type, targetUid, carId, score, review, createdAt});
    // Let the two participants see that this rating is already used up. Lives on the booking (readable
    // only by them + admin), so the rate button can retire itself instead of losing a written review
    // to a 409. The private ratings/ node stays admin-only, so the client can't check it directly.
    await db.ref(`bookings/${body.bookingId}/ratedBy/${token.uid}_${type}`).set(true).catch(() => {});
    await audit(token.uid, 'rating_submit', type, type === 'car' ? carId : targetUid, {score});
    return json(200, {ok: true});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.status ? error.message : 'שגיאת שרת — נסו שוב בעוד רגע'});
  }
}
