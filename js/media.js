import {api} from './api.js';
import {storage} from './firebase.js';

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
    const meta = snapshot?.metadata || {};
    const token = String(meta.downloadTokens || '').split(',')[0];
    const bucket = meta.bucket || window.CROWNDRIVE_FIREBASE_CONFIG?.storageBucket;
    const url = token && bucket ? `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}` : await storage.ref(path).getDownloadURL();
    return {path, url};
  } catch (error) {
    throw new Error('העלאת הסרטון נכשלה — לסרטונים נסו בדפדפן רגיל (Safari/Chrome)');
  }
}

// Images become an inline data URL stored straight in the record; videos keep the SDK path.
export async function uploadPrivate(file, kind, entityId = '') {
  if (!file) throw new Error('לא נבחר קובץ');
  return isVideo(file) ? (await uploadVideoViaSdk(file, kind, entityId)).path : await toImageDataUrl(file);
}
export async function uploadPublicMedia(file, kind, entityId = '') {
  if (!file) throw new Error('לא נבחר קובץ');
  return isVideo(file) ? (await uploadVideoViaSdk(file, kind, entityId)).url : await toImageDataUrl(file);
}

// A stored image is already an inline data URL — return it as-is. Only true storage paths
// (legacy / video) still need a server-signed read url.
export async function signedRead(path) {
  if (/^data:/.test(String(path || ''))) return path;
  return (await api('media-sign-read', {path})).url;
}

export async function capturePhoto({facingMode = 'environment', title = 'צילום תמונה'} = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('המצלמה אינה נתמכת בדפדפן זה');
  const stream = await navigator.mediaDevices.getUserMedia({video: {facingMode}, audio: false});
  return new Promise((resolve, reject) => {
    const root = document.querySelector('#modal-root');
    root.innerHTML = `<div class="modal-backdrop"><section class="modal camera-modal"><div class="modal-head"><h2>${title}</h2><button class="close" id="camera-cancel">×</button></div><video id="camera-preview" autoplay playsinline muted></video><div class="chips"><button class="btn primary" id="camera-shot">צלם</button><button class="btn outline" id="camera-switch">החלף מצלמה</button></div></section></div>`;
    const video = root.querySelector('#camera-preview');
    video.srcObject = stream;
    const stop = () => stream.getTracks().forEach(track => track.stop());
    root.querySelector('#camera-cancel').onclick = () => { stop(); root.innerHTML = ''; reject(new Error('הצילום בוטל')); };
    root.querySelector('#camera-shot').onclick = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        stop(); root.innerHTML = '';
        if (!blob) return reject(new Error('הצילום נכשל'));
        resolve(new File([blob], `camera-${Date.now()}.jpg`, {type: 'image/jpeg'}));
      }, 'image/jpeg', 0.9);
    };
    root.querySelector('#camera-switch').onclick = async () => {
      stop(); root.innerHTML = '';
      try { resolve(await capturePhoto({facingMode: facingMode === 'user' ? 'environment' : 'user', title})); }
      catch (error) { reject(error); }
    };
  });
}
