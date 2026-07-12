import {startPublic, store} from './store.js';
import {authReady} from './auth.js';
import {nav, home, cars, authView, dashboard, chatsPage, openAdminLogin} from './views.js';
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
      const gear = '<svg class="gear" viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.49.49 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.14 8.48a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.07.63-.07.94 0 .31.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>';
      document.querySelector('#app').innerHTML = `<section class="card maintenance"><div class="maint-gears" aria-hidden="true"><span class="g1">${gear}</span><span class="g2">${gear}</span></div><h1>האתר בתחזוקה</h1><p>אנחנו מעלים עדכון — נחזור ממש בקרוב. תודה על הסבלנות!</p><button class="btn outline" id="maint-admin">כניסת מנהל</button></section>`;
      document.querySelector('#maint-admin')?.addEventListener('click', () => openAdminLogin());
      return;
    }
    (routes[route] || home)();
    // The personal area has its own close button + bottom tab bar, so skip the floating
    // back button there (it used to overlap the header). Other inner pages keep it.
    if (!['home', 'dashboard'].includes(route)) {
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
  // Never surface raw/technical text to the user. We only toast our OWN messages, which are
  // always in Hebrew; anything else (JSON SyntaxError, Firebase SDK English strings, etc.)
  // is logged for us but hidden from the user.
  event.preventDefault();
  const message = String(event.reason?.message || '');
  if (event.reason?.name !== 'SyntaxError' && /[֐-׿]/.test(message)) toast(message);
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
