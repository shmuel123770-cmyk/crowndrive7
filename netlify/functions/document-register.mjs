import {getAdmin, verify, json, cleanText, audit} from './_firebase-admin.mjs';
const allowed = new Set(['licenseFront', 'licenseBack', 'selfie']);
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    const {documentType, path} = JSON.parse(event.body || '{}');
    if (!allowed.has(documentType)) return json(400, {error: 'סוג מסמך לא תקין'});
    const expected = `users/${token.uid}/documents/`;
    if (!String(path || '').startsWith(expected) || String(path).includes('..')) return json(400, {error: 'נתיב קובץ לא תקין'});
    const db = getAdmin().database();
    const updates = {};
    updates[`privateUserDocuments/${token.uid}/${documentType}`] = cleanText(path, 500);
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
