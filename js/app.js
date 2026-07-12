import {startPublic,store} from './store.js';
import {authReady} from './auth.js';
import {nav,home,cars,authView,dashboard} from './views.js';
import {toast,closeModal} from './core.js';

const routes={home,cars,auth:authView,dashboard};
let rendering=false;

await startPublic();
await authReady;

function normalizedRoute(){
  const requested=location.hash.slice(1)||'home';
  if(requested==='dashboard'&&!store.user)return 'auth';
  if(requested==='auth'&&store.user)return 'dashboard';
  return routes[requested]?requested:'home';
}

function render(){
  if(rendering)return;
  rendering=true;
  try{
    nav();
    const route=normalizedRoute();
    if(location.hash.slice(1)!==route)history.replaceState(null,'',`#${route}`);
    store.route=route;
    routes[route]();
    document.querySelector('#app')?.focus({preventScroll:true});
  }catch(error){
    console.error(error);
    document.querySelector('#app').innerHTML=`<section class="card panel error-state"><h1>לא הצלחנו לפתוח את המסך</h1><p>המידע שלך לא נמחק. נסה שוב או חזור לדף הבית.</p><div class="chips"><button class="btn primary" data-route="home">חזרה לבית</button><button class="btn outline" id="retry-render">נסה שוב</button></div></section>`;
    document.querySelector('#retry-render')?.addEventListener('click',render);
    toast(error?.message||'אירעה שגיאה בטעינת המסך');
  }finally{rendering=false}
}

document.addEventListener('click',e=>{
  const route=e.target.closest('[data-route]');
  if(route){e.preventDefault();location.hash=route.dataset.route;return}
  if(e.target.closest('[data-close-modal]')){closeModal();return}
  if(e.target.classList.contains('modal-backdrop'))closeModal();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
window.addEventListener('hashchange',render);
window.addEventListener('storechange',()=>{if(['home','cars','dashboard'].includes(store.route))render()});
window.addEventListener('authchange',render);
window.addEventListener('app-error',e=>toast(e.detail||'שגיאת תקשורת'));
window.addEventListener('unhandledrejection',e=>{console.error(e.reason);toast(e.reason?.message||'פעולה לא הושלמה')});
window.addEventListener('error',e=>{console.error(e.error||e.message);toast('אירעה שגיאה. נסה שוב')});
render();
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('/sw.js').catch(console.warn);
