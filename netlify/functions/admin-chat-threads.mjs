import {getAdmin, verify, json, isAdmin} from './_firebase-admin.mjs';

// Lightweight admin support-thread list. The admin chat sidebar used to `.on('value')` the WHOLE
// messages/admin tree in the browser — every thread, every message, INCLUDING base64 image attachments —
// which froze the tab once chat usage grew. This reads that tree SERVER-side (the server can handle the
// size) and returns only a tiny summary per thread: {uid, lastAt, lastText}. No message bodies/images
// travel to the browser, so the list can never freeze it again. The open conversation itself still loads
// its own (capped) messages in real time.
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const token = await verify(event);
    if (!(await isAdmin(token.uid))) return json(403, {error: 'מנהל בלבד'});
    const snap = await getAdmin().database().ref('messages/admin').once('value');
    const threads = [];
    snap.forEach(child => {
      const msgs = child.val() || {};
      let lastAt = 0, lastText = '', lastRealAt = 0, unreadHint = false;
      for (const m of Object.values(msgs)) {
        const t = Number(m?.createdAt || 0);
        if (t >= lastAt) {
          lastAt = t;
          lastText = String(m?.text || (m?.attachment ? '📷 תמונה' : '')).slice(0, 90);
        }
        // Unread light: look at the last GENUINE message, ignoring the automatic acknowledgement so a
        // guest's very first message still flags the thread as awaiting a real reply.
        if (m?.auto !== true && t >= lastRealAt) { lastRealAt = t; unreadHint = m?.fromAdmin !== true; }
      }
      threads.push({uid: child.key, lastAt, lastText, unread: unreadHint});
    });
    threads.sort((a, b) => b.lastAt - a.lastAt);
    // ALL conversations, no cap (user decision: no limits on users/cars). The payload stays light
    // because each thread is a ~100-byte SUMMARY — the heavy part (#29, message bodies + base64
    // images) never travels here.
    return json(200, {threads});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.status ? error.message : 'שגיאת שרת — נסו שוב בעוד רגע'});
  }
}
