import {getAdmin, verify, json, isAdmin, cleanText, audit, parseBody} from './_firebase-admin.mjs';
import {rateLimit, tooMany} from './_ratelimit.mjs';
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    if (!await isAdmin(token.uid)) return json(403, {error: 'מנהל בלבד'});
    if (!(await rateLimit(token.uid, 'verification', 80, 60 * 1000))) throw tooMany();
    const body = parseBody(event);
    if (!body) return json(400, {error: 'בקשה לא תקינה — נסו שוב'});
    const {uid, status, note} = body;
    if (!uid || !['approved', 'rejected', 'needs_resubmission', 'pending'].includes(status)) return json(400, {error: 'נתונים לא תקינים'});
    const db = getAdmin().database();
    const heal = {};
    if (status === 'approved') {
      // NO email gate (user decision: registration stays simple — email verification never blocks the
      // admin's approval). The uploaded documents themselves are the only requirement; the per-document
      // flags are just the wizard's progress markers and can lag, so they're healed on approval.
      const docs = (await db.ref(`privateUserDocuments/${uid}`).once('value')).val() || {};
      if (!docs.licenseFront || !docs.licenseBack || !docs.selfie) return json(409, {error: 'אי אפשר לאשר לפני שכל שלושת המסמכים הוגשו'});
      heal[`users/${uid}/verification/licenseFront`] = true;
      heal[`users/${uid}/verification/licenseBack`] = true;
      heal[`users/${uid}/verification/selfie`] = true;
    }
    const updates = {
      ...heal,
      [`verificationStatus/${uid}`]: status,
      [`users/${uid}/verification/reviewNote`]: cleanText(note, 500),
      [`users/${uid}/verification/reviewedAt`]: Date.now(),
      [`users/${uid}/verification/reviewedBy`]: token.uid,
    };
    // audit #7: when the admin asks for a redo, RESET the document flags so the user's wizard shows the
    // upload steps again (document-register also allows re-upload only in these two states).
    if (status === 'needs_resubmission' || status === 'rejected') {
      updates[`users/${uid}/verification/licenseFront`] = false;
      updates[`users/${uid}/verification/licenseBack`] = false;
      updates[`users/${uid}/verification/selfie`] = false;
    }
    await db.ref().update(updates);
    await audit(token.uid, 'verification_review', 'user', uid, {status});
    return json(200, {ok: true});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.status ? error.message : 'שגיאת שרת — נסו שוב בעוד רגע'});
  }
}
