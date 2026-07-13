import {getAdmin, verify, json, isAdmin, profile, parseBody} from './_firebase-admin.mjs';
import {smsUser, smsAdmin, onceGuard} from './_sms.mjs';
import {rateLimit, tooMany} from './_ratelimit.mjs';

// Client-triggered SMS for actions that happen as CLIENT-WRITES (publishing a car, creating a profile,
// sending an admin-support chat) — those never pass through a server function, so the client calls this
// afterwards (best-effort, non-blocking). Every event is RE-VERIFIED against the database here, so a
// forged call can't send bogus texts, and an onceGuard stops duplicates/retries from double-sending.
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    if (!(await rateLimit(token.uid, 'notify', 30, 60 * 1000))) throw tooMany();
    const body = parseBody(event);
    if (!body) return json(400, {error: 'bad body'});
    const db = getAdmin().database();
    const type = String(body.type || '');

    if (type === 'new-car') {
      const carId = String(body.carId || '');
      const car = (await db.ref(`cars/${carId}`).once('value')).val();
      if (!car || car.ownerUid !== token.uid) return json(200, {ok: true});          // only the real owner, real car
      if (await onceGuard(`car/${carId}`)) {
        const owner = await profile(token.uid);
        await smsAdmin(`CrownDrive: רכב חדש נוסף לאתר — ${car.make || ''} ${car.model || ''} מאת ${owner?.name || 'משתמש'}.`);
      }
      return json(200, {ok: true});
    }

    if (type === 'new-user') {
      const me = await profile(token.uid);
      if (!me) return json(200, {ok: true});
      if (await onceGuard(`user/${token.uid}`)) {
        const role = me.role === 'owner' ? 'בעל רכב' : 'שוכר';
        await smsAdmin(`CrownDrive: משתמש חדש נרשם לאתר — ${me.name || ''} (${role}).`);
      }
      return json(200, {ok: true});
    }

    if (type === 'admin-chat') {
      // A message in the admin↔user support thread. The user texts the admin; the admin texts the user.
      const userUid = String(body.userUid || token.uid);
      const admin = await isAdmin(token.uid);
      if (!admin && userUid !== token.uid) return json(403, {error: 'no access'});
      // Debounce per thread (2 min) so a burst of messages doesn't fire a burst of texts.
      if (await onceGuard(`thread/${userUid}`, 2 * 60 * 1000)) {
        if (admin) {
          await smsUser(userUid, 'CrownDrive: קיבלת הודעה חדשה מצוות האתר. היכנסו לצ׳אט כדי לקרוא ולהשיב.');
        } else {
          const me = await profile(token.uid);
          await smsAdmin(`CrownDrive: הודעה חדשה בצ׳אט התמיכה מ-${me?.name || 'משתמש'}.`);
        }
      }
      return json(200, {ok: true});
    }

    return json(200, {ok: true});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
