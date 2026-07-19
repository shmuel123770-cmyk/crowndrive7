import {getAdmin, verify, json, isAdmin, cleanText, audit, notifyAdmin, notifyUser, parseBody} from './_firebase-admin.mjs';
import {rateLimit, tooMany} from './_ratelimit.mjs';
import crypto from 'node:crypto';

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
      // profile-save locks name + birthDate once verification is pending/approved and tells the user
      // "לשינוי פנו למנהל האתר" — so the admin must actually be able to change them. birthDate was
      // missing here, leaving that instruction impossible to act on (and booking-create requires one).
      if (body.patch?.birthDate !== undefined) {
        const date = String(body.patch.birthDate || '');
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(400, {error: 'תאריך לידה לא תקין'});
        patch.birthDate = date;
      }
      if (body.patch?.role !== undefined) {
        if (!['renter', 'owner'].includes(body.patch.role)) return json(400, {error: 'תפקיד לא תקין'});
        // Demoting an owner who still has cars would orphan their listings (audit #15).
        if (body.patch.role === 'renter') {
          const owned = await db.ref('cars').orderByChild('ownerUid').equalTo(uid).once('value');
          if (owned.exists()) return json(409, {error: 'למשתמש יש רכבים במערכת — מחקו או העבירו אותם לפני שינוי התפקיד לשוכר'});
        }
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
      // Tell the person. Blocked: they're locked out of every screen, so SMS is the only channel that
      // reaches them (the site itself now leaves a support thread open for an appeal). Unblocked: they
      // would otherwise have no way of knowing they can come back.
      const {smsUser} = await import('./_sms.mjs');
      if (blocked) await smsUser(uid, 'CrownDrive: הגישה לחשבון שלך נחסמה. אם לדעתך מדובר בטעות, אפשר לכתוב לנו מהאתר ונבדוק.');
      else {
        await notifyUser(uid, 'block', 'החסימה על החשבון שלך הוסרה — אפשר להשתמש באתר כרגיל.');
        await smsUser(uid, 'CrownDrive: החסימה על החשבון שלך הוסרה — אפשר להשתמש באתר כרגיל.');
      }
      return json(200, {ok: true});
    }
    if (body.action === 'user-delete') {
      if (!uid) return json(400, {error: 'חסר משתמש'});
      // Destructive + irreversible (audit #57): a long-lived admin session isn't enough — the token
      // must come from a SIGN-IN within the last 30 minutes (a stolen open tab can't mass-delete).
      if (!token.auth_time || Date.now() / 1000 - Number(token.auth_time) > 30 * 60) {
        return json(403, {error: 'מטעמי אבטחה מחיקת משתמש דורשת התחברות טרייה — התנתקו, התחברו שוב ונסו מיד'});
      }
      // FULL cascade (audit #1): personal nodes, owned cars, inquiries + their chats, authored/received
      // ratings, and the user's storage folders. Bookings involving the user are KEPT (the other party's
      // financial/legal record) but the name is anonymized.
      const updates = {
        [`users/${uid}`]: null,
        [`verificationStatus/${uid}`]: null,
        [`privateUserDocuments/${uid}`]: null,
        [`messages/admin/${uid}`]: null,
        [`supportGuestState/${uid}`]: null,
        [`rateLimits/${uid}`]: null,
      };
      try {
        const ownedCars = (await db.ref('cars').orderByChild('ownerUid').equalTo(uid).once('value')).val() || {};
        for (const carId of Object.keys(ownedCars)) { updates[`cars/${carId}`] = null; updates[`publicCars/${carId}`] = null; updates[`privateCarDetails/${carId}`] = null; }
        for (const field of ['renterUid', 'ownerUid']) {
          const inquiries = (await db.ref('inquiries').orderByChild(field).equalTo(uid).once('value')).val() || {};
          for (const id of Object.keys(inquiries)) { updates[`inquiries/${id}`] = null; updates[`messages/inquiry/${id}`] = null; }
          const bookings = (await db.ref('bookings').orderByChild(field).equalTo(uid).once('value')).val() || {};
          for (const id of Object.keys(bookings)) updates[`bookings/${id}/${field === 'renterUid' ? 'renterName' : 'ownerName'}`] = 'משתמש שנמחק';
        }
        const allRatings = (await db.ref('ratings').once('value')).val() || {};
        for (const [id, row] of Object.entries(allRatings)) {
          // The public projection is keyed by a hash of the private id (see rating-submit). Clear BOTH
          // that and the legacy plaintext key, or deleting a user would leave their public review behind.
          if (row?.authorUid === uid || row?.targetUid === uid) {
            updates[`ratings/${id}`] = null;
            updates[`publicRatings/${id}`] = null;
            updates[`publicRatings/${crypto.createHash('sha1').update(id).digest('hex')}`] = null;
          }
        }
      } catch (error) { console.error('user-delete cascade scan failed — deleting core nodes only', error); }
      await db.ref().update(updates);
      // Storage folders (best effort — bucket may be unreachable locally).
      try {
        const {storageBucketName} = await import('./_storage.mjs');
        const bucket = getAdmin().storage().bucket(storageBucketName());
        await Promise.all(['users/', 'avatars/', 'cars/'].map(prefix => bucket.deleteFiles({prefix: `${prefix}${uid}/`}).catch(() => {})));
      } catch {}
      // Auth deletion must NOT fail silently (audit #2): report it so the admin re-runs the deletion
      // (all the DB deletes above are idempotent).
      try { await getAdmin().auth().deleteUser(uid); }
      catch (error) {
        if (error?.code !== 'auth/user-not-found') {
          console.error('auth deleteUser failed', error);
          await audit(token.uid, 'admin_user_delete_partial', 'user', uid, {authDeleteFailed: true});
          return json(502, {error: 'הנתונים נמחקו, אך מחיקת חשבון ההתחברות נכשלה — הריצו שוב את המחיקה'});
        }
      }
      await audit(token.uid, 'admin_user_delete', 'user', uid);
      return json(200, {ok: true});
    }
    if (body.action === 'car-owner') {
      const carId = cleanText(body.carId, 100);
      if (!uid) return json(400, {error: 'חסר משתמש'});
      const car = (await db.ref(`cars/${carId}`).once('value')).val();
      if (!car) return json(404, {error: 'רכב לא נמצא'});
      const target = (await db.ref(`users/${uid}`).once('value')).val();
      if (!target) return json(404, {error: 'המשתמש החדש לא נמצא'});
      // A live booking still routes chat/payments/address to the OLD owner — finish it first (audit #4).
      const carBookings = (await db.ref('bookings').orderByChild('carId').equalTo(carId).once('value')).val() || {};
      if (Object.values(carBookings).some(b => ['pending', 'approved', 'active'].includes(b?.status))) {
        return json(409, {error: 'יש הזמנה פעילה או ממתינה על הרכב — סיימו או בטלו אותה לפני העברת הבעלות'});
      }
      // The receiver must already BE an owner — silently flipping a renter's role would also strip
      // their ability to book. Changing the role stays a separate, deliberate admin action.
      if (target.role !== 'owner') return json(409, {error: 'המשתמש המקבל אינו בעל רכב — שנו קודם את תפקידו ל"בעל רכב" ואז העבירו'});
      await db.ref().update({
        [`cars/${carId}/ownerUid`]: uid,
        [`cars/${carId}/ownerName`]: cleanText(target.name || target.email, 80),
        // RESET, not patch — the old owner's pickup address must not leak to the new owner (audit #4).
        [`privateCarDetails/${carId}`]: {ownerUid: uid, updatedAt: Date.now()},
      });
      // Refresh the public mirror from the updated source record (audit #45).
      const {syncPublicCar} = await import('./_public-cars.mjs');
      await syncPublicCar(db, carId);
      await audit(token.uid, 'admin_car_owner', 'car', carId, {newOwner: uid, previousOwner: car.ownerUid || ''});
      return json(200, {ok: true, note: 'כתובת האיסוף אופסה — על הבעלים החדש להזין כתובת, ומומלץ להעלות תמונות מחדש'});
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
      // Inquiry chats live under messages/inquiry/<id> — clearing them used to hit messages/<id>,
      // report success and delete nothing (audit #26).
      const inquiryId = cleanText(body.inquiryId, 100);
      const thread = body.userUid ? `admin/${cleanText(body.userUid, 128)}` : inquiryId ? `inquiry/${inquiryId}` : cleanText(body.bookingId, 100);
      if (!thread || thread === 'admin/' || thread === 'inquiry/') return json(400, {error: 'חסר צ׳אט'});
      await db.ref(`messages/${thread}`).set(null);
      // Clearing a support thread also resets the guest gate (audit #27) — otherwise the guest stays
      // stuck on "נציג יחזור אליכם" with no thread behind it and no way to write again.
      if (body.userUid) await db.ref(`supportGuestState/${cleanText(body.userUid, 128)}`).set(null);
      await audit(token.uid, 'admin_chat_clear', 'chat', thread);
      return json(200, {ok: true});
    }
    if (body.action === 'ratings-rekey') {
      // One-time cleanup: publicRatings is world-readable, and rows written before rev.177 are keyed
      // `<bookingId>_<type>_<authorUid>` — handing back the two fields the record body strips on
      // purpose. Re-key them to the hash the server now writes. Idempotent: already-hashed keys are
      // skipped, so running it twice is a no-op and it can safely disappear once the count hits zero.
      const all = (await db.ref('publicRatings').once('value')).val() || {};
      const legacy = Object.keys(all).filter(k => !/^[0-9a-f]{40}$/.test(k));
      const updates = {};
      for (const key of legacy) {
        updates[crypto.createHash('sha1').update(key).digest('hex')] = all[key];
        updates[key] = null;
      }
      if (legacy.length) await db.ref('publicRatings').update(updates);
      await audit(token.uid, 'admin_ratings_rekey', 'rating', 'publicRatings', {moved: legacy.length});
      return json(200, {ok: true, moved: legacy.length});
    }
    return json(400, {error: 'פעולה לא מוכרת'});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.status ? error.message : 'שגיאת שרת — נסו שוב בעוד רגע'});
  }
}
