import {verify, json, canAccessBooking, isAdmin, profile, cleanText, parseBody, maintenanceBlocked} from './_firebase-admin.mjs';
import {putStorageObject} from './_storage.mjs';
import {rateLimit, tooMany} from './_ratelimit.mjs';
import {detectedImageType, detectedMediaType, AUDIO_TYPES, DOC_TYPES} from './_media.mjs';

// Direct server-side image upload: the client POSTs base64 bytes to THIS same-origin function
// and the Admin SDK writes them to Storage. This works inside in-app browsers (Telegram/IG
// webviews) that block direct cross-origin uploads to firebasestorage.googleapis.com, and it
// needs no Storage security rules (Admin SDK bypasses them). Videos are too large for a base64
// body and keep using the SDK path via media-sign-upload.
// The client always downscales/re-encodes to a compact high-quality JPEG before sending, so
// the received bytes are far smaller than the source. This is the ceiling for the encoded
// bytes (well within Netlify's ~6MB request limit); any image type is accepted.
const MAX_IMAGE = 4 * 1024 * 1024;
// Voice notes and documents ride the same base64 body, so they share the image ceiling — it is the
// Netlify request limit that sets it, not the media. 4MB decoded is ~5.3MB encoded, which the image
// path has been carrying in production. A minute of Opus is well under 1MB; a scanned PDF is the
// case that will actually hit this, and the client says so plainly rather than failing at the server.
const MAX_MEDIA = 4 * 1024 * 1024;
// Chat attachments ONLY. Avatars, car photos, identity documents and payment proofs stay images:
// widening those would be a different decision with different review paths behind it.
const MEDIA_KINDS = new Set(['booking-media']);
const EXT_FOR = {'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3',
                 'audio/mp4': 'm4a', 'application/pdf': 'pdf'};
const safe = value => String(value || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
// Shared magic-byte detector from _media.mjs; this endpoint stays stricter than the detector (no GIF).
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const user = await verify(event);
    if (await maintenanceBlocked(user.uid)) return json(503, {error: 'האתר בתחזוקה כרגע — נסו שוב בעוד מספר דקות'});  // audit #23
    if (!(await rateLimit(user.uid, 'media-upload', 25, 10 * 60 * 1000))) throw tooMany();
    const reqBody = parseBody(event);
    if (!reqBody) return json(400, {error: 'בקשה לא תקינה — נסו שוב'});
    const {name, type, kind, entityId, data} = reqBody;
    const declared = String(type || '').toLowerCase();
    // A voice note or a document is only offered inside a booking chat, so the door only opens for
    // that kind. Everything else keeps the original image-only contract untouched.
    const wantsMedia = MEDIA_KINDS.has(kind) && (AUDIO_TYPES.has(declared) || DOC_TYPES.has(declared));
    if (!wantsMedia && !['image/jpeg', 'image/png', 'image/webp'].includes(declared)) return json(400, {error: 'יש להעלות תמונת JPG, PNG או WebP'});
    const base64 = String(data || '').replace(/^data:[^,]*,/, '');
    if (!base64) return json(400, {error: 'לא התקבל קובץ'});
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return json(400, {error: 'קובץ ריק'});

    let detectedType;
    if (wantsMedia) {
      if (buffer.length > MAX_MEDIA) return json(400, {error: 'הקובץ גדול מדי — עד 4MB'});
      // The declared type is the client's claim; this is what the bytes actually are. They must
      // agree, so a PDF cannot be posted as audio and played, and audio cannot be filed as a document.
      detectedType = detectedMediaType(buffer);
      if (!detectedType) return json(400, {error: 'סוג הקובץ אינו נתמך — הקלטה קולית או PDF בלבד'});
      const bothAudio = AUDIO_TYPES.has(detectedType) && AUDIO_TYPES.has(declared);
      const bothDocs = DOC_TYPES.has(detectedType) && DOC_TYPES.has(declared);
      if (!bothAudio && !bothDocs) return json(400, {error: 'תוכן הקובץ אינו תואם לסוג שהוצהר'});
    } else {
      if (buffer.length > MAX_IMAGE) return json(400, {error: 'התמונה גדולה מדי גם אחרי אופטימיזציה — נסו תמונה אחרת'});
      detectedType = detectedImageType(buffer);
      if (!ACCEPTED.has(detectedType)) return json(400, {error: 'תוכן הקובץ אינו תמונת JPG, PNG או WebP תקינה'});
    }

    let path;
    if (kind === 'user-document') {
      if (!['licenseFront', 'licenseBack', 'selfie'].includes(entityId)) return json(400, {error: 'סוג מסמך לא תקין'});
      path = `users/${user.uid}/documents/${entityId}/${Date.now()}-${safe(name)}`;
    } else if (kind === 'payment') {
      if (!await canAccessBooking(user.uid, entityId)) return json(403, {error: 'אין הרשאה'});
      path = `bookings/${cleanText(entityId, 100)}/payments/${user.uid}/${Date.now()}-${safe(name)}`;
    } else if (kind === 'booking-media') {
      if (!await canAccessBooking(user.uid, entityId)) return json(403, {error: 'אין הרשאה'});
      const ext = EXT_FOR[detectedType];
      const filename = ext ? `${safe(name).replace(/\.[a-z0-9]+$/i, '')}.${ext}` : safe(name);
      path = `bookings/${cleanText(entityId, 100)}/media/${user.uid}/${Date.now()}-${filename}`;
    } else if (kind === 'avatar') {
      path = `avatars/${user.uid}/${Date.now()}-${safe(name)}`;
    } else if (kind === 'car-image') {
      const p = await profile(user.uid);
      if (p?.role !== 'owner' && !await isAdmin(user.uid)) return json(403, {error: 'בעל רכב בלבד'});
      path = `cars/${user.uid}/${Date.now()}-${safe(name)}`;
    } else return json(400, {error: 'סוג העלאה לא תקין'});

    // Write the bytes to Storage server-side (Admin credential → GCS JSON API) and get back a
    // permanent, publicly-readable, CDN-cached token URL. Shared with media-migrate.
    // Identity documents, payment proofs and handover evidence are private: no permanent public token.
    const privateObject = ['user-document', 'payment', 'booking-media'].includes(kind);
    const url = await putStorageObject(path, buffer, detectedType, {privateObject});
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
