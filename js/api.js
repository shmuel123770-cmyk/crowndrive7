import {auth} from './firebase.js';

export async function api(path, body = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('נדרשת התחברות');
  const token = await user.getIdToken();
  // Every server call is time-boxed (25s) — a hanging function can never freeze the UI forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let response;
  try {
    response = await fetch(`/api/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(error?.name === 'AbortError' ? 'השרת לא הגיב בזמן — נסו שוב' : 'בעיית רשת — בדקו את החיבור ונסו שוב');
  } finally {
    clearTimeout(timer);
  }
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    if (response.status === 501 || response.status === 502) {
      throw new Error('שרת האתר אינו זמין כרגע — פעולה זו עובדת רק באתר החי אחרי פריסה, לא בשרת הבדיקות המקומי');
    }
    throw new Error(payload.error || 'הפעולה נכשלה');
  }
  return payload;
}
