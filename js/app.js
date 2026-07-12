import {startPublic, store} from './store.js';
import {authReady} from './auth.js';
import {nav, home, cars, authView, dashboard, chatsPage} from './views.js';
import {toast, closeModal} from './core.js';

// Start data + auth in the background — do NOT block first paint on them.
// The home page renders instantly; auth-gated views wait via store.authSettled.
startPublic();
authReady.then(() => { store.authSettled = true; render(); });

const routes = {home, cars, auth: authView, dashboard, chats: chatsPage};

// Scroll reveal (same motion language as the original design).
const revealObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('in'); revealObserver.unobserve(entry.target); }
    }, {threshold: .12})
  : null;
function watchReveals() {
  document.querySelectorAll('.reveal:not(.in)').forEach(el => revealObserver ? revealObserver.observe(el) : el.classList.add('in'));
}

let rendering = false;
function render() {
  if (rendering) return;
  rendering = true;
  try {
    nav();
    const route = location.hash.slice(1) || 'home';
    store.route = route;
    document.body.dataset.page = route;
    // Maintenance mode: only admins can browse; everyone else sees a notice (login stays open).
    if (store.config?.maintenance?.on && !store.isAdmin && route !== 'auth') {
      document.querySelector('#app').innerHTML = `<section class="card maintenance"><span class="maint-icon">🛠️</span><h1>האתר בתחזוקה</h1><p>אנחנו מעלים עדכון — נחזור ממש בקרוב. תודה על הסבלנות!</p><button class="btn outline" data-route="auth">כניסת מנהל</button></section>`;
      return;
    }
    (routes[route] || home)();
    if (route !== 'home') {
      document.querySelector('#app').insertAdjacentHTML('afterbegin', '<button type="button" class="page-back" id="page-back">→ חזרה</button>');
      document.querySelector('#page-back').onclick = () => { if (history.length > 1) history.back(); else location.hash = 'home'; };
    }
    watchReveals();
    document.querySelector('#app')?.focus({preventScroll: true});
  } catch (error) {
    console.error('render failed', error);
    toast(`שגיאה בטעינת המסך: ${error.message}`);
  } finally {
    rendering = false;
  }
}

document.addEventListener('click', event => {
  const routeButton = event.target.closest('button[data-route], a[data-route]');
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
  if (['cars','ratings','profile','verification-status','bookings','payments','users','admin-notifications','config','private-ready','private-stopped'].includes(key)) render();
});
window.addEventListener('authchange', render);
window.addEventListener('unhandledrejection', event => {
  console.error('unhandled rejection', event.reason);
  // JSON/parse failures (e.g. a non-JSON API response) are already handled at every call
  // site; never surface the raw "Unexpected … JSON at position N" text to the user.
  if (event.reason?.name === 'SyntaxError') { event.preventDefault(); return; }
  toast(event.reason?.message || 'אירעה שגיאה');
});
window.addEventListener('error', event => {
  console.error('window error', event.error || event.message);
});
// The site always opens on the home page.
if (location.hash && location.hash !== '#home') history.replaceState(null, '', '#home');

document.querySelector('.brand')?.addEventListener('click', event => {
  event.preventDefault();
  if ((location.hash.slice(1) || 'home') === 'home') { window.scrollTo({top: 0, behavior: 'smooth'}); render(); }
  else location.hash = 'home';
});
render();
