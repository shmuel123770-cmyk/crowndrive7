import {getAdmin, verify, json, booking, cleanText, audit, notifyAdmin, parseBody, maintenanceBlocked} from './_firebase-admin.mjs';
import {rateLimit, tooMany} from './_ratelimit.mjs';
import {validateImageDataUrl} from './_media.mjs';
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    if (!(await rateLimit(token.uid, 'payment', 12, 10 * 60 * 1000))) throw tooMany();
    if (await maintenanceBlocked(token.uid)) return json(503, {error: 'האתר בתחזוקה כרגע — נסו שוב בעוד מספר דקות'});
    const body = parseBody(event);
    if (!body) return json(400, {error: 'הבקשה גדולה או פגומה — נסו תמונה קטנה יותר'});
    const value = await booking(body.bookingId);
    if (!value) return json(404, {error: 'הזמנה לא נמצאה'});
    if (value.renterUid !== token.uid) return json(403, {error: 'רק השוכר יכול לשלוח הוכחת תשלום'});
    if (!['approved', 'active'].includes(value.status)) return json(409, {error: 'אפשר לשלוח הוכחה רק להזמנה מאושרת או פעילה'});
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return json(400, {error: 'הסכום אינו תקין'});
    // The proof image is stored inline as a data URL; also accept a legacy storage path.
    const media = String(body.mediaPath || '');
    const isImage = /^data:image\//i.test(media);
    const expected = `bookings/${body.bookingId}/payments/${token.uid}/`;
    if (!isImage && !media.startsWith(expected)) return json(400, {error: 'נתיב הוכחה לא תקין'});
    await getAdmin().database().ref(`payments/${body.bookingId}`).set({
      bookingId: body.bookingId,
      renterUid: value.renterUid,
      ownerUid: value.ownerUid,
      amount,
      mediaPath: isImage ? validateImageDataUrl(media) : cleanText(body.mediaPath, 500),
      createdAt: Date.now(),
    });
    await audit(token.uid, 'payment_submit', 'booking', body.bookingId, {amount});
    await notifyAdmin('payment', `שוכר שלח אישור תשלום על $${amount}`, {bookingId: body.bookingId, amount});
    return json(200, {ok: true});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
