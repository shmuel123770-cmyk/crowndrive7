import {getAdmin} from './_firebase-admin.mjs';
import {smsUser} from './_sms.mjs';

// Flip stale PENDING bookings to 'expired' — a request the owner never answered within the 48h window (set
// at booking-create as pendingExpiresAt). It ONLY touches bookings that are status:'pending' AND have a
// pendingExpiresAt in the past; legacy pending bookings (no expiry field) are left alone, and no other
// status is ever changed. The core is exported so the scenario tests can drive it against the in-memory DB.
export async function expireStalePending(db = getAdmin().database(), now = Date.now()) {
  const all = (await db.ref('bookings').once('value')).val() || {};
  const expired = [];
  for (const [id, b] of Object.entries(all)) {
    const exp = Number(b?.pendingExpiresAt || 0);
    if (b?.status === 'pending' && exp && exp < now) {
      await db.ref(`bookings/${id}`).update({status: 'expired', expiredAt: now, updatedAt: now});
      expired.push({id, renterUid: b.renterUid});
    }
  }
  // Let each renter know their request lapsed (best-effort; never fails the batch).
  for (const {id, renterUid} of expired) {
    if (renterUid) await smsUser(renterUid, `CrownDrive: בקשת ההזמנה שלך (${String(id).slice(-7)}) פגה — בעל הרכב לא הגיב בזמן. אפשר לשלוח בקשה חדשה.`).catch(() => {});
  }
  return {expired: expired.length, ids: expired.map(e => e.id)};
}

export async function handler() {
  try {
    const {expired} = await expireStalePending();
    console.log('booking-expire-scheduled: expired', expired);
    return {statusCode: 200, body: JSON.stringify({ok: true, expired})};
  } catch (error) {
    console.error('booking-expire-scheduled error', error);
    return {statusCode: 500, body: JSON.stringify({error: error.message})};
  }
}
