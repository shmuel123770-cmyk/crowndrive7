import {auth} from './firebase.js';

export async function api(path, body = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('נדרשת התחברות');
  const token = await user.getIdToken();
  const response = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(payload.error || 'הפעולה נכשלה');
  return payload;
}
