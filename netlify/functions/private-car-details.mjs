import {getAdmin, verify, json, booking, isAdmin} from './_firebase-admin.mjs';
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    const {bookingId} = JSON.parse(event.body || '{}');
    const value = await booking(bookingId);
    if (!value) return json(404, {error: 'הזמנה לא נמצאה'});
    const admin = await isAdmin(token.uid);
    const owner = value.ownerUid === token.uid;
    const renterAllowed = value.renterUid === token.uid && ['approved', 'active'].includes(value.status);
    if (!admin && !owner && !renterAllowed) return json(403, {error: 'הכתובת זמינה רק לאחר אישור ההזמנה'});
    const details = (await getAdmin().database().ref(`privateCarDetails/${value.carId}`).once('value')).val() || {};
    return json(200, {fullAddress: details.fullAddress || ''});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
