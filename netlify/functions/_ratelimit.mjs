import {getAdmin} from './_firebase-admin.mjs';

// Per-user, per-action fixed-window rate limit, backed by the Realtime Database (admin-only node,
// default-deny for clients). Uses a transaction so concurrent requests can't slip past the cap.
// FAILS OPEN: if the check itself errors, the request is allowed — a limiter bug must never lock users
// out of the site. Returns true = allowed, false = over the limit.
export async function rateLimit(uid, action, max, windowMs) {
  try {
    if (!uid) return true;
    const now = Date.now();
    const ref = getAdmin().database().ref(`rateLimits/${uid}/${action}`);
    let over = false;
    await ref.transaction(current => {
      over = false;  // reset for each transaction attempt (it may retry on contention)
      if (!current || now - (current.start || 0) >= windowMs) return {start: now, count: 1};
      if (current.count >= max) { over = true; return; }  // abort → over the limit
      return {start: current.start, count: current.count + 1};
    });
    return !over;
  } catch {
    return true;  // fail open
  }
}

// A clean 429 error the handlers can return.
export function tooMany(retryHint = 'נסו שוב בעוד רגע') {
  return Object.assign(new Error(`יותר מדי בקשות — ${retryHint}`), {status: 429});
}
