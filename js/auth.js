import {auth,refs} from './firebase.js';
import {validPassword,now} from './core.js';
import {startPrivate,stopPrivate,store} from './store.js';
let readyResolve;export const authReady=new Promise(r=>readyResolve=r);let first=true;
auth.onAuthStateChanged(async user=>{try{if(user)await startPrivate(user);else stopPrivate();}finally{if(first){first=false;readyResolve()}window.dispatchEvent(new Event('authchange'))}});
export async function register({name,email,phone,password,role}){if(!validPassword(password))throw new Error('הסיסמה חייבת לכלול לפחות 6 תווים, אות גדולה ואות קטנה באנגלית');const c=await auth.createUserWithEmailAndPassword(email,password);await c.user.updateProfile({displayName:name});await refs.users.child(c.user.uid).set({name,email,phone:phone||'',role,createdAt:now(),verification:{email:false,licenseFront:false,licenseBack:false,selfie:false}});await c.user.sendEmailVerification();return c.user}
export async function login(email,password){return (await auth.signInWithEmailAndPassword(email,password)).user}
export async function logout(){await auth.signOut()}
export async function sendVerify(){if(!auth.currentUser)throw new Error('אין משתמש מחובר');await auth.currentUser.sendEmailVerification()}
export async function refreshEmailStatus(){if(!auth.currentUser)return false;await auth.currentUser.reload();const ok=auth.currentUser.emailVerified;await refs.users.child(auth.currentUser.uid).child('verification/email').set(ok);return ok}
