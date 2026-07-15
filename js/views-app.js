import {store, list, myRole, myBookings, myCars, carRating, carRatingCount, userRating} from './store.js';
import {esc, money, fmtDate, statusLabel, verificationLabel, modal, closeModal, formData, toast, stars, validEmail, paintApp, resetPaint} from './core.js';
import {register, login, logout, sendVerify, refreshEmailStatus, sendPasswordReset, createOwnProfile, signInGuest} from './auth.js';
import {saveUser, setOwnPhoto, createCar, updateCar, deleteCar, createBooking, startInquiry, setBookingStatus, registerDocument, approveVerification, sendMessage, savePayment, saveHandover, submitRating, carMediaPublic, adminAction, setMaintenance, setCarStatus, setCarFeatured, checkIsAdmin} from './db.js';
import {uploadPrivate, uploadPublicMedia, signedRead, capturePhoto} from './media.js';
import {legacyStatus, migrateLegacy} from './migrate.js';
import {api} from './api.js';
import {saveAuthReturn, afterAuthDestination, CAR_MAKES, CAR_TYPES, ICON, MODELS_BY_MAKE, RENTAL_MODES, TAB_ICONS, app, avatarHtml, carImage, carPhotoList, carStatusPill, carYears, composePhone, emptyState, fallbackImage, kpi, phoneField, roleName, selectOptions, bindCarButtons, carGrid, featuredFirst} from './views.js';

function dashboardLayout(title, tabs, active, content, actions = '', navFooter = '') {
  const firstName = String(store.profile?.name || '').trim().split(/\s+/)[0];
  const eyebrow = firstName ? `שלום, ${esc(firstName)}` : 'האזור האישי';
  return `<div class="dashboard-shell"><header class="dashboard-head">
      <div class="dash-head-top">
        <div class="dash-head-titles"><p class="eyebrow">${eyebrow}</p><h1>${esc(title)}</h1></div>
        <div class="dash-head-controls"><button type="button" class="avatar-btn" data-goto-profile title="לפרופיל שלי">${avatarHtml(store.profile, 60)}</button><button type="button" class="dash-close" data-route="home" aria-label="סגירת האזור האישי">✕</button></div>
      </div>
      ${actions ? `<div class="dash-head-actions">${actions}</div>` : ''}
    </header><nav class="dashboard-tabs" aria-label="תפריט אזור אישי">${tabs.map(([key, label]) => `<button class="tab ${key === active ? 'active' : ''}" data-dashboard-tab="${key}"><i class="tab-ic">${(TAB_ICONS[key] || (() => ''))()}</i><span>${label}</span></button>`).join('')}${navFooter ? `<div class="nav-footer">${navFooter}</div>` : ''}</nav><section class="card panel dashboard-panel">${content}</section></div>`;
}
// The dashboard tab the user is currently on. Kept across re-renders so a data event (new message,
// booking update…) no longer resets the personal area to "overview" and bounces the user to the main page.
function bindDashboardTabs(renderer) {
  document.querySelectorAll('[data-dashboard-tab]').forEach(button => button.onclick = () => {
    const tab = button.dataset.dashboardTab;
    if (tab === 'chats') { location.hash = 'chats'; return; }  // full-screen messaging page
    store.dashTab = tab; renderer(tab);
  });
  const headAvatar = document.querySelector('[data-goto-profile]');
  if (headAvatar) headAvatar.onclick = () => { store.dashTab = 'profile'; renderer('profile'); };
}
export function dashboard() {
  resetPaint();
  // A guest (anonymous) has no personal area — send them to register instead of a dead-end profile screen.
  if (store.user?.isAnonymous) { toast('הירשמו כדי לפתוח אזור אישי'); location.hash = 'auth'; return; }
  if (!store.user) {
    if (!store.authSettled) { app().innerHTML = '<div class="app-loader"><div class="spinner"></div><p>טוען…</p></div>'; return; }
    location.hash = 'auth'; return;
  }
  const role = myRole();
  if (role === 'admin') adminDashboard(store.dashTab);
  else if (role === 'owner') ownerDashboard(store.dashTab);
  else if (role === 'renter') renterDashboard(store.dashTab);
  else if (!store.adminChecked || !store.profileLoaded) app().innerHTML = '<div class="app-loader"><div class="spinner"></div><p>טוען את האזור האישי…</p></div>';
  else completeProfile();
}

// The account exists in Firebase Auth but has no profile in the DB (old broken
// registrations) — let the user finish setup and choose their real role.
function completeProfile() {
  app().innerHTML = `<section class="card auth-shell"><div class="auth-head"><h2>עוד צעד אחד וסיימנו</h2><p>${store.profile?.name ? 'איך תרצו להשתמש באתר?' : 'נשלים את פרטי החשבון כדי לפתוח את האזור האישי המתאים לך'}</p></div>
    <div class="role-grid" id="cp-roles">
      <button class="role-card" data-cp-role="renter"><span class="role-emoji">${ICON.key}</span><b>אני שוכר</b><small>מחפש רכב לשכור</small></button>
      <button class="role-card" data-cp-role="owner"><span class="role-emoji">${ICON.car}</span><b>אני בעל רכב</b><small>רוצה להשכיר רכב ולנהל הזמנות</small></button>
    </div>
    <form id="cp-form" style="display:none"><input type="hidden" name="role"><div class="field"><label>שם מלא</label><input name="name" value="${esc(store.user.displayName || '')}" required></div>${phoneField()}<button class="btn primary block">שמירה וכניסה לאזור האישי</button></form></section>`;
  const hasProfile = Boolean(store.profile?.name);
  const form = document.querySelector('#cp-form');
  document.querySelectorAll('[data-cp-role]').forEach(card => card.onclick = async () => {
    document.querySelectorAll('[data-cp-role]').forEach(x => x.classList.toggle('role-selected', x === card));
    if (hasProfile) {
      // name+phone already saved at signup — one tap sets the role and we're in.
      try { await createOwnProfile({name: store.profile?.name, phone: store.profile?.phone, role: card.dataset.cpRole}); toast('החשבון מוכן!'); }
      catch (error) { toast(error.message); }
      return;
    }
    form.role.value = card.dataset.cpRole;
    form.style.display = '';
  });
  form.onsubmit = async event => {
    event.preventDefault();
    const data = composePhone(formData(event.target));
    if (!['renter', 'owner'].includes(data.role)) return toast('בחרו סוג חשבון');
    const btn = event.submitter; if (btn) btn.disabled = true;
    try { await createOwnProfile({name: data.name, phone: data.phone, role: data.role}); afterAuthDestination(); toast('הפרופיל נשמר!'); }
    catch (error) { toast(error.message); if (btn) btn.disabled = false; }
  };
}

function renterDashboard(tab = 'overview') {
  const bookings = myBookings();
  const verification = store.profile?.verification || {};
  const contents = {
    overview: `<div class="kpis">${kpi('calendar', bookings.filter(b => b.status === 'active').length, 'השכרות פעילות')}${kpi('check', bookings.filter(b => b.status === 'pending').length, 'ממתינות לאישור')}${kpi('car', bookings.filter(b => b.status === 'done').length, 'הושלמו')}${kpi('users', verification.status === 'approved' ? '✓' : verification.status === 'pending' ? 'בבדיקה' : 'ממתין', 'אימות רישיון')}</div><h2>הזמנות אחרונות</h2>${bookingList(bookings, 'renter')}`,
    bookings: `<h2>ההזמנות שלי</h2>${bookingList(bookings, 'renter')}`,
    profile: profileView(),
    messages: messagesView(),
  };
  app().innerHTML = dashboardLayout('האזור האישי', [['overview','סקירה'],['bookings','הזמנות'],['chats','צ׳אטים'],['profile','פרופיל ואימות']], tab, contents[tab] || contents.overview);
  bindDashboardTabs(renterDashboard); bindActions(); bindProfileActions();
}

function ownerDashboard(tab = 'overview') {
  const bookings = myBookings();
  const cars = myCars();
  const total = Object.values(store.payments).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const contents = {
    overview: `<div class="kpis">${kpi('car', cars.length, 'רכבים')}${kpi('check', cars.filter(c => c.status === 'available').length, 'זמינים')}${kpi('calendar', bookings.filter(b => b.status === 'pending').length, 'ממתינות לאישור')}${kpi('money', money(total), 'תשלומים מדווחים')}</div><h2>הזמנות פעילות</h2>${bookingList(bookings.filter(b => ['pending','approved','active'].includes(b.status)), 'owner')}`,
    bookings: `<h2>הזמנות</h2>${bookingList(bookings, 'owner')}`,
    cars: `<div class="section-head"><h2>הרכבים שלי</h2><button class="btn gold" id="add-car">הוספת רכב</button></div>${carGrid(cars, true)}`,
    profile: ownerProfileView(),
  };
  app().innerHTML = dashboardLayout('לוח בעל רכב', [['overview','סקירה'],['bookings','הזמנות'],['cars','רכבים'],['chats','צ׳אטים'],['profile','פרופיל']], tab, contents[tab] || contents.overview, '<button class="btn gold" id="add-car-head">+ הוספת רכב</button>');
  bindDashboardTabs(ownerDashboard); bindActions(); bindCarButtons(); bindProfileActions();
  document.querySelector('#add-car')?.addEventListener('click', () => carForm());
  document.querySelector('#add-car-head')?.addEventListener('click', () => carForm());
}

function adminDashboard(tab = 'overview') {
  // Users needing verification review float to the top (they're the action items), then newest-first.
  const users = list(store.users).map(user => ({...user, verification: {...(user.verification || {}), status: store.verificationStatuses[user.id] || 'missing'}}))
    .sort((a, b) => ((a.verification.status === 'pending' ? 0 : 1) - (b.verification.status === 'pending' ? 0 : 1)) || Number(b.createdAt || 0) - Number(a.createdAt || 0));
  const bookings = myBookings();
  const cars = list(store.cars);
  const total = Object.values(store.payments).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const recentCars = cars.slice().sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 5);
  const recentBookings = bookings.slice().sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 5);
  // "Needs attention" — the items the admin must act on, surfaced at the top of the overview so nothing is missed.
  const pendingVerif = users.filter(u => u.verification?.status === 'pending').length;
  const pendingPay = Object.values(store.payments).filter(p => p && p.status === 'pending').length;
  const pendingBook = bookings.filter(b => b.status === 'pending').length;
  const attnCards = [pendingVerif && ['users', pendingVerif, 'אימותים לבדיקה'], pendingPay && ['bookings', pendingPay, 'תשלומים לאישור'], pendingBook && ['bookings', pendingBook, 'הזמנות ממתינות']].filter(Boolean);
  const attnHtml = `<div class="admin-attention">${attnCards.length ? attnCards.map(([t, n, label]) => `<button class="attn-card" data-attn-tab="${t}"><b>${n}</b><span>${esc(label)}</span></button>`).join('') : '<div class="attn-clear">✓ אין פעולות ממתינות — הכל מטופל</div>'}</div>`;
  const contents = {
    overview: `<div class="panel-head-actions"><h2>סקירה</h2><div class="chips"><button class="btn ${store.config?.maintenance?.on ? 'danger' : 'outline'}" id="maintenance-toggle">${store.config?.maintenance?.on ? 'האתר בתחזוקה — לחצו לפתיחה' : 'מצב תחזוקה'}</button></div></div>
      ${attnHtml}
      <div class="field admin-search-wrap"><input id="admin-search" placeholder="🔎 חיפוש: שם, מייל, טלפון, רכב, בעל רכב, סטטוס…" autocomplete="off"></div><div id="admin-search-results"></div>
      <div class="kpis">${kpi('money', money(total), 'תשלומים מדווחים')}${kpi('calendar', bookings.length, 'הזמנות')}${kpi('car', cars.length, 'רכבים')}${kpi('users', users.length, 'משתמשים')}</div>
      <div class="overview-grid">
        <div class="mini-panel"><div class="mini-panel-head"><h3>רכבים חדשים</h3><span>${recentCars.length} אחרונים</span></div>${recentCars.length ? recentCars.map(c => `<div class="mini-row"><b>${esc(c.make || '')} ${esc(c.model || '')}</b><span class="mut">${money(c.dailyPrice || 0)}/יום</span></div>`).join('') : '<div class="mini-row"><span class="mut">אין רכבים</span></div>'}</div>
        <div class="mini-panel"><div class="mini-panel-head"><h3>הזמנות אחרונות</h3><span>${recentBookings.length} אחרונות</span></div>${recentBookings.length ? recentBookings.map(b => { const c = store.cars[b.carId] || {}; return `<div class="mini-row"><b>${esc(c.make || 'רכב')} ${esc(c.model || '')}</b><span class="mut">${statusLabel(b.status)}</span></div>`; }).join('') : '<div class="mini-row"><span class="mut">אין הזמנות</span></div>'}</div>
      </div>
      <details class="admin-tools"><summary>כלים מתקדמים</summary><div class="admin-tools-grid"><button class="btn outline" id="export-json">ייצוא JSON</button><button class="btn outline" id="legacy-migrate">העברת נתונים ישנים</button><button class="btn outline" id="media-migrate" title="מעביר תמונות רכב ישנות מהמסד לאחסון CDN — מאיץ את טעינת האתר">⚡ האצת טעינה (תמונות)</button></div></details>`,
    users: `<h2 style="margin-bottom:16px">משתמשים ואימותים</h2>${adminUsersTable(users)}`,
    cars: `<h2 style="margin-bottom:16px">רכבים</h2>${adminCarsTable(cars)}`,
    bookings: `<h2 style="margin-bottom:16px">הזמנות</h2>${bookingList(bookings, 'admin')}`,
    notifications: adminNotificationsView(),
    profile: ownerProfileView(),
  };
  const unread = adminUnreadCount();
  app().innerHTML = dashboardLayout('לוח ניהול מנהל', [['overview','סקירה'],['chats','צ׳אטים'],['users','משתמשים'],['cars','רכבים'],['bookings','הזמנות'],['notifications', `התראות${unread ? ` (${unread})` : ''}`]], tab, contents[tab] || contents.overview, '<button class="btn gold" id="admin-add-car">+ הוספת רכב</button>', '<button class="btn dark-out block" id="admin-refresh" title="רענון נתונים">רענון</button><button class="btn dark-out block" id="admin-logout">יציאה</button>');
  document.querySelector('#admin-add-car')?.addEventListener('click', () => carForm());
  document.querySelector('#admin-refresh')?.addEventListener('click', () => window.location.reload());
  document.querySelector('#admin-logout')?.addEventListener('click', async () => { try { await logout(); location.hash = 'home'; } catch (error) { toast(error.message); } });
  bindDashboardTabs(adminDashboard); bindActions(); bindCarButtons(); bindProfileActions();
  document.querySelectorAll('[data-attn-tab]').forEach(btn => btn.onclick = () => { store.dashTab = btn.dataset.attnTab; adminDashboard(btn.dataset.attnTab); });
  document.querySelectorAll('[data-admin-user]').forEach(button => button.onclick = () => adminUserModal(button.dataset.adminUser));
  document.querySelectorAll('[data-admin-rentals]').forEach(button => button.onclick = () => adminUserBookingsModal(button.dataset.adminRentals));
  document.querySelectorAll('[data-user-message]').forEach(button => button.onclick = () => openChatThread(`a:${button.dataset.userMessage}`));
  document.querySelectorAll('[data-user-edit]').forEach(button => button.onclick = async () => {
    const uid = button.dataset.userEdit;
    const user = store.users[uid] || {};
    const name = prompt('שם המשתמש:', user.name || '');
    if (name === null) return;
    const phone = prompt('טלפון:', user.phone || '');
    if (phone === null) return;
    try { await adminAction('user-update', {uid, patch: {name, phone}}); toast('המשתמש עודכן'); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-user-block]').forEach(button => button.onclick = async () => {
    const uid = button.dataset.userBlock;
    const blocked = !store.users[uid]?.blocked;
    if (!confirm(blocked ? 'לחסום את המשתמש? הוא לא יוכל לבצע שום פעולה באתר.' : 'לשחרר את החסימה?')) return;
    try { await adminAction('user-block', {uid, blocked}); toast(blocked ? 'המשתמש נחסם' : 'החסימה הוסרה'); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-user-delete]').forEach(button => button.onclick = async () => {
    const uid = button.dataset.userDelete;
    const user = store.users[uid] || {};
    if (!confirm(`למחוק לצמיתות את ${user.name || user.email || 'המשתמש'}? הפעולה מוחקת את הפרופיל, המסמכים והחשבון.`)) return;
    try { await adminAction('user-delete', {uid}); toast('המשתמש נמחק'); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-car-delete]').forEach(button => button.onclick = async () => {
    if (!confirm('למחוק את הרכב לצמיתות?')) return;
    try { await deleteCar(button.dataset.carDelete); toast('הרכב נמחק'); }
    catch (error) { toast(error.message); }
  });
  document.querySelector('#legacy-migrate')?.addEventListener('click', migratePrompt);
  document.querySelector('#media-migrate')?.addEventListener('click', migrateMediaPrompt);
  document.querySelector('#maintenance-toggle')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const on = !store.config?.maintenance?.on;
    if (!confirm(on ? 'להעביר את האתר למצב תחזוקה? רק מנהלים יוכלו לגלוש.' : 'לפתוח את האתר לכולם? כל המבקרים יחזרו לגלישה רגילה.')) return;
    button.disabled = true;
    try { await setMaintenance(on); toast(on ? 'האתר עבר למצב תחזוקה' : 'האתר חזר למצב רגיל — פתוח לכולם'); }
    catch (error) { toast('לא ניתן לעדכן את מצב התחזוקה — יש לפרסם את חוקי ה-Firebase המעודכנים'); button.disabled = false; }
  });
  bindAdminSearch();
  if (tab === 'notifications') {
    localStorage.setItem('cd-admin-seen', String(Date.now()));
    document.querySelectorAll('[data-notif-thread]').forEach(row => {
      const go = () => openChatThread(row.dataset.notifThread);
      row.onclick = go;
      row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(); } };
    });
  }
  if (tab === 'cars') bindAdminCarActions();
  if (tab === 'bookings') bindAdminBookingActions();
  document.querySelector('#export-json')?.addEventListener('click', () => {
    const payload = {exportedAt: new Date().toISOString(), users: store.users, cars: store.cars, bookings: store.bookings, payments: store.payments};
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `crowndrive-export-${Date.now()}.json`; anchor.click();
    URL.revokeObjectURL(url);
  });
}

function adminUsersTable(users) {
  if (!users.length) return '<div class="empty">אין משתמשים</div>';
  const rentalCount = uid => myBookings().filter(b => b.renterUid === uid || b.ownerUid === uid).length;
  return `<div class="admin-cards">${users.map(user => {
    const count = rentalCount(user.id);
    const initial = esc(String(user.name || user.email || '?').trim().charAt(0) || '?');
    const vs = user.verification?.status;
    return `<div class="auc${user.blocked ? ' auc-blocked' : ''}">
      <div class="auc-head">
        <span class="auc-ava" aria-hidden="true">${initial}</span>
        <div class="auc-id"><b class="auc-name">${esc(user.name || '—')}${user.blocked ? ' <span class="pill warn">חסום</span>' : ''}</b><span class="auc-role">${esc(roleName(user.role))} · ${count} השכרות</span></div>
        <span class="pill ${vs === 'approved' ? 'ok' : 'warn'}">${esc(verificationLabel(vs))}</span>
      </div>
      <div class="auc-contact"><span><span class="lab">מייל</span>${esc(user.email || '—')}</span><span><span class="lab">טלפון</span>${esc(user.phone || '—')}</span></div>
      <div class="auc-actions">
        <button class="btn outline" data-admin-user="${esc(user.id)}">מסמכים</button>
        <button class="btn outline" data-admin-rentals="${esc(user.id)}">${count} השכרות</button>
        <span class="auc-icons"><button class="icon-btn" title="שליחת הודעה" data-user-message="${esc(user.id)}">${ICON.chat}</button><button class="icon-btn" title="עריכה" data-user-edit="${esc(user.id)}">${ICON.edit}</button><button class="icon-btn ${user.blocked ? '' : 'danger'}" title="${user.blocked ? 'שחרור חסימה' : 'חסימה'}" data-user-block="${esc(user.id)}">${user.blocked ? ICON.check : ICON.block}</button><button class="icon-btn danger" title="מחיקה" data-user-delete="${esc(user.id)}">${ICON.trash}</button></span>
      </div>
    </div>`;
  }).join('')}</div>`;
}

// Admin notifications feed (new car / booking / status / payment / chat / block).
const NOTIF_ICONS = {car: ICON.car, booking: ICON.calendar, status: ICON.check, payment: ICON.money, chat: ICON.chat, block: ICON.block, user: ICON.users};
function adminUnreadCount() {
  const seen = Number(localStorage.getItem('cd-admin-seen') || 0);
  return list(store.adminNotifications).filter(n => Number(n.createdAt || 0) > seen).length;
}
// A notification that concerns a conversation links straight to it: a support-chat message opens that
// user's support thread; a booking event opens that booking's chat.
function notifThread(n) {
  if (n.type === 'chat' && n.meta?.userUid) return `a:${n.meta.userUid}`;
  if (n.meta?.bookingId && ['status', 'payment', 'booking'].includes(n.type)) return `b:${n.meta.bookingId}`;
  return '';
}
function adminNotificationsView() {
  const rows = list(store.adminNotifications).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  const seen = Number(localStorage.getItem('cd-admin-seen') || 0);
  return `<h2 style="margin-bottom:16px">התראות מנהל</h2><div class="list">${rows.length ? rows.map(n => {
    const thread = notifThread(n);
    return `<div class="notif-row ${Number(n.createdAt || 0) > seen ? 'unread' : ''}${thread ? ' clickable' : ''}"${thread ? ` role="button" tabindex="0" data-notif-thread="${esc(thread)}"` : ''}><span class="notif-icon">${NOTIF_ICONS[n.type] || ICON.check}</span><div class="notif-main"><b>${esc(n.text || '')}</b><small>${fmtDate(n.createdAt)}</small></div>${thread ? `<span class="notif-go">${n.type === 'chat' ? 'לצ׳אט' : 'לשיחה'} ←</span>` : ''}</div>`;
  }).join('') : '<div class="empty">אין התראות עדיין — כל אירוע באתר יופיע כאן</div>'}</div>`;
}

// Admin global search: users, cars and bookings by any field.
function bindAdminSearch() {
  const input = document.querySelector('#admin-search');
  const box = document.querySelector('#admin-search-results');
  if (!input || !box) return;
  input.oninput = () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { box.innerHTML = ''; return; }
    const users = list(store.users).filter(u => `${u.name || ''} ${u.email || ''} ${u.phone || ''}`.toLowerCase().includes(q)).slice(0, 6);
    const cars = list(store.cars).filter(c => `${c.make || ''} ${c.model || ''} ${c.ownerName || ''} ${c.area || ''}`.toLowerCase().includes(q)).slice(0, 6);
    const bookings = myBookings().filter(b => {
      const car = store.cars[b.carId] || {};
      const renter = store.users[b.renterUid] || {};
      return `${car.make || ''} ${car.model || ''} ${renter.name || ''} ${renter.email || ''} ${b.status || ''} ${statusLabel(b.status)} ${b.id}`.toLowerCase().includes(q);
    }).slice(0, 6);
    box.innerHTML = (users.length + cars.length + bookings.length) ? `
      ${users.length ? `<p class="search-group">משתמשים</p>${users.map(u => `<button class="search-hit" data-hit-user="${esc(u.id)}">👤 ${esc(u.name || '—')} · ${esc(u.email || '')} · ${esc(u.phone || '')}</button>`).join('')}` : ''}
      ${cars.length ? `<p class="search-group">רכבים</p>${cars.map(c => `<button class="search-hit" data-hit-car="${esc(c.id)}">🚗 ${esc(c.make || '')} ${esc(c.model || '')} · ${esc(c.ownerName || '')} · ${carStatusPill(c.status)}</button>`).join('')}` : ''}
      ${bookings.length ? `<p class="search-group">הזמנות</p>${bookings.map(b => { const car = store.cars[b.carId] || {}; return `<button class="search-hit" data-hit-booking="${esc(b.renterUid)}">📅 ${esc(car.make || 'רכב')} ${esc(car.model || '')} · ${fmtDate(b.startAt)} · ${statusLabel(b.status)}</button>`; }).join('')}` : ''}
    ` : '<div class="empty">לא נמצאו תוצאות</div>';
    box.querySelectorAll('[data-hit-user]').forEach(b => b.onclick = () => adminUserModal(b.dataset.hitUser));
    box.querySelectorAll('[data-hit-car]').forEach(b => b.onclick = () => { const car = {id: b.dataset.hitCar, ...store.cars[b.dataset.hitCar]}; carForm(car); });
    box.querySelectorAll('[data-hit-booking]').forEach(b => b.onclick = () => adminUserBookingsModal(b.dataset.hitBooking));
  };
}

function bindAdminCarActions() {
  document.querySelectorAll('[data-car-edit]').forEach(button => button.onclick = () => carForm({id: button.dataset.carEdit, ...store.cars[button.dataset.carEdit]}));
  document.querySelectorAll('[data-car-toggle]').forEach(button => button.onclick = async () => {
    const id = button.dataset.carToggle;
    const next = (store.cars[id]?.status === 'hidden') ? 'available' : 'hidden';
    try { await setCarStatus(id, next); toast(next === 'hidden' ? 'הרכב הוסתר' : 'הרכב חזר לתצוגה'); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-car-avail]').forEach(button => button.onclick = async () => {
    try { await setCarStatus(button.dataset.carAvail, button.dataset.next); toast(button.dataset.next === 'rented' ? 'הרכב סומן כתפוס' : 'הרכב סומן כפנוי'); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-car-feature]').forEach(button => button.onclick = async () => {
    try { await setCarFeatured(button.dataset.carFeature, button.dataset.on === '1'); toast(button.dataset.on === '1' ? 'הרכב קודם לראש הרשימה' : 'הקידום בוטל'); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-car-owner]').forEach(button => button.onclick = async () => {
    const email = prompt('מייל של בעל הרכב החדש:');
    if (!email) return;
    const target = list(store.users).find(u => (u.email || '').toLowerCase() === email.trim().toLowerCase());
    if (!target) return toast('לא נמצא משתמש עם המייל הזה');
    try { await adminAction('car-owner', {carId: button.dataset.carOwner, uid: target.id}); toast(`הבעלות הועברה ל${target.name || email}`); }
    catch (error) { toast(error.message); }
  });
}

function bindAdminBookingActions() {
  document.querySelectorAll('[data-admin-status]').forEach(select => select.onchange = async () => {
    if (!select.value) return;
    // Confirm the destructive changes; reset the dropdown if the admin backs out.
    if ((select.value === 'cancelled' || select.value === 'rejected') && !confirm(select.value === 'cancelled' ? 'לבטל את ההזמנה?' : 'לדחות את ההזמנה?')) { select.value = ''; return; }
    try { await setBookingStatus(select.dataset.adminStatus, select.value); toast('הסטטוס עודכן'); }
    catch (error) { toast(error.message); select.value = ''; }
  });
  document.querySelectorAll('[data-admin-note]').forEach(button => button.onclick = async () => {
    const id = button.dataset.adminNote;
    const booking = store.bookings[id] || {};
    const note = prompt('הערת מנהל להזמנה:', booking.adminNote || '');
    if (note === null) return;
    const amount = prompt('סכום מתוקן (רשות, מספר בלבד):', booking.adminAmount ?? '');
    try { await adminAction('booking-admin', {bookingId: id, note, ...(amount !== null && amount !== '' ? {amount: Number(amount)} : {})}); toast('ההזמנה עודכנה'); }
    catch (error) { toast(error.message); }
  });
}

// Admin info center: every rental of one user — car + photos, exact times, parties, payment proof.
function adminUserBookingsModal(uid) {
  const user = store.users[uid] || {};
  const rows = myBookings().filter(b => b.renterUid === uid || b.ownerUid === uid).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  modal(`<div class="modal-head"><h2>השכרות · ${esc(user.name || user.email || 'משתמש')}</h2><button class="close" data-close-modal>×</button></div>${rows.length ? rows.map(booking => {
    const car = store.cars[booking.carId] || {};
    const renter = store.users[booking.renterUid] || {};
    const owner = store.users[booking.ownerUid] || {};
    const payment = store.payments[booking.id];
    return `<div class="rental-row"><img class="rental-car-img" src="${esc(carImage(car))}" alt="${esc(car.make || 'רכב')}"><div class="rental-info"><b>${esc(car.make || 'רכב')} ${esc(car.model || '')} ${esc(car.year || '')}</b><small>🕑 ${fmtDate(booking.startAt)} ← ${fmtDate(booking.endAt)}</small><small>שוכר: ${esc(renter.name || '—')} · בעל רכב: ${esc(owner.name || '—')}</small><div class="chips">${payment ? `<span class="pill ok">שולם ${money(payment.amount)}</span><button class="btn outline" data-proof="${esc(payment.mediaPath)}">אישור תשלום</button>` : '<span class="pill warn">אין הוכחת תשלום</span>'}${booking.handover || booking.evidence ? `<button class="btn outline" data-view-handover="${esc(booking.id)}">תיעוד הרכב</button>` : ''}<button class="btn outline" data-chat="${esc(booking.id)}">צ׳אט ההזמנה</button></div></div><span class="status-badge ${esc(booking.status)}">${statusLabel(booking.status)}</span></div>`;
  }).join('') : '<div class="empty">אין השכרות למשתמש זה</div>'}`);
  const root = document.querySelector('#modal-root');
  root.querySelectorAll('.rental-car-img').forEach(img => img.addEventListener('error', () => { img.src = fallbackImage; }, {once: true}));
  root.querySelectorAll('[data-proof]').forEach(button => button.onclick = async () => {
    try { window.open(await signedRead(button.dataset.proof), '_blank', 'noopener'); }
    catch (error) { toast(error.message); }
  });
  root.querySelectorAll('[data-view-handover]').forEach(button => button.onclick = () => viewHandoverModal(button.dataset.viewHandover));
  root.querySelectorAll('[data-chat]').forEach(button => button.onclick = () => { closeModal(); openChatThread(`b:${button.dataset.chat}`); });
}
function adminCarsTable(cars) {
  if (!cars.length) return '<div class="empty">אין רכבים</div>';
  return `<div class="table-wrap"><table class="data"><thead><tr><th>רכב</th><th>בעל הרכב</th><th>מחיר/יום</th><th>סטטוס (לחצו)</th><th>ניהול</th></tr></thead><tbody>${featuredFirst(cars).map(car => `<tr><td class="t-main">${car.featured ? '★ ' : ''}${esc(car.make || '')} ${esc(car.model || '')} ${esc(car.year || '')}</td><td>${esc(car.ownerName || '—')}</td><td>${money(car.dailyPrice || 0)}</td><td><button type="button" class="pill-btn" data-car-avail="${esc(car.id)}" data-next="${car.status === 'rented' ? 'available' : 'rented'}" title="לחצו לשינוי תפוס / פנוי">${carStatusPill(car.status)}</button></td><td><div class="t-actions"><button class="icon-btn feat-btn ${car.featured ? 'feat-on' : ''}" title="${car.featured ? 'ביטול קידום לראש הרשימה' : 'קידום לראש הרשימה'}" data-car-feature="${esc(car.id)}" data-on="${car.featured ? '' : '1'}">★</button><button class="icon-btn" title="עריכת רכב" data-car-edit="${esc(car.id)}">${ICON.edit}</button><button class="icon-btn" title="${car.status === 'hidden' ? 'הצגת הרכב' : 'הסתרת הרכב'}" data-car-toggle="${esc(car.id)}">${ICON.eye}</button><button class="icon-btn danger" title="מחיקה" data-car-delete="${esc(car.id)}">${ICON.trash}</button></div></td></tr>`).join('')}</tbody></table></div>`;
}

function bookingList(bookings, role) {
  const sorted = bookings.slice().sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return `<div class="list">${sorted.length ? sorted.map(booking => {
    const car = store.cars[booking.carId] || {};
    const ratingButtons = booking.status === 'done' ? (role === 'renter' ? `<button class="btn outline" data-rate="${booking.id}" data-rate-type="car">דרג רכב</button><button class="btn outline" data-rate="${booking.id}" data-rate-type="user">דרג בעל רכב</button>` : role === 'owner' ? `<button class="btn outline" data-rate="${booking.id}" data-rate-type="user">דרג שוכר</button>` : '') : '';
    const evidence = booking.evidence || {};
    const pmt = store.payments[booking.id];
    const evidenceDone = evidence.video && evidence.fuel && evidence.odometer && paymentApproved(pmt);
    const paymentSection = ['owner', 'admin'].includes(role) && pmt
      ? `${pmt.status === 'approved' ? '<span class="pill ok">תשלום אושר</span>' : pmt.status === 'rejected' ? '<span class="pill warn">תשלום נדחה</span>' : pmt.status === 'pending' ? '<span class="pill warn">ממתין לאישור</span>' : ''}<button class="btn outline" data-view-payment="${booking.id}">הוכחת תשלום</button>${pmt.status === 'pending' ? `<button class="btn primary" data-pay-approve="${booking.id}">אישור תשלום</button><button class="btn danger" data-pay-reject="${booking.id}">דחייה</button>` : ''}`
      : '';
    const renterPaymentNote = role === 'renter' && pmt ? `<p class="ev-note">${pmt.status === 'approved' ? '✓ התשלום שלך אושר על ידי בעל הרכב.' : pmt.status === 'rejected' ? '✗ התשלום נדחה — שלחו הוכחה מעודכנת בצ׳אט.' : '⏳ הוכחת התשלום ממתינה לאישור בעל הרכב.'}</p>` : '';
    return `<article class="booking-card"><div class="booking-main"><div><small>הזמנה ${esc(booking.id.slice(-7))}</small><h3>${esc(car.make || '')} ${esc(car.model || '')}</h3><p>${fmtDate(booking.startAt)} — ${fmtDate(booking.endAt)}</p></div><span class="status-badge ${esc(booking.status)}">${statusLabel(booking.status)}</span></div><div class="chips">${role === 'owner' && booking.status === 'pending' ? `<button class="btn primary" data-status="approved" data-booking="${booking.id}">אישור</button><button class="btn danger" data-status="rejected" data-booking="${booking.id}">דחייה</button>` : ''}${role === 'owner' && booking.status === 'approved' ? `<button class="btn gold ${evidenceDone ? '' : 'soft-disabled'}" data-status="active" data-booking="${booking.id}">התחלת השכרה</button>` : ''}${role === 'owner' && booking.status === 'active' ? `<button class="btn gold" data-status="done" data-booking="${booking.id}">סיום השכרה</button>` : ''}${role === 'owner' && ['pending','approved','active'].includes(booking.status) ? `<button class="btn outline" data-renter="${booking.renterUid}">פרטי שוכר</button>` : ''}${['approved','active'].includes(booking.status) ? `<button class="btn outline" data-address="${booking.id}">כתובת איסוף</button>` : ''}${['pending','approved','active'].includes(booking.status) ? `<button class="btn outline" data-chat="${booking.id}">צ׳אט</button>` : ''}${role === 'renter' && booking.status === 'active' ? `<button class="btn outline" data-handover="${booking.id}" data-stage="return">תיעוד החזרה</button>` : ''}${paymentSection}${['owner','admin'].includes(role) && booking.handover ? `<button class="btn outline" data-view-handover="${booking.id}">צפייה בתיעוד</button>` : ''}${role === 'admin' ? `<select class="admin-status-select" data-admin-status="${booking.id}"><option value="">שינוי סטטוס…</option><option value="approved">אישור</option><option value="rejected">דחייה</option><option value="active">התחלת השכרה</option><option value="done">סיום</option><option value="cancelled">ביטול</option></select><button class="btn outline" data-admin-note="${booking.id}">הערת מנהל</button>` : ''}${['renter', 'owner'].includes(role) && ['pending', 'approved'].includes(booking.status) ? `<button class="btn outline" data-cancel-booking="${booking.id}">ביטול הזמנה</button>` : ''}${ratingButtons}</div>${booking.adminNote || booking.adminAmount !== undefined ? `<p class="ev-note">הערת מנהל: ${esc(booking.adminNote || '')}${booking.adminAmount !== undefined ? ` · סכום מתוקן: ${money(booking.adminAmount)}` : ''}</p>` : ''}${renterPaymentNote}${role === 'renter' && booking.status === 'approved' ? `<p class="ev-note">לפני תחילת ההשכרה שלחו בצ׳אט: סרטון חוץ, תמונת דלק, קילומטראז׳ והוכחת תשלום.</p>` : ''}</article>`;
  }).join('') : emptyState(ICON.calendar, role === 'renter' ? 'אין לך הזמנות עדיין' : 'אין הזמנות עדיין', role === 'renter' ? 'מצאו רכב מהצי שלנו והזמינו — זה מהיר ופשוט.' : 'כשתתקבל בקשת הזמנה היא תופיע כאן.', role === 'renter' ? '<button class="btn primary" data-route="cars">חיפוש רכב</button>' : '')}</div>`;
}

function bindActions() {
  document.querySelectorAll('[data-status]').forEach(button => button.onclick = async () => {
    const status = button.dataset.status;
    // Confirm the significant/irreversible transitions (reject denies the renter; done ends the rental) — the
    // forward steps (approve/start) don't need it. Also disable during the call so a double-click can't double-submit.
    if (status === 'rejected' && !confirm('לדחות את ההזמנה? השוכר יקבל הודעה שהבקשה נדחתה.')) return;
    if (status === 'done' && !confirm('לסיים את ההשכרה?')) return;
    button.disabled = true;
    try { await setBookingStatus(button.dataset.booking, status); toast('ההזמנה עודכנה'); }
    catch (error) { toast(error.message); button.disabled = false; }
  });
  // audit #19: renter/owner can cancel a pending/approved booking themselves (with confirmation).
  document.querySelectorAll('[data-cancel-booking]').forEach(button => button.onclick = async () => {
    if (!confirm('לבטל את ההזמנה?')) return;
    button.disabled = true;
    try { await setBookingStatus(button.dataset.cancelBooking, 'cancelled'); toast('ההזמנה בוטלה'); }
    catch (error) { toast(error.message); button.disabled = false; }
  });
  document.querySelectorAll('[data-chat]').forEach(button => button.onclick = () => openChatThread(`b:${button.dataset.chat}`));
  document.querySelectorAll('[data-payment]').forEach(button => button.onclick = () => paymentModal(button.dataset.payment));
  document.querySelectorAll('[data-renter]').forEach(button => button.onclick = () => ownerRenterModal(button.dataset.renter));
  document.querySelectorAll('[data-handover]').forEach(button => button.onclick = () => handoverModal(button.dataset.handover, button.dataset.stage));
  document.querySelectorAll('[data-view-payment]').forEach(button => button.onclick = () => viewPaymentModal(button.dataset.viewPayment));
  document.querySelectorAll('[data-pay-approve]').forEach(button => button.onclick = async () => {
    if (!confirm('לאשר את הוכחת התשלום? לאחר האישור אפשר יהיה להתחיל את ההשכרה.')) return;
    try { await api('booking-action', {action: 'payment-review', bookingId: button.dataset.payApprove, decision: 'approved'}); toast('התשלום אושר'); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-pay-reject]').forEach(button => button.onclick = async () => {
    if (!confirm('לדחות את הוכחת התשלום? השוכר יתבקש לשלוח הוכחה מעודכנת.')) return;
    try { await api('booking-action', {action: 'payment-review', bookingId: button.dataset.payReject, decision: 'rejected'}); toast('התשלום נדחה'); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-view-handover]').forEach(button => button.onclick = () => viewHandoverModal(button.dataset.viewHandover));
  document.querySelectorAll('[data-address]').forEach(button => button.onclick = () => addressModal(button.dataset.address));
  document.querySelectorAll('[data-rate]').forEach(button => button.onclick = () => ratingModal(button.dataset.rate, button.dataset.rateType));
}

function profileView() {
  const profile = store.profile || {};
  const verification = profile.verification || {};
  const done = verification.licenseFront && verification.licenseBack && verification.selfie;
  const approved = verification.status === 'approved';
  const cardSvg = '<svg viewBox="0 0 96 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="92" height="60" rx="8" fill="#EDF2F7" stroke="#3F6B8E" stroke-width="2.5"/><rect x="10" y="12" width="26" height="26" rx="4" fill="#C9D8E5"/><circle cx="23" cy="21" r="5" fill="#3F6B8E"/><path d="M14 36c2-6 6-8 9-8s7 2 9 8" fill="#3F6B8E"/><rect x="44" y="14" width="42" height="5" rx="2.5" fill="#9FB6C9"/><rect x="44" y="24" width="34" height="5" rx="2.5" fill="#C9D8E5"/><rect x="44" y="34" width="38" height="5" rx="2.5" fill="#C9D8E5"/><rect x="10" y="48" width="76" height="5" rx="2.5" fill="#9FB6C9"/></svg>';
  const verLocked = done && !['needs_resubmission', 'rejected'].includes(verification.status);
  return `<div class="section-head"><h2>פרופיל ואימות</h2><span class="status-badge ${approved ? 'approved' : 'pending'}">${esc(verificationLabel(verification.status))}</span></div>
    <div class="avatar-row"><button type="button" class="avatar-click" id="avatar-open" title="החלפת תמונת פרופיל">${avatarHtml(profile, 116)}<span class="avatar-cam">${ICON.camera}</span></button><input hidden type="file" accept="image/*" id="avatar-file"><div class="avatar-actions"><b>תמונת פרופיל</b><button type="button" class="btn outline" id="avatar-open2">בחירת תמונה מהגלריה</button></div></div><form id="profile-form" class="card inset"><div class="form-grid"><div class="field"><label>שם מלא</label><input name="name" value="${esc(profile.name || '')}" disabled required></div><div class="field"><label>טלפון</label><input name="phone" value="${esc(profile.phone || '')}" disabled></div><div class="field"><label>תאריך לידה</label><input name="birthDate" type="date" value="${esc(profile.birthDate || '')}" disabled required></div><div class="field"><label>מייל 🔒</label><input value="${esc(profile.email || store.user?.email || '')}" disabled data-locked></div></div><button type="button" class="btn outline block" id="profile-edit">עריכה</button><button class="btn primary block" id="profile-save" style="display:none">שמירת שינויים</button></form>
    ${verLocked
      ? `<div class="ver-card ver-locked ${approved ? 'ver-ok' : ''}"><span class="ver-illustration">${cardSvg}</span><span class="ver-main"><b>אימות רישיון נהיגה</b><small>${approved ? 'האימות אושר ונעול 🔒 — אפשר להזמין רכבים' : 'המסמכים נשלחו ונעולים 🔒 · בבדיקת מנהל'}</small></span><span class="ver-arrow">${approved ? '✓' : '🔒'}</span></div>`
      : `<button type="button" class="ver-card" id="ver-wizard"><span class="ver-illustration">${cardSvg}</span><span class="ver-main"><b>אימות רישיון נהיגה</b><small>${verification.status === 'needs_resubmission' ? 'המנהל ביקש צילום מחדש — לחצו להעלאה' : 'צלמו רישיון (2 צדדים) וסלפי — לוקח דקה'}</small></span><span class="ver-arrow">←</span></button>`}
    ${verification.reviewNote ? `<p class="ev-note">הערת מנהל: ${esc(verification.reviewNote)}</p>` : ''}<button type="button" class="btn outline block" id="logout-profile">יציאה מהחשבון</button>`;
}
function ownerProfileView() {
  const profile = store.profile || {};
  return `<h2>פרופיל</h2><div class="avatar-row"><button type="button" class="avatar-click" id="avatar-open" title="החלפת תמונת פרופיל">${avatarHtml(profile, 116)}<span class="avatar-cam">${ICON.camera}</span></button><input hidden type="file" accept="image/*" id="avatar-file"><div class="avatar-actions"><b>תמונת פרופיל</b><button type="button" class="btn outline" id="avatar-open2">בחירת תמונה מהגלריה</button></div></div><form id="profile-form" class="card inset"><div class="form-grid"><div class="field"><label>שם מלא</label><input name="name" value="${esc(profile.name || '')}" disabled required></div><div class="field"><label>טלפון</label><input name="phone" value="${esc(profile.phone || '')}" disabled></div><div class="field"><label>מייל 🔒</label><input value="${esc(profile.email || store.user?.email || '')}" disabled data-locked></div></div><button type="button" class="btn outline block" id="profile-edit">עריכה</button><button class="btn primary block" id="profile-save" style="display:none">שמירת שינויים</button></form><button type="button" class="btn outline block" id="logout-profile">יציאה מהחשבון</button>`;
}
function bindProfileActions() {
  const form = document.querySelector('#profile-form');
  if (form && document.querySelector('#profile-edit')) {
    document.querySelector('#profile-edit').onclick = () => {
      form.querySelectorAll('input, select').forEach(el => { if (!el.hasAttribute('data-locked')) el.disabled = false; });
      document.querySelector('#profile-edit').style.display = 'none';
      document.querySelector('#profile-save').style.display = '';
    };
  }
  document.querySelector('#profile-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    try { await saveUser(formData(event.target)); toast('הפרטים נשמרו'); }
    catch (error) { toast(error.message); }
  });
  document.querySelector('#ver-wizard')?.addEventListener('click', () => verificationWizard());
  document.querySelector('#logout-profile')?.addEventListener('click', async () => {
    try { await logout(); location.hash = 'home'; toast('יצאת מהחשבון'); }
    catch (error) { toast(error.message); }
  });
  document.querySelector('#avatar-file')?.addEventListener('change', event => {
    const file = event.target.files[0];
    if (file) avatarCropper(file);
    event.target.value = '';
  });
  const openAvatarPicker = () => document.querySelector('#avatar-file')?.click();
  document.querySelector('#avatar-open')?.addEventListener('click', openAvatarPicker);
  document.querySelector('#avatar-open2')?.addEventListener('click', openAvatarPicker);
}

// Round avatar cropper: drag to position, slider to zoom, canvas-crop, upload.
function avatarCropper(file) {
  const objectUrl = URL.createObjectURL(file);
  const source = new Image();
  source.onload = () => {
    const V = Math.min(280, Math.floor(window.innerWidth * 0.72));
    modal(`<div class="modal-head"><h2>מיקום התמונה בעיגול</h2><button class="close" data-close-modal>×</button></div>
      <div class="crop-stage"><div class="crop-viewport" id="crop-vp" style="width:${V}px;height:${V}px"><img id="crop-img" src="${objectUrl}" alt="" draggable="false"></div></div>
      <div class="crop-zoom-row"><span>−</span><input type="range" id="crop-zoom" min="100" max="320" value="100"><span>+</span></div>
      <p class="mut crop-hint">גררו את התמונה למיקום · הסליידר מגדיל ומקטין</p>
      <button class="btn primary block" id="crop-save">שמירת תמונת פרופיל</button>`);
    const vp = document.querySelector('#crop-vp');
    const el = document.querySelector('#crop-img');
    const iw = source.naturalWidth, ih = source.naturalHeight;
    const base = V / Math.min(iw, ih);
    let zoom = 1, x = 0, y = 0;
    const apply = () => {
      const s = base * zoom;
      x = Math.min(0, Math.max(V - iw * s, x));
      y = Math.min(0, Math.max(V - ih * s, y));
      el.style.width = `${iw * s}px`;
      el.style.transform = `translate(${x}px, ${y}px)`;
    };
    x = (V - iw * base) / 2; y = (V - ih * base) / 2; apply();
    let drag = null;
    vp.onpointerdown = event => { drag = {px: event.clientX, py: event.clientY, ox: x, oy: y}; vp.setPointerCapture(event.pointerId); };
    vp.onpointermove = event => { if (!drag) return; x = drag.ox + (event.clientX - drag.px); y = drag.oy + (event.clientY - drag.py); apply(); };
    vp.onpointerup = vp.onpointercancel = () => { drag = null; };
    document.querySelector('#crop-zoom').oninput = event => {
      const next = Number(event.target.value) / 100;
      const s0 = base * zoom, s1 = base * next;
      x = V / 2 - ((V / 2 - x) / s0) * s1;
      y = V / 2 - ((V / 2 - y) / s0) * s1;
      zoom = next; apply();
    };
    document.querySelector('#crop-save').onclick = async () => {
      const button = document.querySelector('#crop-save');
      button.disabled = true; button.textContent = 'שומר…';
      try {
        const OUT = 512, k = OUT / V, s = base * zoom;
        const canvas = document.createElement('canvas');
        canvas.width = OUT; canvas.height = OUT;
        canvas.getContext('2d').drawImage(source, x * k, y * k, iw * s * k, ih * s * k);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
        const publicUrl = await uploadPublicMedia(new File([blob], 'avatar.jpg', {type: 'image/jpeg'}), 'avatar');
        await setOwnPhoto(publicUrl);
        URL.revokeObjectURL(objectUrl);
        closeModal(); toast('תמונת הפרופיל עודכנה ✓');
      } catch (error) { toast(error.message); button.disabled = false; button.textContent = 'שמירת תמונת פרופיל'; }
    };
  };
  source.src = objectUrl;
}

// Step-by-step license verification: front → back → selfie, each via gallery or camera.
const WIZARD_STEPS = [
  {key: 'licenseFront', title: 'צד קדמי של הרישיון', hint: 'צלמו את החזית של רישיון הנהיגה — ודאו שהפרטים קריאים', facing: 'environment', emoji: ICON.id},
  {key: 'licenseBack', title: 'צד אחורי של הרישיון', hint: 'עכשיו הפכו את הרישיון וצלמו את הצד השני', facing: 'environment', emoji: ICON.rotate},
  {key: 'selfie', title: 'סלפי לאימות', hint: 'צלמו סלפי ברור — כדי לוודא שהרישיון באמת שלכם', facing: 'user', emoji: ICON.selfie},
];
function verificationWizard() {
  const verification = store.profile?.verification || {};
  const stepIndex = WIZARD_STEPS.findIndex(step => !verification[step.key]);
  if (stepIndex === -1) {
    modal(`<div class="modal-head"><h2>אימות רישיון</h2><button class="close" data-close-modal>×</button></div><div class="wizard-done"><span class="wiz-ic ok-ic">${ICON.check}</span><h3>כל המסמכים נשלחו!</h3><p>הפרטים הועברו למנהל האתר לבדיקה. תקבלו אישור באזור האישי.</p><button class="btn primary block" data-close-modal>סגירה</button></div>`);
    return;
  }
  const step = WIZARD_STEPS[stepIndex];
  modal(`<div class="modal-head"><h2>אימות רישיון · שלב ${stepIndex + 1} מתוך 3</h2><button class="close" data-close-modal>×</button></div>
    <div class="steps-bar">${WIZARD_STEPS.map((s, i) => `<span class="sb ${i <= stepIndex ? 'on' : ''}"></span>`).join('')}</div>
    <div class="wizard-step"><span class="wizard-emoji">${step.emoji}</span><h3>${step.title}</h3><p>${step.hint}</p>
      <div class="wizard-actions">
        <label class="wizard-btn">${ICON.image}<b>מהגלריה</b><input hidden type="file" accept="image/*" id="wiz-file"></label>
        <button type="button" class="wizard-btn" id="wiz-camera">${ICON.camera}<b>מצלמה</b></button>
      </div>
      <p class="mut wizard-note" id="wiz-note"></p>
    </div>`);
  const advance = async file => {
    const note = document.querySelector('#wiz-note');
    try {
      if (note) note.textContent = 'מעלה…';
      await uploadDocument(step.key, file);
      store.profile.verification = {...(store.profile.verification || {}), [step.key]: true};
      verificationWizard();
    } catch (error) { toast(error.message); if (note) note.textContent = error.message; }
  };
  document.querySelector('#wiz-file').onchange = event => { if (event.target.files[0]) advance(event.target.files[0]); };
  document.querySelector('#wiz-camera').onclick = async () => {
    try { advance(await capturePhoto({facingMode: step.facing, title: step.title})); }
    catch (error) { if (error.message !== 'הצילום בוטל') toast(error.message); }
  };
}
async function uploadDocument(type, file) {
  try {
    const path = await uploadPrivate(file, 'user-document', type);
    await registerDocument(type, path);
    toast('המסמך נשמר לבדיקה');
  } catch (error) { toast(error.message); throw error; }  // audit #7: RETHROW so the wizard never advances on a failed upload
}

function messagesView() {
  return `<h2>מרכז הודעות</h2><p class="mut">כל השיחות מרוכזות בעמוד הצ׳אטים — כמו אפליקציית הודעות.</p><button class="btn primary" data-route="chats">מעבר לצ׳אטים</button>`;
}

// ---------- Chats page: app-like messaging (thread list + conversation) ----------
const chatState = {thread: null, unsub: null, draft: ''};
let pendingThread = null;
let adminChatActivity = null;
let adminUnread = {};   // uid -> true when the thread's last message is from the USER (awaiting the admin)
let adminReadAt = {};   // uid -> ts the admin last opened the thread; clears the green "unread" dot

// A thread shows the green unread light only if the server says its last message isn't from the admin
// AND that message is newer than the last time the admin opened it (so reading a thread clears the dot,
// and it re-lights only when a genuinely newer message arrives).
const adminThreadUnread = id => !!adminUnread[id] && (adminChatActivity?.[id] || 0) > (adminReadAt[id] || 0);

export function openChatThread(threadKey) {
  pendingThread = threadKey;
  if (store.route === 'chats') chatsPage();
  else location.hash = 'chats';
}

// Open the support chat for ANYONE — a registered user uses their account; an unregistered visitor is
// signed in as a guest (anonymous) so they can message support and see replies without signing up.
export async function openSupportChat() {
  try {
    let user = store.user;
    if (!user) user = await signInGuest();
    closeModal();
    openChatThread(`a:${user.uid}`);
  } catch (error) {
    closeModal();
    toast('פתיחת הצ׳אט נכשלה — אפשר להתחבר ולנסות שוב');
    location.hash = 'auth';
  }
}

// Open (or reuse) a DIRECT renter↔owner conversation about a car. A guest / logged-out visitor is asked to
// sign in first (inquiries are between real accounts and owners — the server rejects anonymous users).
export async function openOwnerInquiry(carId) {
  if (!store.user || store.user.isAnonymous) {
    saveAuthReturn({carId});  // come back to this car after signing in
    closeModal();
    toast('התחברו עם חשבון כדי לפנות לבעל הרכב');
    location.hash = 'auth';
    return;
  }
  try {
    const inquiryId = await startInquiry(carId);
    // Seed the thread locally so it opens INSTANTLY — the real-time `inquiries` listener fires a moment
    // later and refreshes it. Without this, selectThread would race the listener and show "not found".
    if (!store.inquiries[inquiryId]) {
      const car = store.cars[carId] || {};
      store.inquiries = {...store.inquiries, [inquiryId]: {carId, renterUid: store.user.uid, ownerUid: car.ownerUid, createdAt: Date.now(), updatedAt: Date.now()}};
    }
    closeModal();
    openChatThread(`i:${inquiryId}`);
  } catch (error) { toast(error.message); }
}

const EV_LABELS = {video: 'סרטון הרכב מבחוץ', fuel: 'תמונת דלק', odometer: 'תמונת קילומטראז׳'};
// A payment counts for starting a rental only once the owner CONFIRMED it. Legacy proofs (no status field,
// saved before approval existed) are treated as approved so older bookings keep working.
const paymentApproved = payment => !!payment && payment.status !== 'pending' && payment.status !== 'rejected';
const evidenceState = (booking, bookingId) => {
  const ev = booking?.evidence || {};
  return {video: Boolean(ev.video), fuel: Boolean(ev.fuel), odometer: Boolean(ev.odometer), payment: paymentApproved(store.payments[bookingId])};
};

export function chatsPage() {
  resetPaint();
  if (!store.user) {
    if (!store.authSettled) { app().innerHTML = '<div class="app-loader"><div class="spinner"></div><p>טוען…</p></div>'; return; }
    saveAuthReturn({hash: 'chats'});  // come back to the chats after signing in
    location.hash = 'auth'; return;
  }
  // If the chat shell is already up, a re-render (incoming message, any data event) only needs the sidebar
  // list refreshed — do NOT rebuild the whole shell. Rebuilding wiped the open conversation AND the reply
  // the admin was typing, which is exactly why "the admin can't reply" happened.
  if (document.querySelector('#chat-shell')) { renderChatItems(); return; }
  app().innerHTML = `<div class="chat-shell" id="chat-shell">
    <aside class="chat-list">
      <div class="chat-list-head"><button type="button" class="chat-page-back" id="chat-page-back" title="חזרה לאזור האישי" aria-label="חזרה">→</button><h2>צ׳אטים</h2>${store.isAdmin ? '<input id="chat-search" placeholder="חיפוש משתמש…" autocomplete="off">' : ''}</div>
      <div class="chat-items" id="chat-items"></div>
    </aside>
    <section class="chat-pane" id="chat-pane"><div class="chat-empty"><span class="chat-empty-ic">${ICON.chat}</span><p>בחרו שיחה מהרשימה</p></div></section>
  </div>`;
  if (store.isAdmin) ensureAdminChatFeed();
  renderChatItems();
  document.querySelector('#chat-page-back')?.addEventListener('click', () => { location.hash = (store.user && !store.user.isAnonymous) ? 'dashboard' : 'home'; });
  document.querySelector('#chat-search')?.addEventListener('input', renderChatItems);
  const wanted = pendingThread || chatState.thread;
  pendingThread = null;
  if (wanted) selectThread(wanted);
  else if (window.matchMedia('(min-width: 900px)').matches) {
    const first = document.querySelector('[data-thread]');
    if (first) selectThread(first.dataset.thread);
  }
}

// The admin support-thread list comes from a lightweight SERVER endpoint (admin-chat-threads) that
// returns only per-thread summaries — NOT the whole messages/admin tree, which downloaded every message +
// base64 image into the browser and FROZE the tab once chat usage grew. Refreshed on entering chats and on
// a gentle timer while the tab is visible; the open conversation itself still updates in real time.
let adminFeedTimer = null;
function teardownAdminChatFeed() {
  if (adminFeedTimer) { clearInterval(adminFeedTimer); adminFeedTimer = null; }
  adminChatActivity = null;
  adminUnread = {};
  adminReadAt = {};
}
async function loadAdminThreads() {
  if (!store.isAdmin) return teardownAdminChatFeed();
  try {
    const {threads} = await api('admin-chat-threads');
    adminChatActivity = {};
    for (const t of threads || []) { adminChatActivity[t.uid] = t.lastAt || 0; adminUnread[t.uid] = !!t.unread; }
    if (store.route === 'chats') renderChatItems();
  } catch { /* transient network/permission error — keep the list we already have */ }
}
function ensureAdminChatFeed() {
  if (adminFeedTimer || !store.isAdmin) return;
  loadAdminThreads();
  adminFeedTimer = setInterval(() => { if (store.route === 'chats' && !document.hidden) loadAdminThreads(); }, 15000);
}

function chatItems() {
  if (store.isAdmin) {
    if (adminChatActivity === null) adminChatActivity = {};
    const query = (document.querySelector('#chat-search')?.value || '').trim().toLowerCase();
    const registered = list(store.users);
    const registeredIds = new Set(registered.map(u => u.id));
    // Guest (unregistered/anonymous) support threads: a support thread whose uid has no user profile.
    const guests = Object.keys(adminChatActivity)
      .filter(uid => !registeredIds.has(uid))
      .map(uid => ({id: uid, guest: true, name: `אורח · ${uid.slice(-5)}`}));
    return [...registered, ...guests]
      .filter(u => !query || `${u.name || ''} ${u.email || ''}`.toLowerCase().includes(query) || (u.guest && 'אורח'.includes(query)))
      .sort((a, b) => (adminChatActivity[b.id] || 0) - (adminChatActivity[a.id] || 0) || String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''), 'he'))
      .map(u => u.guest
        ? {key: `a:${u.id}`, emoji: ICON.chat, title: u.name, subtitle: `לקוח לא רשום${adminChatActivity[u.id] ? ' · ' + fmtDate(adminChatActivity[u.id]) : ''}`, live: true, unread: adminThreadUnread(u.id)}
        : {key: `a:${u.id}`, avatar: avatarHtml(u, 42), title: u.name || u.email || 'משתמש', subtitle: `${roleName(u.role)}${adminChatActivity[u.id] ? ' · ' + fmtDate(adminChatActivity[u.id]) : ''}`, live: true, unread: adminThreadUnread(u.id)});
  }
  const role = myRole();
  const bookingItems = myBookings()
    .filter(b => ['pending', 'approved', 'active', 'done'].includes(b.status))
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
    .map(b => {
      const car = store.cars[b.carId] || {};
      return {key: `b:${b.id}`, emoji: ICON.car, title: `${car.make || 'רכב'} ${car.model || ''}`.trim(), subtitle: role === 'owner' ? 'שיחה עם השוכר' : 'שיחה עם בעל הרכב', status: b.status, live: ['pending', 'approved', 'active'].includes(b.status)};
    });
  // Pre-booking inquiry threads (store.inquiries is already role-filtered: a renter sees ones they opened,
  // an owner sees ones about their cars).
  const inquiryItems = list(store.inquiries)
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
    .map(inq => {
      const car = store.cars[inq.carId] || {};
      return {key: `i:${inq.id}`, emoji: ICON.chat, title: `${car.make || 'רכב'} ${car.model || ''}`.trim(), subtitle: role === 'owner' ? 'פנייה משוכר (טרם הזמנה)' : 'שיחה עם בעל הרכב (טרם הזמנה)', live: true};
    });
  return [{key: `a:${store.user.uid}`, emoji: ICON.chat, title: 'שירות לקוחות', subtitle: 'תמיכה טכנית · מענה מהיר', live: true}, ...bookingItems, ...inquiryItems];
}

function renderChatItems() {
  const box = document.querySelector('#chat-items');
  if (!box) return;
  const items = chatItems();
  box.innerHTML = items.length ? items.map(item => `<button class="chat-item ${item.key === chatState.thread ? 'active' : ''} ${item.live ? '' : 'ended'}" data-thread="${esc(item.key)}">${item.avatar || `<span class="chat-item-emoji">${item.emoji}</span>`}<span class="chat-item-main"><b>${esc(item.title)}</b><small>${esc(item.subtitle)}</small></span>${item.unread ? '<span class="chat-unread-dot" title="הודעה חדשה שלא נקראה" aria-label="הודעה חדשה שלא נקראה"></span>' : ''}${item.status ? `<span class="status-badge ${esc(item.status)}">${statusLabel(item.status)}</span>` : ''}</button>`).join('') : '<div class="empty">אין שיחות פעילות</div>';
  box.querySelectorAll('[data-thread]').forEach(button => button.onclick = () => selectThread(button.dataset.thread));
}

function selectThread(key) {
  chatState.unsub?.();
  chatState.unsub = null;
  if (chatState.thread !== key) chatState.draft = '';
  chatState.thread = key;
  document.querySelectorAll('[data-thread]').forEach(el => el.classList.toggle('active', el.dataset.thread === key));
  document.querySelector('#chat-shell')?.classList.add('show-pane');
  const pane = document.querySelector('#chat-pane');
  if (!pane) return;
  const isSupport = key.startsWith('a:');
  const isInquiry = key.startsWith('i:');   // pre-booking renter↔owner thread about a car
  const id = key.slice(2);
  // The admin opened this thread → it's now read; drop the green unread light for it.
  if (isSupport && store.isAdmin) { adminReadAt[id] = Date.now(); if (adminUnread[id]) { adminUnread[id] = false; renderChatItems(); } }
  const inquiry = isInquiry ? store.inquiries[id] : null;
  const booking = (isSupport || isInquiry) ? null : store.bookings[id];
  if (isInquiry && !inquiry) { pane.innerHTML = '<div class="chat-empty"><p>השיחה לא נמצאה</p></div>'; return; }
  if (!isSupport && !isInquiry && !booking) { pane.innerHTML = '<div class="chat-empty"><p>השיחה לא נמצאה</p></div>'; return; }
  const car = booking ? store.cars[booking.carId] || {} : (inquiry ? store.cars[inquiry.carId] || {} : {});
  const title = isSupport ? (store.isAdmin ? (store.users[id]?.name || store.users[id]?.email || `אורח · ${id.slice(-5)}`) : 'שירות לקוחות') : `${car.make || 'רכב'} ${car.model || ''}`.trim();
  const isOwner = booking && booking.ownerUid === store.user.uid;
  const isRenter = booking && booking.renterUid === store.user.uid;
  const convEnded = booking ? booking.chatEnded === true : false;   // owner/admin pressed "סיום שיחה"
  const live = (isSupport || isInquiry || ['pending', 'approved', 'active'].includes(booking?.status)) && !(convEnded && isRenter);
  const ev = booking ? evidenceState(booking, id) : null;
  const evReady = ev && ev.video && ev.fuel && ev.odometer && ev.payment;

  const headActions = `${booking && isOwner
    ? (booking.status === 'approved' ? `<button class="btn gold ${evReady ? '' : 'soft-disabled'}" id="rental-start">התחלת השכרה</button>`
      : booking.status === 'active' ? `<button class="btn primary" id="rental-end">סיום השכרה</button>` : '')
    : ''}${booking && (isOwner || store.isAdmin) && !convEnded ? '<button class="btn dark-out" id="chat-end" title="הצד השני לא יוכל לשלוח עוד הודעות">סיום שיחה</button>' : ''}${store.isAdmin ? '<button class="btn dark-out" id="chat-clear" title="מחיקת כל ההודעות">ניקוי</button>' : ''}`;
  const checklist = booking && booking.status === 'approved'
    ? `<div class="ev-checklist">${[['video', 'סרטון חוץ'], ['fuel', 'דלק'], ['odometer', 'קילומטראז׳'], ['payment', 'תשלום']].map(([k, label]) => `<span class="ev-status ${ev[k] ? 'ok' : ''}">${ev[k] ? '✓' : '○'} ${label}</span>`).join('')}</div>` : '';
  const evidenceRow = booking && booking.status === 'approved' && isRenter
    ? `<div class="evidence-row">
        <label class="ev-chip ${ev.video ? 'ok' : ''}">סרטון חוץ<input hidden type="file" accept="video/*" data-ev="video"></label>
        <label class="ev-chip ${ev.fuel ? 'ok' : ''}">דלק<input hidden type="file" accept="image/*" capture="environment" data-ev="fuel"></label>
        <label class="ev-chip ${ev.odometer ? 'ok' : ''}">קילומטראז׳<input hidden type="file" accept="image/*" capture="environment" data-ev="odometer"></label>
        <button type="button" class="ev-chip ${ev.payment ? 'ok' : ''}" id="ev-payment">תשלום</button>
      </div>` : '';
  const composer = live
    ? `${evidenceRow}<form class="chat-composer" id="chat-composer" autocomplete="off"><label class="chat-attach" title="שליחת תמונה">${ICON.image}<input hidden type="file" accept="image/*" id="chat-photo"></label><input name="text" maxlength="2000" placeholder="כתבו הודעה…" value="${esc(chatState.draft)}"><button class="btn primary">שליחה</button></form>`
    : `<div class="chat-closed">${convEnded && isRenter ? 'השיחה נסגרה על ידי הצד השני — לא ניתן לשלוח הודעות נוספות' : 'ההשכרה הסתיימה — הצ׳אט פתוח רק מאישור ההזמנה ועד סיום ההשכרה'}</div>`;

  pane.innerHTML = `<header class="chat-head">
      <button class="chat-back" id="chat-back" aria-label="חזרה לרשימה">→</button><button class="chat-x" id="chat-close" aria-label="סגירת הצ׳אט">×</button>
      <div class="chat-head-main"><h3>${esc(title)}</h3>${booking ? `<span class="status-badge ${esc(booking.status)}">${statusLabel(booking.status)}</span>` : isInquiry ? '<span class="pill ok">פנייה על רכב · טרם הזמנה</span>' : '<span class="pill ok">שירות לקוחות</span>'}</div>
      <div class="chips">${headActions}</div>
    </header>${checklist}<div class="chat-msgs" id="chat-msgs"><div class="empty">טוען הודעות…</div></div>${composer}`;

  pane.querySelector('#chat-back').onclick = () => document.querySelector('#chat-shell')?.classList.remove('show-pane');
  pane.querySelector('#chat-close').onclick = () => { chatState.unsub?.(); chatState.unsub = null; chatState.thread = null; document.querySelector('#chat-shell')?.classList.remove('show-pane'); pane.innerHTML = '<div class="chat-empty"><span class="chat-empty-ic">${ICON.chat}</span><p>בחרו שיחה מהרשימה</p></div>'; document.querySelectorAll('[data-thread]').forEach(el => el.classList.remove('active')); };
  const form = pane.querySelector('#chat-composer');
  if (form) {
    form.text.oninput = () => { chatState.draft = form.text.value; };
    form.onsubmit = async event => {
      event.preventDefault();
      const text = form.text.value.trim();
      if (!text) return;
      form.text.value = ''; chatState.draft = '';
      // ALWAYS pass userUid = the thread's user id. For the admin it's the person they're messaging;
      // for a regular user it's their own uid (harmlessly ignored server-side). Previously this was
      // gated on store.isAdmin — if that flag was momentarily false the message lost its target and
      // went to the admin's OWN thread instead of the user's. THAT was the "can't message users" bug.
      try { await sendMessage(isSupport ? {thread: 'admin', userUid: id, text} : isInquiry ? {inquiryId: id, text} : {bookingId: id, text}); }
      catch (error) { toast(error.message); form.text.value = text; chatState.draft = text; }
    };
  }
  pane.querySelector('#chat-photo')?.addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      toast('מעלה תמונה…');
      const dataUrl = await uploadPublicMedia(file, 'chat-photo', id);
      const attachment = {path: dataUrl, type: 'photo'};
      await sendMessage(isSupport ? {thread: 'admin', userUid: id, text: '', attachment} : isInquiry ? {inquiryId: id, text: '', attachment} : {bookingId: id, text: '', attachment});
      toast('התמונה נשלחה');
    } catch (error) { toast(error.message); }
  });
  pane.querySelectorAll('[data-ev]').forEach(input => input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      toast('מעלה קובץ…');
      const path = await uploadPrivate(file, 'booking-media', id);
      await sendMessage({bookingId: id, text: EV_LABELS[input.dataset.ev], attachment: {path, type: `evidence-${input.dataset.ev}`}});
      toast('התיעוד נשלח לבעל הרכב');
    } catch (error) { toast(error.message); }
  });
  pane.querySelector('#ev-payment')?.addEventListener('click', () => paymentModal(id, async amount => {
    try { await sendMessage({bookingId: id, text: `נשלחה הוכחת תשלום על ${money(amount)}`}); } catch {}
  }));
  pane.querySelector('#rental-start')?.addEventListener('click', async () => {
    try { await setBookingStatus(id, 'active'); toast('ההשכרה התחילה — נסיעה טובה!'); }
    catch (error) { toast(error.message); }
  });
  pane.querySelector('#rental-end')?.addEventListener('click', async () => {
    if (!confirm('לסיים את ההשכרה?')) return;
    try { await setBookingStatus(id, 'done'); toast('ההשכרה הסתיימה'); }
    catch (error) { toast(error.message); }
  });
  pane.querySelector('#chat-clear')?.addEventListener('click', async () => {
    if (!confirm('למחוק לצמיתות את כל ההודעות בשיחה זו?')) return;
    try { await adminAction('chat-clear', isSupport ? {userUid: id} : {bookingId: id}); toast('הצ׳אט נוקה'); }
    catch (error) { toast(error.message); }
  });
  pane.querySelector('#chat-end')?.addEventListener('click', async () => {
    if (!confirm('לסיים את השיחה? הצד השני לא יוכל לשלוח יותר הודעות.')) return;
    try { await api('booking-action', {action: 'end-chat', bookingId: id}); toast('השיחה נסגרה'); }
    catch (error) { toast(error.message); }
  });

  const ref = firebase.database().ref(isSupport ? `messages/admin/${id}` : isInquiry ? `messages/inquiry/${id}` : `messages/${id}`).limitToLast(100);
  const handler = snap => {
    const box = document.querySelector('#chat-msgs');
    if (!box || store.route !== 'chats' || chatState.thread !== key) { ref.off('value', handler); return; }
    const messages = list(snap.val() || {}).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    box.innerHTML = messages.length ? messages.map(renderChatMessage).join('') : '<div class="empty">אין הודעות עדיין</div>';
    box.scrollTop = box.scrollHeight;
    box.querySelectorAll('[data-att-path]').forEach(button => button.onclick = async () => {
      try { window.open(await signedRead(button.dataset.attPath), '_blank', 'noopener'); }
      catch (error) { toast(error.message); }
    });
    // Guest gate: an unregistered visitor may send ONE message until the admin replies. Once they've
    // sent and no admin answer exists yet, lock the composer with a friendly "we'll get back to you" note.
    if (isSupport && store.user?.isAnonymous) {
      const waiting = messages.some(m => m.senderUid === store.user.uid) && !messages.some(m => m.fromAdmin);
      const composerForm = document.querySelector('#chat-composer');
      composerForm?.querySelectorAll('input,button').forEach(el => { el.disabled = waiting; });
      let note = document.querySelector('#guest-wait-note');
      if (waiting && !note && composerForm) composerForm.insertAdjacentHTML('beforebegin', '<div class="chat-closed" id="guest-wait-note">שלחתם הודעה לתמיכה — נחזור אליכם בהקדם. תוכלו להמשיך לכתוב ברגע שנענה.</div>');
      else if (!waiting && note) note.remove();
    }
  };
  ref.on('value', handler, error => {
    const box = document.querySelector('#chat-msgs');
    const denied = /permission_denied/i.test(String(error?.message || ''));
    if (box) box.innerHTML = `<div class="empty">${denied ? 'אין גישה לצ׳אט הזה כרגע.<br><small>אם האתר עודכן עכשיו — צריך לפרסם ב-Firebase את חוקי האבטחה המעודכנים (FIREBASE_DATABASE_RULES_V2.json).</small>' : 'שגיאה בטעינת ההודעות — נסו לרענן.'}</div>`;
    else if (!denied) toast('שגיאה בטעינת ההודעות');
  });
  chatState.unsub = () => ref.off('value', handler);
}

function renderChatMessage(message) {
  const mine = message.senderUid === store.user?.uid;
  const attLabels = {'evidence-video': 'סרטון הרכב מבחוץ', 'evidence-fuel': 'תמונת דלק', 'evidence-odometer': 'תמונת קילומטראז׳', photo: 'קובץ מצורף'};
  const att = message.attachment;
  // Inline images are already the picture (data URL) — show them directly. Videos / legacy
  // storage paths keep the click-to-open button (fetched through signedRead).
  const attachment = att
    ? (/^data:image\//i.test(String(att.path || ''))
        ? `<img class="msg-img" src="${esc(att.path)}" alt="${esc(attLabels[att.type] || 'תמונה')}" loading="lazy" data-att-img="${esc(att.path)}">`
        : `<button class="msg-att" data-att-path="${esc(att.path)}">${attLabels[att.type] || 'קובץ'} · צפייה</button>`)
    : '';
  return `<div class="message ${mine ? 'mine' : ''}">${message.text ? `<p>${esc(message.text)}</p>` : ''}${attachment}<small>${fmtDate(message.createdAt)}</small></div>`;
}

function paymentModal(bookingId, onDone = null) {
  modal(`<div class="modal-head"><h2>הוכחת תשלום</h2><button class="close" data-close-modal>×</button></div><form id="payment-form"><div class="field"><label>סכום ששולם</label><input name="amount" type="number" min="0.01" step="0.01" required></div><div class="field"><label>צילום הוכחה</label><input name="file" type="file" accept="image/*" required></div><button class="btn primary">שמירה</button></form>`);
  document.querySelector('#payment-form').onsubmit = async event => {
    event.preventDefault();
    const btn = event.submitter; if (btn) btn.disabled = true;  // the upload takes seconds — block a double-tap
    try {
      const amount = Number(event.target.amount.value);
      const path = await uploadPrivate(event.target.file.files[0], 'payment', bookingId);
      await savePayment(bookingId, {amount, mediaPath: path});
      closeModal(); toast('הוכחת התשלום נשמרה');
      await onDone?.(amount);
    } catch (error) { toast(error.message); if (btn) btn.disabled = false; }
  };
}

async function viewPaymentModal(bookingId) {
  const payment = store.payments[bookingId];
  if (!payment) return toast('אין הוכחת תשלום');
  try {
    const url = await signedRead(payment.mediaPath);
    modal(`<div class="modal-head"><h2>הוכחת תשלום</h2><button class="close" data-close-modal>×</button></div><div class="summary"><span>סכום</span><b>${money(payment.amount)}</b></div><div class="summary"><span>תאריך</span><b>${fmtDate(payment.createdAt)}</b></div><a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">פתיחת צילום ההוכחה</a>`);
  } catch (error) { toast(error.message); }
}

function handoverModal(bookingId, stage) {
  const title = stage === 'pickup' ? 'תיעוד לפני נסיעה' : 'תיעוד החזרה';
  modal(`<div class="modal-head"><h2>${title}</h2><button class="close" data-close-modal>×</button></div><form id="handover-form"><div class="field"><label>סרטון הרכב מבחוץ</label><input name="video" type="file" accept="video/*" required></div><div class="field"><label>תמונה של הדלק והמיילים</label><input name="dash" type="file" accept="image/*" required></div><div class="form-grid"><div class="field"><label>מיילים / קילומטראז׳</label><input name="mileage" type="number" min="0" required></div><div class="field"><label>רמת דלק</label><select name="fuel"><option>מלא</option><option>3/4</option><option>1/2</option><option>1/4</option><option>ריק</option></select></div></div><div class="field"><label>נזקים והערות</label><textarea name="notes" maxlength="2000"></textarea></div><button class="btn primary">שמירה</button></form>`);
  document.querySelector('#handover-form').onsubmit = async event => {
    event.preventDefault();
    const btn = event.submitter; if (btn) btn.disabled = true;  // two uploads — block a double-tap
    try {
      const videoPath = await uploadPrivate(event.target.video.files[0], 'booking-media', bookingId);
      const dashboardPhotoPath = await uploadPrivate(event.target.dash.files[0], 'booking-media', bookingId);
      await saveHandover(bookingId, stage, {videoPath, dashboardPhotoPath, mileage: Number(event.target.mileage.value), fuel: event.target.fuel.value, notes: event.target.notes.value});
      closeModal(); toast('התיעוד נשמר');
    } catch (error) { toast(error.message); if (btn) btn.disabled = false; }
  };
}

async function viewHandoverModal(bookingId) {
  const booking = store.bookings[bookingId];
  if (!booking?.handover) return toast('אין תיעוד');
  let html = '';
  for (const [stage, data] of Object.entries(booking.handover)) {
    let videoUrl = '', photoUrl = '';
    try { videoUrl = await signedRead(data.videoPath); photoUrl = await signedRead(data.dashboardPhotoPath); } catch {}
    html += `<div class="card inset"><h3>${stage === 'pickup' ? 'לפני נסיעה' : 'החזרה'}</h3><div class="media-grid">${videoUrl ? `<video controls src="${esc(videoUrl)}"></video>` : ''}${photoUrl ? `<img src="${esc(photoUrl)}" alt="לוח מחוונים">` : ''}</div><div class="summary"><span>מיילים</span><b>${esc(data.mileage)}</b></div><div class="summary"><span>דלק</span><b>${esc(data.fuel)}</b></div><p>${esc(data.notes || '')}</p></div>`;
  }
  modal(`<div class="modal-head"><h2>תיעוד הזמנה</h2><button class="close" data-close-modal>×</button></div>${html}`);
}

async function addressModal(bookingId) {
  try {
    const data = await api('private-car-details', {bookingId});
    modal(`<div class="modal-head"><h2>פרטי איסוף</h2><button class="close" data-close-modal>×</button></div><div class="summary"><span>כתובת מלאה</span><b>${esc(data.fullAddress || 'לא הוגדרה')}</b></div>`);
  } catch (error) { toast(error.message); }
}

async function ownerRenterModal(uid) {
  try {
    const data = await api('user-private-profile', {uid});
    const rating = userRating(uid);
    const reviews = list(store.ratings).filter(r => r.type === 'user' && r.targetUid === uid && r.review).slice(0, 6);
    modal(`<div class="modal-head"><h2 class="with-avatar">${avatarHtml(data.profile, 38)} ${esc(data.profile.name || data.profile.email || 'שוכר')}</h2><button class="close" data-close-modal>×</button></div><div class="summary"><span>מייל</span><b>${esc(data.profile.email || '—')}</b></div><div class="summary"><span>טלפון</span><b>${esc(data.profile.phone || '—')}</b></div><div class="summary"><span>דירוג</span><b>${stars(rating)} ${rating ? rating.toFixed(1) : 'חדש'}</b></div><div class="summary"><span>סטטוס אימות</span><b>${esc(verificationLabel(data.profile.verification?.status))}</b></div><div class="list">${Object.entries(data.documents || {}).map(([key, url]) => `<a class="btn outline" href="${esc(url)}" target="_blank" rel="noopener">${esc(key)}</a>`).join('') || '<div class="empty">אין מסמכים זמינים</div>'}</div>${reviews.length ? `<div class="reviews"><h3>ביקורות על המשתמש</h3>${reviews.map(r => `<div class="review"><div class="review-head"><span class="review-stars">${stars(r.score)}</span><small>${fmtDate(r.createdAt)}</small></div><p>${esc(r.review)}</p></div>`).join('')}</div>` : ''}`);
  } catch (error) { toast(error.message); }
}

async function adminUserModal(uid) {
  try {
    const data = await api('user-private-profile', {uid});
    const userPayments = Object.values(store.payments).filter(payment => payment.renterUid === uid);
    const paymentTotal = userPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const paymentLinks = [];
    for (const payment of userPayments) {
      try { paymentLinks.push({payment, url: await signedRead(payment.mediaPath)}); } catch {}
    }
    modal(`<div class="modal-head"><h2 class="with-avatar">${avatarHtml(data.profile, 38)} ${esc(data.profile.name || data.profile.email || 'משתמש')}</h2><button class="close" data-close-modal>×</button></div><div class="summary"><span>מייל</span><b>${esc(data.profile.email || '—')}</b></div><div class="summary"><span>טלפון</span><b>${esc(data.profile.phone || '—')}</b></div><div class="summary"><span>תפקיד</span><b>${esc(roleName(data.profile.role))}</b></div><div class="summary"><span>סך תשלומים מדווחים</span><b>${money(paymentTotal)}</b></div><div class="summary"><span>סטטוס</span><b>${esc(verificationLabel(data.profile.verification?.status))}</b></div><div class="list">${Object.entries(data.documents || {}).map(([key, url]) => `<a class="btn outline" href="${esc(url)}" target="_blank" rel="noopener">${esc(key)}</a>`).join('') || '<div class="empty">אין מסמכים</div>'}</div>${paymentLinks.length ? `<h3>הוכחות תשלום</h3><div class="list">${paymentLinks.map(({payment,url}) => `<a class="btn outline" href="${esc(url)}" target="_blank" rel="noopener">${money(payment.amount)} · ${fmtDate(payment.createdAt)}</a>`).join('')}</div>` : ''}<div class="summary"><span>סיסמה</span><b>מוצפנת · לא ניתנת לצפייה</b></div><button class="btn gold block" data-message-user="${esc(uid)}">💬 שליחת הודעה למשתמש</button><div class="chips"><button class="btn primary" data-review="approved">אישור אימות</button><button class="btn danger" data-review="rejected">דחייה</button><button class="btn outline" data-review="needs_resubmission">בקשת צילום מחדש</button><button class="btn outline" data-role-toggle="${data.profile.role === 'owner' ? 'renter' : 'owner'}">${data.profile.role === 'owner' ? 'הפיכה לשוכר' : 'הפיכה לבעל רכב'}</button><button class="btn outline" data-reset-pw="${esc(data.profile.email || '')}">שליחת קישור לאיפוס סיסמה</button></div>`);
    document.querySelector('[data-message-user]')?.addEventListener('click', () => { closeModal(); openChatThread(`a:${uid}`); });
    document.querySelectorAll('[data-review]').forEach(button => button.onclick = async () => {
      const note = button.dataset.review === 'approved' ? '' : prompt('הערה למשתמש:') || '';
      try { await approveVerification(uid, button.dataset.review, note); closeModal(); toast('סטטוס האימות עודכן'); }
      catch (error) { toast(error.message); }
    });
    document.querySelector('[data-role-toggle]')?.addEventListener('click', async event => {
      const role = event.currentTarget.dataset.roleToggle;
      if (!confirm(`לשנות את התפקיד של המשתמש ל${roleName(role)}?`)) return;
      try { await adminAction('user-update', {uid, patch: {role}}); closeModal(); toast('התפקיד עודכן'); }
      catch (error) { toast(error.message); }
    });
    document.querySelector('[data-reset-pw]')?.addEventListener('click', async event => {
      try { await sendPasswordReset(event.currentTarget.dataset.resetPw); toast('נשלח קישור לאיפוס סיסמה למייל של המשתמש'); }
      catch (error) { toast(error.message); }
    });
  } catch (error) { toast(error.message); }
}

function ratingModal(bookingId, type) {
  modal(`<div class="modal-head"><h2>דירוג וביקורת</h2><button class="close" data-close-modal>×</button></div><form id="rating-form"><div class="field"><label>דירוג</label><select name="score"><option value="5">5 — מצוין</option><option value="4">4 — טוב מאוד</option><option value="3">3 — טוב</option><option value="2">2 — טעון שיפור</option><option value="1">1 — לא טוב</option></select></div><div class="field"><label>ביקורת</label><textarea name="review" maxlength="1000"></textarea></div><button class="btn primary">שליחה</button></form>`);
  document.querySelector('#rating-form').onsubmit = async event => {
    event.preventDefault();
    const btn = event.submitter; if (btn) btn.disabled = true;
    try { const data = formData(event.target); await submitRating({bookingId, type, score: Number(data.score), review: data.review}); closeModal(); toast('הדירוג נשמר'); }
    catch (error) { toast(error.message); if (btn) btn.disabled = false; }
  };
}

export function carForm(car = null) {
  const editing = Boolean(car?.id);
  // Photo manager state: up to 6 photos, one marked as main.
  const photos = editing ? carPhotoList(car).slice(0, 6) : [];
  let mainUrl = car?.photoUrl || photos[0] || '';
  let videoUrl = car?.videoUrl || '';
  const knownMake = CAR_MAKES.includes(car?.make);

  modal(`<div class="modal-head"><h2>${editing ? 'עריכת רכב' : 'הוספת רכב'}</h2><button class="close" data-close-modal>×</button></div><form id="car-form">
    <p class="form-section-title">פרטי הרכב</p>
    <div class="form-grid">
      <div class="field"><label>יצרן <span class="req">*</span></label><select name="makeSelect" id="make-select">${selectOptions(CAR_MAKES, knownMake ? car.make : '')}<option value="__other" ${editing && !knownMake ? 'selected' : ''}>אחר…</option></select><input name="make" id="make-input" value="${esc(car?.make || '')}" placeholder="שם היצרן" style="${knownMake || !editing ? 'display:none' : ''};margin-top:6px"></div>
      <div class="field"><label>דגם <span class="req">*</span></label><select name="modelSelect" id="model-select"></select><input name="model" id="model-input" value="${esc(car?.model || '')}" placeholder="שם הדגם" style="display:none;margin-top:6px"></div>
      <div class="field"><label>תת דגם <span class="mut">(רשות)</span></label><input name="trim" value="${esc(car?.trim || '')}" placeholder="לדוגמה Sport, Limited"></div>
      <div class="field"><label>שנה</label><select name="year">${selectOptions(carYears(), String(car?.year || new Date().getFullYear()))}</select></div>
      <div class="field"><label>סוג רכב <span class="req">*</span></label><select name="category" required>${selectOptions(CAR_TYPES, car?.category)}</select></div>
      <div class="field"><label>סוג דלק</label><select name="fuel">${selectOptions(['בנזין','דיזל','היברידי','PHEV','חשמלי'], car?.fuel)}</select></div>
      <div class="field"><label>תיבת הילוכים</label><select name="gear">${selectOptions(['אוטומט','ידני'], car?.gear)}</select></div>
      <div class="field"><label>מספר מושבים</label><input name="seats" type="number" min="1" max="20" value="${esc(car?.seats || 5)}"></div>
      <div class="field"><label>גיל מינימלי</label><input name="minAge" type="number" min="18" max="99" value="${esc(car?.minAge || 21)}"></div>
    </div>

    <p class="form-section-title">אופן ההשכרה <span class="req">*</span></p>
    <div class="mode-picker" id="mode-picker">
      ${RENTAL_MODES.map(m => `<label class="mode-opt"><input type="radio" name="rentalMode" value="${m.value}" ${((car?.rentalMode || 'hourly_daily') === m.value) ? 'checked' : ''}><span class="mode-opt-in"><b>${m.label}</b><small>${m.hint}</small></span></label>`).join('')}
    </div>

    <p class="form-section-title">מחירים <span class="mut">(בדולר)</span></p>
    <label class="price-request-toggle"><input type="checkbox" name="priceOnRequest" id="price-on-request" ${car?.priceOnRequest ? 'checked' : ''}> <span><b>הצגת "שלחו הודעה לקבלת מחיר"</b> — במקום מחיר במודעה יופיע כפתור, והשוכר ישלח לכם הודעה לתיאום מחיר</span></label>
    <div class="form-grid" id="price-grid">
      <div class="field" data-price="hourly"><label>מחיר לשעה <span class="req">*</span></label><input name="priceHourly" type="number" min="0" value="${esc(car?.priceHourly || '')}"></div>
      <div class="field" data-price="daily"><label>מחיר יומי <span class="req">*</span></label><input name="dailyPrice" type="number" min="0" value="${esc(car?.dailyPrice || '')}"></div>
      <div class="field" data-price="weekly"><label>מחיר לשבוע <span class="req">*</span></label><input name="priceWeekly" type="number" min="0" value="${esc(car?.priceWeekly || '')}"></div>
    </div>
    <label class="price-request-toggle" id="weekend-toggle-row"><input type="checkbox" name="weekendEnabled" id="weekend-enabled" ${car?.weekendEnabled ? 'checked' : ''}> <span><b>זמין גם לסופ״ש (כולל שבת)</b> — גם רכב שמושכר לפי שעות יוכל להיות מושכר לסופ״ש במחיר קבוע. המחיר לא יופיע במודעה — הוא יוצג רק כשהשוכר בוחר תאריכים שכוללים שבת.</span></label>
    <div class="form-grid" id="weekend-price-grid"><div class="field"><label>מחיר קבוע לסופ״ש <span class="req">*</span></label><input name="weekendPrice" type="number" min="0" value="${esc(car?.weekendPrice || '')}"></div></div>

    <p class="form-section-title">תמונות הרכב <span class="req">*</span> <span class="mut">(עד 6, בחרו תמונה ראשית)</span></p>
    <div id="photo-grid" class="photo-grid"></div>
    <div class="chips photo-actions">
      <label class="btn outline">העלאת תמונות<input hidden type="file" id="photo-files" accept="image/*" multiple></label>
      <button type="button" class="btn outline" id="auto-car-image">תמונה מהיצרן</button>
    </div>
    <div id="photo-suggest"></div>
    <small id="car-image-note" class="mut">כל סוג תמונה ובכל גודל — התמונה מותאמת אוטומטית לאיכות גבוהה וטעינה מהירה. אפשר גם למשוך תמונה רשמית לפי היצרן/הדגם. עד 6 תמונות (מספיקה תמונה אחת).</small>

    <p class="form-section-title">סרטון קצר <span class="mut">(רשות)</span></p>
    <div class="chips"><label class="btn outline">העלאת סרטון<input hidden type="file" id="video-file" accept="video/*"></label><span id="video-status" class="mut">${videoUrl ? 'סרטון קיים' : 'לא הועלה סרטון'}</span></div>

    <p class="form-section-title">מיקום</p>
    <div class="field"><label>אזור ציבורי</label><input name="area" value="${esc(car?.area || 'Crown Heights')}"></div>
    <div class="field"><label>כתובת מלאה — תיחשף לשוכר רק לאחר אישור</label><input name="fullAddress"></div>
    <button class="btn primary block" id="car-submit">${editing ? 'שמירת שינויים' : 'פרסום הרכב'}</button>
  </form>`);

  const form = document.querySelector('#car-form');
  const grid = document.querySelector('#photo-grid');
  const note = document.querySelector('#car-image-note');
  const makeSelect = document.querySelector('#make-select');
  const makeInput = document.querySelector('#make-input');
  const modelSelect = document.querySelector('#model-select');
  const modelInput = document.querySelector('#model-input');

  const currentMake = () => makeSelect.value === '__other' ? makeInput.value.trim() : makeSelect.value;
  function renderPhotos() {
    if (!photos.length) { grid.innerHTML = '<div class="photo-empty">עדיין לא נוספו תמונות</div>'; return; }
    grid.innerHTML = photos.map((url, i) => `<div class="photo-item ${url === mainUrl ? 'is-main' : ''}"><img src="${esc(url)}" alt="תמונה ${i + 1}"><button type="button" class="photo-remove" data-remove="${i}" title="הסרה">×</button><button type="button" class="photo-main-btn" data-main="${esc(url)}">${url === mainUrl ? '★ ראשית' : '☆ הפוך לראשית'}</button></div>`).join('');
    grid.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => { const idx = Number(b.dataset.remove); const removed = photos.splice(idx, 1)[0]; if (removed === mainUrl) mainUrl = photos[0] || ''; renderPhotos(); });
    grid.querySelectorAll('[data-main]').forEach(b => b.onclick = () => { mainUrl = b.dataset.main; renderPhotos(); });
  }
  function addPhoto(url) {
    if (!/^(https:\/\/|data:image\/)/i.test(url)) return;  // accept inline data-URL images too
    if (photos.includes(url)) return;
    if (photos.length >= 6) { toast('אפשר עד 6 תמונות'); return; }
    photos.push(url);
    if (!mainUrl) mainUrl = url;
    renderPhotos();
  }
  function populateModels() {
    const make = currentMake();
    const models = (MODELS_BY_MAKE[make] || []).slice().sort((a, b) => a.localeCompare(b, 'en'));
    modelSelect.innerHTML = `${selectOptions(models, models.includes(car?.model) ? car.model : '')}<option value="__other" ${car?.model && !models.includes(car.model) ? 'selected' : ''}>אחר…</option>`;
    const useInput = !models.length || modelSelect.value === '__other';
    modelInput.style.display = useInput ? '' : 'none';
    if (!models.length && !modelInput.value && car?.model) modelInput.value = car.model;
  }
  renderPhotos();
  populateModels();

  // Rental mode → which price fields are shown + required. hourly: hourly only; hourly_daily: hourly
  // + daily; long_term: weekly only. (Hidden fields keep any existing value — nothing legacy is lost.)
  const MODE_PRICES = {hourly: {hourly: 1}, hourly_daily: {hourly: 1, daily: 1}, long_term: {weekly: 1}};
  const priceGrid = form.querySelector('#price-grid');
  const priceOnReq = form.querySelector('#price-on-request');
  const weekendRow = form.querySelector('#weekend-toggle-row');
  const weekendCheck = form.querySelector('#weekend-enabled');
  const weekendPriceGrid = form.querySelector('#weekend-price-grid');
  const weekendAllowed = () => ['hourly', 'hourly_daily'].includes(form.querySelector('input[name="rentalMode"]:checked')?.value || 'hourly_daily') && !priceOnReq?.checked;
  function updatePriceFields() {
    // Weekend option is offered only for hourly / hourly-daily cars (not long-term, not price-on-request).
    const wkAllowed = weekendAllowed();
    if (weekendRow) weekendRow.style.display = wkAllowed ? '' : 'none';
    if (weekendPriceGrid) weekendPriceGrid.style.display = wkAllowed && weekendCheck?.checked ? '' : 'none';
    // "שלחו הודעה לקבלת מחיר" hides all price fields; otherwise show the ones the rental mode needs.
    if (priceOnReq?.checked) { priceGrid.style.display = 'none'; return; }
    priceGrid.style.display = '';
    const mode = form.querySelector('input[name="rentalMode"]:checked')?.value || 'hourly_daily';
    const cfg = MODE_PRICES[mode] || MODE_PRICES.hourly_daily;
    form.querySelectorAll('#price-grid [data-price]').forEach(field => { field.style.display = cfg[field.dataset.price] ? '' : 'none'; });
  }
  form.querySelectorAll('input[name="rentalMode"]').forEach(radio => radio.addEventListener('change', updatePriceFields));
  priceOnReq?.addEventListener('change', updatePriceFields);
  weekendCheck?.addEventListener('change', updatePriceFields);
  updatePriceFields();

  // --- Draft persistence (mobile audit #4): picking a photo opens the camera/gallery, which backgrounds the
  // page — and iOS sometimes reloads it, wiping everything typed. Save the TEXT/select/checkbox fields (never
  // photos or files) to sessionStorage as the owner types; restore them when the form reopens; clear on save.
  const draftKey = `cd-car-draft:${car?.id || 'new'}`;
  const draftFields = () => [...form.elements].filter(el => el.name && el.type !== 'file' && el.type !== 'hidden');
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
    if (saved && typeof saved === 'object') {
      // Restore make first (the model dropdown's options depend on it), then everything else.
      if (saved.makeSelect !== undefined && makeSelect) { makeSelect.value = saved.makeSelect; makeSelect.dispatchEvent(new Event('change')); populateModels(); }
      let restored = 0;
      for (const el of draftFields()) {
        const val = saved[el.name];
        if (val === undefined || el.id === 'make-select') continue;
        if (el.type === 'checkbox') { if (el.checked !== !!val) { el.checked = !!val; restored++; } }
        else if (el.type === 'radio') { if (val === el.value && !el.checked) { el.checked = true; restored++; } }
        else if (val !== '' && String(el.value || '') !== String(val)) { el.value = val; restored++; }
      }
      populateModels(); updatePriceFields();
      if (saved.modelSelect !== undefined && modelSelect) modelSelect.value = saved.modelSelect;
      if (restored) toast('שוחזרה טיוטה שלא נשמרה');
    }
  } catch {}
  const saveDraft = () => {
    const draft = {};
    for (const el of draftFields()) draft[el.name] = el.type === 'checkbox' ? el.checked : (el.type === 'radio' ? (el.checked ? el.value : draft[el.name]) : el.value);
    try { sessionStorage.setItem(draftKey, JSON.stringify(draft)); } catch {}
  };
  form.addEventListener('input', saveDraft);
  form.addEventListener('change', saveDraft);

  // The site "chats" a photo suggestion the moment the owner picks the spec.
  let lastSuggest = '';
  async function suggestPhoto() {
    const make = currentMake();
    const model = modelSelect.value === '__other' ? modelInput.value.trim() : modelSelect.value;
    const box = document.querySelector('#photo-suggest');
    if (!box || !make || !model || photos.length >= 6) return;
    const key = `${make} ${model}`;
    if (key === lastSuggest) return;
    lastSuggest = key;
    box.innerHTML = '<div class="suggest-bubble typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
    try {
      const response = await fetch('/api/car-image-search', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({make, model, year: form.year.value})});
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.url) { box.innerHTML = ''; return; }
      box.innerHTML = `<div class="suggest-bubble"><img class="suggest-img" src="${esc(result.url)}" alt=""><div class="suggest-text"><b>מצאתי תמונה של ${esc(make)} ${esc(model)}</b><small>רוצים שאוסיף אותה לגלריה?</small><div class="chips"><button type="button" class="btn primary" id="suggest-yes">כן, הוסף</button><button type="button" class="btn outline" id="suggest-no">לא תודה</button></div></div></div>`;
      box.querySelector('#suggest-yes').onclick = () => { addPhoto(result.url); box.innerHTML = ''; toast('התמונה נוספה לגלריה'); };
      box.querySelector('#suggest-no').onclick = () => { box.innerHTML = ''; };
    } catch { box.innerHTML = ''; }
  }
  makeSelect.onchange = () => { makeInput.style.display = makeSelect.value === '__other' ? '' : 'none'; populateModels(); suggestPhoto(); };
  makeInput.oninput = populateModels;
  modelSelect.onchange = () => { modelInput.style.display = modelSelect.value === '__other' ? '' : 'none'; suggestPhoto(); };

  document.querySelector('#photo-files').onchange = async event => {
    const files = [...event.target.files].slice(0, 6 - photos.length);
    for (const file of files) {
      try { note.textContent = 'מעלה תמונה…'; const url = await uploadPublicMedia(file, 'car-image'); addPhoto(url); }
      catch (error) { toast(error.message); }
    }
    note.textContent = `${photos.length} תמונות נוספו`;
    event.target.value = '';
  };
  document.querySelector('#auto-car-image').onclick = async () => {
    const make = currentMake(), model = modelSelect.value === '__other' ? modelInput.value : modelSelect.value;
    if (!make || !model) return toast('בחרו יצרן ודגם קודם');
    try {
      note.textContent = 'מחפש תמונה רשמית…';
      const response = await fetch('/api/car-image-search', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({make, model, year: form.year.value, trim: form.trim.value})});
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.url) throw new Error(result.error || 'לא נמצאה תמונה מתאימה — אפשר להעלות תמונה מהגלריה');
      addPhoto(result.url);
      note.textContent = `${result.title || 'תמונה'} ${result.license ? '· ' + result.license : ''}`;
    } catch (error) { toast(error.message); note.textContent = error.message; }
  };
  document.querySelector('#video-file').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    const status = document.querySelector('#video-status');
    try { status.textContent = 'מעלה סרטון…'; videoUrl = await uploadPublicMedia(file, 'car-video'); status.textContent = 'הסרטון הועלה ✓'; }
    catch (error) { toast(error.message); status.textContent = error.message; }
  };

  form.onsubmit = async event => {
    event.preventDefault();
    if (!photos.length) return toast('יש להוסיף לפחות תמונה אחת של הרכב');
    const make = currentMake();
    const model = modelSelect.value === '__other' ? modelInput.value.trim() : modelSelect.value;
    if (!make || !model) return toast('יש לבחור יצרן ודגם');
    const data = formData(event.target);
    const onRequest = !!priceOnReq?.checked;
    data.priceOnRequest = onRequest;
    if (!onRequest) {  // require the mode's prices only when a price is actually shown
      const mode = data.rentalMode || 'hourly_daily';
      const required = MODE_PRICES[mode] || MODE_PRICES.hourly_daily;
      const priceName = {hourly: 'priceHourly', daily: 'dailyPrice', weekly: 'priceWeekly'};
      for (const key of Object.keys(required)) {
        if (!(Number(data[priceName[key]]) > 0)) return toast('יש להזין את כל המחירים הנדרשים לאופן ההשכרה שנבחר');
      }
    }
    // Weekend rental: only kept for hourly / hourly-daily cars (not long-term / price-on-request), and
    // a weekend price is then required.
    const weekendOn = weekendAllowed() && !!weekendCheck?.checked;
    data.weekendEnabled = weekendOn;
    if (weekendOn && !(Number(data.weekendPrice) > 0)) return toast('יש להזין מחיר קבוע לסופ״ש, או לבטל את האפשרות');
    if (!weekendOn) data.weekendPrice = 0;
    data.make = make; data.model = model;
    data.photos = photos;
    data.photoUrl = mainUrl || photos[0];
    data.videoUrl = videoUrl;
    delete data.makeSelect; delete data.modelSelect;
    const submit = document.querySelector('#car-submit');
    submit.disabled = true; submit.textContent = 'שומר…';
    try {
      if (editing) await updateCar(car.id, data); else await createCar(data);
      try { sessionStorage.removeItem(draftKey); } catch {}  // the draft made it in — drop it
      closeModal(); toast(editing ? 'הרכב עודכן' : 'הרכב פורסם');
    } catch (error) { toast(error.message); submit.disabled = false; submit.textContent = editing ? 'שמירת שינויים' : 'פרסום הרכב'; }
  };
}

async function migratePrompt() {
  try {
    const status = await legacyStatus();
    if (!status?.exists) return toast('לא נמצאו נתונים ישנים');
    if (!confirm(`נמצאו ${status.cars} רכבים, ${status.owners + status.renters} משתמשים ו-${status.bookings} הזמנות. להעתיק למבנה החדש בלי למחוק את הישן?`)) return;
    const count = await migrateLegacy();
    toast(`הועתקו ${count} רשומות`);
  } catch (error) { toast(error.message); }
}
// Move existing inline (base64) car images to Storage/CDN so the public catalog loads fast. The
// server migrates a small batch per call (never times out); we loop until it reports done.
async function migrateMediaPrompt() {
  if (!confirm('להעביר את תמונות הרכבים לאחסון CDN? זה מאיץ משמעותית את טעינת האתר. הפעולה בטוחה, חד-פעמית וניתן להריץ אותה שוב.')) return;
  const button = document.querySelector('#media-migrate');
  const label = button?.textContent;
  if (button) button.disabled = true;
  let total = 0;
  try {
    for (let i = 0; i < 60; i++) {
      const res = await api('media-migrate', {});
      total += res.migrated || 0;
      if (button) button.textContent = `מעביר תמונות… (${total})`;
      if (res.done) break;
    }
    toast(total ? `הועברו ${total} תמונות ל-CDN — הטעינה תהיה מהירה יותר` : 'כל התמונות כבר מאוחסנות ב-CDN');
  } catch (error) { toast(error.message); }
  finally { if (button) { button.disabled = false; button.textContent = label; } }
}

