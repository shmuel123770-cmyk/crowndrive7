import {getAdmin, verify, json, profile, cleanText, audit, isAdmin} from './_firebase-admin.mjs';
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    const body = JSON.parse(event.body || '{}');
    const db = getAdmin().database();
    const ref = db.ref(`users/${token.uid}`);
    let existing = await profile(token.uid);
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
      // The role is chosen once (right after signup) and then locked — only an admin can change it.
      if ('role' in body) {
        if (!['renter', 'owner'].includes(body.role)) return json(400, {error: 'סוג חשבון לא תקין'});
        if (['renter', 'owner'].includes(existing.role)) return json(403, {error: 'שינוי סוג חשבון אפשרי רק דרך מנהל האתר'});
        patch.role = body.role;
      }
      if ('name' in body) patch.name = cleanText(body.name, 100);
      if ('phone' in body) patch.phone = cleanText(body.phone, 40);
      if ('photoURL' in body) {
        const v = String(body.photoURL || '');
        patch.photoURL = /^data:image\//i.test(v) ? v.slice(0, 1000000) : (/^https:\/\//.test(v) ? v.slice(0, 1000) : '');
      }
      if ('birthDate' in body) {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.birthDate)) ? String(body.birthDate) : '';
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
    return json(error.status || 500, {error: error.message});
  }
}
