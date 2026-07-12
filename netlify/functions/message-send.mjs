import {getAdmin, verify, json, booking, isAdmin, cleanText, audit} from './_firebase-admin.mjs';
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    const {bookingId, text} = JSON.parse(event.body || '{}');
    const value = await booking(bookingId);
    if (!value) return json(404, {error: 'הזמנה לא נמצאה'});
    const admin = await isAdmin(token.uid);
    if (!admin && ![value.ownerUid, value.renterUid].includes(token.uid)) return json(403, {error: 'אין הרשאה'});
    const message = cleanText(text, 2000);
    if (!message) return json(400, {error: 'הודעה ריקה'});
    const ref = getAdmin().database().ref(`messages/${bookingId}`).push();
    await ref.set({senderUid: token.uid, text: message, createdAt: Date.now()});
    await audit(token.uid, 'message_send', 'booking', bookingId);
    return json(200, {ok: true, id: ref.key});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
