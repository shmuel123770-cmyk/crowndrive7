// Web Push (Firebase Cloud Messaging) — lets owners/renters get notified when the site is CLOSED.
// Everything degrades gracefully: no VAPID key, no permission, or an unsupported browser → the app
// behaves exactly as before (in-app popups + inbox still work). Nothing here can break the app.
import {api} from './api.js';

const TOKEN_KEY = 'cd-push-token';

// True only when the browser can do web push AND the messaging SDK loaded AND the admin pasted a
// VAPID key into firebase-config.js.
export function pushSupported() {
  try {
    return 'serviceWorker' in navigator && 'Notification' in window && 'PushManager' in window
      && typeof firebase !== 'undefined' && typeof firebase.messaging === 'function'
      && !!window.CROWNDRIVE_VAPID_KEY;
  } catch { return false; }
}

// iOS only exposes Web Push to a PWA that was added to the Home Screen — in a normal Safari tab
// `PushManager` doesn't exist, so pushSupported() is false and every notification prompt stays hidden.
// `beforeinstallprompt` doesn't exist on iOS either, so the install tip never fires. Result: iPhone
// users saw NOTHING and had no way to learn that notifications are possible at all. This tells them.
export function iosNeedsInstall() {
  try {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (!isIOS) return false;
    const standalone = window.navigator.standalone === true
      || window.matchMedia?.('(display-mode: standalone)')?.matches === true;
    return !standalone && !('PushManager' in window);
  } catch { return false; }
}

// Whether we should still OFFER to turn notifications on (supported, not blocked, not already on).
export function pushPromptable() {
  return pushSupported() && Notification.permission === 'default';
}

export function pushEnabled() {
  try { return pushSupported() && Notification.permission === 'granted' && !!localStorage.getItem(TOKEN_KEY); }
  catch { return false; }
}

// Ask permission, get the FCM token, and register it with the server. Throws a Hebrew message on failure.
export async function enablePush() {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) throw new Error('הדפדפן שלך לא תומך בהתראות');
  if (!window.CROWNDRIVE_VAPID_KEY) throw new Error('ההתראות עדיין לא הופעלו על ידי מנהל האתר');
  if (typeof firebase === 'undefined' || typeof firebase.messaging !== 'function') throw new Error('רכיב ההתראות לא נטען — נסו לרענן');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('כדי לקבל התראות יש לאשר אותן בדפדפן');
  const messaging = firebase.messaging();
  // getToken auto-registers /firebase-messaging-sw.js at its own scope (no clash with the app's sw.js).
  const token = await messaging.getToken({vapidKey: window.CROWNDRIVE_VAPID_KEY});
  if (!token) throw new Error('קבלת אסימון ההתראות נכשלה — נסו שוב');
  await api('profile-save', {action: 'push-register', token});
  try { localStorage.setItem(TOKEN_KEY, token); } catch {}
  initPushForeground();
  return token;
}

// While a tab is open, an incoming push arrives as a foreground message — the in-app popups/inbox
// already handle those events, so we keep this to a quiet, non-duplicating no-op guard.
let foregroundBound = false;
export function initPushForeground() {
  if (foregroundBound || !pushEnabled()) return;
  try {
    foregroundBound = true;
    firebase.messaging().onMessage(() => { /* foreground: the app's own popups/inbox already show it */ });
  } catch { foregroundBound = false; }
}
