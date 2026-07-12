import {randomUUID} from 'node:crypto';
import {getAdmin, verify, json, canAccessBooking, isAdmin, profile, cleanText} from './_firebase-admin.mjs';

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
    const {name, type, kind, entityId, data} = JSON.parse(event.body || '{}');
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

    // This project's real bucket is <project>.firebasestorage.app. A FIREBASE_STORAGE_BUCKET
    // env left on the old <project>.appspot.com form (which 404s) would break the write, so
    // derive/normalise it from the service-account project id.
    const projectId = (() => { try { return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}').project_id; } catch { return ''; } })();
    const envBucket = process.env.FIREBASE_STORAGE_BUCKET || '';
    const bucketName = (!envBucket || envBucket.includes('.appspot.com'))
      ? `${projectId || 'amar-75684'}.firebasestorage.app`
      : envBucket;
    // Write via the Firebase Storage REST API using the Admin credential's OAuth token. This
    // relies only on built-in fetch (no @google-cloud/storage module to bundle on Netlify) and
    // the endpoint auto-creates a permanent download token, returned in the response.
    const {access_token} = await getAdmin().options.credential.getAccessToken();
    const uploadRes = await fetch(`https://firebasestorage.googleapis.com/v0/b/${bucketName}/o?name=${encodeURIComponent(path)}`, {
      method: 'POST',
      headers: {authorization: `Bearer ${access_token}`, 'content-type': type},
      body: buffer,
    });
    if (!uploadRes.ok) {
      const detail = await uploadRes.text().catch(() => '');
      throw Object.assign(new Error(detail || `storage ${uploadRes.status}`), {storageStatus: uploadRes.status});
    }
    const meta = await uploadRes.json().catch(() => ({}));
    const downloadToken = String(meta.downloadTokens || '').split(',')[0] || randomUUID();
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`;
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
