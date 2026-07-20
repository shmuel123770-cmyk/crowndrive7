import {getAdmin, verify, json, cleanText, audit, notifyAdmin, notifyUser, sendPush, parseBody, maintenanceBlocked} from './_firebase-admin.mjs';
import {smsUser} from './_sms.mjs';
import {rateLimit, tooMany} from './_ratelimit.mjs';
import {validateImageDataUrl} from './_media.mjs';
const allowed = new Set(['licenseFront', 'licenseBack', 'selfie']);
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    if (!(await rateLimit(token.uid, 'document', 15, 10 * 60 * 1000))) throw tooMany();
    if (await maintenanceBlocked(token.uid)) return json(503, {error: 'האתר בתחזוקה כרגע — נסו שוב בעוד מספר דקות'});
    const parsed = parseBody(event);
    if (!parsed) return json(400, {error: 'הבקשה גדולה או פגומה — נסו תמונה קטנה יותר'});
    const {documentType, path} = parsed;
    if (!allowed.has(documentType)) return json(400, {error: 'סוג מסמך לא תקין'});
    // The document image is now stored inline as a data URL; also accept a legacy storage path.
    const value = String(path || '');
    const isImage = /^data:image\//i.test(value);
    const expected = `users/${token.uid}/documents/`;
    if (!isImage && (!value.startsWith(expected) || value.includes('..'))) return json(400, {error: 'נתיב קובץ לא תקין'});
    // A legacy storage path must point at a REAL object (audit #7) — a fabricated path can no longer be
    // registered as a license/selfie. (Data-URLs are content-validated below instead.)
    if (!isImage) {
      const {storageObjectExists} = await import('./_storage.mjs');
      if ((await storageObjectExists(value)) === false) return json(400, {error: 'קובץ המסמך לא נמצא באחסון — צלמו והעלו שוב'});
    }
    const stored = isImage ? validateImageDataUrl(value) : cleanText(path, 500);  // real image bytes, not just the prefix
    const db = getAdmin().database();
    // Once all three documents were submitted the verification is locked —
    // re-upload is possible only if the admin asked for a redo (or rejected).
    const currentVer = (await db.ref(`users/${token.uid}/verification`).once('value')).val() || {};
    const currentStatus = (await db.ref(`verificationStatus/${token.uid}`).once('value')).val();
    if (currentVer.licenseFront && currentVer.licenseBack && currentVer.selfie && !['needs_resubmission', 'rejected'].includes(currentStatus)) {
      return json(409, {error: 'האימות הושלם ונעול — לשינוי יש לפנות למנהל האתר'});
    }
    // A re-shot document replaces the record — delete the PREVIOUS file if it lived in Storage, so an
    // old license photo doesn't linger forever (audit #21; best-effort, data-URLs have no file).
    const previous = (await db.ref(`privateUserDocuments/${token.uid}/${documentType}`).once('value')).val();
    if (typeof previous === 'string' && previous && !previous.startsWith('data:') && previous !== stored) {
      const {deleteStorageObject} = await import('./_storage.mjs');
      await deleteStorageObject(previous);
    }
    const updates = {};
    updates[`privateUserDocuments/${token.uid}/${documentType}`] = stored;
    updates[`users/${token.uid}/verification/${documentType}`] = true;
    updates[`users/${token.uid}/verification/updatedAt`] = Date.now();
    const profileSnap = await db.ref(`users/${token.uid}/verification`).once('value');
    const verification = {...(profileSnap.val() || {}), [documentType]: true};
    const nowComplete = verification.licenseFront && verification.licenseBack && verification.selfie;
    // AUTO-APPROVAL (user decision): the three documents are the requirement, and meeting it approves
    // the account on the spot — no admin step in between. The documents are still stored and still
    // visible in the admin area, and an admin can revoke or ask for a resubmission at any time, so
    // this removes the WAIT rather than the oversight.
    if (nowComplete) {
      updates[`verificationStatus/${token.uid}`] = 'approved';
      // The wizard's per-document flags are what the UI reads; heal them together with the status so
      // an approved user never sees a half-filled verification card.
      updates[`users/${token.uid}/verification/licenseFront`] = true;
      updates[`users/${token.uid}/verification/licenseBack`] = true;
      updates[`users/${token.uid}/verification/selfie`] = true;
      updates[`users/${token.uid}/verification/reviewedAt`] = Date.now();
      updates[`users/${token.uid}/verification/reviewedBy`] = 'auto';
    }
    await db.ref().update(updates);
    await audit(token.uid, 'document_register', 'user', token.uid, {documentType});
    // Tell the admin activity feed the moment a user finishes submitting all three documents — this is a
    // real action item ("כל מה שזז באתר"): a new verification is now waiting for the admin's review.
    if (nowComplete) {
      const name = (await db.ref(`users/${token.uid}/name`).once('value')).val() || 'משתמש';
      // The admin feed still records it — it is no longer an action item, it is a record to review
      // after the fact if they want to.
      await notifyAdmin('user', `${name} השלים/ה אימות — אושר אוטומטית`, {userUid: token.uid});
      // Tell the user themselves, the same way verification-review does on a manual approval.
      await notifyUser(token.uid, 'verification', 'האימות שלך אושר ✓ — אפשר להזמין רכבים באתר');
      await sendPush(token.uid, '✓ האימות אושר!', 'אפשר להתחיל להזמין רכבים באתר.', '/#cars');
      await smsUser(token.uid, 'CrownDrive: האימות שלך אושר — אפשר להזמין רכבים באתר.');
    }
    return json(200, {ok: true});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.status ? error.message : 'שגיאת שרת — נסו שוב בעוד רגע'});
  }
}
