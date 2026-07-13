import {getAdmin, verify, json, isAdmin, profile, cleanText, parseBody} from './_firebase-admin.mjs';

// Car listing media (gallery photos / demo video) is public by design — the
// cars node itself is world-readable. Owners upload to their own cars/<uid>/
// prefix via a signed URL, then this endpoint makes that one file public and
// returns a stable URL. Private documents/booking media never pass here.
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    const body = parseBody(event);
    if (!body) return json(400, {error: 'בקשה לא תקינה — נסו שוב'});
    const path = cleanText(body.path, 500);
    const admin = await isAdmin(token.uid);
    const ownAvatar = path.startsWith(`avatars/${token.uid}/`);
    if (!admin && !ownAvatar) {
      const p = await profile(token.uid);
      if (p?.role !== 'owner') return json(403, {error: 'בעל רכב בלבד'});
      if (!path.startsWith(`cars/${token.uid}/`)) return json(403, {error: 'נתיב לא תקין'});
    } else if (admin && !path.startsWith('cars/') && !path.startsWith('avatars/')) {
      return json(400, {error: 'נתיב לא תקין'});
    }
    const bucket = getAdmin().storage().bucket();
    const file = bucket.file(path);
    const [exists] = await file.exists();
    if (!exists) return json(404, {error: 'הקובץ לא נמצא'});
    await file.makePublic();
    const url = `https://storage.googleapis.com/${bucket.name}/${path.split('/').map(encodeURIComponent).join('/')}`;
    return json(200, {url});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
