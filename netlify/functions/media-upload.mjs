import {randomUUID} from 'node:crypto';
import {getAdmin, verify, json, canAccessBooking, isAdmin, profile, cleanText} from './_firebase-admin.mjs';

// Direct server-side image upload: the client POSTs base64 bytes to THIS same-origin function
// and the Admin SDK writes them to Storage. This works inside in-app browsers (Telegram/IG
// webviews) that block direct cross-origin uploads to firebasestorage.googleapis.com, and it
// needs no Storage security rules (Admin SDK bypasses them). Videos are too large for a base64
// body and keep using the SDK path via media-sign-upload.
const MAX_IMAGE = 12 * 1024 * 1024;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const safe = value => String(value || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const user = await verify(event);
    const {name, type, kind, entityId, data} = JSON.parse(event.body || '{}');
    if (!imageTypes.has(String(type || ''))) return json(400, {error: 'סוג קובץ לא נתמך'});
    const base64 = String(data || '').replace(/^data:[^,]*,/, '');
    if (!base64) return json(400, {error: 'לא התקבל קובץ'});
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length || buffer.length > MAX_IMAGE) return json(400, {error: 'גודל התמונה אינו תקין'});

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

    const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'amar-75684.firebasestorage.app';
    const token = randomUUID();
    const fileRef = getAdmin().storage().bucket(bucketName).file(path);
    await fileRef.save(buffer, {
      resumable: false,
      metadata: {contentType: type, metadata: {firebaseStorageDownloadTokens: token}},
    });
    // A token download URL is publicly readable and permanent — no makePublic (blocked by
    // uniform bucket-level access) and no signed-url expiry.
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return json(200, {path, url});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: 'העלאת התמונה נכשלה בשרת — נסו שוב'});
  }
}
