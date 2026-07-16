// PHASE A of audit #45 (a "hidden" car is still readable straight from the DB, because the catalog
// node must stay world-readable for the public site): a server-maintained PUBLIC MIRROR of the
// catalog at publicCars/<id> — every non-hidden car verbatim, hidden/deleted cars absent. Every
// server code path that writes a car also refreshes its mirror entry; a scheduled backfill seeds the
// mirror once on deployed data. PHASE B (a later rev, after the mirror is confirmed populated in
// production) points the client at publicCars and locks the cars node down to owner-query + admin
// reads — from then on hidden cars are truly invisible to direct DB reads.

// Refresh one mirror entry. Pass the car record when the caller already holds it (saves a read);
// otherwise it is re-read from the source of truth.
export async function syncPublicCar(db, carId, car = undefined) {
  const value = car === undefined ? (await db.ref(`cars/${carId}`).once('value')).val() : car;
  await db.ref(`publicCars/${carId}`).set(value && value.status !== 'hidden' ? value : null);
}

// One-shot seed/repair: mirror every non-hidden car, drop mirror entries whose source is gone.
// Idempotent — safe to run any number of times.
export async function backfillPublicCars(db) {
  const cars = (await db.ref('cars').once('value')).val() || {};
  const mirror = (await db.ref('publicCars').once('value')).val() || {};
  const updates = {};
  for (const [id, car] of Object.entries(cars)) updates[`publicCars/${id}`] = car && car.status !== 'hidden' ? car : null;
  for (const id of Object.keys(mirror)) if (!(id in cars)) updates[`publicCars/${id}`] = null;
  if (Object.keys(updates).length) await db.ref().update(updates);
  await db.ref('config/publicCarsSyncedAt').set(Date.now());
  return Object.keys(cars).length;
}
