import {getAdmin, verify, json, isAdmin, cleanText, audit, notifyAdmin, parseBody} from './_firebase-admin.mjs';
import {rateLimit, tooMany} from './_ratelimit.mjs';

// One endpoint for all privileged admin controls. Every action is audited.
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    if (!await isAdmin(token.uid)) return json(403, {error: 'מנהל בלבד'});
    if (!(await rateLimit(token.uid, 'admin-action', 80, 60 * 1000))) throw tooMany();
    const body = parseBody(event);
    if (!body) return json(400, {error: 'בקשה לא תקינה — נסו שוב'});
    const db = getAdmin().database();
    const uid = cleanText(body.uid, 128);

    if (body.action === 'maintenance') {
      await db.ref('config/maintenance').set({on: body.on === true, updatedAt: Date.now(), by: token.uid});
      await audit(token.uid, 'maintenance', 'config', 'maintenance', {on: body.on === true});
      return json(200, {ok: true});
    }
    if (body.action === 'user-update') {
      if (!uid) return json(400, {error: 'חסר משתמש'});
      const patch = {};
      if (body.patch?.name !== undefined) patch.name = cleanText(body.patch.name, 80);
      if (body.patch?.phone !== undefined) patch.phone = cleanText(body.patch.phone, 40);
      if (body.patch?.role !== undefined) {
        if (!['renter', 'owner'].includes(body.patch.role)) return json(400, {error: 'תפקיד לא תקין'});
        patch.role = body.patch.role;
      }
      if (!Object.keys(patch).length) return json(400, {error: 'אין שינויים'});
      await db.ref(`users/${uid}`).update({...patch, updatedAt: Date.now()});
      await audit(token.uid, 'admin_user_update', 'user', uid, {fields: Object.keys(patch)});
      return json(200, {ok: true});
    }
    if (body.action === 'user-block') {
      if (!uid) return json(400, {error: 'חסר משתמש'});
      const blocked = body.blocked === true;
      await db.ref(`users/${uid}`).update({blocked, updatedAt: Date.now()});
      await audit(token.uid, 'admin_user_block', 'user', uid, {blocked});
      await notifyAdmin('block', blocked ? 'משתמש נחסם' : 'חסימת משתמש הוסרה', {uid});
      return json(200, {ok: true});
    }
    if (body.action === 'user-delete') {
      if (!uid) return json(400, {error: 'חסר משתמש'});
      await db.ref().update({
        [`users/${uid}`]: null,
        [`verificationStatus/${uid}`]: null,
        [`privateUserDocuments/${uid}`]: null,
        [`messages/admin/${uid}`]: null,
      });
      try { await getAdmin().auth().deleteUser(uid); } catch {}
      await audit(token.uid, 'admin_user_delete', 'user', uid);
      return json(200, {ok: true});
    }
    if (body.action === 'car-owner') {
      const carId = cleanText(body.carId, 100);
      const car = (await db.ref(`cars/${carId}`).once('value')).val();
      if (!car) return json(404, {error: 'רכב לא נמצא'});
      const target = (await db.ref(`users/${uid}`).once('value')).val();
      if (!target) return json(404, {error: 'המשתמש החדש לא נמצא'});
      await db.ref().update({
        [`cars/${carId}/ownerUid`]: uid,
        [`cars/${carId}/ownerName`]: cleanText(target.name || target.email, 80),
        [`privateCarDetails/${carId}/ownerUid`]: uid,
      });
      await audit(token.uid, 'admin_car_owner', 'car', carId, {newOwner: uid});
      return json(200, {ok: true});
    }
    if (body.action === 'booking-admin') {
      const bookingId = cleanText(body.bookingId, 100);
      const current = (await db.ref(`bookings/${bookingId}`).once('value')).val();
      if (!current) return json(404, {error: 'הזמנה לא נמצאה'});
      const patch = {updatedAt: Date.now()};
      if (body.note !== undefined) patch.adminNote = cleanText(body.note, 1000);
      if (body.amount !== undefined) {
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) return json(400, {error: 'סכום לא תקין'});
        patch.adminAmount = amount;
      }
      await db.ref(`bookings/${bookingId}`).update(patch);
      await audit(token.uid, 'admin_booking_edit', 'booking', bookingId, {fields: Object.keys(patch)});
      return json(200, {ok: true});
    }
    if (body.action === 'chat-clear') {
      const thread = body.userUid ? `admin/${cleanText(body.userUid, 128)}` : cleanText(body.bookingId, 100);
      if (!thread || thread === 'admin/') return json(400, {error: 'חסר צ׳אט'});
      await db.ref(`messages/${thread}`).set(null);
      await audit(token.uid, 'admin_chat_clear', 'chat', thread);
      return json(200, {ok: true});
    }
    return json(400, {error: 'פעולה לא מוכרת'});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
