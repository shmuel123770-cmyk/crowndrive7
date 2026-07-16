import {verify, json, isAdmin, profile, parseBody} from './_firebase-admin.mjs';
import {rateLimit, tooMany} from './_ratelimit.mjs';
import {putStorageObject} from './_storage.mjs';
import {detectedImageType} from './_media.mjs';

// Rehost a Wikimedia-suggested car photo onto OUR storage/CDN (audit #36): a hot-linked external URL
// lets its host track every visitor's IP and swap the picture after the listing was approved. The
// fetch is pinned to upload.wikimedia.org ONLY (fixed allowlist — no SSRF surface), size-capped, and
// the bytes must really be an image. Attribution is stored separately on the car (audit #37).
const ALLOWED = /^https:\/\/upload\.wikimedia\.org\//;
const MAX_BYTES = 8 * 1024 * 1024;

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    if (!(await rateLimit(token.uid, 'image-rehost', 20, 10 * 60 * 1000))) throw tooMany();
    const user = await profile(token.uid);
    if (user?.role !== 'owner' && !(await isAdmin(token.uid))) return json(403, {error: 'בעל רכב בלבד'});
    const body = parseBody(event);
    const url = String(body?.url || '');
    if (!ALLOWED.test(url)) return json(400, {error: 'ניתן לאחסן רק תמונות מוויקימדיה'});
    const response = await fetch(url, {headers: {'user-agent': 'CrownDrive/2.0 (car listing image rehost)'}});
    if (!response.ok) return json(502, {error: 'הורדת התמונה נכשלה — נסו שוב'});
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > MAX_BYTES) return json(400, {error: 'התמונה גדולה מדי'});
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_BYTES) return json(400, {error: 'התמונה גדולה מדי'});
    const contentType = detectedImageType(buffer);
    if (!contentType) return json(400, {error: 'הקובץ שהתקבל אינו תמונה תקינה'});
    const stored = await putStorageObject(`cars/${token.uid}/wiki-${Date.now()}.${contentType.split('/')[1]}`, buffer, contentType);
    return json(200, {url: stored});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.status ? error.message : 'שגיאת שרת — נסו שוב בעוד רגע'});
  }
}
