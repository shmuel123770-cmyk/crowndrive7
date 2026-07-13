// ---- SMS notifications via Twilio's REST API (no SDK — plain fetch, so nothing extra to bundle) ----
// Configured entirely through Netlify environment variables; if they're missing, every call NO-OPS
// quietly so the site keeps working exactly as before. Secrets NEVER live in the code or the ZIP:
//   TWILIO_ACCOUNT_SID   – Twilio account SID (starts with AC…)
//   TWILIO_AUTH_TOKEN    – Twilio auth token
//   TWILIO_FROM_NUMBER   – the Twilio phone number to send from, E.164 (e.g. +17185551234)
//   ADMIN_PHONE          – the site admin's phone for "new car / new user" alerts, E.164
import {getAdmin} from './_firebase-admin.mjs';

// Normalise a phone to E.164. Bare US 10-digit numbers get +1 (the site serves Crown Heights, NY).
export function normalizePhone(value) {
  let s = String(value || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (!s.startsWith('+')) {
    s = s.replace(/^0+/, '');
    s = s.length === 10 ? `+1${s}` : `+${s}`;
  }
  return /^\+\d{8,15}$/.test(s) ? s : '';
}

export function smsConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

// Send one SMS. Returns {ok|skipped|error} and NEVER throws — a notification must not break the action.
export async function sendSms(to, body) {
  try {
    if (!smsConfigured()) return {skipped: 'not-configured'};
    const phone = normalizePhone(to);
    if (!phone) return {skipped: 'no-phone'};
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({To: phone, From: process.env.TWILIO_FROM_NUMBER, Body: String(body || '').slice(0, 640)}).toString(),
    });
    if (!res.ok) { console.warn('SMS send failed', res.status, (await res.text().catch(() => '')).slice(0, 200)); return {error: res.status}; }
    return {ok: true};
  } catch (error) { console.warn('SMS send error', error?.message); return {error: 'exception'}; }
}

// Look up a user's phone from their profile and text them.
export async function smsUser(uid, body) {
  try {
    if (!uid) return {skipped: 'no-uid'};
    const phone = (await getAdmin().database().ref(`users/${uid}/phone`).once('value')).val();
    return sendSms(phone, body);
  } catch (error) { console.warn('smsUser error', error?.message); return {error: 'exception'}; }
}

// Text the site admin (ADMIN_PHONE).
export async function smsAdmin(body) {
  return sendSms(process.env.ADMIN_PHONE, body);
}

// Once-only guard so a client that retries can't fire the same alert twice (also light spam protection).
// Stored under smsLog/* which no client rule exposes (default-deny); the Admin SDK bypasses rules.
export async function onceGuard(path, windowMs = 0) {
  try {
    const ref = getAdmin().database().ref(`smsLog/${path}`);
    const prev = (await ref.once('value')).val();
    if (prev) {
      if (!windowMs) return false;                 // already sent, no repeat window → skip
      if (Date.now() - Number(prev) < windowMs) return false;  // within debounce window → skip
    }
    await ref.set(Date.now());
    return true;
  } catch { return true; }  // if the guard itself fails, don't block the notification
}
