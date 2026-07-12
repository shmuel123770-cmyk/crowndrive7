import {startPublic, store} from './store.js';
import {authReady} from './auth.js';
import {nav, home, cars, authView, dashboard} from './views.js';
import {toast, closeModal} from './core.js';

await startPublic();
await authReady;

const routes = {home, cars, auth: authView, dashboard};
let rendering = false;
function render() {
  if (rendering) return;
  rendering = true;
  try {
    nav();
    const route = location.hash.slice(1) || 'home';
    store.route = route;
    (routes[route] || home)();
    document.querySelector('#app')?.focus({preventScroll: true});
  } catch (error) {
    console.error('render failed', error);
    toast(`שגיאה בטעינת המסך: ${error.message}`);
  } finally {
    rendering = false;
  }
}

document.addEventListener('click', event => {
  const routeButton = event.target.closest('[data-route]');
  if (routeButton) {
    event.preventDefault();
    location.hash = routeButton.dataset.route;
    return;
  }
  if (event.target.closest('[data-close-modal]') || event.target.classList.contains('modal-backdrop')) closeModal();
});
window.addEventListener('hashchange', render);
window.addEventListener('storechange', event => {
  const key = String(event.detail || '');
  if (['cars','ratings','profile','verification-status','bookings','payments','users','private-ready','private-stopped'].includes(key)) render();
});
window.addEventListener('authchange', render);
window.addEventListener('unhandledrejection', event => {
  console.error('unhandled rejection', event.reason);
  toast(event.reason?.message || 'אירעה שגיאה');
});
window.addEventListener('error', event => {
  console.error('window error', event.error || event.message);
});
render();
