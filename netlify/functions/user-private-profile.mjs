import {getAdmin, verify, json, canReadUserDocs} from './_firebase-admin.mjs';
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const viewer = await verify(event);
    const {uid} = JSON.parse(event.body || '{}');
    if (!uid || !await canReadUserDocs(viewer.uid, uid)) return json(403, {error: 'אין הרשאה לפרטי השוכר'});
    const db = getAdmin().database();
    const [profileSnap, docsSnap, statusSnap] = await Promise.all([
      db.ref(`users/${uid}`).once('value'),
      db.ref(`privateUserDocuments/${uid}`).once('value'),
      db.ref(`verificationStatus/${uid}`).once('value'),
    ]);
    const profile = profileSnap.val() || {};
    profile.verification = {...(profile.verification || {}), status: statusSnap.val() || 'missing'};
    const docs = docsSnap.val() || {};
    const bucket = getAdmin().storage().bucket();
    const documents = {};
    for (const [key, path] of Object.entries(docs)) {
      const [url] = await bucket.file(path).getSignedUrl({version: 'v4', action: 'read', expires: Date.now() + 5 * 60 * 1000});
      documents[key] = url;
    }
    return json(200, {profile, documents});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
