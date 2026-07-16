import {getAdmin, verify, json, booking, cleanText, audit, notifyAdmin, parseBody, maintenanceBlocked} from './_firebase-admin.mjs';
import {rateLimit, tooMany} from './_ratelimit.mjs';
import {validateImageDataUrl} from './_media.mjs';
import {storageObjectExists, deleteStorageObject} from './_storage.mjs';
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
    // The admin's corrected amount (audit #6) takes precedence over the original quote when set.
    const adminAmount = Number(value.adminAmount);
    const expectedAmount = Number.isFinite(adminAmount) && adminAmount > 0 ? adminAmount : Number(value.quote?.total);
    if (Number.isFinite(expectedAmount) && expectedAmount > 0 && Math.abs(amount - expectedAmount) > 0.01) return json(400, {error: 'הסכום אינו תואם לסיכום ההזמנה'});
    // The proof image is stored inline as a data URL; also accept a legacy storage path.
    const media = String(body.mediaPath || '');
    const isImage = /^data:image\//i.test(media);
    const expected = `bookings/${body.bookingId}/payments/${token.uid}/`;
    if (!isImage && !media.startsWith(expected)) return json(400, {error: 'נתיב הוכחה לא תקין'});
    // A path-shaped proof must point at a REAL object (audit #7) — a made-up path no longer registers.
    if (!isImage && (await storageObjectExists(media)) === false) return json(400, {error: 'קובץ ההוכחה לא נמצא באחסון — העלו אותו שוב'});
    const payload = {
      bookingId: body.bookingId,
      renterUid: value.renterUid,
      ownerUid: value.ownerUid,
      amount,
      mediaPath: isImage ? validateImageDataUrl(media) : cleanText(body.mediaPath, 500),
      // Proof is only a REPORT until the owner (or admin) confirms it — the rental can't start on a
      // 'pending' or 'rejected' payment. Re-submitting (over a rejected one) resets it to pending.
      status: 'pending',
      createdAt: Date.now(),
    };
    // Transaction (audit #13): the old read-then-set let two concurrent submits both pass the check;
    // now the write itself refuses to land on a pending/approved record.
    const pref = getAdmin().database().ref(`payments/${body.bookingId}`);
    const prior = (await pref.once('value')).val();  // for old-file cleanup below
    const result = await pref.transaction(existing => {
      if (existing && ['pending', 'approved'].includes(existing.status)) return;  // abort
      return payload;
    });
    if (!result.committed) {
      const existing = (await pref.once('value')).val();
      if (existing?.status === 'approved') return json(409, {error: 'התשלום כבר אושר ואינו ניתן להחלפה'});
      return json(409, {error: 'הוכחת התשלום כבר ממתינה לאישור'});
    }
    // The rejected proof this one replaces is gone from the record — remove its file too (audit #21).
    const priorPath = String(prior?.mediaPath || '');
    if (priorPath && !priorPath.startsWith('data:') && priorPath !== payload.mediaPath) await deleteStorageObject(priorPath);
    await audit(token.uid, 'payment_submit', 'booking', body.bookingId, {amount});
    await notifyAdmin('payment', `שוכר שלח הוכחת תשלום על $${amount} — ממתין לאישור`, {bookingId: body.bookingId, amount});
    return json(200, {ok: true});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.status ? error.message : 'שגיאת שרת — נסו שוב בעוד רגע'});
  }
}
