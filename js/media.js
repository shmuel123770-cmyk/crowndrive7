import {api} from './api.js';
import {storage} from './firebase.js';
import {modal, closeModal} from './core.js';

const isVideo = file => String(file?.type || '').startsWith('video/');

// Load a file into an <img> so we can re-encode it. Rejects for formats the browser can't
// decode (rare on-device HEIC), which triggers a raw-bytes fallback.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}
// Downscale the image and return it as an inline JPEG data URL. The image is stored DIRECTLY in
// the database record (car photos, avatar, license, payment proof) — no Firebase Storage, no
// upload endpoint, no permissions, no CORS, no in-app-browser blocking. It just works everywhere.
// Kept modest (<=1024px, q0.72) because the data URL lives inside the DB record.
async function toImageDataUrl(file) {
  let source, sw, sh;
  // Prefer createImageBitmap — it uses the OS image decoder, so it handles iPhone HEIC/HEIF
  // photos that an <img> element often refuses to decode inside in-app browsers. Fall back to
  // an <img> element for older browsers.
  try {
    source = await createImageBitmap(file);
    sw = source.width; sh = source.height;
  } catch {
    try {
      source = await loadImage(file);
      sw = source.naturalWidth || source.width; sh = source.naturalHeight || source.height;
    } catch {
      throw new Error('לא ניתן לעבד את התמונה הזו — נסו לצלם מחדש או לבחור תמונה אחרת');
    }
  }
  // Keep images modest (<=900px, q0.6) — they live inline in the DB record and travel inside the
  // request body, so small = reliable delivery through the serverless function + fast public reads.
  const max = 900, scale = Math.min(1, max / Math.max(sw || 1, sh || 1));
  const w = Math.max(1, Math.round((sw || max) * scale)), h = Math.max(1, Math.round((sh || max) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(source, 0, 0, w, h);
  if (source.close) source.close();  // release the decoded bitmap
  return canvas.toDataURL('image/jpeg', 0.6);
}

// Videos are far too large to inline — keep the Firebase Storage SDK path (works in a normal
// browser; a video is optional). Returns {path, url}.
async function uploadVideoViaSdk(file, kind, entityId) {
  if (!storage) throw new Error('שירות ההעלאות לא נטען — רעננו את הדף ונסו שוב');
  const {path} = await api('media-sign-upload', {name: file.name, type: file.type, size: file.size, kind, entityId});
  try {
    const snapshot = await storage.ref(path).put(file, {contentType: file.type});
    if (['user-document', 'payment', 'booking-media'].includes(kind)) return {path, url: ''};
    const meta = snapshot?.metadata || {};
    const token = String(meta.downloadTokens || '').split(',')[0];
    const bucket = meta.bucket || window.CROWNDRIVE_FIREBASE_CONFIG?.storageBucket;
    const url = token && bucket ? `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}` : await storage.ref(path).getDownloadURL();
    return {path, url};
  } catch (error) {
    throw new Error('העלאת הסרטון נכשלה — לסרטונים נסו בדפדפן רגיל (Safari/Chrome)');
  }
}

// Public images (car photos, avatars) are OFFLOADED to Storage/CDN so the world-readable DB record
// holds only a tiny URL instead of ~70KB of inline base64 — this is what keeps the public catalog
// fast to load (the whole cars payload downloads on every fresh visit). The client still downscales
// first (reliable everywhere), then hands the compact JPEG to the media-upload function, which writes
// it to Storage server-side — so it works inside in-app browsers that block direct Storage uploads.
// If Storage isn't set up, or the call fails for ANY reason, we fall back to the inline data URL, so
// uploads NEVER break for public media. Private kinds never fall back to the database: they are written
// to private Storage paths and later read only through short-lived signed URLs.
const OFFLOAD_KINDS = new Set(['car-image', 'avatar']);
async function offloadImage(dataUrl, kind, entityId) {
  if (!OFFLOAD_KINDS.has(kind)) return '';
  try {
    const {url} = await api('media-upload', {name: `${kind}.jpg`, type: 'image/jpeg', kind, entityId, data: dataUrl});
    return /^https?:\/\//.test(url || '') ? url : '';
  } catch { return ''; }
}

export async function uploadPrivate(file, kind, entityId = '') {
  if (!file) throw new Error('לא נבחר קובץ');
  if (isVideo(file)) return (await uploadVideoViaSdk(file, kind, entityId)).path;
  const dataUrl = await toImageDataUrl(file);
  const result = await api('media-upload', {name: `${kind}.jpg`, type: 'image/jpeg', kind, entityId, data: dataUrl});
  if (!result?.path) throw new Error('העלאת התמונה נכשלה — נסו שוב');
  return result.path;
}
export async function uploadPublicMedia(file, kind, entityId = '') {
  if (!file) throw new Error('לא נבחר קובץ');
  if (isVideo(file)) return (await uploadVideoViaSdk(file, kind, entityId)).url;
  const dataUrl = await toImageDataUrl(file);
  return (await offloadImage(dataUrl, kind, entityId)) || dataUrl;
}

// Legacy inline images are still readable; new private media is stored as a path and receives a short URL.
export async function signedRead(path) {
  if (/^data:/.test(String(path || ''))) return path;
  return (await api('media-sign-read', {path})).url;
}

export async function capturePhoto({facingMode = 'environment', title = 'צילום תמונה'} = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('המצלמה אינה נתמכת בדפדפן זה');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({video: {facingMode}, audio: false}); }
  catch (error) {
    if (['NotAllowedError', 'PermissionDeniedError'].includes(error?.name)) throw new Error('לא ניתנה הרשאה למצלמה — אפשרו גישה בהגדרות הדפדפן או בחרו תמונה מהגלריה');
    throw new Error('לא ניתן לפתוח את המצלמה — נסו שוב או בחרו תמונה מהגלריה');
  }
  return new Promise((resolve, reject) => {
    modal(`<div class="modal-head"><h2>${title}</h2><button type="button" class="close" id="camera-cancel" data-close-modal>×</button></div><div class="camera-stage"><video id="camera-preview" autoplay playsinline muted></video><div class="camera-guide" aria-hidden="true"></div></div><p class="camera-hint">מקמו את המסמך או לוח המחוונים בתוך המסגרת</p><div class="camera-actions"><button type="button" class="btn outline" id="camera-switch">החלפת מצלמה</button><button type="button" class="camera-shot" id="camera-shot" aria-label="צילום תמונה"><span aria-hidden="true"></span></button><button type="button" class="btn outline" id="camera-gallery">בחירה מהגלריה</button><input type="file" id="camera-gallery-input" accept="image/jpeg,image/png,image/webp" hidden></div>`);
    const root = document.querySelector('#modal-root');
    const section = root.querySelector('.modal');
    section?.classList.add('camera-modal');
    const video = root.querySelector('#camera-preview');
    video.srcObject = stream;
    let settled = false;
    const stop = () => stream?.getTracks().forEach(track => track.stop());
    const cancel = () => { if (settled) return; settled = true; stop(); reject(new Error('הצילום בוטל')); };
    section?.addEventListener('cd:modal-close', cancel, {once: true});
    root.querySelector('#camera-shot').onclick = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (settled) return;
        settled = true; stop(); closeModal();
        if (!blob) return reject(new Error('הצילום נכשל'));
        resolve(new File([blob], `camera-${Date.now()}.jpg`, {type: 'image/jpeg'}));
      }, 'image/jpeg', 0.9);
    };
    root.querySelector('#camera-switch').onclick = async () => {
      if (settled) return;
      settled = true; stop(); closeModal();
      try { resolve(await capturePhoto({facingMode: facingMode === 'user' ? 'environment' : 'user', title})); }
      catch (error) { reject(error); }
    };
    const fileInput = root.querySelector('#camera-gallery-input');
    root.querySelector('#camera-gallery').onclick = () => fileInput.click();
    fileInput.onchange = () => {
      const file = fileInput.files?.[0];
      if (!file || settled) return;
      settled = true; stop(); closeModal(); resolve(file);
    };
  });
}
