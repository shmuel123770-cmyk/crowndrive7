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
const toBase64 = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
  reader.onerror = () => reject(new Error('read'));
  reader.readAsDataURL(blob);
});

// Downscale to <=1600px and re-encode as JPEG so the base64 body stays small (well under the
// function's request limit). Falls back to the raw bytes if the browser can't decode the image.
async function toImagePayload(file) {
  try {
    const img = await loadImage(file);
    const max = 1600, scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
    if (blob && blob.size) return {type: 'image/jpeg', data: await toBase64(blob)};
  } catch {}
  if (file.size > 4 * 1024 * 1024) throw new Error('התמונה גדולה מדי — נסו תמונה קטנה יותר או צלמו מחדש');
  return {type: file.type || 'image/jpeg', data: await toBase64(file)};
}

// Images upload through our OWN function (same-origin POST → Admin SDK writes the file). This
// works even inside in-app browsers that block direct uploads to firebasestorage.googleapis.com,
// and needs no Storage rules. Returns {path, url}.
async function uploadImageViaServer(file, kind, entityId) {
  if (!file) throw new Error('לא נבחר קובץ');
  const {type, data} = await toImagePayload(file);
  return api('media-upload', {name: file.name, type, kind, entityId, data});
}

// Videos are too large for a base64 body — keep the Firebase Storage SDK path for them.
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
    if (error?.code === 'storage/unauthorized') throw new Error('אין הרשאה להעלאת הסרטון — יש לפרסם את חוקי ה-Storage');
    throw new Error('העלאת הסרטון נכשלה — לסרטונים נסו בדפדפן רגיל (Safari/Chrome)');
  }
}

// Private media (payment proof, handover photo/video): the server issues a short-lived,
// access-controlled signed READ url later, so we only need the storage path here.
export async function uploadPrivate(file, kind, entityId = '') {
  if (!file) throw new Error('לא נבחר קובץ');
  return (isVideo(file) ? await uploadVideoViaSdk(file, kind, entityId) : await uploadImageViaServer(file, kind, entityId)).path;
}

// Public media (car photos/videos, profile avatars): return a permanent display url.
export async function uploadPublicMedia(file, kind, entityId = '') {
  if (!file) throw new Error('לא נבחר קובץ');
  return (isVideo(file) ? await uploadVideoViaSdk(file, kind, entityId) : await uploadImageViaServer(file, kind, entityId)).url;
}

export async function signedRead(path) {
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
