import {getAdmin, verify, json, booking, cleanText, audit} from './_firebase-admin.mjs';
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    const body = JSON.parse(event.body || '{}');
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
    const ref = getAdmin().database().ref(`ratings/${id}`);
    if ((await ref.once('value')).exists()) return json(409, {error: 'כבר דירגת הזמנה זו'});
    await ref.set({
      bookingId: body.bookingId,
      type,
      authorUid: token.uid,
      targetUid,
      carId,
      score,
      review: cleanText(body.review, 1000),
      createdAt: Date.now(),
    });
    await audit(token.uid, 'rating_submit', type, type === 'car' ? carId : targetUid, {score});
    return json(200, {ok: true});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
