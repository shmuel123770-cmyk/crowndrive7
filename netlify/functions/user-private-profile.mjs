import {getAdmin, verify, json, canReadUserDocs, canReadUserProfile, parseBody} from './_firebase-admin.mjs';
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const viewer = await verify(event);
    const body = parseBody(event);
    if (!body) return json(400, {error: 'בקשה לא תקינה — נסו שוב'});
    const {uid} = body;
    if (!uid || !await canReadUserProfile(viewer.uid, uid)) return json(403, {error: 'אין הרשאה לפרטי השוכר'});
    const includeDocuments = await canReadUserDocs(viewer.uid, uid);
    const db = getAdmin().database();
    const [profileSnap, docsSnap, statusSnap] = await Promise.all([
      db.ref(`users/${uid}`).once('value'),
      db.ref(`privateUserDocuments/${uid}`).once('value'),
      db.ref(`verificationStatus/${uid}`).once('value'),
    ]);
    const rawProfile = profileSnap.val() || {};
    const profile = includeDocuments
      ? {...rawProfile, verification: {...(rawProfile.verification || {}), status: statusSnap.val() || 'missing'}}
      : {name: rawProfile.name || '', email: rawProfile.email || '', phone: rawProfile.phone || '', photoURL: rawProfile.photoURL || '', verification: {status: statusSnap.val() || 'missing'}};
    const docs = docsSnap.val() || {};
    const documents = {};
    let bucket = null;
    for (const [key, path] of Object.entries(includeDocuments ? docs : {})) {
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
    return json(error.status || 500, {error: error.status ? error.message : 'שגיאת שרת — נסו שוב בעוד רגע'});
  }
}
