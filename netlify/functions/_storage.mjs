import {randomUUID} from 'node:crypto';
import {getAdmin} from './_firebase-admin.mjs';

// This project's real bucket is <project>.firebasestorage.app. A FIREBASE_STORAGE_BUCKET env left
// on the old <project>.appspot.com form (which 404s) would break every write, so derive/normalise
// it from the service-account project id.
export function storageBucketName() {
  const projectId = (() => { try { return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}').project_id; } catch { return ''; } })();
  const envBucket = process.env.FIREBASE_STORAGE_BUCKET || '';
  return (!envBucket || envBucket.includes('.appspot.com')) ? `${projectId || 'amar-75684'}.firebasestorage.app` : envBucket;
}

// Write bytes to Storage via the Google Cloud Storage JSON API using the Admin credential's OAuth
// access token (multipart so we can attach a permanent firebase download token). This uses only the
// built-in fetch (no @google-cloud/storage module to bundle on Netlify), works inside in-app
// browsers (the write is server-side — no CORS), and needs no Storage security rules (the Admin
// credential bypasses them). A cache-control of one immutable year lets Google's CDN + the browser
// cache the image forever, so a returned URL is downloaded at most once per client.
// Returns a public, permanent token download URL. Throws with .storageStatus set on a write failure.
export async function putStorageObject(path, buffer, contentType, {privateObject = false} = {}) {
  const {access_token} = await getAdmin().options.credential.getAccessToken();
  if (!access_token) throw new Error('service account token unavailable');
  const bucketName = storageBucketName();
  const downloadToken = randomUUID();
  const boundary = `cd${downloadToken}`;
  const metadata = privateObject ? {} : {firebaseStorageDownloadTokens: downloadToken};
  const metaJson = JSON.stringify({
    name: path,
    contentType,
    cacheControl: privateObject ? 'private, no-store' : 'public, max-age=31536000, immutable',
    metadata,
  });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`, 'utf8'),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);
  const res = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucketName)}/o?uploadType=multipart`, {
    method: 'POST',
    headers: {authorization: `Bearer ${access_token}`, 'content-type': `multipart/related; boundary=${boundary}`},
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Object.assign(new Error(detail || `storage ${res.status}`), {storageStatus: res.status});
  }
  // Private evidence/documents return no public token at all; callers read them through media-sign-read.
  if (privateObject) return '';
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`;
}
