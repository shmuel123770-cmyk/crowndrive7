import {refs} from './firebase.js';
export const store={user:null,profile:null,isAdmin:false,cars:{},bookings:{},payments:{},route:'home',publicUnsub:null,privateUnsubs:[]};
const val=s=>s.val()||{};
function listen(ref,cb,key){const fn=s=>{cb(val(s));window.dispatchEvent(new CustomEvent('storechange',{detail:key}))};ref.on('value',fn,e=>{console.error(key,e);window.dispatchEvent(new CustomEvent('app-error',{detail:e?.message||`שגיאת טעינה: ${key}`}))});return()=>ref.off('value',fn)}
export async function startPublic(){if(store.publicUnsub)return;store.publicUnsub=listen(refs.cars,v=>store.cars=v,'cars')}
export async function startPrivate(user){stopPrivate();store.user=user;store.isAdmin=(await refs.admins.child(user.uid).once('value')).val()===true;store.profile=(await refs.users.child(user.uid).once('value')).val()||{name:user.displayName||'',email:user.email||'',role:'renter',verification:{}};const verificationStatus=(await refs.verificationStatus.child(user.uid).once('value')).val()||'missing';store.profile.verification={...(store.profile.verification||{}),status:verificationStatus};if(store.isAdmin){store.privateUnsubs.push(listen(refs.bookings,v=>store.bookings=v,'bookings'));store.privateUnsubs.push(listen(refs.payments,v=>store.payments=v,'payments'))}else{const role=store.profile?.role;const field=role==='owner'?'ownerUid':'renterUid';store.privateUnsubs.push(listen(refs.bookings.orderByChild(field).equalTo(user.uid),v=>store.bookings=v,'bookings'));store.privateUnsubs.push(listen(refs.payments.orderByChild(field).equalTo(user.uid),v=>store.payments=v,'payments'))}window.dispatchEvent(new Event('storechange'))}
export function stopPrivate(){store.privateUnsubs.splice(0).forEach(fn=>fn());store.user=null;store.profile=null;store.isAdmin=false;store.bookings={};store.payments={}}
export function list(obj){return Object.entries(obj||{}).map(([id,v])=>({id,...v}))}
export function myRole(){return store.isAdmin?'admin':store.profile?.role||null}
export function myBookings(){return list(store.bookings)}
export function myCars(){const u=store.user?.uid,r=myRole();return list(store.cars).filter(c=>r==='admin'||c.ownerUid===u)}
