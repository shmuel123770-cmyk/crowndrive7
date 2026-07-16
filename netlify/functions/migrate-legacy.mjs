import {getAdmin, verify, json, isAdmin, cleanText, audit, parseBody} from './_firebase-admin.mjs';
const values = value => Array.isArray(value) ? value : Object.values(value || {});
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    if (!await isAdmin(token.uid)) return json(403, {error: 'מנהל בלבד'});
    const body = parseBody(event);
    if (!body) return json(400, {error: 'בקשה לא תקינה — נסו שוב'});
    const {action} = body;
    const db = getAdmin().database();
    const legacy = (await db.ref('crowndrive-live/state/data').once('value')).val() || null;
    if (action === 'status') return json(200, {
      exists: !!legacy,
      cars: values(legacy?.cars).length,
      owners: values(legacy?.owners).length,
      renters: values(legacy?.renters).length,
      bookings: values(legacy?.bookings).length,
    });
    if (action !== 'migrate' || !legacy) return json(400, {error: 'לא נמצאו נתונים ישנים'});
    const updates = {};
    const userMap = {};
    for (const [role, rows] of [['owner', values(legacy.owners)], ['renter', values(legacy.renters)]]) {
      for (const user of rows) {
        let uid = user.uid || user.firebaseUid;
        if (!uid && user.email) { try { uid = (await getAdmin().auth().getUserByEmail(String(user.email).trim())).uid; } catch {} }
        if (!uid) continue;
        userMap[user.id || uid] = uid;
        if (!(await db.ref(`users/${uid}`).once('value')).exists()) updates[`users/${uid}`] = {
          name: cleanText(user.name, 100), email: cleanText(user.email, 200), phone: cleanText(user.phone, 40), role,
          createdAt: Number(user.createdAt || Date.now()),
          verification: {
            email: !!user.verification?.email,
            licenseFront: !!user.verification?.licenseFront,
            licenseBack: !!user.verification?.licenseBack,
            selfie: !!user.verification?.selfie,
          },
        };
        if (!(await db.ref(`verificationStatus/${uid}`).once('value')).exists()) updates[`verificationStatus/${uid}`] = ['missing', 'pending', 'approved', 'rejected', 'needs_resubmission'].includes(user.verification?.status) ? user.verification.status : 'missing';
      }
    }
    for (const car of values(legacy.cars)) {
      const id = String(car.id || db.ref('cars').push().key);
      const ownerUid = car.ownerUid || userMap[car.ownerId];
      if (!ownerUid) continue;
      if ((await db.ref(`cars/${id}`).once('value')).exists()) continue;
      const migratedCar = {
        make: cleanText(car.make, 60), model: cleanText(car.model, 60), year: Number(car.year || new Date().getFullYear()), trim: cleanText(car.trim, 80),
        // Statuses are WHITELISTED (audit #19) — a legacy record can't smuggle an arbitrary string that
        // later lands in the UI's HTML.
        ownerUid, status: ['available', 'hidden'].includes(car.status) ? car.status : 'available', dailyPrice: Number(car.dailyPrice || car.price || 0), minAge: Number(car.minAge || 21),
        area: cleanText(car.area || car.location, 120) || 'Crown Heights', deliveryEnabled: !!car.deliveryEnabled,
        photoUrl: Array.isArray(car.photos) ? car.photos[0] || '' : car.photoUrl || '', createdAt: Number(car.createdAt || Date.now()),
      };
      updates[`cars/${id}`] = migratedCar;
      if (migratedCar.status !== 'hidden') updates[`publicCars/${id}`] = migratedCar;  // public mirror (audit #45)
    }
    for (const old of values(legacy.bookings)) {
      const id = String(old.id || db.ref('bookings').push().key);
      const ownerUid = old.ownerUid || userMap[old.ownerId];
      const renterUid = old.renterUid || userMap[old.renterId];
      if (!ownerUid || !renterUid) continue;
      if ((await db.ref(`bookings/${id}`).once('value')).exists()) continue;
      const bookingStatus = old.done ? 'done' : ['pending', 'approved', 'rejected', 'active', 'done', 'cancelled', 'expired'].includes(old.status) ? old.status : 'pending';
      updates[`bookings/${id}`] = {carId: String(old.carId || ''), ownerUid, renterUid, startAt: old.startAt || old.from || '', endAt: old.endAt || old.to || '', status: bookingStatus, done: !!old.done, createdAt: Number(old.createdAt || Date.now())};
    }
    updates['migration/v2'] = {completedAt: Date.now(), source: 'crowndrive-live/state/data', actorUid: token.uid};
    await db.ref().update(updates);
    await audit(token.uid, 'legacy_migrate', 'system', 'v2', {count: Object.keys(updates).length});
    return json(200, {ok: true, count: Object.keys(updates).length});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.status ? error.message : 'שגיאת שרת — נסו שוב בעוד רגע'});
  }
}
