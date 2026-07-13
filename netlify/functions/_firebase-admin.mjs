import admin from 'firebase-admin';
let app;
export function getAdmin() {
  if (app) return app;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON missing');
  app = admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(raw)),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  }, 'crowndrive-netlify');
  return app;
}
export async function verify(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  if (!header.startsWith('Bearer ')) throw Object.assign(new Error('Unauthorized'), {status: 401});
  const decoded = await getAdmin().auth().verifyIdToken(header.slice(7));
  const blocked = (await getAdmin().database().ref(`users/${decoded.uid}/blocked`).once('value')).val();
  if (blocked === true) throw Object.assign(new Error('החשבון חסום על ידי מנהל האתר'), {status: 403});
  return decoded;
}
// Admin activity feed — every important event lands here (admin-only read).
export async function notifyAdmin(type, text, meta = {}) {
  try { await getAdmin().database().ref('adminNotifications').push({type, text, meta, createdAt: Date.now()}); } catch {}
}
export const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  },
  body: JSON.stringify(body),
});
// Parse the request JSON body robustly. Netlify may deliver a large body base64-encoded
// (event.isBase64Encoded); decode it first so JSON.parse doesn't choke. Returns null on a
// genuinely malformed/truncated body so the caller can answer with a clean Hebrew message
// instead of leaking a raw "Unexpected … JSON at position N" error to the user.
export function parseBody(event) {
  let raw = event?.body || '';
  if (event?.isBase64Encoded && raw) { try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch {} }
  try { return JSON.parse(raw || '{}'); } catch { return null; }
}
export async function isAdmin(uid) {
  return (await getAdmin().database().ref(`admins/${uid}`).once('value')).val() === true;
}
export async function profile(uid) {
  return (await getAdmin().database().ref(`users/${uid}`).once('value')).val() || null;
}
export async function booking(id) {
  return (await getAdmin().database().ref(`bookings/${id}`).once('value')).val() || null;
}
export async function canAccessBooking(uid, id) {
  if (await isAdmin(uid)) return true;
  const value = await booking(id);
  return !!value && [value.ownerUid, value.renterUid].includes(uid);
}
export async function canReadUserDocs(viewer, target) {
  if (viewer === target || await isAdmin(viewer)) return true;
  const snap = await getAdmin().database().ref('bookings').orderByChild('renterUid').equalTo(target).once('value');
  return Object.values(snap.val() || {}).some(b => b.ownerUid === viewer && ['pending', 'approved', 'active'].includes(b.status) && !b.done);
}
export function cleanText(value, max = 500) {
  return String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}
// Audit logging is best-effort — it must NEVER turn a successful business action into a 500 for the
// user (audit #11). A failed audit write is swallowed + logged, so `await audit(...)` never rejects.
export function audit(actorUid, action, entityType, entityId, details = {}) {
  return getAdmin().database().ref('auditLogs').push({actorUid, action, entityType, entityId, details, createdAt: Date.now()})
    .catch(error => { console.warn('audit write failed', error?.message); });
}
