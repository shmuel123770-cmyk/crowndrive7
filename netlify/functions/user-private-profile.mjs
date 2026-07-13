import {getAdmin, verify, json, canReadUserDocs, parseBody} from './_firebase-admin.mjs';
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const viewer = await verify(event);
    const body = parseBody(event);
    if (!body) return json(400, {error: 'בקשה לא תקינה — נסו שוב'});
    const {uid} = body;
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
    const documents = {};
    let bucket = null;
    for (const [key, path] of Object.entries(docs)) {
      // Documents are now stored inline as data URLs — return them as-is. Only a legacy
      // storage path needs a short-lived signed url.
      if (/^data:/.test(String(path))) { documents[key] = path; continue; }
      try {
        bucket = bucket || getAdmin().storage().bucket();
        const [url] = await bucket.file(path).getSignedUrl({version: 'v4', action: 'read', expires: Date.now() + 5 * 60 * 1000});
        documents[key] = url;
      } catch { documents[key] = ''; }
    }
    return json(200, {profile, documents});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
