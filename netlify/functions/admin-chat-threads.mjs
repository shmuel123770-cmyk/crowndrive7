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
      let lastAt = 0, lastText = '', unreadHint = false;
      for (const m of Object.values(msgs)) {
        const t = Number(m?.createdAt || 0);
        if (t >= lastAt) {
          lastAt = t;
          lastText = String(m?.text || (m?.attachment ? '📷 תמונה' : '')).slice(0, 90);
          unreadHint = m?.fromAdmin !== true;  // last message came from the user → likely needs a reply
        }
      }
      threads.push({uid: child.key, lastAt, lastText, unread: unreadHint});
    });
    threads.sort((a, b) => b.lastAt - a.lastAt);
    return json(200, {threads});
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
