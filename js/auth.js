import {auth} from './firebase.js';
import {api} from './api.js';
import {validPassword} from './core.js';
import {startPrivate, stopPrivate} from './store.js';

let resolveReady;
export const authReady = new Promise(resolve => { resolveReady = resolve; });
let initialResolved = false;

// The only Firebase Auth observer in the project.
auth.onAuthStateChanged(async user => {
  try {
    if (user) {
      await startPrivate(user);
      try { await user.reload(); await user.getIdToken(true); await api('profile-save', {action: 'sync-email'}); } catch (error) { console.warn('email verification sync skipped', error.message); }
    }
    else stopPrivate();
  } catch (error) {
    console.error('auth bootstrap failed', error);
    stopPrivate();
  } finally {
    if (!initialResolved) {
      initialResolved = true;
      resolveReady();
    }
    window.dispatchEvent(new Event('authchange'));
  }
});

export async function register({name, email, phone, password, role}) {
  if (!validPassword(password)) {
    throw new Error('הסיסמה חייבת לכלול לפחות 6 תווים, אות גדולה ואות קטנה באנגלית');
  }
  if (!['renter', 'owner'].includes(role)) throw new Error('סוג חשבון לא תקין');
  const credential = await auth.createUserWithEmailAndPassword(email.trim(), password);
  await credential.user.updateProfile({displayName: name.trim()});
  await api('profile-save', {action: 'create', name, phone, role});
  await credential.user.sendEmailVerification();
  return credential.user;
}

export async function login(email, password) {
  return (await auth.signInWithEmailAndPassword(email.trim(), password)).user;
}

export async function logout() {
  await auth.signOut();
}

export async function sendVerify() {
  if (!auth.currentUser) throw new Error('אין משתמש מחובר');
  await auth.currentUser.sendEmailVerification();
}

export async function refreshEmailStatus() {
  if (!auth.currentUser) return false;
  await auth.currentUser.reload();
  const verified = auth.currentUser.emailVerified;
  await api('profile-save', {action: 'sync-email'});
  return verified;
}
