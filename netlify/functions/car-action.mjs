import {getAdmin, verify, json, isAdmin, profile, cleanText, audit, notifyAdmin, notifyUser, parseBody, maintenanceBlocked} from './_firebase-admin.mjs';
import {rateLimit, tooMany} from './_ratelimit.mjs';
import {smsUser} from './_sms.mjs';
// A photo is either an inline data-URL image (stored straight in the record — capped at ~1MB)
// or an https link. Anything else is dropped.
const httpsUrl = value => {
  const s = String(value || '');
  if (/^data:image\//i.test(s)) return s.slice(0, 1000000);
  if (/^https:\/\//i.test(s)) return s.slice(0, 1000);
  return '';
};
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
    // Attribution for Wikimedia-sourced photos (audit #37) — Commons licenses require credit.
    photoCredits: Array.isArray(data.photoCredits)
      ? data.photoCredits.slice(0, 6).map(c => ({url: httpsUrl(c?.url), title: cleanText(c?.title, 200), license: cleanText(c?.license, 100)})).filter(c => c.url)
      : (Array.isArray(existing.photoCredits) ? existing.photoCredits : []),
    videoUrl: httpsUrl(data.videoUrl ?? existing.videoUrl),
    rentalMode: ['hourly', 'hourly_daily', 'long_term'].includes(data.rentalMode) ? data.rentalMode : (existing.rentalMode || 'hourly_daily'),
    priceOnRequest: Boolean(data.priceOnRequest ?? existing.priceOnRequest),
    weekendEnabled: Boolean(data.weekendEnabled ?? existing.weekendEnabled),
    weekendPrice: number(data.weekendPrice ?? existing.weekendPrice, 0, 1000000, 0),
    ownerUid,
    ownerName: cleanText(ownerName || existing.ownerName, 80),
  };
}
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    if (!(await rateLimit(token.uid, 'car-action', 30, 10 * 60 * 1000))) throw tooMany();
    if (await maintenanceBlocked(token.uid)) return json(503, {error: 'האתר בתחזוקה כרגע — נסו שוב בעוד מספר דקות'});
    const body = parseBody(event);
    if (!body) return json(400, {error: 'הבקשה גדולה או פגומה — נסו תמונה קטנה יותר'});
    const admin = await isAdmin(token.uid);
    const userProfile = await profile(token.uid);
    const db = getAdmin().database();
    if (!admin && userProfile?.role !== 'owner') return json(403, {error: 'בעל רכב בלבד'});
    if (body.action === 'create') {
      // An admin may publish a car ON BEHALF of an owner (the admin's user page offers it). Without
      // this the car would be created under the ADMIN's uid and then need an ownership transfer,
      // which is blocked whenever the car already has a live booking.
      let ownerUid = token.uid, ownerProfile = userProfile;
      if (admin && body.ownerUid && body.ownerUid !== token.uid) {
        ownerUid = cleanText(body.ownerUid, 128);
        ownerProfile = await profile(ownerUid);
        if (!ownerProfile) return json(404, {error: 'בעל הרכב לא נמצא'});
        if (ownerProfile.role !== 'owner') return json(409, {error: 'המשתמש אינו מוגדר כבעל רכב — שנו את סוג החשבון שלו קודם'});
      }
      const id = db.ref('cars').push().key;
      const car = publicCar(body.data || {}, ownerUid, {}, ownerProfile?.name || '');
      if (!car.make || !car.model) return json(400, {error: 'יצרן ודגם הם חובה'});
      if (!car.photos.length) return json(400, {error: 'יש להוסיף לפחות תמונה אחת של הרכב'});
      // Pricing and address stay flexible by the owner's choice (user decision) — no server-side
      // minimum price or required address here.
      const fullAddress = cleanText(body.data?.fullAddress, 500);
      const record = {...car, status: 'available', createdAt: Date.now()};
      await db.ref().update({
        [`cars/${id}`]: record,
        [`publicCars/${id}`]: record,  // public mirror (audit #45)
        [`privateCarDetails/${id}`]: {ownerUid, fullAddress, updatedAt: Date.now()},
      });
      await audit(token.uid, 'car_create', 'car', id, ownerUid !== token.uid ? {onBehalfOf: ownerUid} : {});
      if (ownerUid !== token.uid) {
        const text = `המנהל פרסם עבורך רכב חדש: ${car.make} ${car.model}`;
        await notifyUser(ownerUid, 'car', text);
        await smsUser(ownerUid, `CrownDrive: ${text}`);
      }
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
      const updates = {[`cars/${id}`]: car, [`publicCars/${id}`]: car.status !== 'hidden' ? car : null};
      if ('fullAddress' in (body.patch || {})) updates[`privateCarDetails/${id}`] = {ownerUid: existing.ownerUid, fullAddress: cleanText(body.patch.fullAddress, 500), updatedAt: Date.now()};
      await db.ref().update(updates);
      await audit(token.uid, 'car_update', 'car', id, {fields: Object.keys(body.patch || {})});
      return json(200, {ok: true});
    }
    if (body.action === 'delete') {
      const active = await db.ref('bookings').orderByChild('carId').equalTo(id).once('value');
      const blocked = Object.values(active.val() || {}).some(b => ['pending', 'approved', 'active'].includes(b.status));
      if (blocked && !admin) return json(409, {error: 'לא ניתן למחוק רכב עם הזמנה פתוחה'});
      await db.ref().update({[`cars/${id}`]: null, [`publicCars/${id}`]: null, [`privateCarDetails/${id}`]: null});
      await audit(token.uid, 'car_delete', 'car', id);
      const carLabel = `${existing.make || ''} ${existing.model || ''}`.trim() || 'רכב';
      if (admin && existing.ownerUid && existing.ownerUid !== token.uid) {
        const text = `הרכב שלך (${carLabel}) הוסר מהאתר על ידי המנהל. לפרטים פנו לתמיכה.`;
        await notifyUser(existing.ownerUid, 'car', text);
        await smsUser(existing.ownerUid, `CrownDrive: ${text}`);
      }
      // Deleting also removes privateCarDetails — a renter mid-rental silently loses the pickup
      // address. Whoever had a live booking on this car has to hear it from us, not find out.
      for (const [bookingId, b] of Object.entries(active.val() || {})) {
        if (!['pending', 'approved', 'active'].includes(b?.status) || !b.renterUid) continue;
        const text = `הרכב (${carLabel}) בהזמנה ${String(bookingId).slice(-7)} הוסר מהאתר. פנו לתמיכה להמשך טיפול.`;
        await notifyUser(b.renterUid, 'car', text);
        await smsUser(b.renterUid, `CrownDrive: ${text}`);
      }
      return json(200, {ok: true});
    }
    if (body.action === 'status') {
      const status = ['available', 'rented', 'hidden'].includes(body.status) ? body.status : null;
      if (!status) return json(400, {error: 'סטטוס לא תקין'});
      const stamped = {...existing, status, updatedAt: Date.now()};
      await db.ref().update({
        [`cars/${id}/status`]: status,
        [`cars/${id}/updatedAt`]: stamped.updatedAt,
        // Hiding removes the car from the public mirror entirely (audit #45); unhiding restores it.
        [`publicCars/${id}`]: status !== 'hidden' ? stamped : null,
      });
      // An ADMIN can flip someone else's car. Hiding it pulls it from the public site and stops all new
      // bookings — an owner who isn't told just sees their listing quietly stop earning.
      if (admin && existing.ownerUid && existing.ownerUid !== token.uid && status !== existing.status) {
        const name = `${existing.make || 'הרכב'} ${existing.model || ''}`.trim();
        const text = status === 'hidden'
          ? `הרכב שלך (${name}) הוסתר מהאתר על ידי המנהל ואינו מקבל הזמנות. לפרטים פנו לתמיכה.`
          : existing.status === 'hidden' ? `הרכב שלך (${name}) הוחזר לתצוגה באתר ומקבל הזמנות שוב.`
          : `סטטוס הרכב שלך (${name}) שונה על ידי המנהל ל${status === 'rented' ? 'תפוס' : 'פנוי'}.`;
        await notifyUser(existing.ownerUid, 'car', text);
        await smsUser(existing.ownerUid, `CrownDrive: ${text}`);
      }
      // Pre-reserve waitlist: the owner flipped the car back to AVAILABLE — renters with a pending
      // request hear about it right away (best-effort; requires Twilio env).
      if (status === 'available' && existing.status === 'rented') {
        try {
          const pendSnap = await db.ref('bookings').orderByChild('carId').equalTo(id).once('value');
          const waitingUids = [...new Set(Object.values(pendSnap.val() || {}).filter(b => b?.status === 'pending').map(b => b.renterUid).filter(Boolean))];
          for (const uid of waitingUids) {
            await notifyUser(uid, 'reserve', `הרכב ששריינתם (${existing.make || 'רכב'} ${existing.model || ''}) התפנה! בעל הרכב יאשר בהתאם לתאריכים שבחרתם`);
            await smsUser(uid, `CrownDrive: הרכב ששריינתם (${existing.make || 'רכב'} ${existing.model || ''}) התפנה! בעל הרכב יאשר את בקשתכם בהתאם לתאריכים שבחרתם.`);
          }
        } catch (error) { console.warn('waitlist sms skipped', error?.message); }
      }
      await audit(token.uid, 'car_status', 'car', id, {status});
      return json(200, {ok: true});
    }
    // Admin pin/unpin to the top of the listings — was a direct client write, which would have let the
    // public mirror drift; now it flows through here and keeps both copies in step.
    if (body.action === 'feature') {
      if (!admin) return json(403, {error: 'מנהל בלבד'});
      const featured = body.featured ? Date.now() : null;
      const stamped = {...existing, featured, updatedAt: Date.now()};
      if (featured === null) delete stamped.featured;
      await db.ref().update({
        [`cars/${id}/featured`]: featured,
        [`cars/${id}/updatedAt`]: stamped.updatedAt,
        [`publicCars/${id}`]: existing.status !== 'hidden' ? stamped : null,
      });
      await audit(token.uid, 'car_feature', 'car', id, {featured: !!featured});
      return json(200, {ok: true});
    }
    return json(400, {error: 'פעולה לא מוכרת'});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.status ? error.message : 'שגיאת שרת — נסו שוב בעוד רגע'});
  }
}
