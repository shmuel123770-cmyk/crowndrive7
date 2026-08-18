import {getAdmin, verify, json, isAdmin, cleanText, parseBody, maintenanceBlocked} from './_firebase-admin.mjs';

// Who the caller is talking to, with their profile photo.
//
// users/$uid is readable only by that user or an admin, so a renter cannot read the owner's profile
// and vice versa. Names survive because they are denormalised onto the car and the booking; photos
// never were. This returns the missing half.
//
// It takes NO uid list from the client. The set of counterparts is derived here, from the caller's
// own bookings and inquiries, so the endpoint cannot be used to look anyone else up — asking for a
// stranger's photo is not a request this API can express.
//
// The Admin SDK bypasses the database rules, so there is nothing for the owner to publish, and it
// works for conversations that already exist rather than only ones created from now on.
const MAX_PEOPLE = 300;

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const user = await verify(event);
    if (await maintenanceBlocked(user.uid)) return json(503, {error: 'האתר בתחזוקה כרגע — נסו שוב בעוד מספר דקות'});
    parseBody(event);   // reject a malformed body even though nothing in it is used
    const db = getAdmin().database();

    // An admin already reads users/ wholesale, so they have every photo without this call.
    if (await isAdmin(user.uid)) return json(200, {people: {}, note: 'admin reads users directly'});

    const uid = cleanText(user.uid, 128);
    const counterparts = new Set();
    const collect = async (node, mineField, theirField) => {
      const snap = await db.ref(node).orderByChild(mineField).equalTo(uid).limitToLast(MAX_PEOPLE).once('value');
      snap.forEach(child => {
        const other = child.val()?.[theirField];
        if (other && other !== uid) counterparts.add(String(other));
      });
    };
    await Promise.all([
      collect('bookings', 'renterUid', 'ownerUid'),
      collect('bookings', 'ownerUid', 'renterUid'),
      collect('inquiries', 'renterUid', 'ownerUid'),
      collect('inquiries', 'ownerUid', 'renterUid'),
    ]);

    // Only the two fields the chat actually renders. Everything else on a profile — phone, email,
    // documents, verification — stays where it is; this is not a profile endpoint.
    const people = {};
    await Promise.all([...counterparts].slice(0, MAX_PEOPLE).map(async other => {
      const value = (await db.ref(`users/${other}`).once('value')).val();
      if (!value) return;
      people[other] = {name: value.name || '', photoURL: value.photoURL || ''};
    }));
    return json(200, {people});
  } catch (error) {
    console.error('chat-people failed', error);
    if (error?.status === 401) return json(401, {error: 'נדרשת התחברות מחדש'});
    return json(error.status || 500, {error: 'שגיאת שרת — נסו שוב בעוד רגע'});
  }
}
