import {getAdmin, verify, json, profile, cleanText, audit, isAdmin, parseBody, maintenanceBlocked} from './_firebase-admin.mjs';
import {TERMS_VERSION} from './_terms.mjs';
import crypto from 'node:crypto';
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    if (await maintenanceBlocked(token.uid)) return json(503, {error: 'האתר בתחזוקה כרגע — נסו שוב בעוד מספר דקות'});  // audit #23
    const body = parseBody(event);
    if (!body) return json(400, {error: 'הבקשה גדולה או פגומה — נסו תמונה קטנה יותר'});
    const db = getAdmin().database();
    const ref = db.ref(`users/${token.uid}`);
    let existing = await profile(token.uid);
    // Re-consent after a terms/privacy update (audit #10): the client shows the "התנאים עודכנו" dialog
    // when the stored version differs from the current one, and records the fresh acceptance here
    // (the legalAcceptance node is deliberately not client-writable after registration).
    // Register this device's Web-Push (FCM) token so the server can notify the user when the app is
    // CLOSED. Stored under users/<uid>/pushTokens/<hash> — key is a hash (tokens contain chars RTDB
    // keys forbid), value is the token + timestamp. Dead tokens are pruned on send (see sendPush).
    if (body.action === 'push-register') {
      const t = cleanText(body.token, 4096);
      if (!t || t.length < 20) return json(400, {error: 'אסימון התראות לא תקין'});
      const key = crypto.createHash('sha1').update(t).digest('hex');
      await db.ref(`users/${token.uid}/pushTokens/${key}`).set({token: t, at: Date.now()});
      return json(200, {ok: true});
    }
    if (body.action === 'accept-terms') {
      await db.ref(`users/${token.uid}/legalAcceptance`).set({termsVersion: TERMS_VERSION, privacyVersion: TERMS_VERSION, acceptedAt: Date.now(), source: 're-consent'});
      await audit(token.uid, 'terms_reconsent', 'user', token.uid, {version: TERMS_VERSION});
      return json(200, {ok: true, termsVersion: TERMS_VERSION});
    }
    if (body.action === 'create') {
      if (existing) return json(200, {ok: true});
      const role = ['renter', 'owner'].includes(body.role) ? body.role : '';
      const value = {
        name: cleanText(body.name, 100) || cleanText(token.name, 100),
        email: cleanText(token.email, 200),
        phone: cleanText(body.phone, 40),
        role,
        createdAt: Date.now(),
        verification: {email: !!token.email_verified, licenseFront: false, licenseBack: false, selfie: false},
      };
      await ref.set(value);
      await db.ref(`verificationStatus/${token.uid}`).set('missing');
      await audit(token.uid, 'profile_create', 'user', token.uid, {role});
      return json(200, {ok: true});
    }
    if (!existing) {
      // Admins may not have registered through the renter/owner signup flow — let them keep
      // their own profile (name/photo) by auto-creating a minimal record. Regular users
      // always have a profile from registration, so this branch only ever fires for admins.
      if (!await isAdmin(token.uid)) return json(404, {error: 'פרופיל לא נמצא'});
      existing = {name: cleanText(token.name, 100) || 'מנהל האתר', email: cleanText(token.email, 200), role: '', createdAt: Date.now()};
      await ref.set(existing);
    }
    if (body.action === 'sync-email') {
      await ref.child('verification/email').set(!!token.email_verified);
      return json(200, {ok: true, emailVerified: !!token.email_verified});
    }
    if (body.action === 'update') {
      const patch = {};
      const verificationStatus = (await db.ref(`verificationStatus/${token.uid}`).once('value')).val();
      const identityLocked = ['pending', 'approved'].includes(verificationStatus);
      // The role is chosen once (right after signup) and then locked — only an admin can change it.
      if ('role' in body) {
        if (!['renter', 'owner'].includes(body.role)) return json(400, {error: 'סוג חשבון לא תקין'});
        if (['renter', 'owner'].includes(existing.role)) return json(403, {error: 'שינוי סוג חשבון אפשרי רק דרך מנהל האתר'});
        patch.role = body.role;
      }
      if ('name' in body) {
        const name = cleanText(body.name, 100);
        if (identityLocked && name !== cleanText(existing.name, 100)) return json(409, {error: 'השם החוקי נעול בזמן האימות — לשינוי פנו למנהל האתר'});
        patch.name = name;
      }
      if ('phone' in body) patch.phone = cleanText(body.phone, 40);
      if ('photoURL' in body) {
        const v = String(body.photoURL || '');
        patch.photoURL = /^data:image\//i.test(v) ? v.slice(0, 1000000) : (/^https:\/\//.test(v) ? v.slice(0, 1000) : '');
      }
      if ('birthDate' in body) {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.birthDate)) ? String(body.birthDate) : '';
        // The lock protects a date the admin already verified against being CHANGED — it must not
        // block FILLING a blank one. Registration never asks for a birth date, so a user who uploads
        // documents first gets locked with an empty field, and booking-create then demands one they
        // can no longer enter: a permanent dead end reachable only through support. Empty → settable.
        const wasEmpty = !String(existing.birthDate || '');
        if (identityLocked && !wasEmpty && date !== String(existing.birthDate)) return json(409, {error: 'תאריך הלידה נעול בזמן האימות — לשינוי פנו למנהל האתר'});
        if (identityLocked && wasEmpty && !date) return json(400, {error: 'תאריך לידה לא תקין'});
        patch.birthDate = date;
      }
      patch.updatedAt = Date.now();
      await ref.update(patch);
      await audit(token.uid, 'profile_update', 'user', token.uid, {fields: Object.keys(patch)});
      return json(200, {ok: true});
    }
    return json(400, {error: 'פעולה לא תקינה'});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.status ? error.message : 'שגיאת שרת — נסו שוב בעוד רגע'});
  }
}
