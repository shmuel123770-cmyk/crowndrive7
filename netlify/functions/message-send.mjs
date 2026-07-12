import {getAdmin, verify, json, booking, isAdmin, cleanText, audit, notifyAdmin} from './_firebase-admin.mjs';

// Chat is open only while the rental is live: from owner approval (pre-pickup
// coordination + evidence) until the rental is marked done. Admin support
// threads (messages/admin/<uid>) are always open.
const CHAT_OPEN = new Set(['approved', 'active']);
const EVIDENCE_KEYS = {'evidence-video': 'video', 'evidence-fuel': 'fuel', 'evidence-odometer': 'odometer'};
const ATTACHMENT_TYPES = new Set(['evidence-video', 'evidence-fuel', 'evidence-odometer', 'photo']);

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    const body = JSON.parse(event.body || '{}');
    const db = getAdmin().database();
    const admin = await isAdmin(token.uid);
    const text = cleanText(body.text, 2000);
    const attachment = body.attachment && typeof body.attachment === 'object' ? body.attachment : null;
    if (!text && !attachment) return json(400, {error: 'הודעה ריקה'});

    // Direct support thread between a single user and the site admin.
    if (body.thread === 'admin') {
      const userUid = cleanText(body.userUid || token.uid, 128);
      if (!admin && userUid !== token.uid) return json(403, {error: 'אין הרשאה'});
      if (attachment) return json(400, {error: 'צירוף קבצים זמין רק בצ׳אט של הזמנה'});
      const ref = db.ref(`messages/admin/${userUid}`).push();
      await ref.set({senderUid: token.uid, fromAdmin: admin, text, createdAt: Date.now()});
      await audit(token.uid, 'admin_message', 'user', userUid);
      if (!admin) await notifyAdmin('chat', `הודעה חדשה בצ׳אט התמיכה`, {userUid});
      return json(200, {ok: true, id: ref.key});
    }

    const bookingId = cleanText(body.bookingId, 100);
    const value = await booking(bookingId);
    if (!value) return json(404, {error: 'הזמנה לא נמצאה'});
    if (!admin && ![value.ownerUid, value.renterUid].includes(token.uid)) return json(403, {error: 'אין הרשאה'});
    if (!admin && !CHAT_OPEN.has(value.status)) return json(409, {error: 'הצ׳אט פתוח רק מאישור ההזמנה ועד סיום ההשכרה'});

    let stored = null;
    if (attachment) {
      const type = String(attachment.type || '');
      // Evidence photos are stored inline as a data URL; a video keeps a storage path.
      const raw = String(attachment.path || '');
      const isImage = /^data:image\//i.test(raw);
      const path = isImage ? raw.slice(0, 1000000) : cleanText(attachment.path, 500);
      if (!ATTACHMENT_TYPES.has(type)) return json(400, {error: 'סוג צירוף לא תקין'});
      if (!isImage && !path.startsWith(`bookings/${bookingId}/media/${token.uid}/`)) return json(400, {error: 'נתיב קובץ לא תקין'});
      if (EVIDENCE_KEYS[type]) {
        if (token.uid !== value.renterUid && !admin) return json(403, {error: 'תיעוד לפני נסיעה נשלח על ידי השוכר'});
        if (value.status !== 'approved' && !admin) return json(409, {error: 'תיעוד נשלח לפני תחילת ההשכרה'});
      }
      stored = {type, path};
    }

    const ref = db.ref(`messages/${bookingId}`).push();
    await ref.set({senderUid: token.uid, text, ...(stored ? {attachment: stored} : {}), createdAt: Date.now()});
    if (stored && EVIDENCE_KEYS[stored.type]) {
      await db.ref(`bookings/${bookingId}/evidence/${EVIDENCE_KEYS[stored.type]}`).set({path: stored.path, by: token.uid, at: Date.now()});
    }
    await audit(token.uid, 'message_send', 'booking', bookingId, stored ? {attachment: stored.type} : {});
    return json(200, {ok: true, id: ref.key});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
