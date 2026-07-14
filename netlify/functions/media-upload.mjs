import {verify, json, canAccessBooking, isAdmin, profile, cleanText, parseBody} from './_firebase-admin.mjs';
import {putStorageObject} from './_storage.mjs';
import {rateLimit, tooMany} from './_ratelimit.mjs';

// Direct server-side image upload: the client POSTs base64 bytes to THIS same-origin function
// and the Admin SDK writes them to Storage. This works inside in-app browsers (Telegram/IG
// webviews) that block direct cross-origin uploads to firebasestorage.googleapis.com, and it
// needs no Storage security rules (Admin SDK bypasses them). Videos are too large for a base64
// body and keep using the SDK path via media-sign-upload.
// The client always downscales/re-encodes to a compact high-quality JPEG before sending, so
// the received bytes are far smaller than the source. This is the ceiling for the encoded
// bytes (well within Netlify's ~6MB request limit); any image type is accepted.
const MAX_IMAGE = 25 * 1024 * 1024;
const safe = value => String(value || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const user = await verify(event);
    if (!(await rateLimit(user.uid, 'media-upload', 25, 10 * 60 * 1000))) throw tooMany();
    const reqBody = parseBody(event);
    if (!reqBody) return json(400, {error: 'בקשה לא תקינה — נסו שוב'});
    const {name, type, kind, entityId, data} = reqBody;
    if (!String(type || '').startsWith('image/')) return json(400, {error: 'יש להעלות קובץ תמונה'});
    const base64 = String(data || '').replace(/^data:[^,]*,/, '');
    if (!base64) return json(400, {error: 'לא התקבל קובץ'});
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return json(400, {error: 'קובץ ריק'});
    if (buffer.length > MAX_IMAGE) return json(400, {error: 'התמונה גדולה מדי גם אחרי אופטימיזציה — נסו תמונה אחרת'});

    let path;
    if (kind === 'user-document') {
      if (!['licenseFront', 'licenseBack', 'selfie'].includes(entityId)) return json(400, {error: 'סוג מסמך לא תקין'});
      path = `users/${user.uid}/documents/${entityId}/${Date.now()}-${safe(name)}`;
    } else if (kind === 'payment') {
      if (!await canAccessBooking(user.uid, entityId)) return json(403, {error: 'אין הרשאה'});
      path = `bookings/${cleanText(entityId, 100)}/payments/${user.uid}/${Date.now()}-${safe(name)}`;
    } else if (kind === 'booking-media') {
      if (!await canAccessBooking(user.uid, entityId)) return json(403, {error: 'אין הרשאה'});
      path = `bookings/${cleanText(entityId, 100)}/media/${user.uid}/${Date.now()}-${safe(name)}`;
    } else if (kind === 'avatar') {
      path = `avatars/${user.uid}/${Date.now()}-${safe(name)}`;
    } else if (kind === 'car-image') {
      const p = await profile(user.uid);
      if (p?.role !== 'owner' && !await isAdmin(user.uid)) return json(403, {error: 'בעל רכב בלבד'});
      path = `cars/${user.uid}/${Date.now()}-${safe(name)}`;
    } else return json(400, {error: 'סוג העלאה לא תקין'});

    // Write the bytes to Storage server-side (Admin credential → GCS JSON API) and get back a
    // permanent, publicly-readable, CDN-cached token URL. Shared with media-migrate.
    const url = await putStorageObject(path, buffer, type);
    return json(200, {path, url});
  } catch (error) {
    console.error('media-upload failed', error);
    if (error?.status === 401) return json(401, {error: 'נדרשת התחברות מחדש'});
    // Categorise the write failure so the (Hebrew) message tells us the real cause.
    const m = `${error?.message || error?.code || ''} ${error?.storageStatus || ''}`;
    let why = 'נסו שוב';
    if (/permission|forbidden|403|does not have|iam|denied/i.test(m)) why = 'לחשבון השירות אין הרשאת כתיבה ל-Storage (Google Cloud → IAM)';
    else if (/not found|404|no such bucket|does not exist|notfound/i.test(m)) why = 'ה-bucket לא נמצא — בדקו את FIREBASE_STORAGE_BUCKET ב-Netlify';
    else if (/cannot find module|is not a function|storage is not|require/i.test(m)) why = 'רכיב שרת חסר בפריסה';
    else if (/service account|credential|invalid_grant|private_key/i.test(m)) why = 'בעיה במפתח חשבון השירות (FIREBASE_SERVICE_ACCOUNT_JSON)';
    return json(500, {error: `העלאת התמונה נכשלה בשרת — ${why}`});
  }
}
