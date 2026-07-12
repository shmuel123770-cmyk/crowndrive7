import {api} from './api.js';

export async function uploadPrivate(file, kind, entityId = '') {
  if (!file) throw new Error('לא נבחר קובץ');
  const {uploadUrl, path} = await api('media-sign-upload', {
    name: file.name,
    type: file.type,
    size: file.size,
    kind,
    entityId,
  });
  const response = await fetch(uploadUrl, {method: 'PUT', headers: {'content-type': file.type}, body: file});
  if (!response.ok) throw new Error('העלאת הקובץ נכשלה');
  return path;
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
