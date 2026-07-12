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
    await storage.ref(path).put(file, {contentType: file.type});
  } catch (error) {
    if (error?.code === 'storage/unauthorized') throw new Error('אין הרשאה להעלאה — יש לפרסם את חוקי ה-Storage המעודכנים');
    if (error?.code === 'storage/retry-limit-exceeded') throw new Error('החיבור איטי מדי — נסו שוב עם רשת יציבה');
    throw new Error('העלאת הקובץ נכשלה — נסו שוב');
  }
  return path;
}

// Private media (payment proof, handover video/photo): the server issues a short-lived,
// access-controlled signed READ url when someone authorized wants to view it.
export async function uploadPrivate(file, kind, entityId = '') { return putFile(file, kind, entityId); }

// Public media (car photos/videos, profile avatars): read the display url straight from the
// Storage SDK. It always points at the exact bucket/object we just uploaded to, so it cannot
// break on a client/server bucket-name mismatch the way the server makePublic() url could.
export async function uploadPublicMedia(file, kind, entityId = '') {
  const path = await putFile(file, kind, entityId);
  return storage.ref(path).getDownloadURL();
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
