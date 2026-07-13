import {getAdmin, verify, json, cleanText, audit, parseBody} from './_firebase-admin.mjs';
import {rateLimit, tooMany} from './_ratelimit.mjs';
import {validateImageDataUrl} from './_media.mjs';
const allowed = new Set(['licenseFront', 'licenseBack', 'selfie']);
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    if (!(await rateLimit(token.uid, 'document', 15, 10 * 60 * 1000))) throw tooMany();
    const parsed = parseBody(event);
    if (!parsed) return json(400, {error: 'הבקשה גדולה או פגומה — נסו תמונה קטנה יותר'});
    const {documentType, path} = parsed;
    if (!allowed.has(documentType)) return json(400, {error: 'סוג מסמך לא תקין'});
    // The document image is now stored inline as a data URL; also accept a legacy storage path.
    const value = String(path || '');
    const isImage = /^data:image\//i.test(value);
    const expected = `users/${token.uid}/documents/`;
    if (!isImage && (!value.startsWith(expected) || value.includes('..'))) return json(400, {error: 'נתיב קובץ לא תקין'});
    const stored = isImage ? validateImageDataUrl(value) : cleanText(path, 500);  // real image bytes, not just the prefix
    const db = getAdmin().database();
    // Once all three documents were submitted the verification is locked —
    // re-upload is possible only if the admin asked for a redo (or rejected).
    const currentVer = (await db.ref(`users/${token.uid}/verification`).once('value')).val() || {};
    const currentStatus = (await db.ref(`verificationStatus/${token.uid}`).once('value')).val();
    if (currentVer.licenseFront && currentVer.licenseBack && currentVer.selfie && !['needs_resubmission', 'rejected'].includes(currentStatus)) {
      return json(409, {error: 'האימות הושלם ונעול — לשינוי יש לפנות למנהל האתר'});
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
    return json(error.status || 500, {error: error.message});
  }
}
