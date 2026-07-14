import {getAdmin, verify, json, cleanText, audit, parseBody, maintenanceBlocked} from './_firebase-admin.mjs';

// Pre-booking inquiry: a renter (or any registered visitor) opens a DIRECT conversation with a car's owner
// WITHOUT creating a booking. One thread per (car, renter) — re-contacting the same car continues the same
// thread. The thread carries {carId, renterUid, ownerUid} so both sides (and the admin) can find + read it
// via the role-filtered `inquiries` query, exactly like bookings. Messages live at messages/inquiry/<id>.
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    if (await maintenanceBlocked(token.uid)) return json(503, {error: 'האתר בתחזוקה כרגע — נסו שוב בקרוב.'});
    // Inquiries are between registered accounts and owners — a guest (anonymous) visitor must sign up first.
    if (token.firebase?.sign_in_provider === 'anonymous') return json(403, {error: 'כדי לפנות לבעל הרכב יש להתחבר עם חשבון.'});
    const body = parseBody(event);
    if (!body) return json(400, {error: 'בקשה פגומה'});
    const carId = cleanText(body.carId, 100);
    if (!carId) return json(400, {error: 'חסר מזהה רכב'});

    const db = getAdmin().database();
    const car = (await db.ref(`cars/${carId}`).once('value')).val();
    if (!car) return json(404, {error: 'הרכב לא נמצא'});
    const ownerUid = car.ownerUid;
    if (!ownerUid) return json(409, {error: 'לרכב הזה אין בעל רכב משויך — פנו לתמיכה.'});
    if (ownerUid === token.uid) return json(400, {error: 'זה הרכב שלך — אי אפשר לפנות לעצמך.'});

    const inquiryId = `${carId}__${token.uid}`;
    const ref = db.ref(`inquiries/${inquiryId}`);
    const existing = (await ref.once('value')).val();
    if (!existing) {
      await ref.set({carId, renterUid: token.uid, ownerUid, createdAt: Date.now(), updatedAt: Date.now()});
      await audit(token.uid, 'inquiry_start', 'car', carId, {ownerUid});
    } else if (existing.ownerUid !== ownerUid) {
      // Car ownership changed since the thread opened — keep it pointed at the current owner.
      await ref.update({ownerUid, updatedAt: Date.now()});
    }
    return json(200, {ok: true, inquiryId});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
