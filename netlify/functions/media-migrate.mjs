import {getAdmin, verify, json, isAdmin, audit} from './_firebase-admin.mjs';
import {putStorageObject} from './_storage.mjs';
import {detectedImageType} from './_media.mjs';
import {syncPublicCar} from './_public-cars.mjs';

// Admin-only, idempotent migration: move existing INLINE data:URL car images (the ones that make the
// world-readable /cars payload heavy) to Storage/CDN and replace them with tiny URLs. It runs in a
// bounded batch per call (a handful of images) so it never hits the function timeout — the client
// calls it repeatedly until {done:true}. Safe to re-run: images already stored as https URLs are left
// untouched, so a partial run simply resumes where it stopped.
const dataUrlRe = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i;
const IMAGES_PER_CALL = 6;

function decode(dataUrl) {
  const match = dataUrlRe.exec(String(dataUrl || ''));
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) return null;
    // The magic bytes decide (audit #59) — a legacy record can't turn arbitrary content into a PUBLIC
    // file by declaring image/*: non-images are skipped, and the stored type is the DETECTED one.
    const contentType = detectedImageType(buffer);
    return contentType ? {contentType, buffer} : null;
  } catch { return null; }
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    if (!(await isAdmin(token.uid))) return json(403, {error: 'מנהל בלבד'});
    const db = getAdmin().database();
    const cars = (await db.ref('cars').once('value')).val() || {};

    let migrated = 0, remaining = 0;
    for (const [carId, car] of Object.entries(cars)) {
      const ownerUid = car.ownerUid || 'legacy';
      const photos = Array.isArray(car.photos) ? [...car.photos] : [];
      const updates = {};
      let changed = false;

      // Main photo.
      if (dataUrlRe.test(String(car.photoUrl || ''))) {
        if (migrated < IMAGES_PER_CALL) {
          const img = decode(car.photoUrl);
          if (img) { updates.photoUrl = await putStorageObject(`cars/${ownerUid}/${carId}/main-${Date.now()}.jpg`, img.buffer, img.contentType); changed = true; migrated++; }
        } else remaining++;
      }
      // Gallery photos.
      for (let i = 0; i < photos.length; i++) {
        if (!dataUrlRe.test(String(photos[i] || ''))) continue;
        if (migrated < IMAGES_PER_CALL) {
          const img = decode(photos[i]);
          if (img) { photos[i] = await putStorageObject(`cars/${ownerUid}/${carId}/p${i}-${Date.now()}.jpg`, img.buffer, img.contentType); changed = true; migrated++; }
        } else remaining++;
      }

      if (changed) {
        updates.photos = photos;
        await db.ref(`cars/${carId}`).update(updates);
        await syncPublicCar(db, carId);  // keep the public mirror's photo URLs in step (audit #45)
      }
    }

    await audit(token.uid, 'media_migrate', 'cars', '', {migrated, remaining});
    return json(200, {ok: true, migrated, remaining, done: remaining === 0});
  } catch (error) {
    console.error('media-migrate failed', error);
    const m = `${error?.message || error?.code || ''} ${error?.storageStatus || ''}`;
    let why = 'נסו שוב';
    if (/permission|forbidden|403|does not have|iam|denied/i.test(m)) why = 'לחשבון השירות אין הרשאת כתיבה ל-Storage (Google Cloud → IAM)';
    else if (/not found|404|no such bucket|does not exist|notfound/i.test(m)) why = 'ה-bucket לא נמצא — בדקו את FIREBASE_STORAGE_BUCKET ב-Netlify';
    else if (/service account|credential|invalid_grant|private_key/i.test(m)) why = 'בעיה במפתח חשבון השירות';
    return json(error.status || 500, {error: `העברת התמונות נכשלה — ${why}`});
  }
}
