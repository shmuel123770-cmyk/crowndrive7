import {getAdmin, verify, json, isAdmin, profile, cleanText, audit, notifyAdmin} from './_firebase-admin.mjs';
const httpsUrl = value => /^https:\/\//i.test(String(value || '')) ? String(value).slice(0, 1000) : '';
const photoList = value => Array.isArray(value) ? [...new Set(value.map(httpsUrl).filter(Boolean))].slice(0, 6) : null;
const number = (value, min, max, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
function publicCar(data, ownerUid, existing = {}, ownerName = '') {
  const photos = photoList(data.photos) ?? (Array.isArray(existing.photos) ? existing.photos : []);
  // The main photo is either the one the owner marked, or the first uploaded.
  const mainCandidate = httpsUrl(data.photoUrl ?? existing.photoUrl);
  const photoUrl = photos.length ? (photos.includes(mainCandidate) ? mainCandidate : photos[0]) : mainCandidate;
  return {
    ...existing,
    make: cleanText(data.make ?? existing.make, 60),
    model: cleanText(data.model ?? existing.model, 60),
    year: number(data.year ?? existing.year, 1980, new Date().getFullYear() + 1, new Date().getFullYear()),
    trim: cleanText(data.trim ?? existing.trim, 80),
    dailyPrice: number(data.dailyPrice ?? existing.dailyPrice, 0, 100000, 0),
    priceHourly: number(data.priceHourly ?? existing.priceHourly, 0, 100000, 0),
    priceWeekly: number(data.priceWeekly ?? existing.priceWeekly, 0, 1000000, 0),
    minAge: number(data.minAge ?? existing.minAge, 18, 99, 21),
    category: cleanText(data.category ?? existing.category, 40),
    fuel: cleanText(data.fuel ?? existing.fuel, 40),
    gear: cleanText(data.gear ?? existing.gear, 40),
    seats: number(data.seats ?? existing.seats, 1, 20, 5),
    area: cleanText(data.area ?? existing.area, 120) || 'Crown Heights',
    deliveryEnabled: Boolean(data.deliveryEnabled ?? existing.deliveryEnabled),
    deliveryCost: number(data.deliveryCost ?? existing.deliveryCost, 0, 100000, 0),
    photoUrl,
    photos,
    videoUrl: httpsUrl(data.videoUrl ?? existing.videoUrl),
    ownerUid,
    ownerName: cleanText(ownerName || existing.ownerName, 80),
  };
}
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    const body = JSON.parse(event.body || '{}');
    const admin = await isAdmin(token.uid);
    const userProfile = await profile(token.uid);
    const db = getAdmin().database();
    if (!admin && userProfile?.role !== 'owner') return json(403, {error: 'בעל רכב בלבד'});
    if (body.action === 'create') {
      const id = db.ref('cars').push().key;
      const car = publicCar(body.data || {}, token.uid, {}, userProfile?.name || '');
      if (!car.make || !car.model) return json(400, {error: 'יצרן ודגם הם חובה'});
      if (car.photos.length < 2) return json(400, {error: 'יש להעלות לפחות 2 תמונות של הרכב'});
      const fullAddress = cleanText(body.data?.fullAddress, 500);
      await db.ref().update({
        [`cars/${id}`]: {...car, status: 'available', createdAt: Date.now()},
        [`privateCarDetails/${id}`]: {ownerUid: token.uid, fullAddress, updatedAt: Date.now()},
      });
      await audit(token.uid, 'car_create', 'car', id);
      await notifyAdmin('car', `רכב חדש פורסם: ${car.make} ${car.model}`, {carId: id, by: token.uid});
      return json(200, {ok: true, id});
    }
    const id = cleanText(body.id, 100);
    const snap = await db.ref(`cars/${id}`).once('value');
    const existing = snap.val();
    if (!existing) return json(404, {error: 'רכב לא נמצא'});
    if (!admin && existing.ownerUid !== token.uid) return json(403, {error: 'אין הרשאה'});
    if (body.action === 'update') {
      const car = publicCar(body.patch || {}, existing.ownerUid, existing);
      car.updatedAt = Date.now();
      const updates = {[`cars/${id}`]: car};
      if ('fullAddress' in (body.patch || {})) updates[`privateCarDetails/${id}`] = {ownerUid: existing.ownerUid, fullAddress: cleanText(body.patch.fullAddress, 500), updatedAt: Date.now()};
      await db.ref().update(updates);
      await audit(token.uid, 'car_update', 'car', id, {fields: Object.keys(body.patch || {})});
      return json(200, {ok: true});
    }
    if (body.action === 'delete') {
      const active = await db.ref('bookings').orderByChild('carId').equalTo(id).once('value');
      const blocked = Object.values(active.val() || {}).some(b => ['pending', 'approved', 'active'].includes(b.status));
      if (blocked && !admin) return json(409, {error: 'לא ניתן למחוק רכב עם הזמנה פתוחה'});
      await db.ref().update({[`cars/${id}`]: null, [`privateCarDetails/${id}`]: null});
      await audit(token.uid, 'car_delete', 'car', id);
      return json(200, {ok: true});
    }
    if (body.action === 'status') {
      const status = ['available', 'rented', 'hidden'].includes(body.status) ? body.status : null;
      if (!status) return json(400, {error: 'סטטוס לא תקין'});
      await db.ref(`cars/${id}`).update({status, updatedAt: Date.now()});
      await audit(token.uid, 'car_status', 'car', id, {status});
      return json(200, {ok: true});
    }
    return json(400, {error: 'פעולה לא מוכרת'});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
