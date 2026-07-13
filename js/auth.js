import {auth, db} from './firebase.js';
import {api} from './api.js';
import {validPassword} from './core.js';
import {startPrivate, stopPrivate} from './store.js';

// Create the user's own profile directly (works even if the server functions are
// down). Firebase rules allow this write once, for the user's own uid, with the
// role limited to renter/owner — see FIREBASE_DATABASE_RULES_V2.json.
export async function createOwnProfile({name, phone, role}) {
  const user = auth.currentUser;
  if (!user) throw new Error('נדרשת התחברות');
  const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
  const digits = v => String(v ?? '').replace(/[^\d+ ]/g, '').trim().slice(0, 40);
  const chosenRole = ['renter', 'owner'].includes(role) ? role : 'renter';
  const ref = db.ref(`users/${user.uid}`);
  const snap = await ref.once('value');
  if (snap.exists()) {
    // Legacy/partial profile (has a name but no role). Set the role DIRECTLY — the rules now allow a
    // user to write their own users/<uid>/role once, while it's still empty (renter|owner). This is
    // what makes "עוד צעד אחד וסיימנו" actually work: it no longer depends on the serverless function
    // (which has been unreliable). Falls back to the server only if the new rule isn't published yet.
    if (!snap.val().role && role) {
      try {
        await db.ref(`users/${user.uid}/role`).set(chosenRole); // client-write:own-role
      } catch (error) {
        if (/permission_denied/i.test(String(error?.message || ''))) {
          try { await api('profile-save', {action: 'update', role: chosenRole}); }
          catch { throw new Error('כמעט סיימנו — יש לפרסם את חוקי ה-Firebase המעודכנים ואז ההרשמה תושלם'); }
        } else throw new Error('שמירת הפרטים נכשלה — נסו שוב');
      }
    }
    return;
  }
  try {
    await ref.set({ // client-write:own-profile
      name: txt(name, 100) || txt(user.displayName, 100),
      email: txt(user.email, 200),
      phone: digits(phone),
      role: chosenRole,
      createdAt: Date.now(),
      verification: {email: !!user.emailVerified, licenseFront: false, licenseBack: false, selfie: false},
    });
  } catch (error) {
    if (/permission_denied/i.test(String(error?.message || ''))) {
      throw new Error('כמעט סיימנו — יש לפרסם את חוקי ה-Firebase המעודכנים (Realtime Database ← Rules) ואז ההרשמה תושלם. החשבון כבר נוצר, אפשר להיכנס איתו אחרי הפרסום.');
    }
    throw error;
  }
  api('notify', {type: 'new-user'}).catch(() => {});  // best-effort SMS to the admin about the new signup (non-blocking)
}

let resolveReady;
export const authReady = new Promise(resolve => { resolveReady = resolve; });
let initialResolved = false;

// The only Firebase Auth observer in the project.
auth.onAuthStateChanged(async user => {
  try {
    if (user) await startPrivate(user);
    else stopPrivate();
  } catch (error) {
    console.error('auth bootstrap failed', error);
    stopPrivate();
  } finally {
    // Mark auth "ready" as soon as the essential state is set — BEFORE any slow/optional network
    // call — so a hanging function can never leave the app stuck on a loading screen.
    if (!initialResolved) {
      initialResolved = true;
      resolveReady();
    }
    window.dispatchEvent(new Event('authchange'));
  }
  // Background, non-blocking: refresh the email-verification flag. Written DIRECTLY (the profile-save
  // function was unreliable and returned a 500 here — the console error users saw). Never delays app
  // readiness, and a failure here has zero effect on the UI.
  if (user) (async () => {
    // reload + force-refresh the ID token so its email_verified claim matches user.emailVerified — the
    // DB rule now validates verification/email against auth.token.email_verified (it can't be forged).
    try { await user.reload(); await user.getIdToken(true); await db.ref(`users/${user.uid}/verification/email`).set(!!user.emailVerified); } // client-write:own-profile
    catch (error) { console.warn('email verification sync skipped', error?.message); }
  })();
});

// Translate Firebase Auth error codes into clear Hebrew messages.
function authError(error) {
  const map = {
    'auth/invalid-credential': 'המייל או הסיסמה שגויים',
    'auth/wrong-password': 'הסיסמה שגויה לחשבון הזה',
    'auth/user-not-found': 'לא נמצא חשבון עם המייל הזה — נסו להירשם',
    'auth/invalid-email': 'כתובת המייל אינה תקינה',
    'auth/email-already-in-use': 'המייל כבר רשום באתר — נסו להתחבר',
    'auth/too-many-requests': 'יותר מדי ניסיונות — נסו שוב בעוד כמה דקות',
    'auth/network-request-failed': 'בעיית רשת — בדקו את החיבור לאינטרנט',
    'auth/user-disabled': 'החשבון הושבת — פנו למנהל האתר',
    'auth/unauthorized-domain': 'הדומיין לא מאושר ב-Firebase Auth (Authentication ← Settings ← Authorized domains)',
  };
  return new Error(map[String(error?.code || '')] || error?.message || 'שגיאת התחברות');
}

export async function register({name, email, phone, password, role}) {
  if (!validPassword(password)) {
    throw new Error('הסיסמה חייבת לכלול לפחות 6 תווים, אות גדולה ואות קטנה באנגלית');
  }
  let credential;
  try {
    credential = await auth.createUserWithEmailAndPassword(email.trim(), password);
  } catch (error) {
    // Existing email + the correct password = just sign in instead of failing.
    if (error?.code === 'auth/email-already-in-use') {
      try { return (await auth.signInWithEmailAndPassword(email.trim(), password)).user; }
      catch { throw new Error('המייל כבר רשום באתר אבל הסיסמה שגויה — התחברו או אפסו סיסמה'); }
    }
    throw authError(error);
  }
  await credential.user.updateProfile({displayName: name.trim()});
  await createOwnProfile({name, phone, role});
  return credential.user;
}

export async function login(email, password) {
  try { return (await auth.signInWithEmailAndPassword(email.trim(), password)).user; }
  catch (error) { throw authError(error); }
}

// Guest / unregistered visitor: a temporary anonymous identity so they can chat with support and see
// replies, without signing up. Requires "Anonymous" sign-in to be ENABLED in the Firebase console.
export async function signInGuest() {
  try { return (await auth.signInAnonymously()).user; }
  catch (error) { throw authError(error); }
}

export async function logout() {
  await auth.signOut();
}

export async function sendVerify() {
  if (!auth.currentUser) throw new Error('אין משתמש מחובר');
  await auth.currentUser.sendEmailVerification();
}

// Secure password management: passwords are never readable (Firebase stores only
// hashes). The admin can send the user a reset link instead of ever seeing it.
export async function sendPasswordReset(email) {
  if (!email) throw new Error('אין כתובת מייל למשתמש');
  await auth.sendPasswordResetEmail(email.trim());
}

export async function refreshEmailStatus() {
  if (!auth.currentUser) return false;
  await auth.currentUser.reload();
  const verified = auth.currentUser.emailVerified;
  await api('profile-save', {action: 'sync-email'});
  return verified;
}
