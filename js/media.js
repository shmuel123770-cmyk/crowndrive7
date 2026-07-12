import {api} from './api.js';
import {storage} from './firebase.js';

async function putFile(file, kind, entityId = '') {
  if (!file) throw new Error('לא נבחר קובץ');
  if (!storage) throw new Error('שירות ההעלאות לא נטען — רעננו את הדף ונסו שוב');
  // The server validates type/size/role/booking-access and returns the canonical path.
  const {path} = await api('media-sign-upload', {
    name: file.name,
    type: file.type,
    size: file.size,
    kind,
    entityId,
  });
  // Upload the bytes through the Firebase Storage SDK. It targets
  // firebasestorage.googleapis.com, which Google already serves with permissive CORS —
  // unlike a raw PUT to a v4-signed storage.googleapis.com URL, which needs bucket CORS
  // that cannot be configured from the Firebase console. Storage Rules authorize the
  // write to the user's own folder (cars/<uid>, avatars/<uid>, users/<uid>, bookings/.../<uid>).
  try {
    const snapshot = await storage.ref(path).put(file, {contentType: file.type});
    return {path, snapshot};
  } catch (error) {
    if (error?.code === 'storage/unauthorized') throw new Error('אין הרשאה להעלאה — יש לפרסם את חוקי ה-Storage המעודכנים');
    if (error?.code === 'storage/retry-limit-exceeded') throw new Error('החיבור איטי מדי — נסו שוב עם רשת יציבה');
    if (error?.code === 'storage/canceled') throw new Error('ההעלאה בוטלה');
    throw new Error('העלאת הקובץ נכשלה — נסו שוב');
  }
}

// Private media (payment proof, handover video/photo): the server issues a short-lived,
// access-controlled signed READ url when someone authorized wants to view it.
export async function uploadPrivate(file, kind, entityId = '') { return (await putFile(file, kind, entityId)).path; }

// Public media (car photos/videos, profile avatars): build the display url from the token
// that the upload response itself carries — with NO second network request. getDownloadURL()
// makes an extra XHR that some in-app browsers (Telegram/Instagram webviews) corrupt, which
// used to throw a raw JSON "Unexpected … position 6" error. getDownloadURL() is only a fallback.
export async function uploadPublicMedia(file, kind, entityId = '') {
  const {path, snapshot} = await putFile(file, kind, entityId);
  try {
    const meta = snapshot?.metadata || {};
    const token = String(meta.downloadTokens || '').split(',')[0];
    const bucket = meta.bucket || window.CROWNDRIVE_FIREBASE_CONFIG?.storageBucket;
    if (token && bucket) {
      return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    }
    return await storage.ref(path).getDownloadURL();
  } catch (error) {
    throw new Error('התמונה הועלתה אך לא הצלחנו לקבל קישור להצגה — נסו שוב');
  }
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
