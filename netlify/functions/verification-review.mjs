import {getAdmin, verify, json, isAdmin, cleanText, audit, parseBody} from './_firebase-admin.mjs';
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    if (!await isAdmin(token.uid)) return json(403, {error: 'מנהל בלבד'});
    const body = parseBody(event);
    if (!body) return json(400, {error: 'בקשה לא תקינה — נסו שוב'});
    const {uid, status, note} = body;
    if (!uid || !['approved', 'rejected', 'needs_resubmission', 'pending'].includes(status)) return json(400, {error: 'נתונים לא תקינים'});
    const db = getAdmin().database();
    await db.ref().update({
      [`verificationStatus/${uid}`]: status,
      [`users/${uid}/verification/reviewNote`]: cleanText(note, 500),
      [`users/${uid}/verification/reviewedAt`]: Date.now(),
      [`users/${uid}/verification/reviewedBy`]: token.uid,
    });
    await audit(token.uid, 'verification_review', 'user', uid, {status});
    return json(200, {ok: true});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
