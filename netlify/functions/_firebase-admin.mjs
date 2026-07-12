import admin from 'firebase-admin';
let app;
export function getAdmin(){if(app)return app;const raw=process.env.FIREBASE_SERVICE_ACCOUNT_JSON;if(!raw)throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON missing');const credential=admin.credential.cert(JSON.parse(raw));app=admin.initializeApp({credential,databaseURL:process.env.FIREBASE_DATABASE_URL,storageBucket:process.env.FIREBASE_STORAGE_BUCKET},'crowndrive-netlify');return app}
export async function verify(event){const h=event.headers.authorization||event.headers.Authorization||'';if(!h.startsWith('Bearer '))throw Object.assign(new Error('Unauthorized'),{status:401});return getAdmin().auth().verifyIdToken(h.slice(7))}
export const json=(statusCode,body)=>({statusCode,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify(body)});
export async function isAdmin(uid){return (await getAdmin().database().ref(`admins/${uid}`).once('value')).val()===true}
export async function canAccessBooking(uid,id){if(await isAdmin(uid))return true;const b=(await getAdmin().database().ref(`bookings/${id}`).once('value')).val();return !!b&&[b.ownerUid,b.renterUid].includes(uid)}
export async function canReadUserDocs(viewer,target){if(viewer===target||await isAdmin(viewer))return true;const snap=await getAdmin().database().ref('bookings').orderByChild('renterUid').equalTo(target).once('value');return Object.values(snap.val()||{}).some(b=>b.ownerUid===viewer&&['pending','approved','active'].includes(b.status)&&!b.done)}
