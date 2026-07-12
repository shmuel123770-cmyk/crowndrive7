import {getAdmin, verify, json, canAccessBooking, isAdmin, profile, cleanText} from './_firebase-admin.mjs';
const max = {image: 12 * 1024 * 1024, video: 180 * 1024 * 1024};
const imageTypes = new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif']);
const videoTypes = new Set(['video/mp4','video/quicktime','video/webm']);
const safe = value => String(value || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const user = await verify(event);
    const {name, type, size, kind, entityId} = JSON.parse(event.body || '{}');
    const group = String(type || '').startsWith('video/') ? 'video' : 'image';
    if (!imageTypes.has(String(type || '')) && !videoTypes.has(String(type || ''))) return json(400, {error: 'סוג קובץ לא נתמך'});
    if (!Number.isFinite(Number(size)) || Number(size) <= 0 || Number(size) > max[group]) return json(400, {error: 'גודל הקובץ אינו תקין'});
    let path;
    if (kind === 'user-document') {
      if (!['licenseFront', 'licenseBack', 'selfie'].includes(entityId)) return json(400, {error: 'סוג מסמך לא תקין'});
      if (group !== 'image') return json(400, {error: 'מסמך חייב להיות תמונה'});
      path = `users/${user.uid}/documents/${entityId}/${Date.now()}-${safe(name)}`;
    } else if (kind === 'payment') {
      if (!await canAccessBooking(user.uid, entityId)) return json(403, {error: 'אין הרשאה'});
      if (group !== 'image') return json(400, {error: 'הוכחת תשלום חייבת להיות תמונה'});
      path = `bookings/${cleanText(entityId, 100)}/payments/${user.uid}/${Date.now()}-${safe(name)}`;
    } else if (kind === 'booking-media') {
      if (!await canAccessBooking(user.uid, entityId)) return json(403, {error: 'אין הרשאה'});
      path = `bookings/${cleanText(entityId, 100)}/media/${user.uid}/${Date.now()}-${safe(name)}`;
    } else if (kind === 'avatar') {
      if (group !== 'image') return json(400, {error: 'תמונת פרופיל חייבת להיות תמונה'});
      path = `avatars/${user.uid}/${Date.now()}-${safe(name)}`;
    } else if (kind === 'car-image' || kind === 'car-video') {
      const p = await profile(user.uid);
      if (p?.role !== 'owner' && !await isAdmin(user.uid)) return json(403, {error: 'בעל רכב בלבד'});
      if (kind === 'car-image' && group !== 'image') return json(400, {error: 'תמונת רכב חייבת להיות תמונה'});
      if (kind === 'car-video' && group !== 'video') return json(400, {error: 'סרטון רכב חייב להיות וידאו'});
      path = `cars/${user.uid}/${Date.now()}-${safe(name)}`;
    } else return json(400, {error: 'סוג העלאה לא תקין'});
    const file = getAdmin().storage().bucket().file(path);
    const [uploadUrl] = await file.getSignedUrl({version: 'v4', action: 'write', expires: Date.now() + 10 * 60 * 1000, contentType: type});
    return json(200, {uploadUrl, path});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
