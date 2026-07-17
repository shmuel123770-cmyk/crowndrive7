import {getAdmin, verify, json, booking, isAdmin, cleanText, audit, notifyAdmin, parseBody, maintenanceBlocked} from './_firebase-admin.mjs';
import {smsUser, smsAdmin, onceGuard} from './_sms.mjs';
import {rateLimit, tooMany} from './_ratelimit.mjs';
import {validateImageDataUrl} from './_media.mjs';

// Chat is open only while the rental is live: from owner approval (pre-pickup
// coordination + evidence) until the rental is marked done. Admin support
// threads (messages/admin/<uid>) are always open.
// Owner↔renter chat is open from the moment the renter REQUESTS (pending) — so they can coordinate before
// approval — through the active rental, until it's marked done.
const CHAT_OPEN = new Set(['pending', 'approved', 'active']);
const EVIDENCE_KEYS = {'evidence-video': 'video', 'evidence-fuel': 'fuel', 'evidence-odometer': 'odometer'};
const ATTACHMENT_TYPES = new Set(['evidence-video', 'evidence-fuel', 'evidence-odometer', 'photo']);

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    if (await maintenanceBlocked(token.uid)) return json(503, {error: 'האתר בתחזוקה כרגע — נסו שוב בעוד מספר דקות'});  // audit #23
    if (!(await rateLimit(token.uid, 'message', 20, 60 * 1000))) throw tooMany();
    const body = parseBody(event);
    if (!body) return json(400, {error: 'הבקשה גדולה או פגומה — נסו תמונה קטנה יותר'});
    const db = getAdmin().database();
    const admin = await isAdmin(token.uid);
    const text = cleanText(body.text, 2000);
    const attachment = body.attachment && typeof body.attachment === 'object' ? body.attachment : null;
    if (!text && !attachment) return json(400, {error: 'הודעה ריקה'});

    // Direct support thread between a single user and the site admin.
    if (body.thread === 'admin') {
      const userUid = cleanText(body.userUid || token.uid, 128);
      if (!admin && userUid !== token.uid) return json(403, {error: 'אין הרשאה'});
      // Guest (unregistered/anonymous) support: ONE message until an admin replies, then free. Enforced
      // HERE on the server so it holds even if the DB rules aren't published.
      const isGuest = token.firebase?.sign_in_provider === 'anonymous';
      let guestState = null;
      if (!admin && isGuest) {
        guestState = (await db.ref(`supportGuestState/${token.uid}`).once('value')).val() || {};
        if (guestState.firstSent && guestState.adminReplied !== true) {
          return json(429, {error: 'שלחתם הודעה — נחזור אליכם בקרוב. אפשר להמשיך לכתוב לאחר שנענה.'});
        }
      }
      // Support chat accepts inline image attachments (stored as a data URL, like everywhere else).
      let stored = null;
      if (attachment) {
        const raw = String(attachment.path || '');
        if (!/^data:image\//i.test(raw)) return json(400, {error: 'ניתן לצרף תמונה בלבד'});
        stored = {type: 'photo', path: validateImageDataUrl(raw)};  // verify real image bytes
      }
      const ref = db.ref(`messages/admin/${userUid}`).push();
      await ref.set({senderUid: token.uid, fromAdmin: admin, text, ...(stored ? {attachment: stored} : {}), createdAt: Date.now()});
      // Cheap unread summary on the RECIPIENT user's own profile node (they already read it via their
      // profile listener) — lets the client show an unread badge without loading any messages. Only for
      // a REGISTERED user (guests have no profile; skip so we don't create a blank users row).
      if (await db.ref(`users/${userUid}/role`).once('value').then(s => s.exists()).catch(() => false)) {
        await db.ref(`users/${userUid}`).update({supportMsgAt: Date.now(), supportMsgFrom: token.uid}).catch(() => {});
      }
      // Guest gate flags: an admin reply opens the guest to write freely; a guest message marks firstSent.
      if (admin) await db.ref(`supportGuestState/${userUid}/adminReplied`).set(true).catch(() => {});
      else if (isGuest) {
        await db.ref(`supportGuestState/${token.uid}/firstSent`).set(true).catch(() => {});
        // Instant auto-acknowledgement on the guest's FIRST message, so they immediately see a reply (a real
        // agent follows up). It does NOT set adminReplied, so the one-message-until-a-human-replies limit holds.
        if (!guestState?.firstSent) {
          await db.ref(`messages/admin/${token.uid}`).push().set({senderUid: 'system', fromAdmin: true, auto: true, text: 'תודה על פנייתכם! 🙏 נציג יחזור אליכם בהקדם.', createdAt: Date.now() + 1}).catch(() => {});
        }
      }
      await audit(token.uid, 'admin_message', 'user', userUid);
      if (!admin) await notifyAdmin('chat', `הודעה חדשה בצ׳אט התמיכה`, {userUid});
      // SMS: user→admin texts the admin; admin→user texts that user (debounced 2 min per thread).
      if (await onceGuard(`thread/${userUid}`, 2 * 60 * 1000)) {
        if (admin) await smsUser(userUid, 'CrownDrive: קיבלת הודעה חדשה מצוות האתר. היכנסו לצ׳אט כדי לקרוא ולהשיב.');
        else await smsAdmin('CrownDrive: הודעה חדשה בצ׳אט התמיכה מאת משתמש.');
      }
      return json(200, {ok: true, id: ref.key});
    }

    // Pre-booking inquiry: a direct renter↔owner conversation about a car, before any booking exists.
    // Both parties (and the admin) may write; messages live at messages/inquiry/<id>.
    if (body.inquiryId) {
      const inquiryId = cleanText(body.inquiryId, 200);
      const inq = (await db.ref(`inquiries/${inquiryId}`).once('value')).val();
      if (!inq) return json(404, {error: 'השיחה לא נמצאה'});
      if (!admin && ![inq.renterUid, inq.ownerUid].includes(token.uid)) return json(403, {error: 'אין הרשאה'});
      let stored = null;
      if (attachment) {
        const raw = String(attachment.path || '');
        if (!/^data:image\//i.test(raw)) return json(400, {error: 'ניתן לצרף תמונה בלבד'});
        stored = {type: 'photo', path: validateImageDataUrl(raw)};  // verify real image bytes
      }
      const ref = db.ref(`messages/inquiry/${inquiryId}`).push();
      await ref.set({senderUid: token.uid, text, ...(stored ? {attachment: stored} : {}), createdAt: Date.now()});
      await db.ref(`inquiries/${inquiryId}`).update({updatedAt: Date.now(), lastText: (text || '📷 תמונה').slice(0, 90), lastSender: token.uid});
      await audit(token.uid, 'inquiry_message', 'inquiry', inquiryId, stored ? {attachment: stored.type} : {});
      // SMS the OTHER party (debounced 2 min per inquiry, so a burst of messages ≠ a burst of texts).
      if (await onceGuard(`imsg/${inquiryId}`, 2 * 60 * 1000)) {
        const other = token.uid === inq.renterUid ? inq.ownerUid : inq.renterUid;
        await smsUser(other, 'CrownDrive: קיבלתם הודעה חדשה בפנייה על רכב. היכנסו לאתר כדי לקרוא ולהשיב.');
      }
      return json(200, {ok: true, id: ref.key});
    }

    const bookingId = cleanText(body.bookingId, 100);
    const value = await booking(bookingId);
    if (!value) return json(404, {error: 'הזמנה לא נמצאה'});
    if (!admin && ![value.ownerUid, value.renterUid].includes(token.uid)) return json(403, {error: 'אין הרשאה'});
    if (!admin && !CHAT_OPEN.has(value.status)) return json(409, {error: 'הצ׳אט פתוח רק מאישור ההזמנה ועד סיום ההשכרה'});
    // Owner/admin ended the conversation → the renter can no longer send (owner + admin still can).
    if (value.chatEnded && token.uid === value.renterUid) return json(403, {error: 'השיחה נסגרה על ידי הצד השני'});

    let stored = null;
    if (attachment) {
      const type = String(attachment.type || '');
      // Evidence photos are stored inline as a data URL; a video keeps a storage path.
      const raw = String(attachment.path || '');
      const isImage = /^data:image\//i.test(raw);
      const path = isImage ? validateImageDataUrl(raw) : cleanText(attachment.path, 500);  // verify real image bytes
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
    // Cheap unread summary on the booking node (both participants already read their bookings) — a
    // preview + who-sent + when, so the chat list shows unread + a last-message line with no message reads.
    await db.ref(`bookings/${bookingId}`).update({lastMsgAt: Date.now(), lastMsgFrom: token.uid, lastMsgText: (text || '📷 תמונה').slice(0, 90)}).catch(() => {});
    if (stored && EVIDENCE_KEYS[stored.type]) {
      await db.ref(`bookings/${bookingId}/evidence/${EVIDENCE_KEYS[stored.type]}`).set({path: stored.path, by: token.uid, at: Date.now()});
    }
    await audit(token.uid, 'message_send', 'booking', bookingId, stored ? {attachment: stored.type} : {});
    // SMS the OTHER side of the booking (admin → both), debounced 2 min per booking so a burst of
    // messages doesn't fire a burst of texts.
    if (await onceGuard(`bmsg/${bookingId}`, 2 * 60 * 1000)) {
      const recipients = admin ? [value.ownerUid, value.renterUid] : [value.ownerUid, value.renterUid].filter(uid => uid !== token.uid);
      for (const uid of recipients) await smsUser(uid, 'CrownDrive: קיבלת הודעה חדשה בצ׳אט ההזמנה. היכנסו לאתר כדי לקרוא ולהשיב.');
    }
    return json(200, {ok: true, id: ref.key});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.status ? error.message : 'שגיאת שרת — נסו שוב בעוד רגע'});
  }
}
