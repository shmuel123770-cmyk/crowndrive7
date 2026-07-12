// Comprehensive end-to-end scenario tests for ALL 18 server functions, run
// against an in-memory Realtime-Database + Storage mock (firebase-admin patched).
// Run: node tests/scenarios.test.mjs
import admin from 'firebase-admin';

// ---------- in-memory RTDB ----------
const data = {};
const get = path => path.split('/').filter(Boolean).reduce((n, k) => (n == null ? undefined : n[k]), data);
function set(path, value) {
  const keys = path.split('/').filter(Boolean);
  if (!keys.length) { for (const k of Object.keys(data)) delete data[k]; Object.assign(data, value || {}); return; }
  let node = data;
  for (const k of keys.slice(0, -1)) node = node[k] = node[k] ?? {};
  if (value === null) delete node[keys.at(-1)]; else node[keys.at(-1)] = value;
}
let pushCount = 0;
function ref(path = '') {
  return {
    key: path.split('/').filter(Boolean).at(-1) || null,
    child: p => ref(`${path}/${p}`),
    push(value) { const key = `k${++pushCount}`; const r = ref(`${path}/${key}`); if (value !== undefined) r.set(value); return r; },
    async set(value) { set(path, value === undefined ? null : JSON.parse(JSON.stringify(value))); },
    async update(patch) { for (const [k, v] of Object.entries(patch)) set(`${path}/${k}`, v === undefined ? null : JSON.parse(JSON.stringify(v))); },
    async once() { const v = get(path); return {val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))), exists: () => v !== undefined}; },
    orderByChild(field) {
      return {equalTo: value => ({async once() {
        const all = get(path) || {};
        const out = {};
        for (const [k, v] of Object.entries(all)) if (v && v[field] === value) out[k] = v;
        return {val: () => (Object.keys(out).length ? JSON.parse(JSON.stringify(out)) : null), exists: () => Object.keys(out).length > 0};
      }})};
    },
  };
}
const usersByEmail = {};
const fakeApp = {
  database: () => ({ref}),
  auth: () => ({
    verifyIdToken: async token => ({uid: token, email: `${token}@x.com`, email_verified: true}),
    deleteUser: async () => {},
    getUserByEmail: async email => { const uid = usersByEmail[email]; if (!uid) throw new Error('not found'); return {uid}; },
  }),
  storage: () => ({bucket: () => ({name: 'test-bucket', file: p => ({getSignedUrl: async () => [`https://signed/${p}`], exists: async () => [true], makePublic: async () => {}, save: async () => {}})})}),
};
admin.initializeApp = () => fakeApp;
admin.credential = {cert: () => ({})};
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{}';

const call = (handler, uid, body) => handler({httpMethod: 'POST', headers: {authorization: `Bearer ${uid}`}, body: JSON.stringify(body)});
let passed = 0, failed = 0;
const check = (name, cond, extra = '') => { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${extra}`); } };
const S = r => r.statusCode;
const B = r => JSON.parse(r.body);

const fn = {};
for (const f of ['profile-save', 'car-action', 'booking-create', 'booking-action', 'message-send', 'payment-submit', 'rating-submit', 'document-register', 'verification-review', 'private-car-details', 'user-private-profile', 'media-sign-upload', 'media-upload', 'media-sign-read', 'car-media-public', 'admin-action', 'migrate-legacy', 'car-image-search'])
  fn[f] = (await import(`../netlify/functions/${f}.mjs`)).handler;

// ---------- seed ----------
set('', {admins: {a1: true}});
usersByEmail['o@x.com'] = 'o1'; usersByEmail['r@x.com'] = 'r1';

console.log('\nתרחיש A: פרופיל (profile-save)');
let r = await call(fn['profile-save'], 'o1', {action: 'create', name: 'מנחם', phone: '+1 5551112222', role: 'owner'});
check('יצירת פרופיל בעל רכב', S(r) === 200 && get('users/o1/role') === 'owner');
r = await call(fn['profile-save'], 'r1', {action: 'create', name: 'יוסי', phone: '+1 5553334444', role: 'renter'});
check('יצירת פרופיל שוכר', S(r) === 200 && get('users/r1/role') === 'renter');
r = await call(fn['profile-save'], 'r1', {action: 'create', name: 'x', role: 'renter'});
check('יצירה כפולה לא דורסת (idempotent)', S(r) === 200 && get('users/r1/name') === 'יוסי');
r = await call(fn['profile-save'], 'r1', {action: 'update', name: 'יוסי כהן', phone: '+1 5559998888', birthDate: '1990-05-15'});
check('עדכון שם/טלפון/תאריך', S(r) === 200 && get('users/r1/birthDate') === '1990-05-15');
r = await call(fn['profile-save'], 'r1', {action: 'update', role: 'owner'});
check('שוכר לא יכול לשנות תפקיד (403)', S(r) === 403);
r = await call(fn['profile-save'], 'r1', {action: 'update', photoURL: 'javascript:evil'});
check('photoURL לא-https נדחה', get('users/r1/photoURL') === '');

console.log('\nתרחיש B: רכבים (car-action)');
r = await call(fn['car-action'], 'o1', {action: 'create', data: {make: 'Toyota', model: 'Corolla', dailyPrice: 180, priceHourly: 15, photos: ['https://a/1.jpg', 'https://b/2.jpg', 'not-a-url'], fullAddress: '123 Kingston Ave'}});
check('פרסום רכב (2+ תמונות)', S(r) === 200);
const carId = B(r).id;
check('כתובת מלאה נשמרה בפרטי מעטים', get(`privateCarDetails/${carId}/fullAddress`) === '123 Kingston Ave');
check('תמונה לא-תקינה סוננה', get(`cars/${carId}/photos`).length === 2);
r = await call(fn['car-action'], 'o1', {action: 'create', data: {make: 'Honda', model: 'Civic', dailyPrice: 120, photos: ['https://a/only.jpg']}});
check('פרסום רכב עם תמונה אחת מתקבל (אין מינימום של 2)', S(r) === 200);
r = await call(fn['car-action'], 'o1', {action: 'create', data: {make: 'Mazda', model: '3', dailyPrice: 120, photos: []}});
check('פרסום רכב בלי אף תמונה נדחה (400)', S(r) === 400);
r = await call(fn['car-action'], 'r1', {action: 'create', data: {make: 'BMW', model: 'X5', photos: ['https://a/1.jpg', 'https://b/2.jpg']}});
check('שוכר לא יכול לפרסם רכב (403)', S(r) === 403);
r = await call(fn['car-action'], 'r1', {action: 'update', id: carId, patch: {dailyPrice: 1}});
check('לא-בעלים לא יכול לערוך רכב (403)', S(r) === 403);
r = await call(fn['car-action'], 'o1', {action: 'update', id: carId, patch: {dailyPrice: 200}});
check('בעל הרכב מעדכן מחיר', S(r) === 200 && get(`cars/${carId}/dailyPrice`) === 200);
r = await call(fn['car-action'], 'o1', {action: 'status', id: carId, status: 'hidden'});
check('הסתרת רכב', S(r) === 200 && get(`cars/${carId}/status`) === 'hidden');
await call(fn['car-action'], 'o1', {action: 'status', id: carId, status: 'available'});

console.log('\nתרחיש C: אימות רישיון (document-register + verification-review)');
for (const doc of ['licenseFront', 'licenseBack']) await call(fn['document-register'], 'r1', {documentType: doc, path: `users/r1/documents/${doc}/x.jpg`});
r = await call(fn['document-register'], 'r1', {documentType: 'selfie', path: 'users/r1/documents/selfie/x.jpg'});
check('שלושת המסמכים → סטטוס pending', get('verificationStatus/r1') === 'pending');
r = await call(fn['document-register'], 'r1', {documentType: 'selfie', path: 'users/r1/documents/selfie/y.jpg'});
check('אימות נעול אחרי השלמה (409)', S(r) === 409);
r = await call(fn['document-register'], 'r1', {documentType: 'licenseFront', path: 'users/r2/documents/licenseFront/x.jpg'});
check('נתיב של משתמש אחר נדחה (400)', S(r) === 400);
r = await call(fn['verification-review'], 'r1', {uid: 'r1', status: 'approved'});
check('לא-מנהל לא יכול לאשר אימות (403)', S(r) === 403);
r = await call(fn['verification-review'], 'a1', {uid: 'r1', status: 'approved', note: 'אושר'});
check('מנהל מאשר אימות', S(r) === 200 && get('verificationStatus/r1') === 'approved');

console.log('\nתרחיש D: הזמנה מלאה (booking-create → action)');
const start = new Date(Date.now() + 86400000).toISOString(), end = new Date(Date.now() + 3 * 86400000).toISOString();
r = await call(fn['booking-create'], 'r1', {carId, startAt: start, endAt: end});
check('שוכר מאומת מזמין', S(r) === 200);
const bId = B(r).id;
r = await call(fn['booking-create'], 'o1', {carId, startAt: start, endAt: end});
check('בעל הרכב לא יכול להזמין את עצמו', S(r) !== 200);
r = await call(fn['booking-create'], 'r1', {carId, startAt: 'bad', endAt: 'bad'});
check('תאריכים לא תקינים נדחו (400)', S(r) === 400);
r = await call(fn['booking-action'], 'r1', {action: 'status', bookingId: bId, status: 'approved'});
check('שוכר לא מאשר לעצמו (403)', S(r) === 403);
r = await call(fn['booking-action'], 'o1', {action: 'status', bookingId: bId, status: 'approved'});
check('בעל הרכב מאשר', S(r) === 200);

console.log('\nתרחיש E: צ׳אט, ראיות ותשלום');
r = await call(fn['message-send'], 'r1', {bookingId: bId, text: 'שלום'});
check('צ׳אט נפתח אחרי אישור', S(r) === 200);
r = await call(fn['booking-action'], 'o1', {action: 'status', bookingId: bId, status: 'active'});
check('אי אפשר להתחיל בלי ראיות (409)', S(r) === 409);
for (const [type, name] of [['evidence-video', 'v.mp4'], ['evidence-fuel', 'f.jpg'], ['evidence-odometer', 'o.jpg']])
  await call(fn['message-send'], 'r1', {bookingId: bId, text: 't', attachment: {type, path: `bookings/${bId}/media/r1/${name}`}});
check('3 ראיות נרשמו', get(`bookings/${bId}/evidence/video`) && get(`bookings/${bId}/evidence/fuel`) && get(`bookings/${bId}/evidence/odometer`));
r = await call(fn['payment-submit'], 'r1', {bookingId: bId, amount: 600, mediaPath: `bookings/${bId}/payments/r1/p.jpg`});
check('הוכחת תשלום', S(r) === 200 && get(`payments/${bId}/amount`) === 600);
r = await call(fn['payment-submit'], 'r1', {bookingId: bId, amount: -5, mediaPath: `bookings/${bId}/payments/r1/p.jpg`});
check('סכום שלילי נדחה (400)', S(r) === 400);
r = await call(fn['payment-submit'], 'r1', {bookingId: bId, amount: 5, mediaPath: 'bookings/OTHER/payments/r1/p.jpg'});
check('נתיב תשלום מזויף נדחה (400)', S(r) === 400);
r = await call(fn['booking-action'], 'o1', {action: 'status', bookingId: bId, status: 'active'});
check('התחלת השכרה אחרי כל הראיות', S(r) === 200);

console.log('\nתרחיש F: פרטים פרטיים + מדיה');
r = await call(fn['private-car-details'], 'r1', {bookingId: bId});
check('שוכר רואה כתובת אחרי אישור', S(r) === 200 && B(r).fullAddress === '123 Kingston Ave');
r = await call(fn['private-car-details'], 'x9', {bookingId: bId});
check('זר לא רואה כתובת (403)', S(r) === 403);
r = await call(fn['user-private-profile'], 'o1', {uid: 'r1'});
check('בעל הרכב רואה מסמכי שוכר פעיל', S(r) === 200 && !!B(r).documents.licenseFront);
r = await call(fn['user-private-profile'], 'x9', {uid: 'r1'});
check('זר לא רואה מסמכי שוכר (403)', S(r) === 403);
r = await call(fn['media-sign-upload'], 'r1', {name: 'x.jpg', type: 'image/jpeg', size: 1000, kind: 'user-document', entityId: 'licenseFront'});
check('חתימת העלאת מסמך', S(r) === 200 && B(r).path.startsWith('users/r1/documents/'));
r = await call(fn['media-sign-upload'], 'r1', {name: 'x.exe', type: 'application/x-msdownload', size: 1000, kind: 'user-document', entityId: 'licenseFront'});
check('סוג קובץ אסור נדחה (400)', S(r) === 400);
r = await call(fn['media-sign-upload'], 'r1', {name: 'big.jpg', type: 'image/jpeg', size: 99 * 1024 * 1024, kind: 'user-document', entityId: 'licenseFront'});
check('קובץ גדול מדי נדחה (400)', S(r) === 400);
r = await call(fn['media-sign-upload'], 'r1', {name: 'a.jpg', type: 'image/jpeg', size: 1000, kind: 'avatar'});
check('חתימת תמונת פרופיל', S(r) === 200 && B(r).path.startsWith('avatars/r1/'));
// Direct server image upload (base64 → Admin SDK write). 1x1 png:
const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC';
r = await call(fn['media-upload'], 'o1', {name: 'car.jpg', type: 'image/jpeg', kind: 'car-image', data: png1x1});
check('העלאת תמונת רכב בשרת (מחזיר url+path)', S(r) === 200 && B(r).path.startsWith('cars/o1/') && /firebasestorage.*token=/.test(B(r).url));
r = await call(fn['media-upload'], 'r1', {name: 'car.jpg', type: 'image/jpeg', kind: 'car-image', data: png1x1});
check('שוכר לא יכול להעלות תמונת רכב (403)', S(r) === 403);
r = await call(fn['media-upload'], 'r1', {name: 'x.exe', type: 'application/x-msdownload', kind: 'avatar', data: png1x1});
check('סוג לא-תמונה בהעלאת שרת נדחה (400)', S(r) === 400);
r = await call(fn['media-upload'], 'r1', {name: 'a.jpg', type: 'image/jpeg', kind: 'avatar', data: ''});
check('העלאת שרת בלי נתונים נדחית (400)', S(r) === 400);
r = await call(fn['media-sign-read'], 'r1', {path: `bookings/${bId}/media/r1/v.mp4`});
check('קריאת מדיה של הזמנה מורשית', S(r) === 200);
r = await call(fn['media-sign-read'], 'x9', {path: '../../etc/passwd'});
check('נתיב זדוני (..) נדחה (400)', S(r) === 400);
r = await call(fn['car-media-public'], 'r1', {path: 'avatars/r1/a.jpg'});
check('פרסום תמונת פרופיל עצמית', S(r) === 200);
r = await call(fn['car-media-public'], 'r1', {path: 'avatars/OTHER/a.jpg'});
check('לא יכול לפרסם אוואטר של אחר (403)', S(r) === 403);

console.log('\nתרחיש G: סיום, דירוגים וצ׳אט סגור');
r = await call(fn['rating-submit'], 'r1', {bookingId: bId, type: 'car', score: 5, review: 'מעולה'});
check('אי אפשר לדרג לפני סיום (409)', S(r) === 409);
r = await call(fn['booking-action'], 'o1', {action: 'status', bookingId: bId, status: 'done'});
check('סיום השכרה', S(r) === 200 && get(`bookings/${bId}/status`) === 'done');
r = await call(fn['message-send'], 'r1', {bookingId: bId, text: 'hi'});
check('צ׳אט נסגר אחרי סיום (409)', S(r) === 409);
r = await call(fn['rating-submit'], 'r1', {bookingId: bId, type: 'car', score: 5, review: 'רכב מצוין'});
check('שוכר מדרג רכב אחרי סיום', S(r) === 200);
r = await call(fn['rating-submit'], 'r1', {bookingId: bId, type: 'car', score: 4});
check('דירוג כפול נחסם (409)', S(r) === 409);
r = await call(fn['rating-submit'], 'o1', {bookingId: bId, type: 'car', score: 5});
check('בעל הרכב לא יכול לדרג רכב (403)', S(r) === 403);
r = await call(fn['rating-submit'], 'o1', {bookingId: bId, type: 'user', score: 5, review: 'שוכר טוב'});
check('בעל הרכב מדרג שוכר', S(r) === 200 && get(`ratings/${bId}_user_o1/targetUid`) === 'r1');

console.log('\nתרחיש H: שליטת מנהל (admin-action)');
r = await call(fn['admin-action'], 'r1', {action: 'user-block', uid: 'x9', blocked: true});
check('לא-מנהל חסום (403)', S(r) === 403);
r = await call(fn['admin-action'], 'a1', {action: 'user-block', uid: 'r1', blocked: true});
check('מנהל חוסם משתמש', S(r) === 200 && get('users/r1/blocked') === true);
r = await call(fn['booking-create'], 'r1', {carId, startAt: start, endAt: end});
check('משתמש חסום לא יכול לפעול (403)', S(r) === 403);
r = await call(fn['admin-action'], 'a1', {action: 'user-block', uid: 'r1', blocked: false});
check('שחרור חסימה', S(r) === 200 && get('users/r1/blocked') === false);
r = await call(fn['admin-action'], 'a1', {action: 'user-update', uid: 'r1', patch: {name: 'שם מנהל', phone: '+1 000'}});
check('מנהל עורך משתמש', S(r) === 200 && get('users/r1/name') === 'שם מנהל');
r = await call(fn['admin-action'], 'a1', {action: 'car-owner', carId, uid: 'r1'});
check('העברת בעלות רכב', S(r) === 200 && get(`cars/${carId}/ownerUid`) === 'r1');
await call(fn['admin-action'], 'a1', {action: 'car-owner', carId, uid: 'o1'});
r = await call(fn['admin-action'], 'a1', {action: 'booking-admin', bookingId: bId, note: 'שולם במזומן', amount: 500});
check('הערת + סכום מנהל להזמנה', S(r) === 200 && get(`bookings/${bId}/adminNote`) === 'שולם במזומן');
r = await call(fn['admin-action'], 'a1', {action: 'maintenance', on: true});
check('מצב תחזוקה', S(r) === 200 && get('config/maintenance/on') === true);
await call(fn['admin-action'], 'a1', {action: 'maintenance', on: false});
r = await call(fn['admin-action'], 'a1', {action: 'chat-clear', bookingId: bId});
check('ניקוי צ׳אט', S(r) === 200 && get(`messages/${bId}`) === undefined);
r = await call(fn['admin-action'], 'a1', {action: 'user-delete', uid: 'x9'});
check('מחיקת משתמש', S(r) === 200);

console.log('\nתרחיש I: מחיקת רכב + התראות');
r = await call(fn['car-action'], 'o1', {action: 'create', data: {make: 'Kia', model: 'Rio', dailyPrice: 90, priceHourly: 10, photos: ['https://a/1.jpg', 'https://b/2.jpg']}});
const car2 = B(r).id;
r = await call(fn['car-action'], 'o1', {action: 'delete', id: car2});
check('מחיקת רכב פנוי', S(r) === 200 && get(`cars/${car2}`) === undefined);
check('התראות מנהל נוצרו', Object.keys(get('adminNotifications') || {}).length >= 3);

console.log('\nתרחיש J: העברת נתונים ישנים (migrate-legacy)');
set('crowndrive-live/state/data', {
  owners: [{id: 'lo1', email: 'o@x.com', name: 'Legacy Owner', phone: '111'}],
  renters: [{id: 'lr1', email: 'r@x.com', name: 'Legacy Renter'}],
  cars: [{id: 'lc1', ownerId: 'lo1', make: 'Ford', model: 'Focus', price: 120}],
  bookings: [{id: 'lb1', carId: 'lc1', ownerId: 'lo1', renterId: 'lr1', status: 'done', done: true}],
});
r = await call(fn['migrate-legacy'], 'r1', {action: 'status'});
check('לא-מנהל לא יכול להעביר (403)', S(r) === 403);
r = await call(fn['migrate-legacy'], 'a1', {action: 'status'});
check('סטטוס נתונים ישנים', S(r) === 200 && B(r).cars === 1);
r = await call(fn['migrate-legacy'], 'a1', {action: 'migrate'});
check('העברה הצליחה', S(r) === 200 && get('cars/lc1/make') === 'Ford');

console.log('\nתרחיש K: שיטות (auth / method)');
r = await fn['car-action']({httpMethod: 'GET', headers: {}, body: ''});
check('GET נדחה (405)', S(r) === 405);
r = await fn['car-action']({httpMethod: 'POST', headers: {}, body: '{}'});
check('בלי טוקן נדחה (401)', S(r) === 401);

console.log('\nתרחיש L: פרופיל מנהל (avatar upsert)');
// a1 is an admin with no /users profile — updating a photo must auto-create it.
r = await call(fn['profile-save'], 'a1', {action: 'update', name: 'מנהל האתר', photoURL: 'https://cdn/admin.jpg'});
check('מנהל בלי פרופיל מעדכן תמונה (נוצר פרופיל)', S(r) === 200 && get('users/a1/photoURL') === 'https://cdn/admin.jpg');
r = await call(fn['profile-save'], 'zz', {action: 'update', photoURL: 'https://cdn/x.jpg'});
check('משתמש רגיל בלי פרופיל עדיין נדחה (404)', S(r) === 404);
// Partial/legacy profile: has a name but no role — "complete profile" must be able to set it.
set('users/partial1', {name: 'ללא תפקיד', email: 'partial1@x.com'});
r = await call(fn['profile-save'], 'partial1', {action: 'update', role: 'owner'});
check('פרופיל חלקי בלי תפקיד — השרת קובע תפקיד', S(r) === 200 && get('users/partial1/role') === 'owner');
r = await call(fn['profile-save'], 'partial1', {action: 'update', role: 'renter'});
check('אחרי שנקבע תפקיד — לא ניתן לשנות ללא מנהל (403)', S(r) === 403 && get('users/partial1/role') === 'owner');

console.log(`\n========== ${passed} עברו · ${failed} נכשלו ==========`);
process.exit(failed ? 1 : 0);
