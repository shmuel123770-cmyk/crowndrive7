import {getAdmin, verify, json, cleanText, audit, parseBody, maintenanceBlocked} from './_firebase-admin.mjs';
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
    if (verification.licenseFront && verification.licenseBack && verification.selfie) {
      updates[`verificationStatus/${token.uid}`] = 'pending';
    }
    await db.ref().update(updates);
    await audit(token.uid, 'document_register', 'user', token.uid, {documentType});
    return json(200, {ok: true});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.status ? error.message : 'שגיאת שרת — נסו שוב בעוד רגע'});
  }
}
