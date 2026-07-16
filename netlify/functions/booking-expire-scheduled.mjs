import {getAdmin} from './_firebase-admin.mjs';
import {smsUser} from './_sms.mjs';

// Flip stale PENDING bookings to 'expired' — a request the owner never answered within the 48h window (set
// at booking-create as pendingExpiresAt). It ONLY touches bookings that are status:'pending' AND have a
// pendingExpiresAt in the past; legacy pending bookings (no expiry field) are left alone, and no other
// status is ever changed. The core is exported so the scenario tests can drive it against the in-memory DB.
export async function expireStalePending(db = getAdmin().database(), now = Date.now()) {
  // Query ONLY pending bookings (audit #31) — requires "status" in the bookings .indexOn rule; the
  // in-loop status check stays as a second guard either way.
  const all = (await db.ref('bookings').orderByChild('status').equalTo('pending').once('value')).val() || {};
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
    // The endpoint is publicly reachable, so an outside caller could hammer full scans (audit #32).
    // A transaction-claimed timestamp caps it at one scan per 5 minutes — the hourly Netlify schedule
    // is never blocked, and forged calls can't create load or cost.
    const gate = await getAdmin().database().ref('config/lastExpireRun').transaction(last => {
      if (Number(last) && Date.now() - Number(last) < 5 * 60 * 1000) return;  // abort — ran recently
      return Date.now();
    });
    if (!gate.committed) return {statusCode: 429, body: JSON.stringify({error: 'ההרצה הקודמת הייתה ממש עכשיו — נסו שוב מאוחר יותר'})};
    // One-time seed of the public catalog mirror (audit #45 phase A): within an hour of deploying
    // this rev, publicCars is populated automatically — no manual step. Idempotent and then skipped.
    const db = getAdmin().database();
    if (!(await db.ref('config/publicCarsSyncedAt').once('value')).val()) {
      const {backfillPublicCars} = await import('./_public-cars.mjs');
      const count = await backfillPublicCars(db);
      console.log('publicCars backfill completed:', count, 'cars');
    }
    const {expired} = await expireStalePending();
    console.log('booking-expire-scheduled: expired', expired);
    return {statusCode: 200, body: JSON.stringify({ok: true, expired})};
  } catch (error) {
    console.error('booking-expire-scheduled error', error);
    // Detail stays in the function log — the HTTP response (this endpoint is publicly reachable) is generic.
    return {statusCode: 500, body: JSON.stringify({error: 'שגיאת שרת'})};
  }
}
