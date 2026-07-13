import {getAdmin, verify, json, isAdmin, canAccessBooking, canReadUserDocs, parseBody} from './_firebase-admin.mjs';
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
    else allowed = await isAdmin(user.uid);
    if (!allowed) return json(403, {error: 'אין הרשאה'});
    const [url] = await getAdmin().storage().bucket().file(path).getSignedUrl({version: 'v4', action: 'read', expires: Date.now() + 5 * 60 * 1000});
    return json(200, {url});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
