
/* ╔════════════════════════════════════════════════════════════════╗
   ║ CrownDrive hardened build + optional Firebase Realtime        ║
   ║ localStorage עובד תמיד; Firebase מפעיל עדכון חי בין מכשירים. ║
   ╚════════════════════════════════════════════════════════════════╝ */
const CLOUD = false; // מצב שמירה יציב: עובד בלי Netlify Blobs ובלי שגיאות שרת
const API_URL = '/.netlify/functions/db';
let db=null, fauth=null;
let REALTIME=false, RT_DB=null, RT_REF=null, RT_AUTH=null, rtApplying=false, rtWriteTimer=null, rtLastToast=0;
window.CROWNDRIVE_AUTH_REQUIRED_FOR_REALTIME = true;

async function api(action, payload={}){
  const res = await fetch(API_URL, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action,...payload})
  });
  const txt = await res.text();
  let data={};
  try{ data = txt ? JSON.parse(txt) : {}; }catch(e){ data={error:txt||'Invalid JSON'}; }
  if(!res.ok) throw new Error(data.error || ('שגיאת שרת '+res.status));
  return data;
}
function snapFrom(rows){
  return { docs:(rows||[]).map(r=>({ id:r.id, data:()=>({...r.data}) })) };
}
function makeCollection(name){
  return {
    doc(id){
      const refId = id || (name.slice(0,2)+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,8));
      return {
        id: refId,
        async get(){ const r=await api('get',{collection:name,id:refId}); return {exists:!!r.record,id:refId,data:()=>r.record||{}}; },
        async set(data, opts){ return api('set',{collection:name,id:refId,data,merge:!!(opts&&opts.merge)}); },
        async update(data){ return api('update',{collection:name,id:refId,data}); },
        async delete(){ return api('delete',{collection:name,id:refId}); }
      };
    },
    async add(data){ const r=await api('add',{collection:name,data}); return {id:r.id}; },
    where(field,op,value){
      return {
        onSnapshot(cb,err){
          let stop=false, timer=null, last='';
          const run=async()=>{
            if(stop)return;
            try{
              const r=await api('list',{collection:name,where:{field,op,value}});
              const key=JSON.stringify(r.records||[]);
              if(key!==last){ last=key; cb(snapFrom(r.records)); }
            }catch(e){ if(err)err(e); else console.error(e); }
          };
          run(); timer=setInterval(run,1000);
          return ()=>{stop=true; if(timer)clearInterval(timer)};
        }
      };
    },
    onSnapshot(cb,err){
      let stop=false, timer=null, last='';
      const run=async()=>{
        if(stop)return;
        try{
          const r=await api('list',{collection:name});
          const key=JSON.stringify(r.records||[]);
          if(key!==last){ last=key; cb(snapFrom(r.records)); }
        }catch(e){ if(err)err(e); else console.error(e); }
      };
      run(); timer=setInterval(run,1000);
      return ()=>{stop=true; if(timer)clearInterval(timer)};
    }
  };
}
function makeAuthUser(u){
  return {
    uid:u.uid,
    email:u.email,
    async updateEmail(newEmail){ const r=await api('updateAuth',{uid:u.uid,email:newEmail}); rememberAuthIdentity(u.uid,newEmail); this.email=newEmail; return r; },
    async updatePassword(newPass){ return api('updateAuth',{uid:u.uid,pass:newPass}); }
  };
}
const authListeners=[];
function notifyAuth(){ authListeners.forEach(fn=>{try{fn(fauth.currentUser)}catch(e){console.error(e)}}); }

db = { collection: makeCollection };
fauth = {
  currentUser:null,
  onAuthStateChanged(fn){ authListeners.push(fn); setTimeout(()=>fn(this.currentUser),0); return ()=>{}; },
  async signInWithEmailAndPassword(email,pass){ const r=await api('login',{email,pass}); this.currentUser=makeAuthUser(r.user); rememberAuthIdentity(r.user.uid,r.user.email); notifyAuth(); return {user:this.currentUser}; },
  async createUserWithEmailAndPassword(email,pass){ const r=await api('signup',{email,pass}); this.currentUser=makeAuthUser(r.user); rememberAuthIdentity(r.user.uid,r.user.email); notifyAuth(); return {user:this.currentUser}; },
  async sendPasswordResetEmail(email){ await api('resetPassword',{email}); },
  async signOut(){ this.currentUser=null; clearAuthIdentity(); notifyAuth(); }
};
(function restoreSession(){
  const uid=localStorage.getItem('cd_uid')||getCookieRaw('cd_uid'), email=localStorage.getItem('cd_email')||getCookieRaw('cd_email');
  if(uid&&email){ rememberAuthIdentity(uid,email); fauth.currentUser=makeAuthUser({uid,email}); }
})();
const LOCAL_KEY = 'crowndrive_site_data_v4';
const AUTH_MEMORY_KEY = 'crowndrive_saved_login_until_deleted_v1';

const COOKIE_SESSION_KEY = 'crowndrive_session_until_deleted_v1';
const COOKIE_LOGIN_KEY = 'crowndrive_login_until_deleted_v1';
const COOKIE_UID_KEY = 'cd_uid';
const COOKIE_EMAIL_KEY = 'cd_email';
const COOKIE_MAX_AGE = 60*60*24*365*10; // 10 שנים — עד יציאה/מחיקת נתוני אתר
function cookieOpts(){ return '; Max-Age='+COOKIE_MAX_AGE+'; Path=/; SameSite=Lax'+(location.protocol==='https:'?'; Secure':''); }
function setCookieRaw(name,value){ try{ document.cookie=name+'='+encodeURIComponent(value)+cookieOpts(); }catch(e){} }
function getCookieRaw(name){
  try{
    const hit=document.cookie.split('; ').find(x=>x.startsWith(name+'='));
    return hit?decodeURIComponent(hit.slice(name.length+1)):'';
  }catch(e){return ''}
}
function delCookie(name){ try{ document.cookie=name+'=; Max-Age=0; Path=/; SameSite=Lax'+(location.protocol==='https:'?'; Secure':''); }catch(e){} }
function packCookie(obj){ try{ return btoa(unescape(encodeURIComponent(JSON.stringify(obj||{})))); }catch(e){ return ''; } }
function unpackCookie(v){ try{ return JSON.parse(decodeURIComponent(escape(atob(v||'')))); }catch(e){ return null; } }
function setCookieJSON(name,obj){ const v=packCookie(obj); if(v) setCookieRaw(name,v); }
function getCookieJSON(name){ return unpackCookie(getCookieRaw(name)); }
function sessionForCookie(u){
  if(!u)return null;
  return {role:u.role,id:u.id,name:u.name||'',email:u.email||'',phone:u.phone||'',ts:Date.now()};
}
function rememberAuthIdentity(uid,email){
  if(uid){ localStorage.setItem('cd_uid',uid); setCookieRaw(COOKIE_UID_KEY,uid); }
  if(email){ localStorage.setItem('cd_email',email); setCookieRaw(COOKIE_EMAIL_KEY,email); }
}
function clearAuthIdentity(){
  ['cd_uid','cd_email'].forEach(k=>{try{localStorage.removeItem(k)}catch(e){}});
  delCookie(COOKIE_UID_KEY); delCookie(COOKIE_EMAIL_KEY);
}
function persistSessionCookie(){
  if(state && state.session) setCookieJSON(COOKIE_SESSION_KEY, sessionForCookie(state.session));
  else delCookie(COOKIE_SESSION_KEY);
}
function rememberLogin(role,email,pass){
  // שומר התחברות עד יציאה/מחיקת נתוני אתר.
  // הסיסמה נשמרת רק ב-localStorage ולא בעוגייה, כדי לא לשלוח אותה לשרת בכל בקשה.
  const localData={role,email,pass:pass||'',ts:Date.now()};
  const cookieData={role,email,ts:Date.now()};
  try{ localStorage.setItem(AUTH_MEMORY_KEY, JSON.stringify(localData)); }catch(e){}
  setCookieJSON(COOKIE_LOGIN_KEY,cookieData);
}
function savedLogin(){
  try{ const local=JSON.parse(localStorage.getItem(AUTH_MEMORY_KEY)||'null'); if(local)return local; }catch(e){}
  return getCookieJSON(COOKIE_LOGIN_KEY);
}
function prefillSavedLogin(role){
  const s=savedLogin();
  if(!s)return;
  if(role && s.role && role!==s.role)return;
  const mail=document.getElementById('l-mail'), pass=document.getElementById('l-pass');
  if(mail && s.email) mail.value=s.email;
  if(pass && s.pass) pass.value=s.pass;
}
function clearSavedLogin(){ try{ localStorage.removeItem(AUTH_MEMORY_KEY); }catch(e){} delCookie(COOKIE_LOGIN_KEY); }


/* ================= FIREBASE AUTH BRIDGE =================
   Firebase Rules cannot know who owns a car unless the browser is signed in
   with Firebase Authentication. These helpers keep the existing site UX, but
   also sign the user into Firebase Auth with the same email/password. */
function firebaseAuthReady(){ return !!(RT_AUTH && typeof RT_AUTH.signInWithEmailAndPassword==='function'); }
function normalizeEmail(e){ return String(e||'').trim().toLowerCase(); }
async function firebaseLoginOrCreate(email, pass, createIfMissing=true){
  email=normalizeEmail(email);
  if(!email || !pass || !firebaseAuthReady()) return null;
  try{
    const cred = await RT_AUTH.signInWithEmailAndPassword(email, pass);
    return cred.user;
  }catch(e){
    const code=(e&&e.code)||'';
    if(createIfMissing && (code==='auth/user-not-found' || code==='auth/invalid-login-credentials')){
      const cred = await RT_AUTH.createUserWithEmailAndPassword(email, pass);
      return cred.user;
    }
    throw e;
  }
}
function migrateLocalIdToFirebaseUid(role, oldId, uid, email){
  if(!uid || !oldId || oldId===uid) return;
  const pool = role==='owner' ? state.owners : (role==='renter' ? state.renters : []);
  const u = pool.find(x=>x.id===oldId || normalizeEmail(x.email)===normalizeEmail(email));
  if(u) u.id = uid;
  if(role==='owner'){
    state.cars.forEach(c=>{ if(c.ownerId===oldId || normalizeEmail(u&&u.email)===normalizeEmail(email)) c.ownerId=uid; });
    state.bookings.forEach(b=>{ if(b.ownerId===oldId) b.ownerId=uid; });
  }
  if(role==='renter'){
    state.bookings.forEach(b=>{ if(b.renterId===oldId) b.renterId=uid; });
  }
  state.msgs.forEach(m=>{
    if(m.uid===oldId) m.uid=uid;
    if(Array.isArray(m.participants)) m.participants=m.participants.map(p=>p===oldId?uid:p);
    if((m.tid||'').includes(oldId)) m.tid=m.tid.replaceAll(oldId,uid);
  });
  if(state.users && state.users[oldId]){ state.users[uid]=state.users[oldId]; delete state.users[oldId]; }
}
async function ensureFirebaseSessionForLocalUser(role, user, pass){
  if(!REALTIME || !firebaseAuthReady() || !user || !user.email || !pass) return user;
  const fbUser = await firebaseLoginOrCreate(user.email, pass, true);
  if(fbUser && fbUser.uid){
    migrateLocalIdToFirebaseUid(role, user.id, fbUser.uid, user.email);
    user.id = fbUser.uid;
    rememberAuthIdentity(fbUser.uid, fbUser.email||user.email);
  }
  return user;
}

function cleanFirebaseValue(v, seen){
  // Firebase Realtime Database rejects undefined, functions, NaN/Infinity, DOM/File objects, and very large accidental blobs.
  // This cleaner makes the cloud payload safe while localStorage still keeps the full local copy.
  if(v===undefined || typeof v==='function' || typeof v==='symbol') return null;
  if(v===null || typeof v==='boolean') return v;
  if(typeof v==='number') return Number.isFinite(v)?v:null;
  if(typeof v==='string'){
    // Keep photos, but prevent one huge base64 image from blocking the whole realtime save.
    if(v.startsWith('data:image/') && v.length>350000) return fallbackCarPhoto();
    return v;
  }
  if(v instanceof Date) return v.toISOString();
  if(typeof File!=='undefined' && v instanceof File) return null;
  if(typeof Blob!=='undefined' && v instanceof Blob) return null;
  if(typeof HTMLElement!=='undefined' && v instanceof HTMLElement) return null;
  if(!seen) seen=new WeakSet();
  if(typeof v==='object'){
    if(seen.has(v)) return null;
    seen.add(v);
    if(Array.isArray(v)) return v.map(x=>cleanFirebaseValue(x, seen)).filter(x=>x!==undefined);
    const o={};
    Object.keys(v).forEach(k=>{
      if(k.startsWith('_')) return;
      const cv=cleanFirebaseValue(v[k], seen);
      if(cv!==undefined) o[k]=cv;
    });
    return o;
  }
  return null;
}
function realtimeData(){
  const data={
    owners:state.owners||[], renters:state.renters||[], cars:state.cars||[], bookings:state.bookings||[],
    msgs:state.msgs||[], ratings:state.ratings||[], users:state.users||{}, seq:seq||1,
    updatedAt:Date.now()
  };
  return cleanFirebaseValue(data);
}
function mergeById(localArr, remoteArr, key){
  const map=new Map();
  safeArr(localArr).forEach(x=>{ if(x&&x.id) map.set(x.id,x); });
  safeArr(remoteArr).forEach(x=>{
    if(!x||!x.id)return;
    const old=map.get(x.id);
    const rt=+(x.updatedAt||x.createdAt||0), lt=+(old&& (old.updatedAt||old.createdAt)||0);
    map.set(x.id, (!old || rt>=lt) ? x : old);
  });
  return Array.from(map.values()).sort((a,b)=>(+(b.updatedAt||b.createdAt||0))-(+(a.updatedAt||a.createdAt||0)));
}
function mergeUsers(localUsers, remoteUsers){
  return {...(remoteUsers||{}), ...(localUsers||{})};
}
function applyRealtimeData(d){
  if(!d || typeof d!=='object')return;
  rtApplying=true;
  try{
    // Merge instead of blind overwrite. This prevents a fresh local action, such as adding a second car,
    // from being erased by a slightly older Firebase snapshot arriving a moment later.
    state.owners=mergeById(state.owners,d.owners,'id');
    state.renters=mergeById(state.renters,d.renters,'id');
    state.cars=mergeById(state.cars,d.cars,'id');
    state.bookings=mergeById(state.bookings,d.bookings,'id');
    state.msgs=mergeById(state.msgs,d.msgs,'id');
    state.ratings=mergeById(state.ratings,d.ratings,'id');
    if(d.users && typeof d.users==='object')state.users=mergeUsers(state.users,d.users);
    if(d.seq && Number.isFinite(+d.seq))seq=Math.max(seq,+d.seq);
    ensureStateIntegrity();
    try{ localStorage.setItem(LOCAL_KEY, JSON.stringify({
      owners:state.owners||[], renters:state.renters||[], cars:state.cars||[], bookings:state.bookings||[],
      session:state.session||null, msgs:state.msgs||[], ratings:state.ratings||[], users:state.users||{}, seq
    })); }catch(e){}
    renderNav(); renderMyAreaFab(); refreshOpenViews(); render(); updateBadge();
  }catch(e){console.error('Realtime apply failed',e)}
  finally{rtApplying=false;}
}
function scheduleRealtimeSave(){
  if(!REALTIME || !RT_REF || rtApplying)return;
  clearTimeout(rtWriteTimer);
  rtWriteTimer=setTimeout(pushRealtimeNow,280);
}
function firebaseErrorText(e){
  const code=(e&&e.code)||''; const msg=(e&&e.message)||String(e||'');
  if(code==='PERMISSION_DENIED' || /permission/i.test(msg)) return 'Firebase חוסם כתיבה — צריך לשנות Rules לכתיבה';
  if(/undefined|invalid/i.test(msg)) return 'נתונים לא תקינים נוקו — נסה לשמור שוב';
  if(/network|offline/i.test(msg)) return 'אין חיבור רשת יציב ל־Firebase';
  return msg.slice(0,90)||'שגיאה לא ידועה';
}
async function ensureRealtimeAuthFromMemory(){
  if(!window.CROWNDRIVE_AUTH_REQUIRED_FOR_REALTIME || !RT_AUTH || RT_AUTH.currentUser) return true;
  try{
    const saved=savedLogin&&savedLogin();
    const localUser=(state.session && state.users) ? state.users[state.session.id] : null;
    const email=normalizeEmail((saved&&saved.email)||(localUser&&localUser.email)||'');
    const pass=(saved&&saved.pass)||(localUser&&localUser.pass)||'';
    const role=(state.session&&state.session.role)||((saved&&saved.role)||'');
    if(!email || !pass) return false;
    const fbUser=await firebaseLoginOrCreate(email,pass,true);
    if(fbUser&&fbUser.uid&&state.session){
      migrateLocalIdToFirebaseUid(role, state.session.id, fbUser.uid, email);
      state.session.id=fbUser.uid;
      if(state.users[fbUser.uid]) state.users[fbUser.uid].uid=fbUser.uid;
      rememberAuthIdentity(fbUser.uid,email);
      persistSessionCookie();
    }
    return !!(RT_AUTH&&RT_AUTH.currentUser);
  }catch(e){ console.warn('Realtime auto auth failed', e); return false; }
}
async function pushRealtimeNow(){
  if(!REALTIME || !RT_REF || rtApplying)return Promise.resolve(false);
  if(window.CROWNDRIVE_AUTH_REQUIRED_FOR_REALTIME && RT_AUTH && !RT_AUTH.currentUser){
    await ensureRealtimeAuthFromMemory();
    if(!RT_AUTH.currentUser){
      const now=Date.now();
      if(now-rtLastToast>7000){rtLastToast=now; safeToast('כדי לשמור בזמן אמת צריך להיכנס מחדש עם מייל וסיסמה');}
      return Promise.resolve(false);
    }
  }
  let payload;
  try{ payload=cleanFirebaseValue({version:1,updatedAt:Date.now(),data:realtimeData()}); }
  catch(e){ console.error('Realtime payload clean failed',e); return Promise.resolve(false); }
  return RT_REF.set(payload).then(()=>{
    window.CROWNDRIVE_LAST_REALTIME_OK=Date.now();
    return true;
  }).catch(e=>{
    console.error('Realtime save failed',e);
    window.CROWNDRIVE_LAST_REALTIME_ERROR=e;
    const now=Date.now();
    if(now-rtLastToast>7000){rtLastToast=now; safeToast('שמירה בזמן אמת נכשלה: '+firebaseErrorText(e));}
    return false;
  });
}
function initRealtime(){
  const cfg=(window.CROWNDRIVE_FIREBASE_CONFIG||window.CROWNFIREBASE_CONFIG||window.FIREBASE_CONFIG||null);
  const ready=cfg && cfg.apiKey && cfg.databaseURL && cfg.projectId;
  if(!ready){console.warn('CrownDrive realtime: fill firebase-config.js to enable live sync.');return false;}
  if(typeof firebase==='undefined' || !firebase.initializeApp){console.warn('CrownDrive realtime: Firebase SDK not loaded.');return false;}
  try{
    if(!firebase.apps || !firebase.apps.length) firebase.initializeApp(cfg);
    RT_DB=firebase.database();
    RT_AUTH = firebase.auth ? firebase.auth() : null;
    if(RT_AUTH && firebase.auth.Auth && firebase.auth.Auth.Persistence){
      RT_AUTH.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(e=>console.warn('Auth persistence failed',e));
    }
    RT_REF=RT_DB.ref((window.CROWNDRIVE_RT_PATH||'crowndrive-live/state'));
    REALTIME=true;
    RT_REF.on('value', snap=>{
      const v=snap.val();
      if(v && v.data) applyRealtimeData(v.data);
      else if(!v) pushRealtimeNow();
    }, err=>{console.error('Realtime listener failed',err);safeToast('חיבור זמן אמת נכשל: '+firebaseErrorText(err));});
    window.addEventListener('online',()=>pushRealtimeNow());
    // Do a tiny diagnostic write first so permission/config problems are visible immediately.
    // If secure Rules require auth, this will succeed after login.
    const diagWrite = ()=>RT_DB.ref((window.CROWNDRIVE_RT_PATH||'crowndrive-live')+'/_connectionTest').set({ok:true,ts:Date.now(),uid:(RT_AUTH&&RT_AUTH.currentUser&&RT_AUTH.currentUser.uid)||null});
    const diagPromise = (RT_AUTH && !RT_AUTH.currentUser) ? Promise.resolve(true) : diagWrite();
    diagPromise.then(()=>{
      window.CROWNDRIVE_REALTIME_CONNECTED=true;
      if(state.session) safeToast('זמן אמת פעיל');
    }).catch(e=>{
      console.error('Realtime diagnostic write failed',e);
      window.CROWNDRIVE_REALTIME_CONNECTED=false;
      safeToast('Firebase לא נותן לשמור: '+firebaseErrorText(e));
    });
    return true;
  }catch(e){console.error('Realtime init failed',e);safeToast('Firebase לא מוגדר תקין — האתר עובד מקומית');return false;}
}
function persistState(){
  try{
    const copy={
      owners:state.owners||[], renters:state.renters||[], cars:state.cars||[], bookings:state.bookings||[],
      session:state.session||null, msgs:state.msgs||[], ratings:state.ratings||[], users:state.users||{}, seq
    };
    persistSessionCookie();
    localStorage.setItem(LOCAL_KEY, JSON.stringify(copy));
    scheduleRealtimeSave();
    return true;
  }catch(e){
    console.error('local save failed', e);
    showToast('השמירה בדפדפן נכשלה — כנראה התמונות כבדות מדי. נסו תמונות קטנות יותר.');
    return false;
  }
}
function loadState(){
  try{
    const raw=localStorage.getItem(LOCAL_KEY);
    if(!raw){ const cs=getCookieJSON(COOKIE_SESSION_KEY); if(cs&&cs.role&&cs.id)state.session=cs; return; }
    const d=JSON.parse(raw);
    ['owners','renters','cars','bookings','msgs','ratings'].forEach(k=>{ if(Array.isArray(d[k])) state[k]=d[k]; });
    if(d.users&&typeof d.users==='object')state.users=d.users;
    if(d.session)state.session=d.session;
    if(!state.session){ const cs=getCookieJSON(COOKIE_SESSION_KEY); if(cs&&cs.role&&cs.id)state.session=cs; }
    if(d.seq&&Number.isFinite(+d.seq))seq=+d.seq;
  }catch(e){console.error('local load failed', e)}
}
function cloudErr(e){console.error(e);showToast('השמירה עברה למצב מקומי יציב — אין צורך ב-Netlify Blobs')}

/* ================= STATE ================= */
const state = {
  owners: [],   // {id,name,phone,email,pass}
  renters: [],  // {id,name,phone,email,pass,lic}
  cars: [],     // {id,ownerId,make,model,yr,color,cat,price,priceHourly,priceDaily,priceWeekly,rentalTypes[],seats,gear,fuel,tags[],status,ret,photos[]}
  bookings: [], // {id,num,status:'pending'|'approved'|'rejected'|'done',carId,ownerId,renterId,from,tmFrom,to,tmTo,hours,days,total,signName,signDate,sig,createdAt}
  session: null // {role:'owner'|'renter', id}
};
let seq = 1; const newId = p => p + (seq++) + Math.random().toString(36).slice(2,6);
let filter='all', searchQ={}, currentCar=null, authRole=null, authMode='login', editId=null, formPhotos=[], rlicData=null, rlicBackData=null, lastBooking=null;

const CAR_MAKES_MODELS={
  "Acura":["ILX","Integra","TLX","RLX","RDX","MDX","ZDX"],
  "Alfa Romeo":["Giulia","Stelvio","Tonale","4C"],
  "Audi":["A3","A4","A5","A6","A7","A8","Q3","Q4 e-tron","Q5","Q7","Q8","e-tron","TT","R8"],
  "BMW":["2 Series","3 Series","4 Series","5 Series","7 Series","8 Series","X1","X2","X3","X4","X5","X6","X7","i3","i4","i5","i7","iX","M3","M4","M5"],
  "Buick":["Encore","Encore GX","Envision","Enclave","Envista","Regal","LaCrosse"],
  "Cadillac":["CT4","CT5","CT6","XT4","XT5","XT6","Escalade","Lyriq"],
  "Chevrolet":["Spark","Sonic","Cruze","Malibu","Impala","Trax","Trailblazer","Equinox","Blazer","Traverse","Tahoe","Suburban","Colorado","Silverado","Camaro","Corvette","Bolt EV","Bolt EUV"],
  "Chrysler":["200","300","Pacifica","Voyager","Town & Country"],
  "Dodge":["Charger","Challenger","Durango","Journey","Grand Caravan","Hornet"],
  "Ford":["Fiesta","Focus","Fusion","Taurus","EcoSport","Escape","Edge","Explorer","Expedition","Bronco","Bronco Sport","Maverick","Ranger","F-150","F-250","Mustang","Mach-E","Transit"],
  "Genesis":["G70","G80","G90","GV60","GV70","GV80"],
  "GMC":["Terrain","Acadia","Yukon","Canyon","Sierra","Savana","Hummer EV"],
  "Honda":["Fit","Civic","Accord","Insight","HR-V","CR-V","Passport","Pilot","Odyssey","Ridgeline","Clarity","Prologue"],
  "Hyundai":["Accent","Elantra","Sonata","Venue","Kona","Tucson","Santa Fe","Palisade","Ioniq","Ioniq 5","Ioniq 6","Veloster","Genesis"],
  "Infiniti":["Q50","Q60","Q70","QX30","QX50","QX55","QX60","QX70","QX80"],
  "Jaguar":["XE","XF","XJ","E-Pace","F-Pace","I-Pace","F-Type"],
  "Jeep":["Renegade","Compass","Cherokee","Grand Cherokee","Wrangler","Gladiator","Wagoneer","Grand Wagoneer"],
  "Kia":["Rio","Forte","K4","K5","Stinger","Soul","Seltos","Sportage","Sorento","Telluride","Carnival","Niro","EV6","EV9"],
  "Land Rover":["Range Rover","Range Rover Sport","Range Rover Velar","Range Rover Evoque","Discovery","Discovery Sport","Defender"],
  "Lexus":["IS","ES","GS","LS","UX","NX","RX","GX","LX","RC","LC","RZ","TX"],
  "Lincoln":["MKZ","Continental","Corsair","Nautilus","Aviator","Navigator"],
  "Mazda":["Mazda3","Mazda6","CX-3","CX-30","CX-5","CX-50","CX-7","CX-9","CX-90","MX-5 Miata"],
  "Mercedes-Benz":["A-Class","C-Class","E-Class","S-Class","CLA","CLS","GLA","GLB","GLC","GLE","GLS","G-Class","EQA","EQB","EQE","EQS","Metris","Sprinter"],
  "Mini":["Cooper","Cooper S","Clubman","Countryman","Paceman"],
  "Mitsubishi":["Mirage","Lancer","Outlander","Outlander Sport","Eclipse Cross","Montero"],
  "Nissan":["Versa","Sentra","Altima","Maxima","Kicks","Rogue","Murano","Pathfinder","Armada","Frontier","Titan","Leaf","Ariya","Z"],
  "Polestar":["Polestar 1","Polestar 2","Polestar 3","Polestar 4"],
  "Porsche":["718 Boxster","718 Cayman","911","Panamera","Macan","Cayenne","Taycan"],
  "Ram":["1500","2500","3500","ProMaster","ProMaster City"],
  "Rivian":["R1T","R1S","EDV"],
  "Subaru":["Impreza","Legacy","WRX","BRZ","Crosstrek","Forester","Outback","Ascent","Solterra"],
  "Tesla":["Model 3","Model Y","Model S","Model X","Cybertruck"],
  "Toyota":["Yaris","Corolla","Camry","Avalon","Crown","Prius","Mirai","C-HR","Corolla Cross","RAV4","Venza","Highlander","Grand Highlander","4Runner","Sequoia","Sienna","Tacoma","Tundra","Land Cruiser","bZ4X","Supra"],
  "Volkswagen":["Jetta","Passat","Arteon","Golf","GTI","Taos","Tiguan","Atlas","ID.4","Beetle"],
  "Volvo":["S60","S90","V60","V90","XC40","XC60","XC90","C40","EX30","EX90"]
};
const ENGINE_TYPES=["3 צילינדרים טורבו","4 צילינדרים","4 צילינדרים טורבו","V6","V6 טורבו","V8","V8 טורבו","היברידי","היברידי נטען (PHEV)","חשמלי","דיזל","דיזל טורבו","1.5L","1.6L","2.0L","2.4L","2.5L","3.0L","3.5L","5.0L"];

const VEHICLE_COLORS=["שחור","לבן","כסף","אפור","כחול","אדום","ירוק","חום","בז׳","זהב","כתום","צהוב","אחר"];
const VEHICLE_SIZES=["קומפקטי","משפחתי","סדאן","SUV קטן","SUV","SUV גדול","מיניוואן","פיקאפ","מסחרי","יוקרה","אחר"];
function yearList(){const y=new Date().getFullYear()+1;let arr=[];for(let i=y;i>=2000;i--)arr.push(String(i));return arr;}
function fillSelectWithOther(id,items,placeholder){const el=$(id); if(!el)return; const cur=el.value; el.innerHTML=`<option value="">${placeholder}</option>`+items.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')+`<option value="אחר">אחר / Other</option>`; if([...items,'אחר'].includes(cur))el.value=cur;}
function toggleOtherInput(selId,inputId){const sel=$(selId), inp=$(inputId); if(!sel||!inp)return; inp.classList.toggle('show',sel.value==='אחר');}
function selectedOrOther(selId,inputId){const sel=$(selId), inp=$(inputId); const v=sel?sel.value:''; return v==='אחר' ? (inp?inp.value.trim():'') : String(v||'').trim();}
function ownerMakeChanged(){
  const make=$('a-make')?.value||'';
  toggleOtherInput('a-make','a-make-other');
  const models=make && make!=='אחר' ? (CAR_MAKES_MODELS[make]||[]) : [];
  fillSelectWithOther('a-model',models,make&&make!=='אחר'?'בחר דגם':'בחר דגם / אחר');
  toggleOtherInput('a-model','a-model-other');
}
function setOwnerSelectValue(selId,inputId,value,items){
  const sel=$(selId), inp=$(inputId); if(!sel)return; value=String(value||'').trim();
  if(value && items && items.includes(value)){sel.value=value;if(inp){inp.value='';inp.classList.remove('show')}}
  else if(value){sel.value='אחר';if(inp){inp.value=value;inp.classList.add('show')}}
  else {sel.value='';if(inp){inp.value='';inp.classList.remove('show')}}
}
function initOwnerChoiceLists(){
  fillSelectWithOther('a-make',Object.keys(CAR_MAKES_MODELS),'בחר יצרן');
  fillSelectWithOther('a-model',[],'בחר דגם');
  const yr=$('a-yr'); if(yr)yr.innerHTML='<option value="">בחר שנה</option>'+yearList().map(y=>`<option value="${y}">${y}</option>`).join('');
  fillSelectWithOther('a-color',VEHICLE_COLORS.filter(x=>x!=='אחר'),'בחר צבע');
  fillSelectWithOther('a-engine',ENGINE_TYPES,'בחר מנוע');
}

const US_STATES=["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","District of Columbia","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming","Canada","Israel","Other"];
const RENTAL_TYPES={hourly:'לפי שעות',daily:'לפי ימים',long:'תקופות ארוכות'};
function rentalTypesOf(c){return Array.isArray(c.rentalTypes)&&c.rentalTypes.length?c.rentalTypes:['hourly'];}
function rentalLabel(k){return RENTAL_TYPES[k]||k;}
function selectedRentalTypes(){return [...document.querySelectorAll('input[name="a-rental"]:checked')].map(x=>x.value);}
function setRentalChecks(types){const set=new Set(types&&types.length?types:['hourly']);document.querySelectorAll('input[name="a-rental"]').forEach(x=>x.checked=set.has(x.value));updateOwnerPriceFields();}
function normalizeRates(c){
  const base=+(c.price||0);
  return {
    hourly:+(c.priceHourly||c.hourlyPrice||base||0),
    daily:+(c.priceDaily||c.dailyPrice||0),
    long:+(c.priceWeekly||c.weeklyPrice||c.priceLong||0)
  };
}
function rateOf(c,type){return normalizeRates(c)[type]||0;}
function primaryRentalType(c){const types=rentalTypesOf(c);return types.find(t=>rateOf(c,t)>0)||types[0]||'hourly';}
function primaryRate(c){return rateOf(c,primaryRentalType(c))||+(c.price||0);}
function rateUnitLabel(type){return type==='daily'?'ליום':type==='long'?'לשבוע':'לשעה';}
function rateSummary(c){
  const rates=normalizeRates(c);
  return rentalTypesOf(c).filter(t=>rates[t]>0).map(t=>`${rentalLabel(t)}: ${money(rates[t])} ${rateUnitLabel(t)}`).join(' · ');
}
function ratePills(c){
  const rates=normalizeRates(c);
  return rentalTypesOf(c).filter(t=>rates[t]>0).map(t=>`<span class="rate-pill">${money(rates[t])} ${rateUnitLabel(t)}</span>`).join('');
}
function updateOwnerPriceFields(){
  const types=selectedRentalTypes();
  [['hourly','af-price-hourly'],['daily','af-price-daily'],['long','af-price-weekly']].forEach(([t,id])=>{const el=$(id);if(el)el.classList.toggle('show',types.includes(t));});
}
function bestPriceForSearch(c){
  const qtype=$('q-rental')?.value||'';
  if(qtype)return rateOf(c,qtype)||999999999;
  const rates=normalizeRates(c);
  const vals=rentalTypesOf(c).map(t=>rates[t]).filter(v=>v>0);
  return vals.length?Math.min(...vals):+(c.price||0);
}
function selectedBookingRentalType(){return $('book-rental-type')?.value||primaryRentalType(currentCar||{});}
function bookingRate(){return currentCar?rateOf(currentCar,selectedBookingRentalType())||primaryRate(currentCar):0;}
function bookingUnits(){
  const type=selectedBookingRentalType(), h=hoursTotal();
  if(type==='daily')return Math.max(1,Math.ceil(h/24));
  if(type==='long')return Math.max(1,Math.ceil(daysTotal()/7));
  return h;
}
function bookingUnitName(){const t=selectedBookingRentalType();return t==='daily'?'ימים':t==='long'?'שבועות':'שעות';}

function fillSelect(id,items,placeholder){const el=$(id); if(!el)return; const cur=el.value; el.innerHTML=`<option value="">${placeholder}</option>`+items.map(x=>`<option>${esc(x)}</option>`).join(''); if(items.includes(cur))el.value=cur;}
function populateModelSelect(makeId,modelId){const make=$(makeId)?.value||''; const models=make?CAR_MAKES_MODELS[make]||[]:[...new Set(Object.values(CAR_MAKES_MODELS).flat())].sort(); fillSelect(modelId,models,make?'כל הדגמים של '+make:'כל הדגמים');}
function initChoiceLists(){fillSelect('q-make',Object.keys(CAR_MAKES_MODELS),'כל יצרני הרכב'); populateModelSelect('q-make','q-model'); }


const $ = id => document.getElementById(id);
const esc = s => String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const money = n => '$'+Number(n||0).toLocaleString('en-US');

/* ================= HARDENING / RECOVERY ================= */
function safeToast(msg){ try{ showToast(msg); }catch(e){ console.warn(msg); } }
window.addEventListener('error', e=>{
  console.error('CrownDrive runtime error:', e.error||e.message);
  safeToast('זוהתה תקלה קטנה במסך — האתר ממשיך לעבוד.');
});
window.addEventListener('unhandledrejection', e=>{
  console.error('CrownDrive promise error:', e.reason);
  safeToast('פעולה נכשלה זמנית — הנתונים נשמרים מקומית בדפדפן.');
});
function safeArr(v){ return Array.isArray(v)?v:[] }
function fallbackCarPhoto(){
  return 'data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="#E6EAEF"/><text x="400" y="245" text-anchor="middle" font-size="42" font-family="Arial" fill="#31567A">Crown Drive</text><text x="400" y="300" text-anchor="middle" font-size="24" font-family="Arial" fill="#6E6E73">תמונה חסרה</text></svg>');
}
function ensureStateIntegrity(){
  try{
    state.owners=safeArr(state.owners); state.renters=safeArr(state.renters); state.cars=safeArr(state.cars);
    state.bookings=safeArr(state.bookings); state.msgs=safeArr(state.msgs); state.ratings=safeArr(state.ratings);
    state.users=(state.users&&typeof state.users==='object')?state.users:{}; state.reads=(state.reads&&typeof state.reads==='object')?state.reads:{};
    state.owners.forEach(u=>{ if(u&&u.id) state.users[u.id]={...(state.users[u.id]||{}),...u,role:'owner'}; });
    state.renters.forEach(u=>{ if(u&&u.id) state.users[u.id]={...(state.users[u.id]||{}),...u,role:'renter'}; });
    state.cars.forEach(c=>{
      c.id=c.id||newId('c'); c.photos=safeArr(c.photos).filter(Boolean); if(!c.photos.length)c.photos=[fallbackCarPhoto()];
      c.tags=safeArr(c.tags); c.rentalTypes=safeArr(c.rentalTypes); if(!c.rentalTypes.length)c.rentalTypes=['hourly'];
      if(!['available','rented'].includes(c.status)) c.status='available';
      c.updatedAt=+c.updatedAt||+c.createdAt||Date.now();
    });
    state.bookings.forEach(b=>{ b.id=b.id||newId('b'); if(!['pending','approved','rejected','done'].includes(b.status)) b.status=b.done?'done':'approved'; b.createdAt=+b.createdAt||Date.now(); });
    if(state.session){
      if(state.session.role==='admin'){ state.session.id='admin'; state.session.name=state.session.name||'מנהל האתר'; }
      else {
        const pool=state.session.role==='owner'?state.owners:state.renters;
        let rec=pool.find(x=>x.id===state.session.id);
        if(!rec && state.session.id && (state.session.email||state.session.name)){
          rec={...state.session,pass:state.session.pass||''}; pool.push(rec);
        }
        if(rec) state.session={...rec,role:state.session.role}; else state.session=null;
      }
    }
    if(!Number.isFinite(+seq)||seq<1) seq=Date.now();
  }catch(e){ console.error('State repair failed', e); }
}
const LOGIN_LOCK_KEY='crowndrive_login_lock_v1';
function loginLockMap(){ try{return JSON.parse(localStorage.getItem(LOGIN_LOCK_KEY)||'{}')}catch(e){return {}} }
function saveLoginLockMap(m){ try{localStorage.setItem(LOGIN_LOCK_KEY,JSON.stringify(m))}catch(e){} }
function loginKey(email){ return String(email||'').toLowerCase().replace(/[^a-z0-9@._-]/g,'').slice(0,100); }
function isLoginLocked(email){ const m=loginLockMap(), r=m[loginKey(email)]; return r&&r.until&&Date.now()<r.until; }
function loginLockSeconds(email){ const m=loginLockMap(), r=m[loginKey(email)]; return r&&r.until?Math.max(0,Math.ceil((r.until-Date.now())/1000)):0; }
function noteLoginFail(email){ const m=loginLockMap(), k=loginKey(email), r=m[k]||{n:0,until:0}; r.n=(r.n||0)+1; if(r.n>=5) r.until=Date.now()+5*60*1000; m[k]=r; saveLoginLockMap(m); }
function clearLoginFail(email){ const m=loginLockMap(); delete m[loginKey(email)]; saveLoginLockMap(m); }
function togglePassword(id,btn){const el=$(id);if(!el)return;const show=el.type==='password';el.type=show?'text':'password';if(btn)btn.textContent=show?'הסתר סיסמה':'הצג סיסמה';}
const me = () => state.session;

const ic = {
  seat:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><path d="M7 18v-6a5 5 0 015-5h0a5 5 0 015 5v6M5 21h14"/></svg>',
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  fuel:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><path d="M5 21V5a2 2 0 012-2h6a2 2 0 012 2v16M3 21h14M15 9h2a2 2 0 012 2v5a1.5 1.5 0 003 0V9l-3-3"/></svg>'
};

/* ================= NAV / SESSION ================= */
function openMyArea(){
  try{
    ensureStateIntegrity();
    if(!state.session){ openAuth(); return; }
    if(state.session.role==='admin') return openAdmin();
    if(state.session.role==='owner') return openOwner();
    return openRenterArea();
  }catch(e){
    console.error('openMyArea failed', e);
    safeToast('האזור האישי תוקן בטעינה — נסה לפתוח שוב.');
    ensureStateIntegrity(); renderNav(); renderMyAreaFab();
  }
}
function renderMyAreaFab(){
  const fab=$('my-area-fab'), lab=$('my-area-fab-label');
  if(!fab)return;
  if(!state.session){ fab.classList.remove('show'); return; }
  const role=state.session.role;
  if(lab) lab.textContent = role==='admin'?'לוח מנהל':(role==='owner'?'אזור בעל רכב':'האזור שלי');
  fab.classList.add('show');
}
function renderNav(){
  const el = $('nav-side');
  if(!el){ renderMyAreaFab(); return; }
  if(!state.session){
    el.innerHTML = `<button class="btn btn-dark-out" onclick="openAuth()">כניסה / הרשמה</button>`;
  } else {
    const u = me()||{};
    const role = state.session.role;
    const roleTxt = role==='admin'?'מנהל האתר':(role==='owner'?'בעל רכב':'שוכר');
    const mainLabel = role==='admin'?'לוח מנהל':(role==='owner'?'אזור בעלי רכב':'האזור שלי');
    el.innerHTML = `
      <span class="who">שלום, <b>${esc((u.name||'משתמש').split(' ')[0])}</b> · ${roleTxt}</span>
      <button class="btn btn-gold" onclick="openMyArea()">${mainLabel}</button>
      ${role==='admin'?'':`<button class="btn btn-dark-out" onclick="openAccount()" title="עריכת פרטי החשבון">⚙ החשבון</button>`} <button class="btn btn-dark-out" onclick="logout()">יציאה</button>`;
  }
  renderMyAreaFab();
}
function logout(){try{ if(RT_AUTH&&RT_AUTH.currentUser)RT_AUTH.signOut(); }catch(e){} if(CLOUD&&fauth.currentUser){fauth.signOut()}state.session=null;clearAuthIdentity();delCookie(COOKIE_SESSION_KEY);persistState();stopUserFeeds();stopAdminFeeds();renderNav();toggleChat(false);updateBadge();renderMyAreaFab();showToast('יצאת מהמערכת בהצלחה')}

/* ================= AUTH ================= */
function openAuth(role){
  authRole=null;
  $('auth-roles').style.display='block';
  $('auth-forms').style.display='none';
  $('auth-title').textContent='כניסה לחשבון';
  openOv('ov-auth');
  if(role) pickRole(role);
  setTimeout(()=>prefillSavedLogin(authRole),0);
}
function pickRole(r){
  if(r==='admin'){
    adminSecretMode=true;
    authRole='admin';
    $('auth-roles').style.display='none';
    $('auth-forms').style.display='block';
    $('renter-extras').style.display='none';
    $('auth-title').textContent='כניסת מנהל מערכת';
    $('t-signup').style.display='none';
    const back=document.querySelector('.auth-back'); if(back)back.style.display='';
    setAuthMode('login');
    setTimeout(()=>{$('l-mail').focus()},60);
    return;
  }
  closeHiddenAdminMode();
  authRole=r;
  $('auth-roles').style.display='none';
  $('auth-forms').style.display='block';
  $('renter-extras').style.display = r==='renter' ? 'block':'none';
  $('auth-title').textContent = r==='owner' ? 'חשבון בעל רכב' : 'חשבון שוכר';
  setAuthMode('login');
}
function backToRoles(){authRole=null;closeHiddenAdminMode();$('auth-roles').style.display='block';$('auth-forms').style.display='none';$('auth-title').textContent='כניסה לחשבון'}
function setAuthMode(m){
  authMode=m;
  $('t-login').classList.toggle('on',m==='login');
  $('t-signup').classList.toggle('on',m==='signup');
  $('auth-login').style.display = m==='login'?'block':'none';
  $('auth-signup').style.display = m==='signup'?'block':'none';
}
let adminSecretMode=false;
function openHiddenAdminLogin(){
  const needed=['ov-auth','auth-title','auth-roles','auth-forms','t-signup','l-mail'];
  if(!needed.every(id=>$(id))){setTimeout(openHiddenAdminLogin,120);return}
  adminSecretMode=true;
  openAuth();
  authRole='admin';
  $('auth-title').textContent='כניסת מנהל מערכת';
  $('auth-roles').style.display='none';
  $('auth-forms').style.display='block';
  $('t-signup').style.display='none';
  const back=document.querySelector('.auth-back'); if(back)back.style.display='none';
  setAuthMode('login');
  setTimeout(()=>{$('l-mail').focus()},80);
}
function closeHiddenAdminMode(){
  adminSecretMode=false;
  if($('t-signup'))$('t-signup').style.display='';
  const back=document.querySelector('.auth-back'); if(back)back.style.display='';
}
function shouldOpenAdminFromUrl(){
  // כניסת מנהל מוסתרת: אין פתיחה דרך #admin או ?admin=1.
  // מנהל נכנס דרך בחירת 'בעל רכב' עם פרטי המנהל בלבד.
  return false;
}
function checkAdminUrl(){
  if(shouldOpenAdminFromUrl()) setTimeout(openHiddenAdminLogin,80);
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',checkAdminUrl);
else checkAdminUrl();
window.addEventListener('load',checkAdminUrl);
window.addEventListener('pageshow',checkAdminUrl);
window.addEventListener('hashchange',checkAdminUrl);
window.addEventListener('keydown',e=>{
  // אין קיצור מקשים גלוי/נסתר לכניסת מנהל.
});

const ADMIN_EMAIL='shmuel123770@icloud.com', ADMIN_PASS='amarZ770@';
let authJustSignedUp=false, pendingProfile=null;
function afterLoginUI(){
  persistState();
  closeOv('ov-auth'); renderNav(); renderMyAreaFab(); updateBadge();
  const u=me();
  if(u&&u.name)showToast('ברוך הבא, '+u.name.split(' ')[0]);
  if(pendingBookCar && state.session && state.session.role==='renter'){const c=pendingBookCar;pendingBookCar=null;openBook(c)}
  else pendingBookCar=null;
  if(state.session && state.session.role==='admin') openAdmin();
  if(state.session && state.session.role==='owner' && authJustSignedUp){authJustSignedUp=false;openOwner();}
}
let acLicData=null;
function openAccount(){
  const u=me(); if(!u)return;
  $('ac-name').value=u.name||'';
  $('ac-phone').value=u.phone||'';
  $('ac-mail').value='';$('ac-pass').value='';
  acLicData=null;$('ac-lic').value='';
  $('ac-renter-extra').style.display = u.role==='renter'?'block':'none';
  openOv('ov-account');
}
$('ac-lic').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f)return;
  const r=new FileReader();
  r.onload=()=>{acLicData=r.result;showToast('צילום הרישיון החדש נטען')};
  r.readAsDataURL(f);
});
function saveAccount(){
  const u=me(); if(!u)return;
  const name=$('ac-name').value.trim(), phone=$('ac-phone').value.trim();
  const newMail=$('ac-mail').value.trim().toLowerCase(), newPass=$('ac-pass').value;
  if(!name){showToast('שם מלא הוא שדה חובה');return}
  if(newPass && newPass.length<6){showToast('סיסמה חדשה חייבת לפחות 6 תווים');return}
  if(CLOUD){
    const jobs=[db.collection('users').doc(u.id).update({name})];
    const priv={phone}; if(acLicData)priv.lic=acLicData;
    jobs.push(db.collection('private').doc(u.id).update(priv));
    const au=fauth.currentUser;
    if(newMail && au)jobs.push(au.updateEmail(newMail));
    if(newPass && au)jobs.push(au.updatePassword(newPass));
    Promise.all(jobs).then(()=>{
      Object.assign(state.session,{name,phone});
      if(acLicData)state.session.lic=acLicData;
      if(newMail)state.session.email=newMail;
      if(newMail||newPass) rememberLogin(state.session.role, state.session.email||newMail||u.email, newPass||'');
      persistSessionCookie();
      renderNav();closeOv('ov-account');showToast('הפרטים עודכנו בהצלחה');
    }).catch(e=>{
      const msg=((e&&e.code)||'').indexOf('requires-recent-login')>-1
        ? 'מטעמי אבטחה, שינוי מייל/סיסמה דורש התנתקות והתחברות מחדש — ואז לנסות שוב'
        : 'שגיאה: '+((e&&e.message)||e);
      showToast(msg);
    });
    return;
  }
  const pool = u.role==='owner'?state.owners:state.renters;
  const rec = pool.find(x=>x.id===u.id);
  if(!rec)return;
  if(newMail){
    if(pool.some(x=>x.email===newMail&&x.id!==u.id)){showToast('המייל החדש כבר רשום במערכת');return}
    rec.email=newMail;
  }
  rec.name=name;rec.phone=phone;
  if(newPass)rec.pass=newPass;
  if(acLicData)rec.lic=acLicData;
  state.users[u.id]={...(state.users[u.id]||{}),name};
  Object.assign(state.session,{name,phone});
  if(newMail)state.session.email=newMail;
  if(newPass)state.session.pass=newPass;
  if(newMail||newPass) rememberLogin(u.role, state.session.email||rec.email, newPass||rec.pass);
  if(acLicData)state.session.lic=acLicData;
  renderNav();render();closeOv('ov-account');showToast('הפרטים עודכנו בהצלחה');
}
function forgotPass(){
  const em=$('l-mail').value.trim().toLowerCase();
  if(!em){mark('lf-mail',true);showToast('הזינו את כתובת המייל ואז לחצו על שחזור');return}
  if(em===ADMIN_EMAIL){
    showToast('אם זה חשבון מנהל, שינוי הסיסמה נעשה דרך עדכון קובץ האתר.');
    return;
  }
  if(CLOUD){
    fauth.sendPasswordResetEmail(em)
      .then(()=>showToast('נשלח מייל לשחזור הסיסמה — בדקו את תיבת הדואר'))
      .catch(e=>showToast('שגיאה: '+((e&&e.message)||e)));
  } else {
    showToast('שחזור סיסמה במייל יפעל אחרי חיבור מסד הנתונים (Firebase)');
  }
}
async function doLogin(){
  const em=$('l-mail').value.trim().toLowerCase(), ps=$('l-pass').value;
  if(isLoginLocked(em)){ showToast('יותר מדי ניסיונות כניסה. נסה שוב בעוד '+loginLockSeconds(em)+' שניות.'); return; }

  try{
    // כניסת מנהל מוסתרת: בוחרים 'אני בעל רכב' ומזינים את פרטי המנהל.
    if((authRole==='owner' || adminSecretMode) && em===ADMIN_EMAIL && ps===ADMIN_PASS){
      clearLoginFail(em); rememberLogin('admin',em,ps);
      let uid='admin';
      if(REALTIME && firebaseAuthReady()){
        const fbUser=await firebaseLoginOrCreate(em,ps,true);
        if(fbUser && fbUser.uid) uid=fbUser.uid;
      }
      state.session={role:'admin',id:uid,name:'מנהל האתר',email:ADMIN_EMAIL};
      state.users[uid]={name:'מנהל האתר',role:'admin',email:ADMIN_EMAIL,updatedAt:Date.now()};
      rememberAuthIdentity(uid,ADMIN_EMAIL);
      if(CLOUD)startAdminFeeds();
      afterLoginUI();
      return;
    }

    if(CLOUD){
      mark('lf-mail',false);mark('lf-pass',false);
      fauth.signInWithEmailAndPassword(em,ps).then(()=>clearLoginFail(em)).catch(e=>{
        noteLoginFail(em);
        if(((e&&e.code)||'').indexOf('user')>-1)mark('lf-mail',true);else mark('lf-pass',true);
      });
      return;
    }

    const pool = authRole==='owner'?state.owners:state.renters;
    let u = pool.find(x=>x.email===em);
    mark('lf-mail',!u);
    if(!u){ noteLoginFail(em); return; }
    mark('lf-pass',u.pass!==ps);
    if(u.pass!==ps){ noteLoginFail(em); return; }

    // Firebase Auth sign-in is required for secure realtime Rules.
    u = await ensureFirebaseSessionForLocalUser(authRole,u,ps);
    clearLoginFail(em);
    rememberLogin(authRole,em,ps);
    state.session={role:authRole,id:u.id,...u};
    state.users[u.id]={...(state.users[u.id]||{}),name:u.name,role:authRole,email:u.email,updatedAt:Date.now()};
    afterLoginUI();
  }catch(e){
    noteLoginFail(em);
    console.error('login failed',e);
    const msg=((e&&e.message)||String(e));
    if(/auth\//.test((e&&e.code)||'')) showToast('Firebase Auth חסם כניסה: '+msg.replace('Firebase: ',''));
    else showToast('שגיאת כניסה: '+msg);
  }
}
async function doSignup(){
  const name=$('s-name').value.trim(), phone=$('s-phone').value.replace(/\D/g,'');
  const em=$('s-mail').value.trim().toLowerCase(), ps=$('s-pass').value;
  const pool = authRole==='owner'?state.owners:state.renters;
  let bad=false;
  const mk=(id,b)=>{mark(id,b);if(b)bad=true};
  mk('sf-name',name.length<2);
  mk('sf-phone',phone.length<9);
  mk('sf-mail',!/^\S+@\S+\.\S+$/.test(em) || pool.some(x=>x.email===em));
  mk('sf-pass',ps.length<6);

  let extra={};
  if(authRole==='renter'){
    const licState=$('lic-state').value;
    mark('sf-lic-state',!licState);
    if(!licState.trim())bad=true;
    if(!rlicData){$('rlic-err').style.display='block';$('drop-rlic').classList.add('err-b');bad=true}
    if(!rlicBackData){$('rlic-back-err').style.display='block';$('drop-rlic-back').classList.add('err-b');bad=true}
    extra={lic:rlicData,licFront:rlicData,licBack:rlicBackData,licenseState:licState.trim()};
  }
  if(bad) return;

  try{
    if(CLOUD){
      const role=authRole;
      const prof={name,role,createdAt:Date.now(),updatedAt:Date.now()};
      const priv={phone:$('s-phone').value.trim(),...extra};
      fauth.createUserWithEmailAndPassword(em,ps).then(cred=>{
        const uid=cred.user.uid;
        authJustSignedUp=(role==='owner');
        pendingProfile={uid,prof,priv};
        return Promise.all([
          db.collection('users').doc(uid).set(prof),
          db.collection('private').doc(uid).set(priv)
        ]);
      }).then(()=>{
        ['s-name','s-phone','s-mail','s-pass'].forEach(i=>$(i).value='');
        clearRLic(true);clearRLicBack(true);if($('lic-state'))$('lic-state').value='';
        showToast('החשבון נוצר בהצלחה');
      }).catch(e=>{mark('sf-mail',true);showToast('שגיאה: '+((e&&e.message)||e))});
      return;
    }

    let uid=newId('u');
    if(REALTIME && firebaseAuthReady()){
      const fbUser=await firebaseLoginOrCreate(em,ps,true);
      if(fbUser && fbUser.uid) uid=fbUser.uid;
    }
    const u={id:uid, name, phone:$('s-phone').value.trim(), email:em, pass:ps, createdAt:Date.now(), ...extra};
    pool.push(u);
    state.users[u.id]={name:u.name,role:authRole,email:u.email,createdAt:u.createdAt};
    state.session={role:authRole,id:u.id,...u};
    rememberLogin(authRole,em,ps);
    rememberAuthIdentity(u.id,u.email);
    ['s-name','s-phone','s-mail','s-pass'].forEach(i=>$(i).value='');
    clearRLic(true);clearRLicBack(true);if($('lic-state'))$('lic-state').value='';
    showToast('החשבון נוצר בהצלחה');
    authJustSignedUp=(authRole==='owner');
    afterLoginUI();
  }catch(e){
    console.error('signup failed',e);
    mark('sf-mail',true);
    showToast('שגיאת הרשמה / Firebase Auth: '+(((e&&e.message)||e)+'').replace('Firebase: ',''));
  }
}

/* renter license upload in signup */
bindDrop('drop-rlic','rlic-file',f=>readImg(f,d=>{
  rlicData=d; $('rlic-img').src=d;
  $('rlic-prev').style.display='block'; $('drop-rlic').style.display='none';
  $('drop-rlic').classList.remove('err-b'); $('rlic-err').style.display='none';
}));
bindDrop('drop-rlic-back','rlic-back-file',f=>readImg(f,d=>{
  rlicBackData=d; $('rlic-back-img').src=d;
  $('rlic-back-prev').style.display='block'; $('drop-rlic-back').style.display='none';
  $('drop-rlic-back').classList.remove('err-b'); $('rlic-back-err').style.display='none';
}));
function clearRLic(s){rlicData=null;$('rlic-file').value='';$('rlic-prev').style.display='none';$('drop-rlic').style.display='block'}
function clearRLicBack(s){rlicBackData=null;$('rlic-back-file').value='';$('rlic-back-prev').style.display='none';$('drop-rlic-back').style.display='block'}

/* card formatting */

/* ================= FLEET ================= */
function bookingStartTs(b){return new Date((b.from||'1970-01-01')+'T'+(b.tmFrom||'00:00')).getTime()}
function bookingEndTs(b){return new Date((b.to||'1970-01-01')+'T'+(b.tmTo||'00:00')).getTime()}
function activeOrNextBookingForCar(carId){
  const now=Date.now();
  const list=state.bookings.filter(b=>b.carId===carId && ['approved','pending'].includes(b.status||'approved') && !b.done).sort((a,b)=>bookingStartTs(a)-bookingStartTs(b));
  return list.find(b=>bookingEndTs(b)>=now) || list[0] || null;
}
function availabilityText(c){
  const b=activeOrNextBookingForCar(c.id);
  if(!b)return c.status==='available'?'זמין עכשיו':'זמינות תעודכן בקרוב';
  const approved=(b.status||'approved')==='approved';
  if(c.status==='available' && bookingStartTs(b)>Date.now())return `פנוי עכשיו · ההזמנה הבאה ${fmt(b.from)} בשעה ${b.tmFrom}`;
  return `${approved?'זמין שוב':'בהמתנה לאישור · אם תאושר, זמין שוב'}: ${fmt(b.to)} בשעה ${b.tmTo}`;
}
function statusInfo(c){
  if(c.status==='available') return {cls:'ok',txt:'זמין עכשיו'};
  if(c.ret) return {cls:'soon',txt:'מתפנה בקרוב'};
  return {cls:'no',txt:'מושכר'};
}
let _renderHash='';
function render(){
  persistState();
  const list = state.cars.filter(matchesSearch).filter(c=>filter==='all'||(filter==='available'?c.status==='available':c.status!=='available')).sort((a,b)=>((b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0)));
  const hash=list.map(c=>c.id+'|'+(c.status||'')+'|'+(c.updatedAt||c.createdAt||0)).join(',')+':'+filter+':'+JSON.stringify(searchQ||{});
  if(hash===_renderHash) return;
  _renderHash=hash;
  const g=$('grid'); g.innerHTML='';
  if(state.cars.length===0){
    g.innerHTML=`<div class="empty">
      <h3>עדיין אין רכבים בצי</h3>
      <p>רכבים חדשים יתווספו בקרוב.</p>
    </div>`;
  } else if(list.length===0){
    g.innerHTML=`<div class="empty"><h3>אין רכבים בסינון זה</h3><p>נסו סינון אחר.</p></div>`;
  } else list.forEach((c,idx)=>{
    const s=statusInfo(c), off=c.status!=='available';
    const ow=userOf(c.ownerId);
    const ost=ownerStats(c.ownerId);
    const el=document.createElement('article');
    el.className='card card-new'+(off?' off':''); el.dataset.id=c.id; el.dataset.ph=0;
    el.style.animationDelay=(idx*70)+'ms';
    el.innerHTML=`
      <div class="gallery">
        <img src="${(c.photos&&c.photos[0])||fallbackCarPhoto()}" alt="${esc(c.make)} ${esc(c.model)}" loading="lazy" onerror="this.src=fallbackCarPhoto()">
        <span class="g-status"><span class="pill ${s.cls}">${s.txt}</span></span>
        <span class="g-count">1 / ${c.photos.length}</span>
        <button class="g-nav g-prev" onclick="slide('${c.id}',-1,event)" aria-label="תמונה קודמת">‹</button>
        <button class="g-nav g-next" onclick="slide('${c.id}',1,event)" aria-label="תמונה הבאה">›</button>
        <div class="g-dots">${c.photos.map((_,i)=>`<span class="${i===0?'on':''}"></span>`).join('')}</div>
      </div>
      <div class="card-body">
        <div class="card-title">
          <div><h3>${esc(c.make)} ${esc(c.model)}</h3><span class="meta">${c.yr} · ${esc(c.color)} · ${esc(c.cat)}</span></div>
          <div class="price"><b>${money(primaryRate(c))}</b><span>${rateUnitLabel(primaryRentalType(c))}</span></div>
        </div>
        <button class="owner-chip" onclick="openOwnerProfile('${c.ownerId}')" title="לצפייה בפרופיל, בדירוגים ובביקורות">
          <span class="oc-ava">${esc(ow?ow.name[0]:'?')}</span>
          <span class="oc-name">${esc(ow?ow.name.split(' ')[0]:'משכיר')}</span>
          ${starsHTML(ost.avg,ost.count)}
          <span class="oc-rv">· ${reviewsOf(c.ownerId).length} ביקורות</span>
        </button>
        <div class="specs">
          <span class="spec">${ic.seat} ${c.seats} מושבים</span>
          <span class="spec">${ic.gear} ${esc(c.gear)}</span>
          <span class="spec">${ic.fuel} הנעה: ${esc(c.fuel)}</span>
          ${c.engine?`<span class="spec">⚙ ${esc(c.engine)}</span>`:''}
          ${c.size?`<span class="spec">▣ ${esc(c.size)}</span>`:''}
        </div>
        <div class="rental-tags">${rentalTypesOf(c).map(t=>`<span class="rental-tag">${rentalLabel(t)}</span>`).join('')}</div>
        <div class="rate-list">${ratePills(c)}</div>
        ${c.tags.length?`<div class="tags">${c.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>`:''}
        <div class="availability-line">${esc(availabilityText(c))}</div>
        <div class="card-actions">
          <button class="card-btn chat" onclick="startOwnerChat('${c.ownerId}',event)">💬 צ'אט עם בעל הרכב</button>
          ${off?`<button class="card-btn dis" disabled>לא זמין כרגע</button>`
               :`<button class="card-btn book" onclick="tryBook('${c.id}')">הזמנת רכב זה</button>`}
        </div>
        <div class="home-chat-note">אפשר לשאול את בעל הרכב לפני ההזמנה</div>
      </div>`;
    g.appendChild(el);
  });
  const ok=state.cars.filter(c=>c.status==='available').length;
  const soon=state.cars.filter(c=>c.status!=='available'&&c.ret).length;
  animateNum($('cnt-ok'),ok); animateNum($('cnt-no'),state.cars.length-ok-soon); animateNum($('cnt-soon'),soon);
  animateNum($('hs-cars'),state.cars.length); animateNum($('hs-ok'),ok); animateNum($('side-avail'),ok);
  $('last-upd').textContent='עודכן '+new Date().toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'});
}

function norm(v){return String(v||'').trim().toLowerCase()}
function matchesSearch(c){
  const q=searchQ||{};
  const hay=norm([c.make,c.model,c.yr,c.color,c.cat,c.fuel,c.gear,c.engine,c.size,c.location,(c.tags||[]).join(' ')].join(' '));
  if(q.free && !hay.includes(norm(q.free)))return false;
  if(q.make && !norm(c.make).includes(norm(q.make)))return false;
  if(q.model && !norm(c.model).includes(norm(q.model)))return false;
  if(q.color && !norm(c.color).includes(norm(q.color)))return false;
  if(q.cat && !norm(c.cat).includes(norm(q.cat)))return false;
  if(q.fuel && c.fuel!==q.fuel)return false;
  if(q.seats && String(c.seats)!==String(q.seats))return false;
  if(q.rental && !rentalTypesOf(c).includes(q.rental))return false;
  return true;
}
function setRentalFilter(v,btn){
  const input=$('q-rental');
  const current=input?input.value:'';
  const next=current===v?'':v;
  if(input)input.value=next;
  document.querySelectorAll('.rent-chip').forEach(b=>b.classList.toggle('on',b.dataset.rental===next));
  updateSearch();
}
function setCarTypeFilter(v,btn){
  const input=$('q-cat');
  const current=input?input.value:'';
  const next=current===v?'':v;
  if(input)input.value=next;
  document.querySelectorAll('.type-chip').forEach(b=>b.classList.toggle('on',b.dataset.cat===next));
  updateSearch();
}

function updateSearch(){
  searchQ={
    free:$('q-free')&&$('q-free').value,
    make:$('q-make')&&$('q-make').value,
    model:$('q-model')&&$('q-model').value,
    color:$('q-color')&&$('q-color').value,
    cat:$('q-cat')&&$('q-cat').value,
    fuel:$('q-fuel')&&$('q-fuel').value,
    seats:$('q-seats')&&$('q-seats').value,
    rental:$('q-rental')&&$('q-rental').value
  };
  render();
}
function clearSearch(){
  ['q-free','q-make','q-model','q-color','q-cat','q-rental','q-fuel','q-seats'].forEach(id=>{if($(id))$(id).value=''});
  populateModelSelect('q-make','q-model');
  document.querySelectorAll('.rent-chip,.type-chip').forEach(b=>b.classList.remove('on'));
  searchQ={};render();
}

function slide(id,dir,e){
  e.stopPropagation();
  const el=document.querySelector(`.card[data-id="${id}"]`);
  const c=state.cars.find(x=>x.id===id);
  const i=(+el.dataset.ph+dir+c.photos.length)%c.photos.length;
  el.dataset.ph=i;
  const img=el.querySelector('.gallery img');
  const swap=()=>{img.src=c.photos[i];img.style.opacity=1};
  if(reduced){swap()}else{img.style.opacity=0;setTimeout(swap,180)}
  el.querySelector('.g-count').textContent=`${i+1} / ${c.photos.length}`;
  el.querySelectorAll('.g-dots span').forEach((d,j)=>d.classList.toggle('on',j===i));
}
function setFilter(f,btn){filter=f;document.querySelectorAll('.filters button').forEach(b=>b.classList.remove('on'));btn.classList.add('on');render()}
function scrollToFleet(){$('fleet').scrollIntoView({behavior:'smooth'})}

function firstAvailableCarId(){
  const car=(state.cars||[]).find(c=>c.status==='available') || (state.cars||[])[0];
  return car ? car.id : null;
}
function goHowStep(step){
  if(step===1){
    openAuth('renter');
    return;
  }
  if(step===2){
    scrollToFleet();
    showToast('בחר רכב ולחץ הזמנה או צ׳אט עם בעל הרכב');
    return;
  }
  if(step===3){
    const id=firstAvailableCarId();
    if(!id){showToast('אין רכבים זמינים כרגע');scrollToFleet();return;}
    tryBook(id);
    return;
  }
  if(step===4){
    if(state.session && state.session.role==='renter') openRenterArea();
    else {showToast('כדי לראות קבלות והזמנות יש להתחבר כשוכר');openAuth('renter');}
  }
}

/* ================= OWNER DASHBOARD ================= */
function openOwner(){
  if(!state.session||state.session.role!=='owner') return openAuth('owner');
  setDash('cars'); renderAdminList(); resetCarForm(); openOv('ov-owner');
}
function setDash(t){
  ['cars','add','book','rep','prof'].forEach(x=>{
    const el=$('dash-'+x);
    el.style.display = x===t?'block':'none';
    if(x===t&&!reduced){el.classList.remove('tab-anim');void el.offsetWidth;el.classList.add('tab-anim')}
    $('dt-'+x).classList.toggle('on',x===t);
  });
  if(t==='book') renderOwnerBookings();
  if(t==='rep') renderOwnerReport();
  if(t==='prof') renderOwnerProfileSettings();
}
function myCars(){return state.cars.filter(c=>c.ownerId===state.session.id)}
function renderAdminList(){
  const box=$('adm-list'), list=myCars();
  if(list.length===0){box.innerHTML='<div class="adm-empty">עדיין לא פרסמת רכבים. מלא את הטופס למטה כדי לפרסם את הראשון.</div>';return}
  box.innerHTML=list.map(c=>{
    const s=statusInfo(c);
    return `<div class="adm-item">
      <img src="${c.photos[0]}" alt="">
      <div class="inf"><b>${esc(c.make)} ${esc(c.model)} ${c.yr}</b>
        <div class="sm">${esc(c.color)} · הנעה: ${esc(c.fuel)} · ${esc(c.cat)} · ${rentalTypesOf(c).map(rentalLabel).join(' / ')} · ${rateSummary(c)||money(primaryRate(c))} · ${c.photos.length} תמונות · <span class="pill ${s.cls}" style="font-size:.62rem;padding:1px 8px">${s.txt}</span></div>
      </div>
      <div class="acts">
        <button class="mini" onclick="toggleStatus('${c.id}')">${c.status==='available'?'סימון כמושכר':'סימון כזמין'}</button>
        <button class="mini gold" onclick="editCar('${c.id}')">עריכת פרטים</button>
        <button class="mini danger" onclick="deleteCar('${c.id}')">מחיקת המודעה</button>
      </div>
    </div>`;
  }).join('');
}
function toggleStatus(id){
  const c=state.cars.find(x=>x.id===id);
  if(!c)return;
  const status=c.status==='available'?'rented':'available';
  const ret=status==='available'?'':c.ret||'';
  if(CLOUD){db.collection('cars').doc(id).update({status,ret}).catch(cloudErr);return;}
  c.status=status;c.ret=ret;
  render();renderAdminList();
}
function deleteCar(id){
  const c=state.cars.find(x=>x.id===id);
  const hasBookings=state.bookings.some(b=>b.carId===id);
  const msg=`למחוק את המודעה של ${c.make} ${c.model} ${c.yr} לגמרי?\n\nהרכב יוסר מהאתר מיד.`+(hasBookings?'\nהיסטוריית ההזמנות שלו תישמר בדוח ההכנסות.':'');
  if(!confirm(msg))return;
  if(editId===id)resetCarForm();
  if(CLOUD){db.collection('cars').doc(id).delete().then(()=>showToast('המודעה נמחקה מהאתר')).catch(cloudErr);return;}
  state.cars=state.cars.filter(x=>x.id!==id);
  render();renderAdminList();showToast('המודעה נמחקה מהאתר');
}
function editCar(id){
  const c=state.cars.find(x=>x.id===id);
  editId=id;
  setDash('add');
  setOwnerSelectValue('a-make','a-make-other',c.make,Object.keys(CAR_MAKES_MODELS));ownerMakeChanged();setOwnerSelectValue('a-model','a-model-other',c.model,CAR_MAKES_MODELS[$('a-make').value]||[]);$('a-yr').value=c.yr||'';
  setOwnerSelectValue('a-color','a-color-other',c.color||'',VEHICLE_COLORS);$('a-cat').value=c.cat;$('a-price-hourly').value=c.priceHourly||c.price||'';$('a-price-daily').value=c.priceDaily||'';$('a-price-weekly').value=c.priceWeekly||c.priceLong||'';
  $('a-seats').value=c.seats;$('a-gear').value=c.gear;$('a-fuel').value=c.fuel;
  $('a-tags').value=c.tags.join(', ');$('a-status').value=c.status;
  setOwnerSelectValue('a-engine','a-engine-other',c.engine||'',ENGINE_TYPES);$('a-size').value=c.size||'';$('a-location').value=c.location||'';setRentalChecks(c.rentalTypes);
  formPhotos=[...c.photos];renderPhotoGrid();
  $('form-title').textContent='עריכת '+c.make+' '+c.model;
  $('a-save').textContent='שמירת שינויים';$('a-cancel').style.display='block';
  const box=document.querySelector('#ov-owner .modal');
  const y=$('form-title').offsetTop-80;
  box.scrollTo({top:y,behavior:reduced?'auto':'smooth'});
  const ft=$('form-title');
  ft.classList.remove('flash');void ft.offsetWidth;ft.classList.add('flash');
}
function resetCarForm(){
  editId=null;
  ['a-make','a-model','a-yr','a-color','a-price-hourly','a-price-daily','a-price-weekly','a-tags','a-engine','a-size','a-location','a-make-other','a-model-other','a-color-other','a-engine-other'].forEach(i=>{if($(i))$(i).value=''});initOwnerChoiceLists();document.querySelectorAll('.other-input').forEach(x=>x.classList.remove('show'));
  $('a-cat').selectedIndex=0;$('a-seats').value='5';$('a-gear').selectedIndex=0;$('a-fuel').selectedIndex=0;$('a-status').value='available';setRentalChecks(['hourly']);
  formPhotos=[];renderPhotoGrid();
  ['af-make','af-model','af-yr','af-rentals','af-price-hourly','af-price-daily','af-price-weekly'].forEach(i=>$(i)&&$(i).classList.remove('err'));
  $('form-title').textContent='הוספת רכב חדש';$('a-save').textContent='פרסום הרכב';$('a-cancel').style.display='none';
  if($('ov-owner').classList.contains('open')&&$('dash-add').style.display==='block'&&arguments[0]===true)setDash('cars');
}
bindDrop('drop-photos','ph-file',null,files=>{
  [...files].forEach(f=>{
    if(!f.type.startsWith('image/'))return showToast('ניתן להעלות קבצי תמונה בלבד');
    if(f.size>10*1024*1024)return showToast(f.name+' — גדול מדי (מקס׳ 10MB)');
    if(formPhotos.length>=6)return showToast('עד 6 תמונות לרכב');
    readImg(f,d=>{formPhotos.push(d);renderPhotoGrid()});
  });
});
function removePhoto(i){formPhotos.splice(i,1);renderPhotoGrid()}
function renderPhotoGrid(){
  $('ph-grid').innerHTML=formPhotos.map((p,i)=>`
    <div class="ph"><img src="${p}" alt="תמונה ${i+1}"><button onclick="removePhoto(${i})">✕</button>${i===0?'<div class="main-tag">ראשית</div>':''}</div>`).join('');
  const req=$('ph-req'),n=formPhotos.length;
  if(n>=2){req.className='photo-req good';req.textContent=`✓ הועלו ${n} תמונות — עומד בדרישת המינימום`}
  else{req.className='photo-req bad';req.textContent=`הועלו ${n} מתוך 2 תמונות נדרשות`}
  $('drop-photos').classList.remove('err-b');
}
function saveCar(){
  if(!state.session || state.session.role!=='owner'){ showToast('צריך להיכנס כבעל רכב כדי להוסיף רכב'); return; }
  const make=selectedOrOther('a-make','a-make-other'),model=selectedOrOther('a-model','a-model-other');
  const yr=+$('a-yr').value;
  const priceHourly=+$('a-price-hourly').value, priceDaily=+$('a-price-daily').value, priceWeekly=+$('a-price-weekly').value;
  let bad=false;const mk=(id,b)=>{$(id).classList.toggle('err',b);if(b)bad=true};
  const color=selectedOrOther('a-color','a-color-other');
  const rentalTypes=selectedRentalTypes();
  mk('af-rentals',rentalTypes.length===0);
  mk('af-make',!make);mk('af-model',!model);mk('af-yr',!(yr>=2000&&yr<=2027));mk('af-color',!color);
  mk('af-price-hourly',rentalTypes.includes('hourly')&&!(priceHourly>0));
  mk('af-price-daily',rentalTypes.includes('daily')&&!(priceDaily>0));
  mk('af-price-weekly',rentalTypes.includes('long')&&!(priceWeekly>0));
  if(formPhotos.length<2){$('drop-photos').classList.add('err-b');showToast('חובה להעלות לפחות 2 תמונות של הרכב');bad=true}
  if(bad)return;
  const price = priceHourly || priceDaily || priceWeekly;
  const now=Date.now();
  const data={make,model,yr,price,priceHourly,priceDaily,priceWeekly,color,cat:$('a-cat').value,rentalTypes,updatedAt:now,
    seats:$('a-seats').value,gear:$('a-gear').value,fuel:$('a-fuel').value,
    engine:selectedOrOther('a-engine','a-engine-other'),size:$('a-size').value.trim(),location:$('a-location').value.trim(),
    tags:$('a-tags').value.split(',').map(t=>t.trim()).filter(Boolean),
    status:$('a-status').value,photos:[...formPhotos]};
  if(CLOUD){
    const payload=editId?data:{...data,ownerId:state.session.id,ret:'',createdAt:now};
    const op=editId? db.collection('cars').doc(editId).update(payload)
                   : db.collection('cars').add(payload);
    op.then(()=>{showToast(editId?'הרכב עודכן':make+' '+model+' נוסף לצי');resetCarForm();if($('ov-owner').classList.contains('open'))setDash('cars');}).catch(cloudErr);
    return; /* הרשימה מתרעננת דרך המאזין */
  }
  if(editId){
    Object.assign(state.cars.find(x=>x.id===editId),data);
    showToast('הרכב עודכן');
  } else {
    state.cars.push({id:newId('c'),createdAt:now,updatedAt:now,ownerId:state.session.id,ret:'',...data});
    showToast(make+' '+model+' נוסף לצי');
  }
  persistState();
  render();renderAdminList();resetCarForm();
  if($('ov-owner').classList.contains('open'))setDash('cars');
}

/* close a rental: booking marked done, car freed */
function endRental(bid){
  const b=state.bookings.find(x=>x.id===bid);
  if(!b||b.done)return;
  if(!state.session||!((state.session.role==='owner'&&b.ownerId===state.session.id)||state.session.role==='admin'))return;
  if(!confirm('לסיים את ההשכרה '+b.num+'? הרכב יסומן כזמין להשכרה.'))return;
  if(CLOUD){
    db.collection('bookings').doc(bid).update({done:true,status:'done',doneAt:Date.now()})
      .then(()=>db.collection('cars').doc(b.carId).update({status:'available',ret:''}))
      .then(()=>showToast('ההשכרה הסתיימה — הרכב חזר להיות זמין'))
      .catch(cloudErr);
    return;
  }
  b.done=true;b.status='done';b.doneAt=Date.now();
  const c=state.cars.find(x=>x.id===b.carId);
  if(c){c.status='available';c.ret='';}
  render();renderOwnerBookings();
  showToast('ההשכרה הסתיימה — הרכב חזר להיות זמין');
}

/* owner: bookings tab */
function renderOwnerBookings(){
  const all=state.bookings.filter(b=>b.ownerId===state.session.id).sort((a,b)=>b.createdAt-a.createdAt);
  const box=$('dash-book');
  if(all.length===0){box.innerHTML='<div class="adm-empty">עדיין אין הזמנות על הרכבים שלך.</div>';return}
  const pending=all.filter(b=>(b.status||'approved')==='pending');
  const approved=all.filter(b=>(b.status||'approved')==='approved'&&!b.done);
  const history=all.filter(b=>b.done || ['rejected'].includes(b.status));
  const pendingHtml=pending.length===0?'<div class="adm-empty">אין בקשות חדשות שממתינות לאישור.</div>':pending.map(b=>{
    const c=state.cars.find(x=>x.id===b.carId)||{make:'—',model:''};
    const rst=renterStats(b.renterId);
    return `<div class="adm-item" style="border:1px solid rgba(160,90,0,.35);background:rgba(160,90,0,.06)">
      ${b.lic?`<img src="${b.lic}" alt="רישיון" style="cursor:pointer" onclick="viewLic('${b.id}')">`:''}
      <div class="inf"><b>${esc(c.make)} ${esc(c.model)} · ${esc(b.signName)}</b>
        <div class="sm">${b.num} · ${fmt(b.from)} ${b.tmFrom} → ${fmt(b.to)} ${b.tmTo} · ${money(b.total)}</div>
        <div class="sm">סטטוס: ${bookingStatusHTML(b)} · דירוג שוכר: ${starsHTML(rst.avg,rst.count)}</div>
      </div>
      <div class="acts">
        <button class="mini gold" onclick="openChatTo('b${b.id}')">💬 צ'אט</button>
        <button class="mini" style="color:var(--ok);border-color:rgba(28,124,79,.4)" onclick="approveBooking('${b.id}')">✓ אישור</button>
        <button class="mini danger" onclick="rejectBooking('${b.id}')">דחייה</button>
      </div>
    </div>`;
  }).join('');
  const approvedHtml=approved.length===0?'<div class="adm-empty">אין השכרות פעילות שאושרו כרגע.</div>':approved.map(b=>{
    const c=state.cars.find(x=>x.id===b.carId)||{make:'—',model:''};
    const rst=renterStats(b.renterId);
    return `<div class="adm-item" style="border:1px solid rgba(28,124,79,.35);background:rgba(28,124,79,.05)">
      ${b.lic?`<img src="${b.lic}" alt="רישיון" style="cursor:pointer" onclick="viewLic('${b.id}')">`:''}
      <div class="inf"><b>${esc(c.make)} ${esc(c.model)} · ${esc(b.signName)}</b>
        <div class="sm">${b.num} · ${fmt(b.from)} ${b.tmFrom} → ${fmt(b.to)} ${b.tmTo} · ${money(b.total)}</div>
        <div class="sm">${bookingStatusHTML(b)} · דירוג שוכר: ${starsHTML(rst.avg,rst.count)}</div>
      </div>
      <div class="acts"><button class="mini gold" onclick="openChatTo('b${b.id}')">💬 צ'אט עם השוכר</button><button class="mini" style="color:var(--ok);border-color:rgba(28,124,79,.4)" onclick="endRental('${b.id}')">✓ סיום השכרה</button></div>
    </div>`;
  }).join('');
  const histHtml=history.length===0?'<div class="adm-empty">אין עדיין היסטוריית הזמנות.</div>':`<table class="tbl"><thead><tr><th>הזמנה</th><th>סטטוס</th><th>רכב</th><th>שוכר</th><th>תקופה</th><th>סכום</th><th>דירוג</th></tr></thead><tbody>${history.map(b=>{
    const c=state.cars.find(x=>x.id===b.carId)||{make:'—',model:''};
    const mine=myRating(b.id,'owner');
    return `<tr><td class="num">${b.num}<div class="sm">${new Date(b.createdAt).toLocaleDateString('he-IL')}</div></td><td>${bookingStatusHTML(b)}</td><td>${esc(c.make)} ${esc(c.model)}</td><td>${esc(b.signName||b.renterName||'')}</td><td>${fmt(b.from)} – ${fmt(b.to)}</td><td class="num">${money(b.total)}</td><td>${mine?starsHTML(mine.stars,null):ratePicker(b.id)}</td></tr>`;
  }).join('')}</tbody></table>`;
  box.innerHTML=`<div class="divider">ממתין לאישור שלך</div>${pendingHtml}<div class="divider">מאושר / פעיל</div>${approvedHtml}<div class="divider">היסטוריה</div>${histHtml}`;
}


/* owner: weekly report */
function weekKey(dateStr){
  const d=new Date(dateStr+'T00:00');
  const day=d.getDay(); // 0=Sunday
  const start=new Date(d); start.setDate(d.getDate()-day);
  return start.toISOString().split('T')[0];
}
function renderOwnerReport(){
  const list=state.bookings.filter(b=>b.ownerId===state.session.id && ((b.status||'approved')==='approved'||b.status==='done'||b.done));
  const box=$('dash-rep');
  if(list.length===0){box.innerHTML='<div class="adm-empty">אין עדיין נתונים לדוח. הדוח יתמלא אוטומטית עם קבלת הזמנות.</div>';return}
  const weeks={};
  list.forEach(b=>{
    const k=weekKey(b.from);
    weeks[k]=weeks[k]||{hours:0,revenue:0,count:0};
    weeks[k].hours+=b.hours; weeks[k].revenue+=b.total; weeks[k].count++;
  });
  const totH=list.reduce((s,b)=>s+b.hours,0), totR=list.reduce((s,b)=>s+b.total,0);
  const rows=Object.entries(weeks).sort((a,b)=>b[0].localeCompare(a[0])).map(([k,w])=>{
    const s=new Date(k+'T00:00'), e=new Date(s); e.setDate(s.getDate()+6);
    const f=d=>d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric'});
    return `<tr><td>${f(s)} – ${f(e)}</td><td class="num">${w.count}</td><td class="num">${w.hours}</td><td class="num">${money(w.revenue)}</td></tr>`;
  }).join('');
  box.innerHTML=`
    <div class="kpis">
      <div class="kpi"><b>${list.length}</b><span>סה"כ הזמנות</span></div>
      <div class="kpi"><b>${totH}</b><span>שעות השכרה מצטברות</span></div>
      <div class="kpi"><b>${money(totR)}</b><span>סה"כ הכנסות</span></div>
      <div class="kpi"><b>${money(Math.round(totR/Math.max(1,Object.keys(weeks).length)))}</b><span>ממוצע הכנסה לשבוע</span></div>
    </div>
    <table class="tbl"><thead><tr><th>שבוע (א'–ש')</th><th>הזמנות</th><th>שעות השכרה</th><th>הכנסה</th></tr></thead><tbody>${rows}</tbody></table>`;
}



function ownerUpcomingBookingsHTML(ownerId){
  const now=Date.now();
  const list=state.bookings.filter(b=>b.ownerId===ownerId && ['pending','approved'].includes(b.status||'approved') && !b.done && bookingEndTs(b)>=now).sort((a,b)=>bookingStartTs(a)-bookingStartTs(b));
  if(!list.length)return '<div class="adm-empty">אין הזמנות עתידיות כרגע.</div>';
  return `<table class="tbl"><thead><tr><th>מספר הזמנה</th><th>תאריך ושעה</th><th>שם השוכר</th><th>רכב</th><th>סטטוס</th></tr></thead><tbody>${list.map(b=>{
    const c=state.cars.find(x=>x.id===b.carId)||{make:'—',model:''};
    return `<tr><td class="num">${esc(b.num)}</td><td>${fmt(b.from)} ${esc(b.tmFrom)} → ${fmt(b.to)} ${esc(b.tmTo)}</td><td>${esc(b.signName||b.renterName||'')}</td><td>${esc(c.make)} ${esc(c.model)}</td><td>${bookingStatusHTML(b)}</td></tr>`;
  }).join('')}</tbody></table>`;
}
function renderOwnerProfileSettings(){
  const u=me(); if(!u)return;
  const prefs=u.prefs||{};
  const cars=myCars();
  $('dash-prof').innerHTML=`
    <div class="kpis">
      <div class="kpi"><b>${cars.length}</b><span>רכבים שלי</span></div>
      <div class="kpi"><b>${state.bookings.filter(b=>b.ownerId===u.id&&b.status==='pending').length}</b><span>ממתינות לאישור</span></div>
      <div class="kpi"><b>${state.bookings.filter(b=>b.ownerId===u.id&&(b.status==='approved'||b.done)).length}</b><span>הזמנות מאושרות/שהסתיימו</span></div>
    </div>
    <div class="divider">הזמנות הבאות לפי סדר</div>
    ${ownerUpcomingBookingsHTML(u.id)}
    <div class="divider">פרופיל משכיר</div>
    <div class="pref-grid">
      <div class="field"><label>שם שיופיע לשוכרים</label><input id="op-display" value="${esc(prefs.displayName||u.name||'')}"></div>
      <div class="field"><label>אזור מסירה מועדף</label><input id="op-area" value="${esc(prefs.area||'קראון הייטס')}"></div>
      <div class="field"><label>זמן תגובה משוער</label><select id="op-response"><option ${prefs.response==='מיידי'?'selected':''}>מיידי</option><option ${prefs.response==='עד שעה'?'selected':''}>עד שעה</option><option ${prefs.response==='באותו יום'?'selected':''}>באותו יום</option></select></div>
      <div class="field"><label>שפת שירות</label><input id="op-lang" value="${esc(prefs.lang||'עברית / English / Yiddish')}"></div>
    </div>
    <div class="field"><label>הודעת פתיחה אוטומטית לשוכרים</label><textarea id="op-welcome" rows="3" placeholder="לדוגמה: שלום, אשמח לענות על שאלות לגבי הרכב...">${esc(prefs.welcome||'')}</textarea></div>
    <div class="divider">העדפות אישיות</div>
    <div class="pref-grid">
      <div class="pref-card"><b>אישורי הזמנות</b><span>כל הזמנה חדשה נכנסת לסטטוס ממתין לאישור שלך.</span></div>
      <div class="pref-card"><b>צ׳אט ישיר</b><span>שוכרים יכולים לפתוח איתך צ׳אט ממסך הבית לפני ההזמנה.</span></div>
      <div class="pref-card"><b>פרטי חשבון</b><span>שינוי שם, טלפון, מייל וסיסמה דרך כפתור החשבון למעלה.</span></div>
    </div>
    <div class="m-actions"><button class="btn btn-gold grow" onclick="saveOwnerPrefs()">שמירת העדפות</button></div>`;
}
function saveOwnerPrefs(){
  const u=me(); if(!u)return;
  const prefs={displayName:$('op-display').value.trim(),area:$('op-area').value.trim(),response:$('op-response').value,lang:$('op-lang').value.trim(),welcome:$('op-welcome').value.trim()};
  savePrefs(prefs,'העדפות המשכיר נשמרו');
}
function savePrefs(prefs,msg){
  const u=me(); if(!u)return;
  u.prefs={...(u.prefs||{}),...prefs};
  if(CLOUD){db.collection('private').doc(u.id).set({prefs:u.prefs},{merge:true}).then(()=>showToast(msg)).catch(cloudErr);return;}
  const pool=u.role==='owner'?state.owners:state.renters;
  const rec=pool.find(x=>x.id===u.id); if(rec)rec.prefs=u.prefs;
  persistState(); showToast(msg);
}


/* ================= ADMIN DASHBOARD ================= */
let adminTab='all';
function openAdmin(){
  if(!state.session||state.session.role!=='admin'){showToast('כניסה למנהל בלבד');return}
  setAdminTab('all');
  openOv('ov-admin');
}
function setAdminTab(t){
  adminTab=t;
  ['all','bookings','chats','cars','users','data'].forEach(x=>{const b=$('ad-'+x);if(b)b.classList.toggle('on',x===t)});
  renderAdminDashboard();
}
function allBookingsSorted(){return [...state.bookings].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))}
function adminKPIs(){
  const bookings=state.bookings;
  const revenue=bookings.filter(b=>['approved','done'].includes(b.status||'approved')||b.done).reduce((s,b)=>s+(+b.total||0),0);
  return `<div class="kpis">
    <div class="kpi"><b>${state.cars.length}</b><span>רכבים באתר</span></div>
    <div class="kpi"><b>${bookings.length}</b><span>סה״כ השכרות</span></div>
    <div class="kpi"><b>${bookings.filter(b=>(b.status||'approved')==='pending').length}</b><span>ממתינות לאישור</span></div>
    <div class="kpi"><b>${money(revenue)}</b><span>מחזור מאושר</span></div>
  </div>`;
}
function adminBookingsTable(list=allBookingsSorted()){
  if(!list.length)return '<div class="adm-empty">אין עדיין השכרות באתר.</div>';
  return `<table class="tbl"><thead><tr><th>מספר</th><th>סטטוס</th><th>רכב</th><th>שוכר</th><th>משכיר</th><th>תאריך</th><th>סכום</th><th>פעולות</th></tr></thead><tbody>${list.map(b=>{
    const c=state.cars.find(x=>x.id===b.carId)||{make:'—',model:'',ownerId:b.ownerId};
    const o=userOf(b.ownerId)||state.owners.find(x=>x.id===b.ownerId)||{};
    return `<tr><td class="num">${esc(b.num)}</td><td>${bookingStatusHTML(b)}</td><td>${esc(c.make)} ${esc(c.model)}</td><td>${esc(b.signName||b.renterName||'')}</td><td>${esc(o.name||'')}</td><td>${fmt(b.from)} ${esc(b.tmFrom)} → ${fmt(b.to)} ${esc(b.tmTo)}</td><td class="num">${money(+b.total||0)}</td><td><button class="mini gold" onclick="openChatTo('b${b.id}')">צ׳אט</button> ${b.lic?`<button class="mini" onclick="viewLic('${b.id}')">רישיון</button>`:''} ${((b.status||'approved')==='pending')?`<button class="mini" onclick="adminSetBooking('${b.id}','approved')">אישור</button><button class="mini danger" onclick="adminSetBooking('${b.id}','rejected')">דחייה</button>`:''} ${((b.status||'approved')==='approved'&&!b.done)?`<button class="mini" onclick="adminSetBooking('${b.id}','done')">סיום</button>`:''} <button class="mini danger" onclick="adminDeleteBooking('${b.id}')">מחיקה</button></td></tr>`;
  }).join('')}</tbody></table>`;
}
function adminThreads(){
  const map=new Map();
  state.bookings.forEach(b=>{
    const c=state.cars.find(x=>x.id===b.carId)||{make:'רכב',model:''};
    map.set('b'+b.id,{tid:'b'+b.id,title:`${b.num} · ${b.signName||'שוכר'} · ${c.make} ${c.model}`,sub:bookingStatusHTML(b).replace(/<[^>]+>/g,'')});
  });
  state.msgs.forEach(m=>{
    if(!map.has(m.tid)){
      let title=m.tid;
      if((m.tid||'').startsWith('o-')){
        const parts=m.tid.split('-'), r=userOf(parts[1])||{}, o=userOf(parts[2])||{};
        title=`שיחה לפני הזמנה · ${r.name||'שוכר'} ↔ ${o.name||'בעל רכב'}`;
      } else if((m.tid||'').startsWith('sup-')) title='שירות לקוחות · מנהל המערכת';
      map.set(m.tid,{tid:m.tid,title,sub:'צ׳אט באתר'});
    }
  });
  return [...map.values()].sort((a,b)=>{
    const la=tMsgs(a.tid).at(-1)?.ts||0, lb=tMsgs(b.tid).at(-1)?.ts||0;
    return lb-la;
  });
}
function adminChatsHTML(){
  const rows=adminThreads();
  if(!rows.length)return '<div class="adm-empty">אין עדיין צ׳אטים באתר.</div>';
  return `<div class="admin-chat-list">${rows.map(t=>{const ms=tMsgs(t.tid),last=ms[ms.length-1];return `<div class="admin-chat-row" onclick="openChatTo('${t.tid}')"><div class="cp-ava usr">💬</div><div class="inf"><b>${esc(t.title)}</b><div class="sm">${last?esc(last.text):esc(t.sub)}</div></div><span class="sm">${last?new Date(last.ts).toLocaleString('he-IL'):''}</span></div>`}).join('')}</div>`;
}
function adminUsersHTML(){
  const owners=Object.entries(state.users).filter(([id,u])=>u.role==='owner').length || state.owners.length;
  const renters=Object.entries(state.users).filter(([id,u])=>u.role==='renter').length || state.renters.length;
  const ownersRows=state.cars.reduce((acc,c)=>{acc[c.ownerId]=(acc[c.ownerId]||0)+1;return acc;},{});
  return `<div class="kpis"><div class="kpi"><b>${owners}</b><span>משכירים</span></div><div class="kpi"><b>${renters}</b><span>שוכרים</span></div><div class="kpi"><b>${state.cars.length}</b><span>רכבים</span></div><div class="kpi"><b>${state.msgs.length}</b><span>הודעות</span></div></div>
  <div class="divider">רכבים לפי משכיר</div>
  ${Object.entries(ownersRows).length?`<table class="tbl"><thead><tr><th>משכיר</th><th>מס׳ רכבים</th><th>הזמנות</th></tr></thead><tbody>${Object.entries(ownersRows).map(([oid,n])=>{const o=userOf(oid)||{};return `<tr><td>${esc(o.name||oid)}</td><td class="num">${n}</td><td class="num">${state.bookings.filter(b=>b.ownerId===oid).length}</td></tr>`}).join('')}</tbody></table>`:'<div class="adm-empty">אין עדיין משכירים עם רכבים.</div>'}`;
}

function adminCarsHTML(){
  if(!state.cars.length)return '<div class="adm-empty">אין רכבים באתר.</div>';
  return `<table class="tbl"><thead><tr><th>רכב</th><th>משכיר</th><th>סוג השכרה</th><th>מחירים</th><th>סטטוס וזמינות</th><th>פעולות</th></tr></thead><tbody>${state.cars.map(c=>{const o=userOf(c.ownerId)||{};const s=statusInfo(c);return `<tr><td><b>${esc(c.make)} ${esc(c.model)} ${esc(c.yr||'')}</b><div class="sm">${esc(c.color||'')} · ${esc(c.cat||'')} · ${esc(c.seats||'')} מושבים</div></td><td>${esc(o.name||c.ownerId||'')}</td><td>${rentalTypesOf(c).map(rentalLabel).join(' / ')||'—'}</td><td class="num">${rateSummary(c)||money(primaryRate(c))}</td><td><span class="pill ${s.cls}" style="font-size:.62rem;padding:1px 8px">${s.txt}</span><div class="sm">${esc(c.ret||'זמין עכשיו / לא הוגדר')}</div></td><td><button class="mini" onclick="adminToggleCar('${c.id}')">${c.status==='available'?'סימון כמושכר':'סימון כזמין'}</button><button class="mini danger" onclick="adminDeleteCar('${c.id}')">מחיקת רכב</button></td></tr>`}).join('')}</tbody></table>`;
}
function adminFullUsersHTML(){
  const users=Object.entries(state.users||{}).map(([id,u])=>({id,...u}));
  const fallback=[...(state.owners||[]).map(u=>({...u,role:'owner'})),...(state.renters||[]).map(u=>({...u,role:'renter'}))];
  const list=users.length?users:fallback;
  if(!list.length)return '<div class="adm-empty">אין משתמשים רשומים עדיין.</div>';
  return `<table class="tbl"><thead><tr><th>שם</th><th>תפקיד</th><th>מייל</th><th>טלפון</th><th>רכבים</th><th>הזמנות</th><th>צ׳אט</th></tr></thead><tbody>${list.map(u=>`<tr><td><b>${esc(u.name||'')}</b><div class="sm">ID: ${esc(u.id||'')}</div></td><td>${u.role==='owner'?'בעל רכב':u.role==='admin'?'מנהל':'שוכר'}</td><td>${esc(u.email||'')}</td><td>${esc(u.phone||'')}</td><td class="num">${state.cars.filter(c=>c.ownerId===u.id).length}</td><td class="num">${state.bookings.filter(b=>b.ownerId===u.id||b.renterId===u.id).length}</td><td>${u.role==='owner'?`<button class="mini gold" onclick="openChatTo('o-admin-${u.id}')">צ׳אט</button>`:''}</td></tr>`).join('')}</tbody></table>`;
}
function adminDataHTML(){
  const safe={cars:state.cars,bookings:state.bookings,messages:state.msgs,owners:state.owners,renters:state.renters,users:state.users};
  return `<div class="note">כאן יש למנהל גישה מלאה לנתוני האתר כפי שהם נטענו בדפדפן/מסד הנתונים. אפשר להעתיק את המידע לגיבוי.</div><div class="m-actions"><button class="btn btn-gold grow" onclick="adminExportData()">הורדת גיבוי JSON</button><button class="btn btn-out grow" onclick="renderAdminDashboard()">רענון תצוגה</button></div><textarea readonly style="width:100%;min-height:360px;margin-top:14px;border:1px solid var(--line);border-radius:14px;padding:14px;direction:ltr;text-align:left;font-family:monospace;font-size:.76rem">${esc(JSON.stringify(safe,null,2))}</textarea>`;
}
function adminSetBooking(id,status){
  const b=state.bookings.find(x=>x.id===id); if(!b)return;
  const labels={approved:'לאשר',rejected:'לדחות',done:'לסיים'};
  if(!confirm(`${labels[status]||'לעדכן'} את ההזמנה ${b.num}?`))return;
  if(CLOUD){
    const upd=status==='done'?{status:'done',done:true,doneAt:Date.now()}:{status,[status+'At']:Date.now()};
    db.collection('bookings').doc(id).update(upd).then(()=>{
      if(status==='approved')return db.collection('cars').doc(b.carId).update({status:'rented',ret:'זמין שוב: '+fmt(b.to)+' בשעה '+b.tmTo});
      if(status==='done')return db.collection('cars').doc(b.carId).update({status:'available',ret:''});
    }).then(()=>showToast('ההזמנה עודכנה')).catch(cloudErr);return;
  }
  b.status=status; if(status==='done'){b.done=true;b.doneAt=Date.now()} else b[status+'At']=Date.now();
  const c=state.cars.find(x=>x.id===b.carId); if(c&&status==='approved'){c.status='rented';c.ret='זמין שוב: '+fmt(b.to)+' בשעה '+b.tmTo} if(c&&status==='done'){c.status='available';c.ret=''}
  render();renderAdminDashboard();showToast('ההזמנה עודכנה');
}
function adminDeleteBooking(id){
  const b=state.bookings.find(x=>x.id===id); if(!b)return;
  if(!confirm('למחוק לגמרי את ההזמנה '+b.num+'?'))return;
  if(CLOUD){db.collection('bookings').doc(id).delete().then(()=>showToast('ההזמנה נמחקה')).catch(cloudErr);return;}
  state.bookings=state.bookings.filter(x=>x.id!==id);render();renderAdminDashboard();showToast('ההזמנה נמחקה');
}
function adminToggleCar(id){toggleStatus(id);setTimeout(renderAdminDashboard,50)}
function adminDeleteCar(id){deleteCar(id);setTimeout(renderAdminDashboard,50)}
function adminExportData(){
  const blob=new Blob([JSON.stringify({cars:state.cars,bookings:state.bookings,messages:state.msgs,owners:state.owners,renters:state.renters,users:state.users},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='crowndrive-admin-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(a.href);
}

function adminOverviewHTML(){
  const lastBookings=allBookingsSorted().slice(0,12);
  const lastChats=adminThreads().slice(0,10);
  return adminKPIs()+`
    <div class="admin-actions-bar">
      <div><b>מרכז ניהול חי</b><br><span>מעקב וניהול מלא של הזמנות, רכבים, משתמשים וצ׳אטים במקום אחד.</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-gold" onclick="setAdminTab('bookings')">ניהול השכרות</button>
        <button class="btn btn-out" onclick="setAdminTab('chats')">פתיחת כל הצ׳אטים</button>
        <button class="btn btn-out" onclick="adminExportData()">ייצוא גיבוי</button>
      </div>
    </div>
    <div class="admin-section-grid">
      <div class="admin-mini-card"><b>${state.bookings.filter(b=>(b.status||'approved')==='approved').length}</b><span>הזמנות מאושרות שצריך לעקוב אחריהן</span></div>
      <div class="admin-mini-card"><b>${state.msgs.length}</b><span>הודעות בצ׳אטים באתר</span></div>
      <div class="admin-mini-card"><b>${Object.keys(state.users||{}).length}</b><span>משתמשים רשומים במערכת</span></div>
      <div class="admin-mini-card"><b>${state.cars.filter(c=>c.status==='available').length}</b><span>רכבים זמינים כרגע</span></div>
    </div>
    <div class="admin-overview-grid">
      <div class="admin-panel"><h4>השכרות אחרונות</h4>${adminBookingsTable(lastBookings)}</div>
      <div class="admin-panel"><h4>צ׳אטים אחרונים</h4>${lastChats.length?adminChatsHTML():'<div class="adm-empty">אין עדיין צ׳אטים.</div>'}</div>
    </div>`;
}

function renderAdminDashboard(){
  const box=$('admin-body'); if(!box)return;
  const mobileNote='<div class="admin-mobile-note">בפלאפון: אפשר להחליק טבלאות לצדדים, וכל הכפתורים עובדים גם במסך קטן.</div>';
  if(adminTab==='all')box.innerHTML=mobileNote+adminOverviewHTML();
  if(adminTab==='bookings')box.innerHTML=mobileNote+adminKPIs()+`<div class="admin-panel"><h4>כל ההשכרות באתר</h4>${adminBookingsTable()}</div>`;
  if(adminTab==='chats')box.innerHTML=mobileNote+adminKPIs()+`<div class="admin-panel"><h4>כל הצ׳אטים באתר — כולל שירות לקוחות מול מנהל המערכת</h4>${adminChatsHTML()}</div>`;
  if(adminTab==='cars')box.innerHTML=mobileNote+adminKPIs()+`<div class="admin-panel"><h4>ניהול כל הרכבים באתר</h4>${adminCarsHTML()}</div>`;
  if(adminTab==='users')box.innerHTML=mobileNote+adminKPIs()+`<div class="admin-panel"><h4>כל המשתמשים במערכת</h4>${adminFullUsersHTML()}</div>`;
  if(adminTab==='data')box.innerHTML=mobileNote+adminKPIs()+`<div class="admin-panel"><h4>גישה מלאה וייצוא מידע</h4>${adminDataHTML()}</div>`;
}

/* ================= RENTER AREA ================= */
function bookingStatusHTML(b){
  const st=b.status||(b.done?'done':'approved');
  const labels={pending:'ממתינה לאישור בעל הרכב',approved:'מאושרת',rejected:'נדחתה',done:'הסתיימה'};
  let extra='';
  if(st==='approved') extra=b.paymentProof?' · צילום תשלום נשלח':' · ממתין לצילום העברת תשלום';
  return `<span class="badge-status ${st}">${labels[st]||labels.approved}${extra}</span>`;
}
function openRenterArea(){
  if(!state.session||state.session.role!=='renter')return openAuth('renter');
  const u=me();
  const prefs=u.prefs||{};
  const list=state.bookings.filter(b=>b.renterId===u.id).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const pending=list.filter(b=>(b.status||'approved')==='pending').length;
  const approved=list.filter(b=>(b.status||'approved')==='approved').length;
  const totalSpent=list.filter(b=>(b.status||'approved')!=='rejected').reduce((sum,b)=>sum+(+b.total||0),0);
  const initials=(u.name||'שוכר').trim().split(/\s+/).map(x=>x[0]).join('').slice(0,2);
  const renterBody=$('renter-body'); if(!renterBody){showToast('האזור האישי לא נטען — חסר רכיב במסך');return;}
  renterBody.innerHTML=`
    <div class="personal-hero">
      <div>
        <h4>שלום ${esc((u.name||'').split(' ')[0]||'שוכר')} 👋</h4>
        <p>כאן מנהלים הזמנות, תשלום, צ׳אט עם בעל הרכב והעדפות — בלי לחפש בכל האתר.</p>
      </div>
      <div class="personal-avatar">${esc(initials)}</div>
    </div>
    <div class="storage-note">מצב השמירה תוקן: האתר שומר בדפדפן בצורה יציבה ולא נתקע בגלל Netlify Blobs או שגיאת שרת.</div>
    <div class="kpis">
      <div class="kpi"><b>${list.length}</b><span>סה״כ הזמנות</span></div>
      <div class="kpi"><b>${pending}</b><span>ממתינות לאישור</span></div>
      <div class="kpi"><b>${approved}</b><span>מאושרות עכשיו</span></div>
      <div class="kpi"><b>${money(totalSpent)}</b><span>סכום הזמנות</span></div>
    </div>
    <div class="quick-actions">
      <div class="qa-card"><b>להזמין רכב</b><span>חזרה מהירה לצי הרכבים</span><button class="mini gold" onclick="closeOv('ov-renter');document.getElementById('fleet').scrollIntoView({behavior:'smooth'})">פתח רכבים</button></div>
      <div class="qa-card"><b>הפרטים שלי</b><span>שם, טלפון, מייל ורישיון</span><button class="mini gold" onclick="openAccount()">עריכת פרטים</button></div>
      <div class="qa-card"><b>צ׳אט שירות</b><span>שאלה למנהל המערכת</span><button class="mini gold" onclick="openSupportChat()">פתח צ׳אט</button></div>
    </div>
    <div class="personal-grid">
      <div class="personal-panel">
        <h4>הפרופיל שלי</h4>
        <div class="profile-lines">
          <div class="profile-line"><span>שם</span><b>${esc(u.name||'—')}</b></div>
          <div class="profile-line"><span>אימייל</span><b>${esc(u.email||'—')}</b></div>
          <div class="profile-line"><span>טלפון</span><b>${esc(u.phone||'—')}</b></div>
          <div class="profile-line"><span>רישיון</span><b style="color:var(--ok)">✓ שמור במערכת</b></div>
        </div>
        <div class="divider">העדפות</div>
        <div class="prefs-row">
          <div class="field" style="margin-bottom:0"><label>שפת תקשורת</label><input id="rp-lang" value="${esc(prefs.lang||'עברית / English')}"></div>
          <button class="btn btn-gold" onclick="saveRenterPrefs()">שמירה</button>
        </div>
      </div>
      <div class="personal-panel">
        <h4>ההזמנות שלי</h4>
        ${list.length===0?'<div class="adm-empty">עדיין אין הזמנות. לחץ על “פתח רכבים” כדי להתחיל.</div>':`<div class="booking-cards">
          ${list.map(b=>{const c=state.cars.find(x=>x.id===b.carId)||{make:'—',model:'',photos:[]}; const mine=myRating(b.id,'renter'); return `
            <div class="booking-card">
              <div class="booking-top">
                <div><div class="booking-title">${esc(c.make)} ${esc(c.model)}</div><div class="booking-meta">${esc(b.num||'')} · ${fmt(b.from)} ${esc(b.tmFrom||'')} עד ${fmt(b.to)} ${esc(b.tmTo||'')}</div></div>
                ${bookingStatusHTML(b)}
              </div>
              <div class="booking-bottom">
                <div class="booking-money">${money(b.total)}</div>
                <div class="mini-row">
                  <button class="mini gold" onclick="openChatTo('b${b.id}')">💬 צ׳אט</button>
                  ${((b.status||'approved')==='approved'&&!b.paymentProof)?`<label class="mini gold">העלאת תשלום<input type="file" accept="image/*" style="display:none" onchange="uploadPaymentProof('${b.id}',this)"></label>`:''}
                </div>
              </div>
              ${b.paymentProof?'<div style="color:var(--ok);font-size:.78rem;margin-top:8px;font-weight:700">✓ צילום תשלום נשלח</div>':''}
              <div style="margin-top:10px">${mine?`<span class="rate-label">דירגת:</span>${starsHTML(mine.stars,null)}${mine.text?`<div class="my-review">&quot;${esc(mine.text)}&quot;</div>`:`<div class="rv-box"><input id="rv-${b.id}" placeholder="כתוב ביקורת קצרה" maxlength="220"><button class="mini gold" onclick="setReview('${b.id}')">פרסום</button></div>`}`:`<span class="rate-label">דירוג אחרי ההשכרה:</span>${ratePicker(b.id)}`}</div>
            </div>`;}).join('')}
        </div>`}
      </div>
    </div>`;
  openOv('ov-renter');
}
function saveRenterPrefs(){
  const prefs={lang:$('rp-lang').value.trim()};
  savePrefs(prefs,'העדפות השוכר נשמרו');
}

function paymentProofCell(b){
  const st=b.status||(b.done?'done':'approved');
  if(st!=='approved')return '<span class="sm">יהיה זמין אחרי אישור בעל הרכב</span>';
  if(b.paymentProof)return `<span style="color:var(--ok);font-weight:600">✓ נשלח</span><img class="proof-thumb" src="${b.paymentProof}" alt="צילום העברת תשלום">`;
  return `<div class="pay-proof-box">אחרי אישור ההשכרה חובה לשלוח לבעל הרכב צילום מסך של העברת הכסף.<br><label class="mini gold proof-upload">העלאת צילום<input type="file" accept="image/*" style="display:none" onchange="uploadPaymentProof('${b.id}',this)"></label></div>`;
}
function uploadPaymentProof(bid,input){
  const f=input.files&&input.files[0]; if(!f)return;
  if(!f.type.startsWith('image/')){showToast('נא להעלות תמונה בלבד');input.value='';return}
  const r=new FileReader();
  r.onload=()=>{
    const data=r.result;
    const b=state.bookings.find(x=>x.id===bid); if(!b)return;
    b.paymentProof=data; b.paymentProofAt=Date.now();
    const txt='השוכר שלח צילום מסך של העברת תשלום עבור הזמנה '+b.num+'.';
    if(CLOUD){
      db.collection('bookings').doc(bid).update({paymentProof:data,paymentProofAt:b.paymentProofAt}).catch(cloudErr);
    }
    pushMsg('b'+bid,state.session?state.session.role:'renter',state.session?state.session.id:b.renterId,txt,[b.renterId,b.ownerId],{image:data,kind:'paymentProof'});
    openRenterArea();
    showToast('צילום התשלום נשלח בצ׳אט לבעל הרכב');
  };
  r.readAsDataURL(f);
}

function applyPrefsToSearch(){
  const p=(me()&&me().prefs)||{};
  closeOv('ov-renter');scrollToFleet();
  if($('q-make'))$('q-make').value=p.make||'';
  if($('q-color'))$('q-color').value=p.color||'';
  if($('q-maxprice'))$('q-maxprice').value=p.budget||'';
  if($('q-seats'))$('q-seats').value=p.seats||'';
  updateSearch();
}


/* ================= BOOKING ================= */
let pendingBookCar=null;
function tryBook(id){
  if(!state.session||state.session.role!=='renter'){
    pendingBookCar=id;
    showToast('להזמנה יש להתחבר כשוכר');
    openAuth('renter');
    return;
  }
  openBook(id);
}
function openBook(id){
  currentCar=state.cars.find(c=>c.id===id);
  const u=me();
  $('m-car').innerHTML=`<img src="${currentCar.photos[0]}" alt="">
    <div><b>${esc(currentCar.make)} ${esc(currentCar.model)} ${currentCar.yr}</b>
    <div class="p">${esc(currentCar.cat)} · ${rateSummary(currentCar)||money(primaryRate(currentCar))}</div></div>`;
  $('book-rental-type').innerHTML=rentalTypesOf(currentCar).map(t=>`<option value="${t}">${rentalLabel(t)} — ${money(rateOf(currentCar,t)||primaryRate(currentCar))} ${rateUnitLabel(t)}</option>`).join('');
  const today=new Date().toISOString().split('T')[0];
  $('dt-from').min=today;$('dt-to').min=today;
  $('dt-from').value='';$('dt-to').value='';
  $('price-live').style.display='none';
  $('agree').checked=false;$('agree-err').style.display='none';
  $('sign-name').value=u.name;
  $('sign-date').value=today;
  clearSig();
  goStep(1,true);
  openOv('ov-book');
}
function hoursTotal(){
  const f=$('dt-from').value,t=$('dt-to').value;
  if(!f||!t)return 0;
  const a=new Date(f+'T'+$('tm-from').value), b=new Date(t+'T'+$('tm-to').value);
  return Math.max(0,Math.round((b-a)/3600000));
}
function daysTotal(){return Math.max(1,Math.ceil(hoursTotal()/24))}
['dt-from','dt-to','tm-from','tm-to'].forEach(id=>$(id).addEventListener('change',updatePriceLive));
function updatePriceLive(){
  const h=hoursTotal(),box=$('price-live');
  if(h>0&&currentCar){
    const units=bookingUnits(), rate=bookingRate(), type=selectedBookingRentalType();
    box.style.display='block';
    box.innerHTML=`<div class="row"><span>משך ההשכרה</span><span>${h} שעות (${daysTotal()} ימים)</span></div>
      <div class="row"><span>סוג השכרה</span><span>${rentalLabel(type)}</span></div>
      <div class="row"><span>${units} ${bookingUnitName()} × ${money(rate)}</span><span>${money(units*rate)}</span></div>
      <div class="row"><span>סה"כ משוער</span><span>${money(units*rate)}</span></div>`;
  } else box.style.display='none';
}
function mark(id,bad){$(id).classList.toggle('err',bad)}
function goStep(n,silent){
  if(!silent){
    if(n===2){
      const f=$('dt-from').value,t=$('dt-to').value;
      mark('f-from',!f);mark('f-to',!t||hoursTotal()<1);
      if(!f||!t||hoursTotal()<1)return;
    }
    if(n===3){
      let bad=false;
      if(!$('agree').checked){$('agree-err').style.display='block';bad=true}else $('agree-err').style.display='none';
      const nm=$('sign-name').value.trim();
      mark('f-signname',nm.length<2);if(nm.length<2)bad=true;
      mark('f-signdate',!$('sign-date').value);if(!$('sign-date').value)bad=true;
      if(!sigDrawn){$('sig-err').style.display='block';bad=true}else $('sig-err').style.display='none';
      if(bad)return;
      buildSummary();
    }
  }
  [1,2,3,4].forEach(i=>{
    const st=$('step'+i);
    st.style.display=i===n?'block':'none';
    if(i===n&&!reduced){st.classList.remove('step-anim');void st.offsetWidth;st.classList.add('step-anim')}
    $('sb'+i).classList.toggle('on',i<=n);
  });
  document.querySelector('#ov-book .modal').scrollTop=0;
}
function buildSummary(){
  const u=me(),h=hoursTotal(),d=daysTotal();
  $('final-sum').innerHTML=`
    <div class="row"><span>רכב</span><span>${esc(currentCar.make)} ${esc(currentCar.model)} ${currentCar.yr}</span></div>
    <div class="row"><span>איסוף</span><span>${fmt($('dt-from').value)} · ${$('tm-from').value}</span></div>
    <div class="row"><span>החזרה</span><span>${fmt($('dt-to').value)} · ${$('tm-to').value}</span></div>
    <div class="row"><span>משך</span><span>${h} שעות (${d} ימים)</span></div>
    <div class="row"><span>סוג השכרה</span><span>${rentalLabel(selectedBookingRentalType())} · ${money(bookingRate())} ${rateUnitLabel(selectedBookingRentalType())}</span></div>
    <div class="row"><span>שוכר</span><span>${esc($('sign-name').value)}</span></div>
    <div class="row"><span>הסכם השכרה</span><span style="color:var(--ok)">✓ נחתם ב-${fmt($('sign-date').value)}</span></div>
    <div class="row"><span>סה"כ לתשלום</span><span>${money(bookingUnits()*bookingRate())}</span></div>`;
}
function fmt(d){return new Date(d+'T00:00').toLocaleDateString('he-IL',{day:'numeric',month:'long',year:'numeric'})}

/* signature pad */
let sigDrawn=false,sigCtx=null;
function initSig(){
  const c=$('sig-pad');
  const resize=()=>{
    const w=c.clientWidth;
    if(!w)return;
    const data=sigDrawn?c.toDataURL():null;
    c.width=w*2;c.height=300;
    sigCtx=c.getContext('2d');
    sigCtx.scale(2,2);
    sigCtx.strokeStyle='#1B2A4A';sigCtx.lineWidth=2.2;sigCtx.lineCap='round';sigCtx.lineJoin='round';
    if(data){const img=new Image();img.onload=()=>sigCtx.drawImage(img,0,0,w,150);img.src=data}
  };
  new ResizeObserver(resize).observe(c);
  let drawing=false,last=null;
  const pos=e=>{const r=c.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
  c.addEventListener('pointerdown',e=>{drawing=true;last=pos(e);c.setPointerCapture(e.pointerId)});
  c.addEventListener('pointermove',e=>{
    if(!drawing)return;
    const p=pos(e);
    sigCtx.beginPath();sigCtx.moveTo(last.x,last.y);sigCtx.lineTo(p.x,p.y);sigCtx.stroke();
    last=p;
    if(!sigDrawn){sigDrawn=true;$('sig-hint').style.display='none';$('sig-err').style.display='none'}
  });
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>c.addEventListener(ev,()=>drawing=false));
}
function clearSig(){
  const c=$('sig-pad');
  if(sigCtx)sigCtx.clearRect(0,0,c.width,c.height);
  sigDrawn=false;$('sig-hint').style.display='grid';
}

function bumpCarActivity(carId){
  if(!carId)return Promise.resolve();
  const ts=Date.now();
  const c=state.cars.find(x=>x.id===carId); if(c)c.updatedAt=ts;
  if(CLOUD)return db.collection('cars').doc(carId).update({updatedAt:ts}).catch(()=>{});
  return Promise.resolve();
}
/* confirm + receipt */
function confirmBooking(){
  const u=me(),h=hoursTotal(),d=daysTotal(),rentType=selectedBookingRentalType(),rate=bookingRate(),units=bookingUnits(),total=units*rate;
  const num='CD-'+Math.floor(100000+Math.random()*900000);
  const b={id:newId('bk'),num,status:'pending',carId:currentCar.id,ownerId:currentCar.ownerId,renterId:u.id,
    lic:u.lic||null,renterName:u.name,
    from:$('dt-from').value,tmFrom:$('tm-from').value,to:$('dt-to').value,tmTo:$('tm-to').value,
    hours:h,days:d,rentalType:rentType,rate,units,total,
    signName:$('sign-name').value.trim(),signDate:$('sign-date').value,sig:$('sig-pad').toDataURL(),
    createdAt:Date.now()};
  const msg='בקשת הזמנה '+num+' נשלחה לבעל הרכב וממתינה לאישור. אפשר להמשיך להתכתב כאן עד לאישור.';
  if(CLOUD){
    const ref=db.collection('bookings').doc();
    b.id=ref.id;
    ref.set(b)
      .then(()=>bumpCarActivity(b.carId))
      .then(()=>pushMsg('b'+b.id,'system',0,msg,[b.renterId,b.ownerId]))
      .catch(cloudErr);
  } else {
    state.bookings.push(b);
    pushMsg('b'+b.id,'system',0,msg);
  }
  lastBooking=b;
  render();
  $('conf-num').textContent=num;
  $('done-txt').textContent=`${currentCar.make} ${currentCar.model} ממתין לאישור בעל הרכב. איסוף מבוקש ב-${fmt(b.from)} בשעה ${b.tmFrom}.`;
  $('receipt').innerHTML=receiptHTML(b);
  goStep(4,true);
  showToast('בקשת ההזמנה נשלחה לבעל הרכב');
}
function approveBooking(bid){
  const b=state.bookings.find(x=>x.id===bid);
  if(!b||!state.session||!((state.session.role==='owner'&&b.ownerId===state.session.id)||state.session.role==='admin'))return;
  const c=state.cars.find(x=>x.id===b.carId);
  if(!confirm('לאשר את ההזמנה '+b.num+'? הרכב יסומן כמושכר.'))return;
  if(CLOUD){
    b.status='approved'; b.approvedAt=Date.now();
    if(c){c.status='rented'; c.ret='זמין שוב: '+fmt(b.to)+' בשעה '+b.tmTo; c.updatedAt=Date.now();}
    render();
    if($('ov-owner').classList.contains('open')) renderOwnerBookings();
    if($('ov-admin')&&$('ov-admin').classList.contains('open')) renderAdminDashboard();
    showToast('ההזמנה אושרה');
    db.collection('bookings').doc(bid).update({status:'approved',approvedAt:b.approvedAt})
      .then(()=>db.collection('cars').doc(b.carId).update({status:'rented',ret:'זמין שוב: '+fmt(b.to)+' בשעה '+b.tmTo,updatedAt:Date.now()}))
      .then(()=>pushMsg('b'+b.id,'system',0,'בעל הרכב אישר את ההזמנה '+b.num+'. עכשיו השוכר צריך לשלוח בצ׳אט צילום מסך של העברת הכסף לבעל הרכב.',[b.renterId,b.ownerId]))
      .catch(cloudErr);return;
  }
  b.status='approved';b.approvedAt=Date.now();
  if(c){c.status='rented';c.ret='זמין שוב: '+fmt(b.to)+' בשעה '+b.tmTo;}
  pushMsg('b'+b.id,'system',0,'בעל הרכב אישר את ההזמנה '+b.num+'. עכשיו השוכר צריך לשלוח בצ׳אט צילום מסך של העברת הכסף לבעל הרכב.');
  render();renderOwnerBookings();showToast('ההזמנה אושרה');
}
function rejectBooking(bid){
  const b=state.bookings.find(x=>x.id===bid);
  if(!b||!state.session||!((state.session.role==='owner'&&b.ownerId===state.session.id)||state.session.role==='admin'))return;
  if(!confirm('לדחות את בקשת ההזמנה '+b.num+'?'))return;
  if(CLOUD){
    b.status='rejected'; b.rejectedAt=Date.now();
    render();
    if($('ov-owner').classList.contains('open')) renderOwnerBookings();
    if($('ov-admin')&&$('ov-admin').classList.contains('open')) renderAdminDashboard();
    showToast('הבקשה נדחתה');
    db.collection('bookings').doc(bid).update({status:'rejected',rejectedAt:b.rejectedAt})
      .then(()=>pushMsg('b'+b.id,'system',0,'בעל הרכב דחה את בקשת ההזמנה '+b.num+'. אפשר להתכתב בצ׳אט או לבחור רכב אחר.',[b.renterId,b.ownerId]))
      .catch(cloudErr);return;
  }
  b.status='rejected';b.rejectedAt=Date.now();
  pushMsg('b'+b.id,'system',0,'בעל הרכב דחה את בקשת ההזמנה '+b.num+'. אפשר להתכתב בצ׳אט או לבחור רכב אחר.');
  render();renderOwnerBookings();showToast('הבקשה נדחתה');
}

function receiptHTML(b){
  const c=state.cars.find(x=>x.id===b.carId)||{make:'',model:'',yr:'',color:'',fuel:'',price:0};
  const u=me()||{email:''};
  return `
    <div class="r-head">
      <div><h4>CROWN DRIVE</h4><div class="sm">השכרת רכבים · קראון הייטס, ברוקלין NY<br>שירות לקוחות: בצ'אט שבאתר</div></div>
      <div style="text-align:left"><div class="sm">קבלה / אישור הזמנה</div><b style="font-size:1.05rem">${b.num}</b><div class="sm">${new Date(b.createdAt).toLocaleDateString('he-IL')} · ${new Date(b.createdAt).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}</div></div>
    </div>
    <div class="r-row"><span>לקוח</span><span>${esc(b.signName)} · ${esc(u.email)}</span></div>
    <div class="r-row"><span>רכב</span><span>${esc(c.make)} ${esc(c.model)} ${c.yr} · ${esc(c.color)} · הנעה: ${esc(c.fuel)}</span></div>
    <div class="r-row"><span>איסוף</span><span>${fmt(b.from)} · ${b.tmFrom}</span></div>
    <div class="r-row"><span>החזרה</span><span>${fmt(b.to)} · ${b.tmTo}</span></div>
    <div class="r-row"><span>משך ההשכרה</span><span>${b.hours} שעות</span></div>
    <div class="r-row"><span>סוג השכרה</span><span>${rentalLabel(b.rentalType||primaryRentalType(c))}</span></div>
    <div class="r-row"><span>תעריף</span><span>${money(b.rate||bookingRate())} ${rateUnitLabel(b.rentalType||primaryRentalType(c))}</span></div>
    <div class="r-row"><span>תשלום</span><span>מוסדר מול בעל הרכב באיסוף</span></div>
    <div class="r-row"><span>הסכם השכרה</span><span>נחתם דיגיטלית · ${fmt(b.signDate)}</span></div>
    <div class="r-row total"><span>סה"כ לתשלום</span><span>${money(b.total)}</span></div>
    <div style="margin-top:14px;display:flex;justify-content:space-between;align-items:end">
      <div class="sm" style="font-size:.72rem;color:#7A7264">חתימת השוכר:</div>
      <img src="${b.sig}" alt="חתימה" style="height:44px">
    </div>
    <div class="r-foot">תודה שבחרתם ב-Crown Drive · התשלום מתבצע בנקודת האיסוף · מסמך זה מהווה אישור הזמנה</div>`;
}
function downloadReceipt(){
  if(!lastBooking)return;
  const st='<sty'+'le>body{font-family:Arial,sans-serif;background:#EFF2F6;padding:30px;display:flex;justify-content:center}'
    +'.receipt{background:#FBF8F2;color:#242018;padding:34px;max-width:560px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.12)}'
    +'.r-head{display:flex;justify-content:space-between;border-bottom:2px solid #242018;padding-bottom:14px;margin-bottom:14px}'
    +'.r-head h4{margin:0;font-size:1.3rem}.sm{font-size:.72rem;color:#7A7264}'
    +'.r-row{display:flex;justify-content:space-between;padding:6px 0;font-size:.85rem;border-bottom:1px dotted #D8D1C2}'
    +'.r-row.total{border-bottom:none;border-top:2px solid #242018;margin-top:8px;padding-top:10px;font-weight:700;font-size:1rem}'
    +'.r-foot{font-size:.7rem;color:#7A7264;margin-top:16px;text-align:center;border-top:1px solid #D8D1C2;padding-top:10px}'
    +'</sty'+'le>';
  const html='<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"><title>קבלה '+lastBooking.num+'</title>'+st
    +'</he'+'ad><body><div class="receipt">'+$('receipt').innerHTML+'</div></bo'+'dy></ht'+'ml>';
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([html],{type:'text/html'}));
  a.download='קבלה-'+lastBooking.num+'.html';
  a.click();
  URL.revokeObjectURL(a.href);
}
function emailReceipt(){
  if(!lastBooking)return;
  const b=lastBooking,c=state.cars.find(x=>x.id===b.carId)||{make:'',model:'',yr:''},u=me()||{email:''};
  const body=[
    'Crown Drive — אישור הזמנה וקבלה','',
    'מספר הזמנה: '+b.num,
    'רכב: '+c.make+' '+c.model+' '+c.yr,
    'איסוף: '+fmt(b.from)+' בשעה '+b.tmFrom,
    'החזרה: '+fmt(b.to)+' בשעה '+b.tmTo,
    'משך: '+b.hours+' שעות',
    'סה"כ לתשלום: '+money(b.total),
    'הסכם השכרה נחתם דיגיטלית בתאריך '+fmt(b.signDate),'',
    'תודה שבחרתם ב-Crown Drive · (718) 555-0123'
  ].join('\n');
  location.href='mailto:'+encodeURIComponent(u.email)+'?subject='+encodeURIComponent('קבלה ואישור הזמנה '+b.num+' — Crown Drive')+'&body='+encodeURIComponent(body);
}

/* ================= HELPERS ================= */
function openOv(id){const el=$(id); if(!el){console.warn('Missing overlay',id);return;} el.classList.add('open');document.body.style.overflow='hidden'}
function closeOv(id){const el=$(id); if(!el)return; el.classList.remove('open');document.body.style.overflow=''; if(id==='ov-auth') closeHiddenAdminMode()}
['ov-auth','ov-owner','ov-admin','ov-renter','ov-book','ov-lic','ov-profile','ov-account'].forEach(id=>{const el=$(id); if(el) el.addEventListener('click',e=>{if(e.target.id===id)closeOv(id)});});
document.addEventListener('keydown',e=>{if(e.key==='Escape')['ov-auth','ov-owner','ov-admin','ov-renter','ov-book','ov-lic','ov-profile','ov-account'].forEach(closeOv)});
function bindDrop(dropId,fileId,single,multi){
  const d=$(dropId),f=$(fileId);
  if(!d||!f){console.warn('Missing upload control',dropId,fileId);return;}
  d.addEventListener('click',()=>f.click());
  d.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();f.click()}});
  ['dragover','dragenter'].forEach(ev=>d.addEventListener(ev,e=>{e.preventDefault();d.classList.add('drag')}));
  ['dragleave','drop'].forEach(ev=>d.addEventListener(ev,e=>{e.preventDefault();d.classList.remove('drag')}));
  d.addEventListener('drop',e=>{
    if(multi)multi(e.dataTransfer.files);
    else if(e.dataTransfer.files[0])single(e.dataTransfer.files[0]);
  });
  f.addEventListener('change',()=>{
    if(multi){multi(f.files);f.value=''}
    else if(f.files[0])single(f.files[0]);
  });
}
function readImg(f,cb){
  if(!f.type.startsWith('image/'))return showToast('יש להעלות קובץ תמונה בלבד');
  if(f.size>10*1024*1024)return showToast('הקובץ גדול מדי (מקסימום 10MB)');
  const r=new FileReader();
  r.onload=()=>{
    const img=new Image();
    img.onload=()=>{
      try{
        const max=1280;
        let w=img.width,h=img.height;
        if(w>max||h>max){const ratio=Math.min(max/w,max/h);w=Math.round(w*ratio);h=Math.round(h*ratio)}
        const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
        const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,w,h);
        cb(canvas.toDataURL('image/jpeg',0.78));
      }catch(e){cb(r.result)}
    };
    img.onerror=()=>cb(r.result);
    img.src=r.result;
  };
  r.readAsDataURL(f);
}
function viewLic(bid){
  const b=state.bookings.find(x=>x.id===bid);
  if(!b||!b.lic)return;
  if(!state.session||!((state.session.role==='owner'&&b.ownerId===state.session.id)||state.session.role==='admin'))return;
  $('lic-full').src=b.lic;
  openOv('ov-lic');
}
function showToast(msg){
  const t=$('toast'); if(!t){console.warn(msg);return;}
  t.textContent=msg;t.classList.add('show');
  clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),2800);
}


/* ================= CHAT ================= */
state.msgs = [];          // {tid, role:'renter'|'owner'|'admin'|'system', uid, text, image, kind, ts}
state.reads = {};         // key `${role}-${uid}-${tid}` -> ts
let activeTid = null;

function meKey(){return state.session ? state.session.role+'-'+state.session.id : 'guest-0'}
function supTid(){return 'sup-'+meKey()}
function ownerThread(oid){return state.session?'o-'+state.session.id+'-'+oid:null}
function openSupportChat(){
  openChatTo(supTid());
}
function startOwnerChat(oid,e){
  if(e)e.stopPropagation();
  if(!state.session||state.session.role!=='renter'){pendingBookCar=null;showToast('כדי לשוחח עם בעל הרכב יש להתחבר כשוכר');openAuth('renter');return}
  if(oid===state.session.id){showToast('זה הרכב שלך');return}
  openChatTo(ownerThread(oid));
}

function myThreads(){
  if(state.session&&state.session.role==='admin')return adminThreads().map(x=>({tid:x.tid,kind:'usr',title:x.title,sub:x.sub,ava:'מ'}));
  const t=[{tid:supTid(),kind:'sup',title:"מנהל המערכת · שירות לקוחות",sub:"ההודעה מגיעה ישירות למנהל האתר"}];
  if(state.session){
    const {role,id}=state.session;
    const seen=new Set();
    state.msgs.filter(m=>(m.tid||'').startsWith('o-') && (m.participants||[]).includes(id)).forEach(m=>{
      if(seen.has(m.tid))return; seen.add(m.tid);
      const parts=m.tid.split('-'); const rid=parts[1], oid=parts[2];
      const otherId=role==='renter'?oid:rid;
      const other=userOf(otherId)||{};
      t.push({tid:m.tid,kind:'usr',title:(role==='renter'?'בעל הרכב':'שוכר')+' · '+(other.name||'משתמש'),sub:'שיחה לפני הזמנה',ava:(other.name||'?')[0]});
    });
    state.bookings
      .filter(b=> role==='renter' ? b.renterId===id : b.ownerId===id)
      .sort((a,b)=>b.createdAt-a.createdAt)
      .forEach(b=>{
        const c=state.cars.find(x=>x.id===b.carId);
        const carName=c?`${c.make} ${c.model}`:'רכב';
        if(role==='renter'){
          const o=userOf(b.ownerId);
          t.push({tid:'b'+b.id,kind:'usr',title:'בעל הרכב · '+carName,sub:'הזמנה '+b.num,ava:(o?o.name[0]:'ב')});
        }else{
          t.push({tid:'b'+b.id,kind:'usr',title:b.signName+' · '+carName,sub:'הזמנה '+b.num,ava:b.signName[0]});
        }
      });
  }
  return t;
}
function tMsgs(tid){return state.msgs.filter(m=>m.tid===tid)}
function unread(tid){
  const last=state.reads[meKey()+'-'+tid]||0;
  const mine=state.session?state.session.role:'guest';
  return tMsgs(tid).filter(m=>m.ts>last && m.role!==mine && m.role!=='system').length;
}
function totalUnread(){return myThreads().reduce((s,t)=>s+unread(t.tid),0)}
function updateBadge(){
  const n=totalUnread(),b=$('chat-badge');
  b.style.display=n>0?'grid':'none';b.textContent=n;
}
function toggleChat(force){
  const p=$('chat-panel');
  const open=force!==undefined?force:!p.classList.contains('open');
  p.classList.toggle('open',open);
  if(open)showChatList();
}
function openChatTo(tid){
  $('chat-panel').classList.add('open');
  showThread(tid);
}
function showChatList(){
  activeTid=null;
  $('cp-back').style.visibility='hidden';
  $('cp-title').textContent='הודעות';
  $('cp-thread').style.display='none';
  const list=$('cp-list');list.style.display='block';
  const ts=myThreads();
  list.innerHTML=ts.map(t=>{
    const ms=tMsgs(t.tid),last=ms[ms.length-1];
    const u=unread(t.tid);
    return `<div class="cp-item" onclick="showThread('${t.tid}')">
      <div class="cp-ava ${t.kind}">${t.kind==='sup'?'☎':esc(t.ava||'?')}</div>
      <div class="inf"><b>${esc(t.title)}</b><span class="last">${last?esc(last.text):esc(t.sub)}</span></div>
      ${u>0?`<span class="cp-unread">${u}</span>`:''}
    </div>`;
  }).join('');
  if(!state.session){
    list.innerHTML+='<div class="cp-empty">כדי לשוחח עם בעל רכב על הזמנה, יש להתחבר ולהזמין רכב.<br>צ\'אט שירות הלקוחות פתוח לכולם 👆</div>';
  } else if(ts.length===1){
    list.innerHTML+='<div class="cp-empty">אחרי שתיסגר הזמנה, יופיע כאן צ\'אט ישיר '+(state.session.role==='renter'?'עם בעל הרכב':'עם השוכר')+'.</div>';
  }
}
function threadTitle(tid){
  const t=myThreads().find(x=>x.tid===tid);
  if(t)return t.title;
  if(tid.startsWith('o-')){
    const parts=tid.split('-');
    const otherId=(state.session&&state.session.role==='renter')?parts[2]:parts[1];
    const other=userOf(otherId)||{};
    return (state.session&&state.session.role==='renter'?'בעל הרכב':'שוכר')+' · '+(other.name||'משתמש');
  }
  if(tid.startsWith('sup-'))return 'מנהל המערכת · שירות לקוחות';
  return 'שיחה';
}
function showThread(tid){
  activeTid=tid;
  $('cp-back').style.visibility='visible';
  $('cp-title').textContent=threadTitle(tid);
  $('cp-list').style.display='none';
  $('cp-thread').style.display='flex';
  state.reads[meKey()+'-'+tid]=Date.now();
  renderMsgs();updateBadge();
  setTimeout(()=>$('cp-text').focus(),80);
}
function renderMsgs(){
  const box=$('cp-msgs');
  const mine=state.session?state.session.role:'guest';
  const ms=tMsgs(activeTid);
  box.innerHTML= ms.length===0
    ? '<div class="bub sys">תחילת השיחה — כתבו הודעה ראשונה</div>'
    : ms.map(m=>{
        if(m.role==='system')return `<div class="bub sys">${esc(m.text)}</div>`;
        const isMe=(m.role===mine)||(mine==='guest'&&m.role==='guest');
        const who=m.role==='admin'?'מנהל המערכת':(m.role==='owner'?'בעל הרכב':(m.role==='renter'?'שוכר':'אורח'));
        const img=m.image?`<img class="chat-img" src="${m.image}" alt="תמונה שנשלחה בצ׳אט">`:'';
        const pay=m.kind==='paymentProof'?'<div class="pay-proof-box">צילום מסך של העברת תשלום</div>':'';
        return `<div class="bub ${isMe?'me':'them'}">${!isMe?`<span class="who">${who}</span>`:''}${esc(m.text||'')}${pay}${img}<span class="tm">${new Date(m.ts).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}</span></div>`;
      }).join('');
  box.scrollTop=box.scrollHeight;
}
function participantsOf(tid){
  if(tid.startsWith('b')){
    const b=state.bookings.find(x=>'b'+x.id===tid);
    return b?[b.renterId,b.ownerId]:[];
  }
  if(tid.startsWith('o-')){
    const parts=tid.split('-');
    return [parts[1],parts[2]].filter(Boolean);
  }
  if(tid.startsWith('sup-')) return state.session?[state.session.id,'admin']:['guest','admin'];
  return state.session?[state.session.id]:[];
}
function pushMsg(tid,role,uid,text,parts,extra){
  const m={tid,role,uid,text,ts:Date.now(),participants:parts||participantsOf(tid),...(extra||{})};
  if(CLOUD){db.collection('messages').add(m).then(()=>{ if(tid.startsWith('b')){const b=state.bookings.find(x=>'b'+x.id===tid); if(b)bumpCarActivity(b.carId);} }).catch(cloudErr);}
  state.msgs.push(m);
  if(activeTid===tid && $('chat-panel').classList.contains('open')){
    state.reads[meKey()+'-'+tid]=Date.now();
    renderMsgs();
  }
  updateBadge();
}
function sendMsg(){
  const inp=$('cp-text'),txt=inp.value.trim();
  if(!txt||!activeTid)return;
  if(CLOUD && !state.session && !(activeTid||'').startsWith('sup-')){showToast('כדי לשלוח הודעה יש להתחבר');openAuth();return;}
  const role=state.session?state.session.role:'guest';
  const uid=state.session?state.session.id:0;
  pushMsg(activeTid,role,uid,txt,participantsOf(activeTid));
  inp.value='';
  if(activeTid.startsWith('sup-') && role!=='admin'){
    showToast('ההודעה נשלחה למנהל המערכת');
  }
}
function sendChatImage(input){
  const f=input.files&&input.files[0]; if(!f||!activeTid)return;
  if(CLOUD && !state.session && !(activeTid||'').startsWith('sup-')){showToast('כדי לשלוח תמונה יש להתחבר');openAuth();input.value='';return;}
  if(!f.type.startsWith('image/')){showToast('נא לבחור קובץ תמונה');input.value='';return;}
  const r=new FileReader();
  r.onload=()=>{
    const role=state.session?state.session.role:'guest';
    const uid=state.session?state.session.id:0;
    const txt=$('cp-text').value.trim()||'תמונה';
    pushMsg(activeTid,role,uid,txt,undefined,{image:r.result,kind:'image',fileName:f.name});
    $('cp-text').value=''; input.value='';
    showToast('התמונה נשלחה בצ׳אט');
  };
  r.readAsDataURL(f);
}
$('cp-text').addEventListener('keydown',e=>{if(e.key==='Enter')sendMsg()});

/* ===== ratings-and-profiles engine ===== */
state.ratings = [];
state.users = {};
const userOf = uid => state.users[uid] || null;
let profOwnerId=null;
function ownerStats(oid){
  const rs=state.ratings.filter(r=>r.raterRole==='renter'&&r.ownerId===oid);
  const c=rs.length;
  return{avg:c?rs.reduce((t,r)=>t+r.stars,0)/c:0,count:c};
}
function renterStats(rid){
  const rs=state.ratings.filter(r=>r.raterRole==='owner'&&r.renterId===rid);
  const c=rs.length;
  return{avg:c?rs.reduce((t,r)=>t+r.stars,0)/c:0,count:c};
}
function myRating(bid,role){return state.ratings.find(r=>r.bookingId===bid&&r.raterRole===role)}
function starsHTML(avg,count){
  if(count===0)return '<span class="new-tag">חדש · ללא דירוג</span>';
  const pct=Math.max(0,Math.min(100,avg/5*100));
  const tail=(count===null)?'':`<span class="rcount">${avg.toFixed(1)} (${count})</span>`;
  return `<span class="stars" title="${avg.toFixed(1)} מתוך 5"><i style="width:${pct}%">★★★★★</i>★★★★★</span>`+tail;
}
function ratePicker(bid){
  return `<span class="rate-picker">${[1,2,3,4,5].map(n=>`<button class="rp-star" title="${n} כוכבים" onclick="setRating('${bid}',${n})">★</button>`).join('')}</span>`;
}
function setRating(bid,n){
  if(!state.session)return;
  const b=state.bookings.find(x=>x.id===bid);
  if(!b)return;
  const role=state.session.role;
  if(role==='renter'&&b.renterId!==state.session.id)return;
  if(role==='owner'&&b.ownerId!==state.session.id)return;
  n=Math.round(Math.min(5,Math.max(1,+n||0)));
  if(!n)return;
  const ex=myRating(bid,role);
  const doc={bookingId:bid,raterRole:role,stars:n,ownerId:b.ownerId,renterId:b.renterId,raterName:(me()&&me().name)||'',text:(ex&&ex.text)||'',ts:Date.now()};
  if(CLOUD){db.collection('ratings').doc(bid+'_'+role).set(doc).catch(cloudErr);}
  else{if(ex)ex.stars=n;else state.ratings.push(doc);}
  showToast('הדירוג נשמר: '+n+' כוכבים');
  render();
  if(role==='renter'&&$('ov-renter').classList.contains('open'))openRenterArea();
  if(role==='owner'&&$('ov-owner').classList.contains('open'))renderOwnerBookings();
  if($('ov-profile').classList.contains('open')&&profOwnerId!==null)openOwnerProfile(profOwnerId);
}
function setReview(bid){
  if(!state.session)return;
  const role=state.session.role;
  const inp=$('rv-'+bid);
  if(!inp)return;
  const text=inp.value.trim();
  if(!text){showToast('כתבו כמה מילים ואז שלחו');return}
  const ex=myRating(bid,role);
  if(!ex){showToast('קודם בחרו דירוג כוכבים, ואז אפשר לצרף ביקורת');return}
  if(CLOUD){
    db.collection('ratings').doc(bid+'_'+role).update({text,raterName:(me()&&me().name)||''})
      .then(()=>showToast('הביקורת פורסמה — תודה!')).catch(cloudErr);
  } else {
    ex.text=text;ex.raterName=(me()&&me().name)||'';
    showToast('הביקורת פורסמה — תודה!');
    render();
    if($('ov-renter').classList.contains('open'))openRenterArea();
  }
}
function reviewsOf(oid){
  return state.ratings.filter(r=>r.raterRole==='renter'&&r.ownerId===oid&&r.text)
    .sort((a,b)=>b.ts-a.ts);
}
function openOwnerProfile(oid){
  const o=userOf(oid);
  if(!o)return;
  profOwnerId=oid;
  const st=ownerStats(oid);
  const cars=state.cars.filter(c=>c.ownerId===oid);
  const since=new Date(o.createdAt||Date.now()).toLocaleDateString('he-IL',{month:'long',year:'numeric'});
  const carsHtml = cars.length===0
    ? '<div class="adm-empty">אין כרגע רכבים פעילים.</div>'
    : '<div class="prof-cars">'+cars.map(c=>{
        const si=statusInfo(c);
        const btn = c.status==='available'
          ? `<button class="mini gold" onclick="closeOv('ov-profile');tryBook('${c.id}')">להזמנה</button>`
          : '<button class="mini" disabled style="opacity:.5">מושכר</button>';
        return `<div class="pc-item"><img src="${c.photos[0]}" alt=""><div class="inf"><b>${esc(c.make)} ${esc(c.model)} ${c.yr}</b><div class="sm">${esc(c.color)} · ${rateSummary(c)||money(primaryRate(c))} · <span class="pill ${si.cls}" style="font-size:.62rem;padding:1px 8px">${si.txt}</span></div></div>${btn}</div>`;
      }).join('')+'</div>';
  $('prof-body').innerHTML=`
    <div class="prof-head">
      <div class="prof-ava">${esc(o.name[0])}</div>
      <div><b>${esc(o.name)}</b><span class="sm">משכיר · חבר מאז ${since}</span>
      <div class="prof-stars">${starsHTML(st.avg,st.count)}</div></div>
    </div>
    <div class="divider">הרכבים של ${esc(o.name.split(' ')[0])} (${cars.length})</div>
    ${carsHtml}
    <div class="divider" style="margin-top:22px">ביקורות (${reviewsOf(oid).length})</div>
    ${reviewsOf(oid).length===0
      ?'<div class="adm-empty">עדיין אין ביקורות כתובות.</div>'
      :'<div class="rv-list">'+reviewsOf(oid).map(r=>`<div class="rv-item">
          <div class="rv-top">${starsHTML(r.stars,null)}<b>${esc((r.raterName||'שוכר').split(' ')[0])}</b><span class="sm">${new Date(r.ts).toLocaleDateString('he-IL',{month:'short',year:'numeric'})}</span></div>
          <div class="rv-txt">"${esc(r.text)}"</div>
        </div>`).join('')+'</div>'}`;
  openOv('ov-profile');
}


/* ================= CLOUD FEEDS ================= */
let userUnsubs=[], adminUnsubs=[], bookMap={};
function stopUserFeeds(){if(!CLOUD)return;userUnsubs.forEach(u=>{try{u()}catch(e){}});userUnsubs=[];bookMap={};state.bookings=[];if(CLOUD)state.msgs=[];}
function stopAdminFeeds(){if(!CLOUD)return;adminUnsubs.forEach(u=>{try{u()}catch(e){}});adminUnsubs=[];}
function refreshOpenViews(){
  render();
  if($('ov-owner').classList.contains('open')){renderAdminList();renderOwnerBookings();renderOwnerReport();}
  if($('ov-renter').classList.contains('open'))openRenterArea();
  if($('ov-profile').classList.contains('open')&&profOwnerId!==null)openOwnerProfile(profOwnerId);
  if($('chat-panel').classList.contains('open')){activeTid?renderMsgs():showChatList();}
  if($('ov-admin')&&$('ov-admin').classList.contains('open'))renderAdminDashboard();
  updateBadge();
}
function startGlobalFeeds(){
  db.collection('users').onSnapshot(sn=>{
    state.users={};sn.forEach(d=>state.users[d.id]=d.data());
    render();
  },cloudErr);
  db.collection('cars').onSnapshot(sn=>{
    state.cars=sn.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>((b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0)));
    refreshOpenViews();
  },cloudErr);
  db.collection('ratings').onSnapshot(sn=>{
    state.ratings=sn.docs.map(d=>({id:d.id,...d.data()}));
    refreshOpenViews();
  },cloudErr);
}
function applyBookSnap(sn){
  sn.forEach(d=>bookMap[d.id]={id:d.id,...d.data()});
  state.bookings=Object.values(bookMap).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  refreshOpenViews();
}
function startUserFeeds(uid){
  stopUserFeeds();
  userUnsubs.push(db.collection('bookings').where('renterId','==',uid).onSnapshot(applyBookSnap,cloudErr));
  userUnsubs.push(db.collection('bookings').where('ownerId','==',uid).onSnapshot(applyBookSnap,cloudErr));
  userUnsubs.push(db.collection('messages').where('participants','array-contains',uid).onSnapshot(sn=>{
    const mine=sn.docs.map(d=>({id:d.id,...d.data()}));
    const local=state.msgs.filter(m=>m.role==='support'||(m.tid||'').startsWith('sup-'));
    state.msgs=mine.concat(local).sort((a,b)=>(a.ts||0)-(b.ts||0));
    if($('chat-panel').classList.contains('open')){activeTid?renderMsgs():showChatList();}
    updateBadge();
  },cloudErr));
}

function startAdminFeeds(){
  if(!CLOUD)return;
  stopAdminFeeds();
  adminUnsubs.push(db.collection('bookings').onSnapshot(sn=>{
    state.bookings=sn.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    refreshOpenViews();
  },cloudErr));
  adminUnsubs.push(db.collection('messages').onSnapshot(sn=>{
    state.msgs=sn.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.ts||0)-(b.ts||0));
    refreshOpenViews();
  },cloudErr));
}

async function buildCloudSession(user){
  const uid=user.uid;
  let prof=null;
  try{const d=await db.collection('users').doc(uid).get();if(d.exists)prof=d.data();}catch(e){}
  if(!prof && pendingProfile && pendingProfile.uid===uid)prof=pendingProfile.prof;
  if(!prof){prof={name:user.email||'משתמש',role:'renter',createdAt:Date.now()}}
  let priv={};
  try{const d=await db.collection('private').doc(uid).get();if(d.exists)priv=d.data();}catch(e){}
  if((!priv||!Object.keys(priv).length) && pendingProfile && pendingProfile.uid===uid)priv=pendingProfile.priv||{};
  state.session={role:prof.role,id:uid,name:prof.name,createdAt:prof.createdAt,email:user.email||'',...priv};
  persistSessionCookie();
  startUserFeeds(uid);
  afterLoginUI();
}
if(CLOUD){
  startGlobalFeeds();
  fauth.onAuthStateChanged(user=>{
    if(user){buildCloudSession(user);}
    else{state.session=null;stopUserFeeds();stopAdminFeeds();renderNav();updateBadge();}
  });
} else {
  console.warn('CrownDrive: CLOUD auth is off. Firebase realtime can still run through firebase-config.js.');
}

/* ---------- SCROLL DYNAMICS ---------- */
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const heroIn=document.querySelector('.hero-in');
const progress=$('progress');
let tick=false;
addEventListener('scroll',()=>{
  if(tick)return;tick=true;
  requestAnimationFrame(()=>{
    const y=scrollY;
    const max=document.documentElement.scrollHeight-innerHeight;
    if(progress)progress.style.width=(max>0?(y/max)*100:0)+'%';
    if(!reduced&&heroIn){
      const f=Math.min(y/600,1);
      heroIn.style.transform=`translateY(${y*.06}px)`;
      heroIn.style.opacity=1-f*.35;
    }
    tick=false;
  });
},{passive:true});

/* headline word-by-word entrance */
(function(){
  const h=document.querySelector('.hero h1');
  if(!h||reduced)return;
  let i=0;
  const wrap=node=>{
    [...node.childNodes].forEach(n=>{
      if(n.nodeType===3){
        const frag=document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(part=>{
          if(!part)return;
          if(/^\s+$/.test(part)){frag.appendChild(document.createTextNode(part));return}
          const sp=document.createElement('span');
          sp.className='w';sp.textContent=part;
          sp.style.animationDelay=(0.12+i*0.09)+'s';i++;
          frag.appendChild(sp);
        });
        node.replaceChild(frag,n);
      } else if(n.nodeType===1) wrap(n);
    });
  };
  wrap(h);
})();

/* animated counters */
function animateNum(el,target){
  target=+target||0;
  if(reduced){el.textContent=target;el._v=target;return}
  const from=el._v||0;
  if(from===target){el.textContent=target;return}
  const t0=performance.now(),dur=700;
  const step=t=>{
    const k=Math.min((t-t0)/dur,1),e=1-Math.pow(1-k,3);
    el.textContent=Math.round(from+(target-from)*e);
    if(k<1)requestAnimationFrame(step);else el._v=target;
  };
  requestAnimationFrame(step);
}

/* reveal on scroll */
const io=new IntersectionObserver(es=>es.forEach(e=>{
  if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}
}),{threshold:.12});
document.querySelectorAll('.sec-head,.fleet-side,.how-grid,.foot-cta,.strip-in').forEach(el=>{
  el.classList.add('reveal');io.observe(el);
});



window.addEventListener('beforeunload', persistState);
window.CROWNDRIVE_DIAGNOSTICS=function(){return {cars:state.cars.length, owners:state.owners.length, renters:state.renters.length, bookings:state.bookings.length, realtime:!!REALTIME, firebaseUser:!!(RT_AUTH&&RT_AUTH.currentUser), lastRealtimeOk:window.CROWNDRIVE_LAST_REALTIME_OK||0, lastRealtimeError:String((window.CROWNDRIVE_LAST_REALTIME_ERROR&&window.CROWNDRIVE_LAST_REALTIME_ERROR.message)||'')};};
loadState();
ensureStateIntegrity();
initRealtime();
try{
  initChoiceLists();initOwnerChoiceLists();updateOwnerPriceFields();renderNav();renderMyAreaFab();render();initSig();updateBadge();
}catch(e){
  console.error('Initial render recovery', e);
  safeToast('האתר תיקן נתונים ישנים/פגומים ונטען מחדש.');
  ensureStateIntegrity(); renderNav(); renderMyAreaFab();
}
setInterval(()=>{
  if(document.activeElement && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;
  refreshOpenViews();
},1000);
