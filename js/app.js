import {startPublic, store} from './store.js';
import {authReady} from './auth.js';
import {nav, bottomNav, home, cars, authView, dashboard, chatsPage, openAdminLogin, openCar, ensureAppModule} from './views.js';
import {toast, closeModal, resetPaint, enhanceUI} from './core.js';

// Start data + auth in the background — do NOT block first paint on them.
// The home page renders instantly; auth-gated views wait via store.authSettled.
startPublic();
authReady.then(() => { store.authSettled = true; scheduleRender(); });
// Safety net: if Firebase Auth never reports back (blocked storage, dead network), don't spin
// forever — after 10s treat auth as "settled" so gated screens resolve (login prompt / content).
setTimeout(() => { if (!store.authSettled) { store.authSettled = true; scheduleRender(); } }, 10000);
// The header + hero + search render INSTANTLY now; only the cars grid shows a skeleton until data
// arrives (see carGrid). Ultimate fallback: if the cars read HANGS (no snapshot AND no error) for 5s,
// end the loading state so the skeleton clears. Guarded so it fires NOTHING once the data arrived
// (previously this timer always ran a redundant extra render around the 5s mark).
setTimeout(() => { if (!store.publicReady) { store.publicReady = true; scheduleRender(); } }, 5000);

const routes = {home, cars, auth: authView, dashboard, chats: chatsPage};

// Scroll reveal (same motion language as the original design).
const revealObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('in'); revealObserver.unobserve(entry.target); }
    }, {threshold: .12})
  : null;
let firstPaintDone = false;
function watchReveals() {
  document.querySelectorAll('.reveal:not(.in)').forEach(el => {
    // Only animate on the very first paint. On later re-renders (data/auth updates) show content
    // instantly — re-running the fade each time is what looked like the page "flashing".
    if (firstPaintDone || !revealObserver) el.classList.add('in');
    else revealObserver.observe(el);
  });
}

// Coalesce bursts of data events into ONE paint. The Firebase listeners (cars/ratings/config/
// bookings/users/…) resolve over the first ~200ms, spread across several animation frames — so a
// per-frame guard still let ~5 renders through (the "jumping / refreshing 5 times" on open). A
// short TRAILING debounce collapses the whole burst into a single render once it goes quiet.
let renderTimer = null, renderFirstAt = 0;
function scheduleRender() {
  const now = Date.now();
  if (!renderTimer) renderFirstAt = now;
  clearTimeout(renderTimer);
  // Debounce a burst by 110ms, but NEVER hold a render longer than 700ms even under a continuous
  // stream of events — otherwise a chatty listener could starve the render and freeze the spinner.
  renderTimer = setTimeout(() => { renderTimer = null; render(); }, (now - renderFirstAt) >= 700 ? 0 : 110);
}

let rendering = false;
let lastRoute = null;  // for the subtle enter-transition, fired only on a real route change (not re-renders)
let pendingCarLink = null;  // #car=<id> deep link waiting for the catalog data to arrive
const scrollMemory = {};  // per-route scroll position — switching tabs keeps your place (design spec §6)
function render() {
  if (rendering) return;
  rendering = true;
  try {
    let requestedRoute = location.hash.slice(1) || 'home';
    // Deep link #car=<id> (share links / WhatsApp): land on the catalog and open that car once the
    // public data is in. The hash is normalized to #cars so the rest of the router behaves as usual.
    if (requestedRoute.startsWith('car=')) {
      pendingCarLink = decodeURIComponent(requestedRoute.slice(4));
      history.replaceState(null, '', '#cars');
      requestedRoute = 'cars';
    }
    const route = routes[requestedRoute] ? requestedRoute : 'home';
    if (route !== requestedRoute) history.replaceState(null, '', '#home');
    store.route = route;
    document.body.dataset.page = route;
    nav();
    bottomNav();
    // A user blocked by the admin is fully locked out of the app (every route) with a big notice. (This is
    // the reliable account-level lock; an optional IP-level block for logged-OUT access is separate.)
    // ...except the support thread. openChatThread navigates to #chats, so blocking that route too
    // meant the appeal button just re-rendered this very screen — the door was never actually open.
    // message-send lets a blocked user write ONLY to their own support thread, and the chat list is
    // reduced to that one thread for them, so nothing else becomes reachable here.
    if (store.profile?.blocked === true && !store.isAdmin && route !== 'chats') {
      resetPaint();
      const navEl = document.querySelector('#main-nav'); if (navEl) navEl.innerHTML = '';
      // Leave ONE door open: a mistaken block must be appealable. message-send lets a blocked user
      // write to their own support thread (and nothing else) precisely for this.
      document.querySelector('#app').innerHTML = '<section class="card blocked-screen"><div class="blocked-ic" aria-hidden="true">⛔</div><h1>הגישה נחסמה</h1><p>החשבון הזה נחסם על ידי הנהלת האתר. אם לדעתכם מדובר בטעות, אפשר לכתוב לנו כאן ונבדוק.</p><button type="button" class="btn primary" id="blocked-support">פנייה לתמיכה</button></section>';
      document.querySelector('#blocked-support')?.addEventListener('click', async () => {
        const {openSupportChat} = await import('./views.js');
        openSupportChat();
      });
      return;
    }
    // Maintenance mode: only admins can browse; everyone else sees a notice (login stays open).
    if (store.config?.maintenance?.on && !store.isAdmin && route !== 'auth') {
      resetPaint();
      const gear = '<svg class="gear" viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.49.49 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.14 8.48a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.07.63-.07.94 0 .31.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>';
      document.querySelector('#app').innerHTML = `<section class="card maintenance"><div class="maint-gears" aria-hidden="true"><span class="g1">${gear}</span><span class="g2">${gear}</span></div><h1>האתר בתחזוקה</h1><p>אנחנו מעלים עדכון — נחזור ממש בקרוב. תודה על הסבלנות!</p><button class="btn outline" id="maint-admin">כניסת מנהל</button></section>`;
      document.querySelector('#maint-admin')?.addEventListener('click', () => openAdminLogin());
      return;
    }
    // Remember how far the user scrolled on the route they're LEAVING (design spec §6: switching
    // tabs must not lose your place) — captured before the new route repaints.
    if (route !== lastRoute && lastRoute) scrollMemory[lastRoute] = window.scrollY;
    (routes[route] || home)();
    // The shared car opens as soon as its data has arrived (first render may be pre-data).
    if (pendingCarLink && store.publicReady) {
      const linkedCar = pendingCarLink;
      pendingCarLink = null;
      if (store.cars[linkedCar]) setTimeout(() => openCar(linkedCar), 80);
      else toast('הרכב מהקישור כבר אינו זמין');
    }
    // Subtle app-like enter transition — only when the route actually changed, so data-driven re-renders
    // (incoming messages, store updates) don't re-animate and flicker.
    if (route !== lastRoute) {
      // Directional slide (app-feel): the page enters from the side you moved toward in the tab bar
      // (RTL: a higher-index tab sits further left). Unknown routes keep the plain fade-up.
      const ROUTE_ORDER = {home: 0, cars: 1, dashboard: 2, chats: 3, auth: 4};
      const from = ROUTE_ORDER[lastRoute], to = ROUTE_ORDER[route];
      const enterClass = from !== undefined && to !== undefined && from !== to
        ? (to > from ? 'app-enter-fwd' : 'app-enter-back') : 'app-enter';
      lastRoute = route;
      // Returning to a tab restores its scroll position (app behavior); a first visit opens at the top.
      // Instant, because the CSS sets scroll-behavior:smooth.
      window.scrollTo({top: scrollMemory[route] || 0, behavior: 'instant'});
      const appEl = document.querySelector('#app');
      if (appEl) { appEl.classList.remove('app-enter', 'app-enter-fwd', 'app-enter-back'); void appEl.offsetWidth; appEl.classList.add(enterClass); }
      document.querySelector('#app')?.focus({preventScroll: true});
    }
    // Only the cars listing gets the in-flow "→ חזרה" button. home/dashboard/auth/chats each have
    // their own navigation (bottom tab bar, in-form back link, chat back/close), so they don't need it.
    // Insert exactly one in-flow "→ חזרה" (only on the cars listing). Guarded so a memoized re-render
    // that kept the existing DOM doesn't add a second one.
    if (!['home', 'dashboard', 'auth', 'chats'].includes(route)) {
      if (!document.querySelector('#page-back')) {
        document.querySelector('#app').insertAdjacentHTML('afterbegin', '<button type="button" class="page-back" id="page-back">→ חזרה</button>');
        document.querySelector('#page-back').onclick = () => { if (history.length > 1) history.back(); else location.hash = 'home'; };
      }
    }
    watchReveals();
    enhanceUI(document);
    firstPaintDone = true;
    window.__CD_BOOT_READY__?.();  // app painted — stand the boot watchdog down
    document.querySelector('#app')?.setAttribute('aria-busy', 'false');
  } catch (error) {
    console.error('render failed', error);
    toast(`שגיאה בטעינת המסך: ${error.message}`);
  } finally {
    rendering = false;
  }
}

document.addEventListener('click', event => {
  const passwordToggle = event.target.closest('[data-toggle-password]');
  if (passwordToggle) {
    const input = document.getElementById(passwordToggle.dataset.togglePassword);
    if (input) {
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      passwordToggle.textContent = visible ? 'הצגה' : 'הסתרה';
      passwordToggle.setAttribute('aria-pressed', String(!visible));
    }
    return;
  }
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
  if (['cars','ratings','profile','verification-status','verification-statuses','bookings','payments','users','admin-notifications','config','private-ready','private-stopped','reservations','user-notifications','external-rentals'].includes(key)) scheduleRender();
  // Load the personal-area module in the background for any signed-in member so the rental-request
  // popup (owner) and the approval/rejection popup (renter) fire even while they browse public pages —
  // the watchers self-subscribe to storechange when the module loads.
  if (key === 'profile' && store.user && !store.user.isAnonymous) ensureAppModule();
});
window.addEventListener('authchange', scheduleRender);
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
// Preserve valid deep links (cars, dashboard, chats, auth). Unknown routes alone return home.
if (location.hash && !routes[location.hash.slice(1)] && !location.hash.startsWith('#car=')) history.replaceState(null, '', '#home');

// Keep the app usable on weak mobile connections: show an explicit connection state and let forms remain
// on screen instead of looking frozen. Firebase/API calls still provide their own retry/error handling.
const networkNode = document.querySelector('#network-status');
function updateNetworkStatus() {
  if (!networkNode) return;
  const offline = navigator.onLine === false;
  document.body.classList.toggle('is-offline', offline);
  networkNode.hidden = !offline;
  networkNode.textContent = offline ? 'אין חיבור לאינטרנט — המידע שמוצג עשוי להיות לא מעודכן' : '';
}
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);
updateNetworkStatus();

// Dashboard/auth content is lazy-rendered after the route paint. Enhance labels and controls whenever a
// new block is inserted, while coalescing a burst of mutations into one inexpensive pass.
let enhanceTimer = null;
new MutationObserver(() => {
  clearTimeout(enhanceTimer);
  enhanceTimer = setTimeout(() => enhanceUI(document), 0);
}).observe(document.body, {childList: true, subtree: true});

document.querySelector('.brand')?.addEventListener('click', event => {
  event.preventDefault();
  if ((location.hash.slice(1) || 'home') === 'home') { window.scrollTo({top: 0, behavior: 'smooth'}); render(); }
  else location.hash = 'home';
});
render();

// Deferred install prompt (mobile audit #55): capture beforeinstallprompt, and only offer installation after
// the visitor showed real interest (opened 2+ cars) — never on first paint. "לא עכשיו" is remembered.
let deferredInstall = null;
const bumpEngagement = () => {
  try { sessionStorage.setItem('cd-engaged', String(Number(sessionStorage.getItem('cd-engaged') || 0) + 1)); } catch {}
  maybeShowInstallTip();
};
document.addEventListener('click', event => { if (event.target.closest('[data-car-open]')) bumpEngagement(); });
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; maybeShowInstallTip(); });
function maybeShowInstallTip() {
  if (!deferredInstall || document.querySelector('#install-tip')) return;
  try { if (localStorage.getItem('cd-install-dismissed')) return; } catch {}
  try { if (Number(sessionStorage.getItem('cd-engaged') || 0) < 2) return; } catch { return; }
  document.body.insertAdjacentHTML('beforeend',
    `<div id="install-tip" class="install-tip" role="region" aria-label="התקנת האפליקציה"><span>📲 הוסיפו את CrownDrive למסך הבית</span><button type="button" class="btn primary" id="install-yes">התקנה</button><button type="button" class="install-x" id="install-no" aria-label="לא עכשיו">×</button></div>`);
  document.querySelector('#install-yes').onclick = async () => {
    try { deferredInstall.prompt(); await deferredInstall.userChoice; } catch {}
    deferredInstall = null;
    document.querySelector('#install-tip')?.remove();
  };
  document.querySelector('#install-no').onclick = () => {
    try { localStorage.setItem('cd-install-dismissed', '1'); } catch {}
    document.querySelector('#install-tip')?.remove();
  };
}
