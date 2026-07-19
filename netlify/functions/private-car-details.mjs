import {getAdmin, verify, json, booking, isAdmin, cleanText, parseBody} from './_firebase-admin.mjs';
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    const body = parseBody(event);
    if (!body) return json(400, {error: 'בקשה לא תקינה — נסו שוב'});
    const {bookingId} = body;
    const value = await booking(bookingId);
    if (!value) return json(404, {error: 'הזמנה לא נמצאה'});
    const admin = await isAdmin(token.uid);
    const owner = value.ownerUid === token.uid;
    const renterAllowed = value.renterUid === token.uid && ['approved', 'active'].includes(value.status);
    if (!admin && !owner && !renterAllowed) return json(403, {error: 'הכתובת זמינה רק לאחר אישור ההזמנה'});
    const db = getAdmin().database();
    const details = (await db.ref(`privateCarDetails/${value.carId}`).once('value')).val() || {};
    // The owner has had the renter's name and phone on the booking since it was created; the renter had
    // NOTHING about the owner — `users/$uid` is readable only by that user or an admin. Handing over a
    // car is a meeting between two people, and only one of them could pick up a phone. This endpoint is
    // already gated to an APPROVED/active booking (the same bar as releasing the address), so the
    // owner's contact rides along with it rather than being exposed from the moment a request is sent.
    const ownerProfile = (await db.ref(`users/${value.ownerUid}`).once('value')).val() || {};
    return json(200, {
      fullAddress: details.fullAddress || '',
      ownerName: cleanText(ownerProfile.name, 100),
      ownerPhone: cleanText(ownerProfile.phone, 40),
    });
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.status ? error.message : 'שגיאת שרת — נסו שוב בעוד רגע'});
  }
}
