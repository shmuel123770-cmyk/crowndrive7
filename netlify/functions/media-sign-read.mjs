import {getAdmin, verify, json, isAdmin, canAccessBooking, canAccessInquiry, canReadUserDocs, parseBody} from './_firebase-admin.mjs';
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const user = await verify(event);
    const body = parseBody(event);
    if (!body) return json(400, {error: 'בקשה לא תקינה — נסו שוב'});
    const {path} = body;
    if (!path || String(path).includes('..')) return json(400, {error: 'נתיב לא תקין'});
    const parts = String(path).split('/');
    let allowed = false;
    if (parts[0] === 'users' && parts[2] === 'documents') allowed = await canReadUserDocs(user.uid, parts[1]);
    else if (parts[0] === 'bookings') allowed = await canAccessBooking(user.uid, parts[1]);
    else if (parts[0] === 'cars') allowed = true;
    // Conversation media. Without these two the catch-all below applies and only an ADMIN can open
    // them — which would half-ship the feature: the file uploads and the message sends, and then the
    // other side gets a 403 on tapping it. In an inquiry that is both participants locked out of each
    // other's documents, and in support it is a member unable to replay their own voice note.
    // support/<threadOwner>/<sender>/… — the thread's owner and any admin.
    else if (parts[0] === 'support') allowed = parts[1] === user.uid || await isAdmin(user.uid);
    // inquiries/<inquiryId>/<sender>/… — the two people in it, or an admin.
    else if (parts[0] === 'inquiries') allowed = await canAccessInquiry(user.uid, parts[1]);
    else allowed = await isAdmin(user.uid);
    if (!allowed) return json(403, {error: 'אין הרשאה'});
    const [url] = await getAdmin().storage().bucket().file(path).getSignedUrl({version: 'v4', action: 'read', expires: Date.now() + 5 * 60 * 1000});
    return json(200, {url});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.status ? error.message : 'שגיאת שרת — נסו שוב בעוד רגע'});
  }
}
