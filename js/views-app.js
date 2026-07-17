import {store, list, myRole, myBookings, myCars, carRating, carRatingCount, userRating} from './store.js';
import {esc, money, fmtDate, statusLabel, verificationLabel, modal, closeModal, formData, toast, stars, validEmail, paintApp, resetPaint, TERMS_VERSION} from './core.js';
import {register, login, logout, sendVerify, refreshEmailStatus, sendPasswordReset, createOwnProfile, signInGuest} from './auth.js';
import {saveUser, setOwnPhoto, createCar, updateCar, deleteCar, createBooking, startInquiry, setBookingStatus, registerDocument, approveVerification, sendMessage, savePayment, saveHandover, submitRating, carMediaPublic, adminAction, setMaintenance, setCarStatus, setCarFeatured, checkIsAdmin, saveExternalRental, deleteExternalRental} from './db.js';
import {uploadPrivate, uploadPublicMedia, signedRead, capturePhoto} from './media.js';
import {legacyStatus, migrateLegacy} from './migrate.js';
import {api} from './api.js';
import {saveAuthReturn, afterAuthDestination, openCar, CAR_MAKES, CAR_TYPES, ICON, MODELS_BY_MAKE, RENTAL_MODES, TAB_ICONS, app, avatarHtml, carImage, carPhotoList, carStatusPill, carYears, composePhone, emptyState, fallbackImage, kpi, phoneField, roleName, selectOptions, bindCarButtons, carGrid, featuredFirst, userUnreadNotifs, bottomNav} from './views.js';

// Incremental list rendering (audit #30 / design spec §22): long admin lists paint the first 30
// records and grow by 50 per tap, so the DOM stays light as the community grows. State survives
// re-renders within the session; the button disappears once everything is shown.
const listPages = {};
const pageOf = key => listPages[key] || 30;
const listMoreBtn = (key, total) => total > pageOf(key) ? `<button class="btn outline block list-more" data-list-more="${key}">הצגת עוד (${total - pageOf(key)} נוספים)</button>` : '';

function dashboardLayout(title, tabs, active, content, actions = '', navFooter = '') {
  const firstName = String(store.profile?.name || '').trim().split(/\s+/)[0];
  const eyebrow = firstName ? `שלום, ${esc(firstName)}` : 'האזור האישי';
  return `<div class="dashboard-shell"><header class="dashboard-head">
      <div class="dash-head-top">
        <div class="dash-head-titles"><p class="eyebrow">${eyebrow}</p><h1>${esc(title)}</h1></div>
        <div class="dash-head-controls"><button type="button" class="dash-bell" data-goto-notifications aria-label="התראות">🔔${userUnreadNotifs() ? `<span class="tab-badge">${userUnreadNotifs()}</span>` : ''}</button><button type="button" class="avatar-btn" data-goto-profile title="לפרופיל שלי">${avatarHtml(store.profile, 60)}</button><button type="button" class="dash-close" data-route="home" aria-label="סגירת האזור האישי">✕</button></div>
      </div>
      ${actions ? `<div class="dash-head-actions">${actions}</div>` : ''}
    </header><nav class="dashboard-tabs" aria-label="תפריט אזור אישי">${tabs.map(([key, label]) => key === '#'
      ? `<span class="tab-group-label">${esc(label)}</span>`
      : `<button class="tab ${key === active ? 'active' : ''}" data-dashboard-tab="${key}"><i class="tab-ic">${(TAB_ICONS[key] || (() => ''))()}</i><span>${label}</span></button>`).join('')}${navFooter ? `<div class="nav-footer">${navFooter}</div>` : ''}</nav><section class="card panel dashboard-panel" data-tab="${esc(active)}">${content}</section></div>`;
}
// The dashboard tab the user is currently on. Kept across re-renders so a data event (new message,
// booking update…) no longer resets the personal area to "overview" and bounces the user to the main page.
function bindDashboardTabs(renderer) {
  document.querySelector('[data-goto-notifications]')?.addEventListener('click', () => { store.dashTab = 'notifications'; renderer('notifications'); });
  document.querySelectorAll('[data-dashboard-tab]').forEach(button => button.onclick = () => {
    const tab = button.dataset.dashboardTab;
    if (tab === 'chats') { location.hash = 'chats'; return; }  // full-screen messaging page
    store.dashTab = tab; renderer(tab);
  });
  // "דורש טיפול" rows and quick links inside an overview jump straight to a tab (shared by renter/owner).
  document.querySelectorAll('[data-goto-tab]').forEach(button => button.onclick = () => {
    const tab = button.dataset.gotoTab;
    if (tab === 'chats') { location.hash = 'chats'; return; }
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
  maybeReconsent();
}

// Re-consent (audit #10): when the terms/privacy version moves past what the user accepted (or an old
// account has no acceptance record at all), a one-time-per-session dialog asks them to read + confirm.
// Booking itself re-collects consent per booking, so this keeps the USER-LEVEL record current.
let reconsentShownAt = '';
function maybeReconsent() {
  if (!store.user || store.user.isAnonymous || !store.profileLoaded) return;
  if (store.profile?.legalAcceptance?.termsVersion === TERMS_VERSION) return;
  if (reconsentShownAt === store.user.uid) return;  // once per session per account
  reconsentShownAt = store.user.uid;
  modal(`<div class="modal-head"><h2>עדכנו את התנאים</h2><button class="close" data-close-modal>×</button></div>
    <p>עדכנו את <a href="terms.html" target="_blank" rel="noopener">תנאי השימוש</a> ואת <a href="privacy.html" target="_blank" rel="noopener">מדיניות הפרטיות</a>. כדי להמשיך להשתמש בכל האפשרויות, אנא קראו ואשרו את הגרסה העדכנית.</p>
    <button class="btn primary block" id="reconsent-ok">קראתי ואני מאשר/ת</button>`);
  document.querySelector('#reconsent-ok')?.addEventListener('click', async () => {
    const btn = document.querySelector('#reconsent-ok');
    btn.disabled = true;
    try {
      const result = await api('profile-save', {action: 'accept-terms'});
      if (store.profile) store.profile.legalAcceptance = {termsVersion: result.termsVersion, acceptedAt: Date.now()};
      closeModal(); toast('תודה! ההסכמה נרשמה');
    } catch (error) { toast(error.message); btn.disabled = false; }
  });
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

// The user's in-app inbox (booking / payment / reserve updates written by the server). Opening the
// tab stamps "seen", which clears the red badges in both nav bars.
const NOTIF_EMOJI = {booking: '📅', payment: '💳', status: '🔔', reserve: '🚗'};
function userNotificationsView() {
  const rows = list(store.userNotifications).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  const seen = Number(localStorage.getItem('cd-notif-seen') || 0);
  try { localStorage.setItem('cd-notif-seen', String(Date.now())); } catch {}
  return `<h2 style="margin-bottom:16px">התראות</h2><div class="list">${rows.length ? rows.map(n =>
    `<div class="notif-row ${Number(n.createdAt || 0) > seen ? 'unread' : ''}"><span class="notif-icon">${NOTIF_EMOJI[n.type] || '🔔'}</span><div class="notif-main"><b>${esc(n.text || '')}</b><small>${fmtDate(n.createdAt)}</small></div></div>`).join('')
    : '<div class="empty">אין התראות עדיין — עדכונים על הזמנות ותשלומים יופיעו כאן</div>'}</div>`;
}

// ---- Off-site rentals (השכרות חוץ): rentals the owner closed OUTSIDE the site, logged manually ----
// Pure owner bookkeeping: a list + a summary of total hours and total income, computed only from what
// the owner entered. Stored under externalRentals/<ownerUid> (own node; admins can read for support).
const extHours = r => {
  const ms = new Date(r.endAt).getTime() - new Date(r.startAt).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms / 3600000 : 0;
};
const fmtHours = h => {
  if (!h) return '0 שעות';
  const days = Math.floor(h / 24), rest = Math.round(h % 24);
  if (!days) return `${Math.round(h * 10) / 10} שעות`;
  return rest ? `${days} ימ׳ ${rest} שע׳` : `${days} ימים`;
};
const extDT = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('he-IL', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}); };
function externalRentalsView(cars) {
  const rows = list(store.externalRentals).sort((a, b) => String(b.startAt).localeCompare(String(a.startAt)));
  const totalHours = rows.reduce((sum, r) => sum + extHours(r), 0);
  const totalAmount = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const carName = r => { const c = r.carId && store.cars[r.carId]; return c ? `${c.make || ''} ${c.model || ''}`.trim() : (r.carLabel || 'רכב'); };
  // Per-car breakdown — only worth showing when the records span more than one car.
  const byCar = {};
  for (const r of rows) { const k = carName(r); byCar[k] = byCar[k] || {hours: 0, amount: 0, count: 0}; byCar[k].hours += extHours(r); byCar[k].amount += Number(r.amount || 0); byCar[k].count++; }
  const carKeys = Object.keys(byCar);
  return `<div class="section-head"><h2>השכרות חוץ</h2><button class="btn gold" id="ext-add">+ הוספת השכרה</button></div>
    <p class="mut ext-sub">השכרות שסגרתם מחוץ לאתר — נרשמות כאן לניהול שלכם בלבד, והסיכום מחושב לפי מה שהזנתם.</p>
    <div class="kpis">${kpi('calendar', rows.length, 'השכרות חוץ')}${kpi('check', fmtHours(totalHours), 'סה״כ שעות השכרה')}${kpi('money', money(totalAmount), 'סה״כ הכנסה')}</div>
    ${carKeys.length > 1 ? `<div class="mini-panel ext-bycar"><div class="mini-panel-head"><h3>לפי רכב</h3><span>${carKeys.length} רכבים</span></div>${carKeys.map(k => `<div class="mini-row"><b>${esc(k)}</b><span class="mut">${byCar[k].count} · ${fmtHours(byCar[k].hours)} · ${money(byCar[k].amount)}</span></div>`).join('')}</div>` : ''}
    <div class="list">${rows.length ? rows.map(r => `<div class="card inset ext-row">
      <div class="ext-row-head"><b>${esc(carName(r))}</b><b class="ext-amount">${money(r.amount)}</b></div>
      <div class="ext-row-sub"><span>${esc(r.renterName || 'שוכר')}${r.renterPhone ? ` · ${esc(r.renterPhone)}` : ''}</span><span>${extDT(r.startAt)} ← ${extDT(r.endAt)} · ${fmtHours(extHours(r))}</span></div>
      ${r.notes ? `<p class="mut ext-notes">${esc(r.notes)}</p>` : ''}
      <div class="chips"><button class="btn outline" data-ext-edit="${esc(r.id)}">עריכה</button><button class="btn outline" data-ext-del="${esc(r.id)}">מחיקה</button></div>
    </div>`).join('') : emptyState(ICON.calendar, 'עוד לא נרשמו השכרות חוץ', 'השכרתם רכב שלא דרך האתר? הוסיפו אותה כאן ותקבלו סיכום שעות והכנסות מסודר.')}</div>`;
}
function bindExternalRentals(cars, renderer) {
  document.querySelector('#ext-add')?.addEventListener('click', () => externalRentalModal(cars, null, renderer));
  document.querySelectorAll('[data-ext-edit]').forEach(btn => btn.onclick = () => {
    const r = store.externalRentals[btn.dataset.extEdit];
    if (r) externalRentalModal(cars, {id: btn.dataset.extEdit, ...r}, renderer);
  });
  document.querySelectorAll('[data-ext-del]').forEach(btn => btn.onclick = async () => {
    if (!confirm('למחוק את רישום ההשכרה?')) return;
    try { await deleteExternalRental(btn.dataset.extDel); toast('הרישום נמחק'); renderer('external'); }
    catch (error) { toast(error.message); }
  });
}
function externalRentalModal(cars, existing, renderer) {
  const toLocal = iso => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''; };
  modal(`<div class="modal-head"><h2>${existing ? 'עריכת השכרת חוץ' : 'הוספת השכרת חוץ'}</h2><button class="close" data-close-modal>×</button></div>
    <form id="ext-form">
      <div class="field"><label>רכב</label><select name="carId">${cars.map(c => `<option value="${esc(c.id)}" ${existing?.carId === c.id ? 'selected' : ''}>${esc(`${c.make || ''} ${c.model || ''}`.trim() || 'רכב')}</option>`).join('')}<option value="" ${existing && !existing.carId ? 'selected' : ''}>רכב אחר (שם חופשי)</option></select></div>
      <div class="field" id="ext-freecar" style="${existing && !existing.carId ? '' : 'display:none'}"><label>שם הרכב</label><input name="carLabel" value="${esc(existing?.carLabel || '')}" maxlength="120" placeholder="למשל: Toyota Sienna 2022"></div>
      <div class="form-grid"><div class="field"><label>שם השוכר</label><input name="renterName" value="${esc(existing?.renterName || '')}" maxlength="120" required></div><div class="field"><label>טלפון (לא חובה)</label><input name="renterPhone" value="${esc(existing?.renterPhone || '')}" maxlength="40" inputmode="tel"></div></div>
      <div class="form-grid"><div class="field"><label>תחילת השכרה</label><input name="startAt" type="datetime-local" value="${toLocal(existing?.startAt)}" required></div><div class="field"><label>סיום השכרה</label><input name="endAt" type="datetime-local" value="${toLocal(existing?.endAt)}" required></div></div>
      <div class="field"><label>סכום שנגבה ($)</label><input name="amount" type="number" inputmode="decimal" min="0" step="0.01" value="${existing ? esc(existing.amount) : ''}" required></div>
      <div class="field"><label>הערות</label><textarea name="notes" maxlength="1000" placeholder="תנאים מיוחדים, פיקדון, דלק…">${esc(existing?.notes || '')}</textarea></div>
      <button class="btn primary block">${existing ? 'שמירת השינויים' : 'הוספה לרשימה'}</button>
    </form>`);
  const form = document.querySelector('#ext-form');
  form.carId.onchange = () => { document.querySelector('#ext-freecar').style.display = form.carId.value ? 'none' : ''; };
  form.onsubmit = async event => {
    event.preventDefault();
    const data = formData(form);
    const start = new Date(data.startAt), end = new Date(data.endAt);
    if (!(end > start)) return toast('שעת הסיום חייבת להיות אחרי שעת ההתחלה');
    const btn = event.submitter; if (btn) btn.disabled = true;
    try {
      await saveExternalRental(existing?.id || null, {...data, startAt: start.toISOString(), endAt: end.toISOString(), createdAt: existing?.createdAt});
      closeModal(); toast(existing ? 'הרישום עודכן' : 'ההשכרה נוספה'); renderer('external');
    } catch (error) {
      toast(/permission_denied|PERMISSION/i.test(String(error?.message)) ? 'אין הרשאה — יש לפרסם את חוקי ה-Firebase המעודכנים (externalRentals)' : error.message);
      if (btn) btn.disabled = false;
    }
  };
}

function renterDashboard(tab = 'overview') {

  const bookings = myBookings();
  const verification = store.profile?.verification || {};
  const active = bookings.filter(b => b.status === 'active').length;
  const pending = bookings.filter(b => b.status === 'pending').length;
  const done = bookings.filter(b => b.status === 'done').length;
  // "דורש טיפול" for the renter: an unfinished license verification is the one thing that blocks them
  // from booking — surface it as a tappable row that jumps to the profile/verification tab.
  const renterTodo = [
    verification.status !== 'approved' && [verification.status === 'pending' ? 'האימות שלך בבדיקה' : 'להשלים אימות רישיון', verification.status === 'pending' ? '⏳' : '!', 'profile'],
  ].filter(Boolean);
  const todoHtml = renterTodo.length
    ? `<div class="admin-todo">${renterTodo.map(([label, n, t]) => `<button class="todo-row" data-goto-tab="${t}"><span class="todo-count">${n}</span><span class="todo-label">${esc(label)}</span><span class="todo-go" aria-hidden="true">›</span></button>`).join('')}</div>`
    : '';
  const contents = {
    overview: `${todoHtml}<div class="admin-stats-mini"><span><b>${active}</b> פעילות</span><span><b>${pending}</b> ממתינות</span><span><b>${done}</b> הושלמו</span><span><b>${verification.status === 'approved' ? '✓' : '—'}</b> אימות</span></div><h2>ההזמנות שלי</h2>${bookingList(bookings, 'renter')}`,
    bookings: `<h2>ההזמנות שלי</h2>${bookingList(bookings, 'renter')}`,
    profile: profileView(),
    notifications: userNotificationsView(),
    messages: messagesView(),
  };
  app().innerHTML = dashboardLayout('האזור האישי', [['overview','סקירה'],['bookings','הזמנות'],['chats','צ׳אטים'],['notifications',`התראות${userUnreadNotifs() ? ` (${userUnreadNotifs()})` : ''}`],['profile','פרופיל ואימות']], tab, contents[tab] || contents.overview);
  bindDashboardTabs(renterDashboard); bindActions(); bindProfileActions();
}

function ownerDashboard(tab = 'overview') {
  const bookings = myBookings();
  const cars = myCars();
  // Real earnings = payments the owner APPROVED (paymentApproved also grandfathers legacy no-status rows) —
  // pending/rejected proofs are counted separately so the KPI never overstates income.
  const payments = Object.values(store.payments || {});
  const approvedTotal = payments.filter(paymentApproved).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const pendingPayments = payments.filter(p => p && p.status === 'pending').length;
  const pendingBook = bookings.filter(b => b.status === 'pending').length;
  // "דורש טיפול" — the owner's action items (an approval waiting, a payment to check) as tappable rows
  // that jump to the bookings tab, instead of a static notice the owner can't act on directly.
  const ownerTodo = [
    pendingBook && ['הזמנות ממתינות לאישורך', pendingBook, 'bookings'],
    pendingPayments && ['תשלומים ממתינים לאישורך', pendingPayments, 'bookings'],
  ].filter(Boolean);
  const todoHtml = ownerTodo.length
    ? `<div class="admin-todo"><div class="admin-sec-h">דורש טיפול</div>${ownerTodo.map(([label, n, t]) => `<button class="todo-row" data-goto-tab="${t}"><span class="todo-count">${n}</span><span class="todo-label">${esc(label)}</span><span class="todo-go" aria-hidden="true">›</span></button>`).join('')}</div>`
    : '';
  const contents = {
    overview: `${todoHtml}<div class="admin-stats-mini"><span><b>${cars.length}</b> רכבים</span><span><b>${cars.filter(c => c.status === 'available').length}</b> זמינים</span><span><b>${money(approvedTotal)}</b> הכנסות</span><span><b>${bookings.filter(b => b.status === 'active').length}</b> פעילות</span></div><h2>הזמנות פעילות</h2>${bookingList(bookings.filter(b => ['pending','approved','active'].includes(b.status)), 'owner')}`,
    bookings: `<h2>הזמנות</h2>${bookingList(bookings, 'owner')}`,
    cars: `<div class="section-head"><h2>הרכבים שלי</h2><div class="chips"><button class="btn outline" id="goto-external">📒 השכרות חוץ</button><button class="btn gold" id="add-car">הוספת רכב</button></div></div>${carGrid(cars, true)}`,
    external: externalRentalsView(cars),
    notifications: userNotificationsView(),
    profile: ownerProfileView(),
  };
  app().innerHTML = dashboardLayout('לוח בעל רכב', [['overview','סקירה'],['bookings','הזמנות'],['cars','רכבים'],['external','השכרות חוץ'],['chats','צ׳אטים'],['notifications',`התראות${userUnreadNotifs() ? ` (${userUnreadNotifs()})` : ''}`],['profile','פרופיל']], tab, contents[tab] || contents.overview, '<button class="btn gold" id="add-car-head">+ הוספת רכב</button>');
  bindDashboardTabs(ownerDashboard); bindActions(); bindCarButtons(); bindProfileActions();
  document.querySelector('#add-car')?.addEventListener('click', () => carForm());
  document.querySelector('#add-car-head')?.addEventListener('click', () => carForm());
  document.querySelector('#goto-external')?.addEventListener('click', () => { store.dashTab = 'external'; ownerDashboard('external'); });
  if (tab === 'external') bindExternalRentals(cars, ownerDashboard);
  if (tab === 'cars') injectCarStats(bookings);
}

// Per-car performance strip on the "הרכבים שלי" tab: bookings, approved earnings and rating for THIS car —
// injected after paint so the shared carCard stays untouched for the public site. Shared by the owner
// dashboard and the admin's personal "הרכבים שלי" tab.
function injectCarStats(bookings) {
  document.querySelectorAll('#app [data-car-open]').forEach(cardEl => {
    if (cardEl.querySelector('.car-stats')) return;
    const carId = cardEl.dataset.carOpen;
    const carBookings = bookings.filter(b => b.carId === carId && !['cancelled', 'rejected', 'expired'].includes(b.status));
    const earned = carBookings.reduce((sum, b) => { const p = store.payments[b.id]; return sum + (paymentApproved(p) ? Number(p.amount || 0) : 0); }, 0);
    const rating = carRating(carId);
    const strip = `<div class="car-stats"><span>📅 ${carBookings.length} הזמנות</span><span>💵 ${money(earned)}</span>${rating ? `<span>⭐ ${rating.toFixed(1)}</span>` : ''}</div>`;
    cardEl.querySelector('.car-manage')?.insertAdjacentHTML('beforebegin', strip);
  });
}

function adminDashboard(tab = 'overview') {
  // Users needing verification review float to the top (they're the action items), then newest-first.
  const users = list(store.users).map(user => ({...user, verification: {...(user.verification || {}), status: store.verificationStatuses[user.id] || 'missing'}}))
    .sort((a, b) => ((a.verification.status === 'pending' ? 0 : 1) - (b.verification.status === 'pending' ? 0 : 1)) || Number(b.createdAt || 0) - Number(a.createdAt || 0));
  const bookings = myBookings();
  const cars = list(store.cars);
  // The admin's PERSONAL cars (they're an owner too) — strictly ownerUid === self, unlike myCars()
  // which gives an admin the whole fleet.
  const adminOwnCars = cars.filter(car => car.ownerUid === store.user?.uid);
  const total = Object.values(store.payments).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  // "Needs attention" — the items the admin must act on, surfaced at the very top so nothing is missed.
  const pendingVerif = users.filter(u => u.verification?.status === 'pending').length;
  const pendingPay = Object.values(store.payments).filter(p => p && p.status === 'pending').length;
  const pendingBook = bookings.filter(b => b.status === 'pending').length;
  const unread = adminUnreadCount();
  const todo = [
    pendingVerif && ['users', pendingVerif, 'אימותים ממתינים לבדיקה'],
    pendingPay && ['bookings', pendingPay, 'תשלומים ממתינים לאישור'],
    pendingBook && ['bookings', pendingBook, 'הזמנות ממתינות לאישור'],
    unread && ['chats', unread, 'הודעות צ׳אט שלא נקראו'],
  ].filter(Boolean);
  // A SIMPLE control hub (user: "האזור האישי של המנהל מאוד מאוד מסובך"): (1) a plain "what needs you"
  // list where each row jumps straight to it, (2) big labeled tiles so every area is one tap away
  // (no hunting in "עוד"), (3) a compact stats strip, (4) search + rare tools folded away at the bottom.
  const todoHtml = todo.length
    ? `<div class="admin-todo"><div class="admin-sec-h">דורש טיפול</div>${todo.map(([t, n, label]) => `<button class="todo-row" data-nav-tab="${t}"><span class="todo-count">${n}</span><span class="todo-label">${esc(label)}</span><span class="todo-go" aria-hidden="true">›</span></button>`).join('')}</div>`
    : `<div class="admin-allclear"><span class="ac-ic">✓</span><div><b>הכל מטופל</b><small>אין כרגע פעולות שממתינות לך</small></div></div>`;
  const navTile = (t, label, icon, tint, badge = 0) => `<button class="hub-tile" data-nav-tab="${t}"><span class="hub-ic tint-${tint}">${icon}</span><b>${esc(label)}</b>${badge ? `<span class="hub-badge">${badge}</span>` : ''}</button>`;
  const contents = {
    overview: `${todoHtml}
      <div class="admin-sec-h">ניהול האתר</div>
      <div class="admin-hub">${navTile('users', 'משתמשים', ICON.users, 'purple', pendingVerif)}${navTile('bookings', 'הזמנות', ICON.calendar, 'blue', pendingPay + pendingBook)}${navTile('cars', 'רכבים', ICON.car, 'gold')}${navTile('chats', 'צ׳אטים', ICON.chat, 'green', unread)}</div>
      <div class="admin-sec-h">האזור שלי — בעל רכב</div>
      <div class="admin-hub">${navTile('myCars', 'הרכבים שלי', ICON.car, 'blue')}${navTile('external', 'השכרות חוץ', ICON.money, 'gold')}${navTile('profile', 'פרופיל', ICON.selfie, 'slate')}</div>
      <div class="admin-stats-mini"><span><b>${bookings.length}</b> הזמנות</span><span><b>${money(total)}</b> תשלומים</span><span><b>${users.length}</b> משתמשים</span><span><b>${cars.length}</b> רכבים</span></div>
      <div class="field admin-search-wrap"><input id="admin-search" placeholder="🔎 חיפוש משתמש, רכב או הזמנה…" autocomplete="off"></div><div id="admin-search-results"></div>
      <details class="admin-tools"><summary>הגדרות וכלים</summary><div class="admin-tools-grid"><button class="btn ${store.config?.maintenance?.on ? 'danger' : 'outline'}" id="maintenance-toggle">${store.config?.maintenance?.on ? 'האתר בתחזוקה — לחצו לפתיחה' : 'מצב תחזוקה'}</button><button class="btn outline" id="export-json">ייצוא JSON</button><button class="btn outline" id="legacy-migrate">העברת נתונים ישנים</button><button class="btn outline" id="media-migrate" title="מעביר תמונות רכב ישנות מהמסד לאחסון CDN — מאיץ את טעינת האתר">⚡ האצת טעינה (תמונות)</button></div></details>`,
    users: `<h2 style="margin-bottom:16px">משתמשים ואימותים</h2>${adminUsersTable(users)}`,
    cars: `<h2 style="margin-bottom:16px">רכבים</h2>${adminCarsTable(cars)}`,
    // The admin is ALSO a car owner: a personal "הרכבים שלי" tab (strictly their own cars, with the
    // owner's per-car stats strip) and the off-site rentals log — same tools an owner gets.
    myCars: `<div class="section-head"><h2>הרכבים שלי</h2><div class="chips"><button class="btn outline" id="goto-external">📒 השכרות חוץ</button><button class="btn gold" id="add-car">הוספת רכב</button></div></div>${carGrid(adminOwnCars, true)}`,
    external: externalRentalsView(adminOwnCars),
    bookings: `<h2 style="margin-bottom:16px">הזמנות</h2>${bookingList(bookings, 'admin')}`,
    notifications: adminNotificationsView(),
    profile: ownerProfileView(),
  };
  // Two clear zones (user: "האזור האישי של המנהל חייב סידור מחדש"): site management first,
  // then the admin's own owner-side area — mirrored in the desktop tab bar and the mobile "עוד" sheet.
  app().innerHTML = dashboardLayout('לוח ניהול מנהל', [
    ['#', 'ניהול האתר'],
    ['overview','סקירה'],['users','משתמשים'],['cars','רכבים'],['bookings','הזמנות'],['chats','צ׳אטים'],['notifications', `התראות${unread ? ` (${unread})` : ''}`],
    ['#', 'האזור שלי'],
    ['myCars','הרכבים שלי'],['external','השכרות חוץ'],['profile','פרופיל'],
  ], tab, contents[tab] || contents.overview, '<button class="btn gold" id="admin-add-car">+ הוספת רכב</button>', '<button class="btn dark-out block" id="admin-refresh" title="רענון נתונים">רענון</button><button class="btn dark-out block" id="admin-logout">יציאה</button>');
  document.querySelector('#admin-add-car')?.addEventListener('click', () => carForm());
  document.querySelector('#add-car')?.addEventListener('click', () => carForm());
  document.querySelector('#goto-external')?.addEventListener('click', () => { store.dashTab = 'external'; adminDashboard('external'); });
  if (tab === 'external') bindExternalRentals(adminOwnCars, adminDashboard);
  if (tab === 'myCars') injectCarStats(bookings.filter(b => adminOwnCars.some(c => c.id === b.carId)));
  document.querySelector('#admin-refresh')?.addEventListener('click', () => window.location.reload());
  document.querySelector('#admin-logout')?.addEventListener('click', async () => { try { await logout(); location.hash = 'home'; } catch (error) { toast(error.message); } });
  bindDashboardTabs(adminDashboard); bindActions(); bindCarButtons(); bindProfileActions();
  // Overview hub tiles + "דורש טיפול" rows jump straight to an area; chats is a full-screen page.
  document.querySelectorAll('[data-nav-tab]').forEach(btn => btn.onclick = () => {
    const t = btn.dataset.navTab;
    if (t === 'chats') { location.hash = 'chats'; return; }
    store.dashTab = t; adminDashboard(t);
  });
  document.querySelectorAll('[data-admin-user]').forEach(button => button.onclick = () => adminUserModal(button.dataset.adminUser));
  // One-tap approval straight from a pending user's card (the modal path with the documents stays
  // available via "מסמכים"; the server still refuses if the three documents are missing).
  document.querySelectorAll('[data-quick-approve]').forEach(button => button.onclick = async () => {
    const uid = button.dataset.quickApprove;
    const name = store.users[uid]?.name || store.users[uid]?.email || 'המשתמש';
    if (!confirm(`לאשר את האימות של ${name}? מומלץ לבדוק קודם את המסמכים (כפתור "מסמכים").`)) return;
    button.disabled = true;
    try { await approveVerification(uid, 'approved'); toast('האימות אושר ✓'); }
    catch (error) { toast(error.message); button.disabled = false; }
  });
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
  return `<div class="admin-cards">${users.slice(0, pageOf('users')).map(user => {
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
        ${vs === 'pending' ? `<button class="btn primary auc-approve" data-quick-approve="${esc(user.id)}">✓ אישור אימות</button>` : ''}
        <button class="btn outline" data-admin-user="${esc(user.id)}">מסמכים</button>
        <button class="btn outline" data-admin-rentals="${esc(user.id)}">${count} השכרות</button>
        <span class="auc-icons"><button class="icon-btn" title="שליחת הודעה" data-user-message="${esc(user.id)}">${ICON.chat}</button><button class="icon-btn" title="עריכה" data-user-edit="${esc(user.id)}">${ICON.edit}</button><button class="icon-btn ${user.blocked ? '' : 'danger'}" title="${user.blocked ? 'שחרור חסימה' : 'חסימה'}" data-user-block="${esc(user.id)}">${user.blocked ? ICON.check : ICON.block}</button><button class="icon-btn danger" title="מחיקה" data-user-delete="${esc(user.id)}">${ICON.trash}</button></span>
      </div>
    </div>`;
  }).join('')}</div>${listMoreBtn('users', users.length)}`;
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
  // "פרטי הרכב" on a booking card → open the car's detail modal (data-car-open can't be used on a button —
  // bindCarButtons deliberately ignores clicks that land on buttons).
  root.querySelectorAll('[data-view-car]').forEach(button => button.onclick = () => openCar(button.dataset.viewCar));
}
function adminCarsTable(cars) {
  if (!cars.length) return '<div class="empty">אין רכבים</div>';
  return `<div class="table-wrap"><table class="data"><thead><tr><th>רכב</th><th>בעל הרכב</th><th>מחיר/יום</th><th>סטטוס (לחצו)</th><th>ניהול</th></tr></thead><tbody>${featuredFirst(cars).slice(0, pageOf('cars')).map(car => `<tr><td class="t-main">${car.featured ? '★ ' : ''}${esc(car.make || '')} ${esc(car.model || '')} ${esc(car.year || '')}</td><td>${esc(car.ownerName || '—')}</td><td>${money(car.dailyPrice || 0)}</td><td><button type="button" class="pill-btn" data-car-avail="${esc(car.id)}" data-next="${car.status === 'rented' ? 'available' : 'rented'}" title="לחצו לשינוי תפוס / פנוי">${carStatusPill(car.status)}</button></td><td><div class="t-actions"><button class="icon-btn feat-btn ${car.featured ? 'feat-on' : ''}" title="${car.featured ? 'ביטול קידום לראש הרשימה' : 'קידום לראש הרשימה'}" data-car-feature="${esc(car.id)}" data-on="${car.featured ? '' : '1'}">★</button><button class="icon-btn" title="עריכת רכב" data-car-edit="${esc(car.id)}">${ICON.edit}</button><button class="icon-btn" title="${car.status === 'hidden' ? 'הצגת הרכב' : 'הסתרת הרכב'}" data-car-toggle="${esc(car.id)}">${ICON.eye}</button><button class="icon-btn danger" title="מחיקה" data-car-delete="${esc(car.id)}">${ICON.trash}</button></div></td></tr>`).join('')}</tbody></table></div>${listMoreBtn('cars', cars.length)}`;
}

// Booking progress timeline (design doc §13): בקשה → אישור → תשלום → איסוף → החזרה → הושלם.
// Completed steps fill in brand-blue, the CURRENT step pulses — only the next action is emphasized.
// Cancelled/rejected/expired bookings skip the strip (their badge already tells the story).
function bookingTimeline(booking, pmt) {
  if (['cancelled', 'rejected', 'expired'].includes(booking.status)) return '';
  const paid = !!pmt && (pmt.status === 'approved' || (!pmt.status && pmt.amount));  // legacy proofs grandfathered
  const steps = [
    ['בקשה', true],
    ['אישור', ['approved', 'active', 'done'].includes(booking.status)],
    ['תשלום', paid],
    ['איסוף', !!booking.handover?.pickup || ['active', 'done'].includes(booking.status)],
    ['החזרה', !!booking.handover?.return || booking.status === 'done'],
    ['הושלם', booking.status === 'done'],
  ];
  const currentIndex = steps.findIndex(([, done]) => !done);
  return `<div class="bk-timeline" aria-label="התקדמות ההזמנה">${steps.map(([label, done], i) =>
    `<div class="bk-step${done ? ' done' : ''}${i === currentIndex ? ' now' : ''}"><span class="bk-dot"></span><small>${label}</small></div>`).join('')}</div>`;
}

function bookingList(bookings, role) {
  const sorted = bookings.slice().sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return `<div class="list">${sorted.length ? sorted.slice(0, pageOf(`bookings-${role}`)).map(booking => {
    const car = store.cars[booking.carId] || {};
    const ratingButtons = booking.status === 'done' ? (role === 'renter' ? `<button class="btn outline" data-rate="${booking.id}" data-rate-type="car">דרג רכב</button><button class="btn outline" data-rate="${booking.id}" data-rate-type="user">דרג בעל רכב</button>` : role === 'owner' ? `<button class="btn outline" data-rate="${booking.id}" data-rate-type="user">דרג שוכר</button>` : '') : '';
    const evidence = booking.evidence || {};
    const pmt = store.payments[booking.id];
    const evidenceDone = evidence.video && evidence.fuel && evidence.odometer && paymentApproved(pmt);
    const paymentSection = ['owner', 'admin'].includes(role) && pmt
      ? `${pmt.status === 'approved' ? '<span class="pill ok">תשלום אושר</span>' : pmt.status === 'rejected' ? '<span class="pill warn">תשלום נדחה</span>' : pmt.status === 'pending' ? '<span class="pill warn">ממתין לאישור</span>' : ''}<button class="btn outline" data-view-payment="${booking.id}">הוכחת תשלום</button>${pmt.status === 'pending' ? `<button class="btn primary" data-pay-approve="${booking.id}">אישור תשלום</button><button class="btn danger" data-pay-reject="${booking.id}">דחייה</button>` : ''}`
      : '';
    const renterPaymentNote = role === 'renter' && pmt ? `<p class="ev-note">${pmt.status === 'approved' ? '✓ התשלום שלך אושר על ידי בעל הרכב.' : pmt.status === 'rejected' ? '✗ התשלום נדחה — שלחו הוכחה מעודכנת בצ׳אט.' : '⏳ הוכחת התשלום ממתינה לאישור בעל הרכב.'}</p>` : '';
    return `<article class="booking-card"><div class="booking-main"><div><small>הזמנה ${esc(booking.id.slice(-7))}</small><h3>${esc(car.make || '')} ${esc(car.model || '')}</h3><p>${fmtDate(booking.startAt)} — ${fmtDate(booking.endAt)}</p>${booking.quote?.total ? `<p class="bk-total">${money(booking.quote.total)}</p>` : ''}${booking.status === 'pending' && booking.pendingExpiresAt ? `<p class="bk-expiry">ממתינה לאישור עד ${fmtDate(booking.pendingExpiresAt)}</p>` : ''}</div><span class="status-badge ${esc(booking.status)}">${statusLabel(booking.status)}</span></div>${bookingTimeline(booking, pmt)}<div class="chips">${role === 'renter' && booking.status === 'approved' && (!pmt || pmt.status === 'rejected') ? `<button class="btn gold" data-payment="${booking.id}">💳 דיווח על תשלום</button>` : ''}${role === 'owner' && booking.status === 'pending' ? `<button class="btn primary" data-status="approved" data-booking="${booking.id}">אישור</button><button class="btn danger" data-status="rejected" data-booking="${booking.id}">דחייה</button>` : ''}${role === 'owner' && booking.status === 'approved' ? `<button class="btn gold ${evidenceDone ? '' : 'soft-disabled'}" data-status="active" data-booking="${booking.id}">התחלת השכרה</button>` : ''}${role === 'owner' && booking.status === 'active' ? `<button class="btn gold" data-status="done" data-booking="${booking.id}">סיום השכרה</button>` : ''}${role === 'owner' && ['pending','approved','active'].includes(booking.status) ? `<button class="btn outline" data-renter="${booking.renterUid}">פרטי שוכר</button>` : ''}${['approved','active'].includes(booking.status) ? `<button class="btn outline" data-address="${booking.id}">כתובת איסוף</button>` : ''}${['pending','approved','active'].includes(booking.status) ? `<button class="btn outline" data-chat="${booking.id}">צ׳אט</button>` : ''}${car.id ? `<button class="btn outline" data-view-car="${esc(car.id)}">פרטי הרכב</button>` : ''}${role === 'renter' && booking.status === 'active' ? `<button class="btn outline" data-handover="${booking.id}" data-stage="return">תיעוד החזרה</button>` : ''}${paymentSection}${['owner','admin'].includes(role) && booking.handover ? `<button class="btn outline" data-view-handover="${booking.id}">צפייה בתיעוד</button>` : ''}${role === 'admin' ? `<select class="admin-status-select" data-admin-status="${booking.id}"><option value="">שינוי סטטוס…</option><option value="approved">אישור</option><option value="rejected">דחייה</option><option value="active">התחלת השכרה</option><option value="done">סיום</option><option value="cancelled">ביטול</option></select><button class="btn outline" data-admin-note="${booking.id}">הערת מנהל</button>` : ''}${['renter', 'owner'].includes(role) && ['pending', 'approved'].includes(booking.status) ? `<button class="btn outline" data-cancel-booking="${booking.id}">ביטול הזמנה</button>` : ''}${ratingButtons}</div>${booking.adminNote || booking.adminAmount !== undefined ? `<p class="ev-note">הערת מנהל: ${esc(booking.adminNote || '')}${booking.adminAmount !== undefined ? ` · סכום מתוקן: ${money(booking.adminAmount)}` : ''}</p>` : ''}${booking.status === 'cancelled' && (booking.cancelledByRole || booking.cancelReason) ? `<p class="ev-note">בוטלה${booking.cancelledByRole ? ` על ידי ${({renter: 'השוכר', owner: 'בעל הרכב', admin: 'המנהל'})[booking.cancelledByRole] || ''}` : ''}${booking.cancelReason ? ` · סיבה: ${esc(booking.cancelReason)}` : ''}</p>` : ''}${renterPaymentNote}${role === 'renter' && booking.status === 'approved' ? `<p class="ev-note">לפני תחילת ההשכרה שלחו בצ׳אט: סרטון חוץ, תמונת דלק, קילומטראז׳ והוכחת תשלום.</p>` : ''}</article>`;
  }).join('') : emptyState(ICON.calendar, role === 'renter' ? 'אין לך הזמנות עדיין' : 'אין הזמנות עדיין', role === 'renter' ? 'מצאו רכב מהצי שלנו והזמינו — זה מהיר ופשוט.' : 'כשתתקבל בקשת הזמנה היא תופיע כאן.', role === 'renter' ? '<button class="btn primary" data-route="cars">חיפוש רכב</button>' : '')}</div>${listMoreBtn(`bookings-${role}`, sorted.length)}`;
}

function bindActions() {
  // "פרטי הרכב" on a booking card → open the car's detail modal (data-car-open can't be used on a button —
  // bindCarButtons deliberately ignores clicks landing on buttons).
  document.querySelectorAll('[data-view-car]').forEach(button => button.onclick = () => openCar(button.dataset.viewCar));
  // "הצגת עוד" on a long list grows that list by 50 and repaints the current dashboard in place.
  document.querySelectorAll('[data-list-more]').forEach(button => button.onclick = () => {
    listPages[button.dataset.listMore] = pageOf(button.dataset.listMore) + 50;
    dashboard();
  });
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
    // The reason is optional but recorded (audit #12) — Escape/ביטול in the prompt aborts the whole action.
    const reason = prompt('לבטל את ההזמנה? אפשר לציין סיבה (רשות):', '');
    if (reason === null) return;
    button.disabled = true;
    try { await setBookingStatus(button.dataset.cancelBooking, 'cancelled', reason.trim()); toast('ההזמנה בוטלה'); }
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
    <div class="avatar-row"><button type="button" class="avatar-click" id="avatar-open" title="החלפת תמונת פרופיל">${avatarHtml(profile, 116)}<span class="avatar-cam">${ICON.camera}</span></button><input hidden type="file" accept="image/jpeg,image/png,image/webp" id="avatar-file"><div class="avatar-actions"><b>תמונת פרופיל</b><button type="button" class="btn outline" id="avatar-open2">בחירת תמונה מהגלריה</button></div></div><form id="profile-form" class="card inset"><div class="form-grid"><div class="field"><label>שם חוקי ${verLocked ? '🔒' : ''}</label><input name="name" value="${esc(profile.name || '')}" disabled ${verLocked ? 'data-locked' : ''} required>${verLocked ? '<small>נעול לאחר הגשת מסמכים. לשינוי פנו לתמיכה.</small>' : ''}</div><div class="field"><label>טלפון</label><input name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(profile.phone || '')}" disabled></div><div class="field"><label>תאריך לידה ${verLocked ? '🔒' : ''}</label><input name="birthDate" type="date" value="${esc(profile.birthDate || '')}" disabled ${verLocked ? 'data-locked' : ''} required></div><div class="field"><label>מייל 🔒</label><input value="${esc(profile.email || store.user?.email || '')}" disabled data-locked></div></div><button type="button" class="btn outline block" id="profile-edit">עריכה</button><button class="btn primary block" id="profile-save" style="display:none">שמירת שינויים</button></form>
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
  // One revoke for EVERY exit path (save / close / decode failure) — audit #63's small leak.
  let revoked = false;
  const revoke = () => { if (!revoked) { revoked = true; URL.revokeObjectURL(objectUrl); } };
  const source = new Image();
  source.onerror = () => { revoke(); toast('לא ניתן לפתוח את התמונה — נסו קובץ אחר'); };
  source.onload = () => {
    const V = Math.min(280, Math.floor(window.innerWidth * 0.72));
    modal(`<div class="modal-head"><h2>מיקום התמונה בעיגול</h2><button class="close" data-close-modal>×</button></div>
      <div class="crop-stage"><div class="crop-viewport" id="crop-vp" style="width:${V}px;height:${V}px"><img id="crop-img" src="${objectUrl}" alt="" draggable="false"></div></div>
      <div class="crop-zoom-row"><span>−</span><input type="range" id="crop-zoom" min="100" max="320" value="100"><span>+</span></div>
      <p class="mut crop-hint">גררו את התמונה למיקום · הסליידר מגדיל ומקטין</p>
      <button class="btn primary block" id="crop-save">שמירת תמונת פרופיל</button>`);
    document.querySelector('[data-close-modal]')?.addEventListener('click', revoke, {once: true});
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
        revoke();
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

// ---------- Unread tracking for EVERY role (WhatsApp-style), computed from data already live in the
// store — no extra Firebase listeners, no message reads. The server writes a cheap {at, from} summary
// per thread: bookings→lastMsgAt/lastMsgFrom, inquiries→updatedAt/lastSender, support→the user's own
// profile supportMsgAt/supportMsgFrom. "Read" is a per-device localStorage timestamp per thread. ----
let chatRead = (() => { try { return JSON.parse(localStorage.getItem('cd-chat-read') || '{}'); } catch { return {}; } })();
let chatFilterUnread = false;   // the "לא נקראו" filter toggle on the list head
const chatReadAt = key => Number(chatRead[key] || 0);
function markThreadRead(key, at = 0) {
  const ts = Math.max(Number(at || 0), Date.now());
  if (chatReadAt(key) >= ts) return false;
  chatRead[key] = ts;
  try { localStorage.setItem('cd-chat-read', JSON.stringify(chatRead)); } catch {}
  return true;
}
// {at, from} for a thread, straight from the store (cheap). from === my uid means I sent it (→ read).
function threadMeta(key) {
  const id = key.slice(2);
  if (key.startsWith('a:')) {
    if (store.isAdmin) { const at = adminChatActivity?.[id] || 0; return at ? {at, from: adminUnread[id] ? id : store.user?.uid} : null; }
    const at = Number(store.profile?.supportMsgAt || 0);
    return at ? {at, from: store.profile?.supportMsgFrom || store.user?.uid} : null;
  }
  if (key.startsWith('b:')) { const b = store.bookings[id]; return b?.lastMsgAt ? {at: Number(b.lastMsgAt), from: b.lastMsgFrom, text: b.lastMsgText} : null; }
  if (key.startsWith('i:')) { const q = store.inquiries[id]; return q?.updatedAt && q?.lastText ? {at: Number(q.updatedAt), from: q.lastSender, text: q.lastText} : null; }
  return null;
}
function threadUnread(key) {
  if (store.isAdmin && key.startsWith('a:')) return adminThreadUnread(key.slice(2));
  const m = threadMeta(key);
  return !!m && m.at > chatReadAt(key) && m.from !== store.user?.uid;
}
// Total unread threads — powers the badge shown on the "צ׳אטים" tab across every personal area.
export function chatUnreadTotal() {
  try {
    if (store.isAdmin) { let n = 0; for (const uid in (adminChatActivity || {})) if (adminThreadUnread(uid)) n++; return n; }
    if (!store.user || store.user.isAnonymous) return 0;
    return chatItems().filter(it => it.unread).length;
  } catch { return 0; }
}

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
      <div class="chat-filter" id="chat-filter"></div>
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
    const supportThreads = [...registered, ...guests]
      .filter(u => !query || `${u.name || ''} ${u.email || ''}`.toLowerCase().includes(query) || (u.guest && 'אורח'.includes(query)))
      .sort((a, b) => (adminChatActivity[b.id] || 0) - (adminChatActivity[a.id] || 0) || String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''), 'he'))
      .map(u => u.guest
        ? {key: `a:${u.id}`, emoji: ICON.chat, title: u.name, subtitle: `לקוח לא רשום${adminChatActivity[u.id] ? ' · ' + fmtDate(adminChatActivity[u.id]) : ''}`, live: true, unread: adminThreadUnread(u.id)}
        : {key: `a:${u.id}`, avatar: avatarHtml(u, 42), title: u.name || u.email || 'משתמש', subtitle: `${roleName(u.role)}${adminChatActivity[u.id] ? ' · ' + fmtDate(adminChatActivity[u.id]) : ''}`, live: true, unread: adminThreadUnread(u.id)});
    // Inquiry (pre-booking) conversations — the admin could always READ them but had no way in from
    // this screen (audit #48). ALL of them, newest first (user decision: no limits).
    const inquiryThreads = list(store.inquiries)
      .filter(inq => {
        const car = store.cars[inq.carId] || {};
        const renter = store.users[inq.renterUid] || {};
        return !query || `פנייה ${car.make || ''} ${car.model || ''} ${renter.name || ''} ${car.ownerName || ''}`.toLowerCase().includes(query);
      })
      .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
      .map(inq => {
        const car = store.cars[inq.carId] || {};
        const renter = store.users[inq.renterUid] || {};
        return {key: `i:${inq.id}`, emoji: ICON.car, title: `פנייה: ${`${car.make || 'רכב'} ${car.model || ''}`.trim()}`, subtitle: `${renter.name || 'שוכר'} ↔ ${car.ownerName || 'בעל הרכב'}`, live: true};
      });
    return [...supportThreads, ...inquiryThreads];
  }
  const role = myRole();
  // A one-line preview like WhatsApp: prefer the last message text the server stored on the thread.
  const preview = (key, fallback) => { const m = threadMeta(key); return m?.text ? `${m.from === store.user?.uid ? 'את/ה: ' : ''}${m.text}` : fallback; };
  const timeOf = key => threadMeta(key)?.at || 0;
  const bookingItems = myBookings()
    .filter(b => ['pending', 'approved', 'active', 'done'].includes(b.status))
    .map(b => {
      const car = store.cars[b.carId] || {};
      const key = `b:${b.id}`;
      return {key, at: timeOf(key) || Number(b.updatedAt || b.createdAt || 0), emoji: ICON.car, title: `${car.make || 'רכב'} ${car.model || ''}`.trim(), subtitle: preview(key, role === 'owner' ? 'שיחה עם השוכר' : 'שיחה עם בעל הרכב'), status: b.status, live: ['pending', 'approved', 'active'].includes(b.status), unread: threadUnread(key)};
    });
  // Pre-booking inquiry threads (store.inquiries is already role-filtered: a renter sees ones they opened,
  // an owner sees ones about their cars).
  const inquiryItems = list(store.inquiries)
    .map(inq => {
      const car = store.cars[inq.carId] || {};
      const key = `i:${inq.id}`;
      return {key, at: timeOf(key) || Number(inq.updatedAt || inq.createdAt || 0), emoji: ICON.chat, title: `${car.make || 'רכב'} ${car.model || ''}`.trim(), subtitle: preview(key, role === 'owner' ? 'פנייה משוכר (טרם הזמנה)' : 'שיחה עם בעל הרכב (טרם הזמנה)'), live: true, unread: threadUnread(key)};
    });
  const supportKey = `a:${store.user.uid}`;
  const support = {key: supportKey, at: timeOf(supportKey), emoji: ICON.chat, title: 'שירות לקוחות', subtitle: preview(supportKey, 'תמיכה טכנית · מענה מהיר'), live: true, unread: threadUnread(supportKey)};
  // Newest-active conversations first (support pinned when it has recent activity, else near the top).
  return [support, ...bookingItems, ...inquiryItems].sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
}

function renderChatItems() {
  const box = document.querySelector('#chat-items');
  if (!box) return;
  const all = chatItems();
  const unreadCount = all.filter(i => i.unread).length;
  // Filter head: "הכל / לא נקראו (N)" + "סמן הכל כנקרא" (mirrors WhatsApp's unread filter).
  const filterBar = document.querySelector('#chat-filter');
  if (filterBar) {
    filterBar.innerHTML = `<div class="chat-filter-chips"><button type="button" class="chat-fchip ${chatFilterUnread ? '' : 'on'}" data-chat-filter="all">הכל</button><button type="button" class="chat-fchip ${chatFilterUnread ? 'on' : ''}" data-chat-filter="unread">לא נקראו${unreadCount ? ` (${unreadCount})` : ''}</button></div>${unreadCount ? '<button type="button" class="chat-markall" id="chat-markall">סימון הכל כנקרא</button>' : ''}`;
    filterBar.querySelectorAll('[data-chat-filter]').forEach(chip => chip.onclick = () => { chatFilterUnread = chip.dataset.chatFilter === 'unread'; renderChatItems(); });
    filterBar.querySelector('#chat-markall')?.addEventListener('click', () => {
      let changed = false;
      for (const it of all) if (it.unread) { markThreadRead(it.key, threadMeta(it.key)?.at); if (store.isAdmin && it.key.startsWith('a:')) { const uid = it.key.slice(2); adminReadAt[uid] = Date.now(); adminUnread[uid] = false; } changed = true; }
      if (changed) { renderChatItems(); refreshChatBadges(); }
    });
  }
  const items = chatFilterUnread ? all.filter(i => i.unread) : all;
  box.innerHTML = items.length
    ? items.map(item => `<button class="chat-item ${item.key === chatState.thread ? 'active' : ''} ${item.live ? '' : 'ended'} ${item.unread ? 'is-unread' : ''}" data-thread="${esc(item.key)}">${item.avatar || `<span class="chat-item-emoji">${item.emoji}</span>`}<span class="chat-item-main"><b>${esc(item.title)}</b><small>${esc(item.subtitle)}</small></span><span class="chat-item-meta">${item.at ? `<time>${chatListTime(item.at)}</time>` : ''}${item.unread ? '<span class="chat-unread-dot" title="הודעה שלא נקראה" aria-label="הודעה שלא נקראה"></span>' : ''}${item.status ? `<span class="status-badge ${esc(item.status)}">${statusLabel(item.status)}</span>` : ''}</span></button>`).join('')
    : `<div class="empty">${chatFilterUnread ? 'אין הודעות שלא נקראו 🎉' : 'אין שיחות עדיין'}</div>`;
  box.querySelectorAll('[data-thread]').forEach(button => button.onclick = () => selectThread(button.dataset.thread));
}
// Short relative time for the conversation list (today → HH:MM, else a short date), like a messaging app.
function chatListTime(at) {
  const d = new Date(Number(at) || 0);
  if (Number.isNaN(d.getTime()) || !at) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('he-IL', {hour: '2-digit', minute: '2-digit'});
  const yst = new Date(now); yst.setDate(now.getDate() - 1);
  if (d.toDateString() === yst.toDateString()) return 'אתמול';
  return d.toLocaleDateString('he-IL', {day: 'numeric', month: 'numeric'});
}
// Refresh the unread badge everywhere it appears (bottom nav + dashboard tab bar) after read-state changes.
function refreshChatBadges() { try { bottomNav(); } catch {} }

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
  // Opening a thread marks it read (every role) → clears its unread dot and updates the badges.
  if (isSupport && store.isAdmin) { adminReadAt[id] = Date.now(); adminUnread[id] = false; }
  markThreadRead(key, threadMeta(key)?.at);
  renderChatItems(); refreshChatBadges();
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
    : ''}${booking && (isOwner || store.isAdmin) && !convEnded && ['done', 'cancelled', 'rejected', 'expired'].includes(booking.status) ? '<button class="btn dark-out" id="chat-end" title="הצד השני לא יוכל לשלוח עוד הודעות">סיום שיחה</button>' : ''}${booking && (isOwner || store.isAdmin) && convEnded ? '<button class="btn dark-out" id="chat-reopen" title="פתיחה מחדש של השיחה לשני הצדדים">פתיחת שיחה מחדש</button>' : ''}${store.isAdmin ? '<button class="btn dark-out" id="chat-clear" title="מחיקת כל ההודעות">ניקוי</button>' : ''}`;
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

  // Hide the "new messages" pill as soon as the reader scrolls down to the bottom themselves.
  pane.querySelector('#chat-msgs')?.addEventListener('scroll', event => { const b = event.currentTarget; if (b.scrollHeight - b.scrollTop - b.clientHeight < 60) document.querySelector('#chat-newpill')?.remove(); });
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
    try { await adminAction('chat-clear', isSupport ? {userUid: id} : isInquiry ? {inquiryId: id} : {bookingId: id}); toast('הצ׳אט נוקה'); }
    catch (error) { toast(error.message); }
  });
  pane.querySelector('#chat-end')?.addEventListener('click', async () => {
    if (!confirm('לסיים את השיחה? הצד השני לא יוכל לשלוח יותר הודעות.')) return;
    try { await api('booking-action', {action: 'end-chat', bookingId: id}); toast('השיחה נסגרה'); }
    catch (error) { toast(error.message); }
  });
  pane.querySelector('#chat-reopen')?.addEventListener('click', async () => {
    try { await api('booking-action', {action: 'reopen-chat', bookingId: id}); toast('השיחה נפתחה מחדש'); }
    catch (error) { toast(error.message); }
  });

  const ref = firebase.database().ref(isSupport ? `messages/admin/${id}` : isInquiry ? `messages/inquiry/${id}` : `messages/${id}`).limitToLast(100);
  // Smooth, WhatsApp-style rendering: APPEND only new bubbles instead of rebuilding the whole list on
  // every snapshot (no flicker, images never reload, scroll position is kept), with day dividers, sender
  // grouping, and a "↓ הודעות חדשות" pill when a message arrives while you're reading history above.
  const seen = new Set();
  let firstBatch = true, lastDay = '', prevSender = '';
  const dayKey = ts => new Date(Number(ts) || 0).toDateString();
  const dayLabel = ts => { const d = new Date(Number(ts) || 0); const now = new Date(); if (d.toDateString() === now.toDateString()) return 'היום'; const y = new Date(now); y.setDate(now.getDate() - 1); if (d.toDateString() === y.toDateString()) return 'אתמול'; return d.toLocaleDateString('he-IL', {day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric'}); };
  const handler = snap => {
    const box = document.querySelector('#chat-msgs');
    if (!box || store.route !== 'chats' || chatState.thread !== key) { ref.off('value', handler); return; }
    const messages = list(snap.val() || {}).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    if (!messages.length) { box.innerHTML = '<div class="empty">אין הודעות עדיין — כתבו הודעה כדי להתחיל 👋</div>'; return; }
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 130;
    if (firstBatch) { box.innerHTML = ''; }
    let appended = false, newFromOther = false;
    for (const m of messages) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const dk = dayKey(m.createdAt);
      if (dk !== lastDay) { box.insertAdjacentHTML('beforeend', `<div class="chat-day"><span>${esc(dayLabel(m.createdAt))}</span></div>`); lastDay = dk; prevSender = ''; }
      box.insertAdjacentHTML('beforeend', renderChatMessage(m, m.senderUid === prevSender));
      prevSender = m.senderUid;
      appended = true;
      if (m.senderUid !== store.user?.uid) newFromOther = true;
    }
    box.querySelectorAll('[data-att-path]:not([data-bound])').forEach(button => { button.dataset.bound = '1'; button.onclick = async () => {
      try { window.open(await signedRead(button.dataset.attPath), '_blank', 'noopener'); }
      catch (error) { toast(error.message); }
    }; });
    const lastMine = messages[messages.length - 1].senderUid === store.user?.uid;
    if (firstBatch || lastMine || nearBottom) { scrollChatToEnd(box, !firstBatch); document.querySelector('#chat-newpill')?.remove(); }
    else if (appended && newFromOther) showNewPill(box);
    firstBatch = false;
    // I'm looking at this thread → it's read. Update the stored read-mark + badges so the dot clears.
    const lastAt = Number(messages[messages.length - 1].createdAt || 0);
    if (markThreadRead(key, lastAt)) { renderChatItems(); refreshChatBadges(); }
    // Guest gate: an unregistered visitor may send ONE message until the admin replies. Once they've
    // sent and no admin answer exists yet, lock the composer with a friendly "we'll get back to you" note.
    if (isSupport && store.user?.isAnonymous) {
      // The instant auto-ack carries auto:true — only a HUMAN admin reply unlocks the guest (audit #28),
      // matching the server gate (otherwise the next guest message bounces with 429).
      const waiting = messages.some(m => m.senderUid === store.user.uid) && !messages.some(m => m.fromAdmin && !m.auto);
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

// Smoothly bring the conversation to the newest message (rAF so layout of the just-inserted node settles first).
function scrollChatToEnd(box, smooth) {
  requestAnimationFrame(() => { try { box.scrollTo({top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto'}); } catch { box.scrollTop = box.scrollHeight; } });
}
// A floating "↓ הודעות חדשות" pill (WhatsApp-style) shown when a new message lands while you're reading
// older history — tap it to jump to the bottom. Auto-removed once you scroll down yourself.
function showNewPill(box) {
  const pane = box.closest('.chat-pane') || box.parentElement;
  if (!pane || document.querySelector('#chat-newpill')) return;
  const pill = document.createElement('button');
  pill.id = 'chat-newpill'; pill.type = 'button'; pill.className = 'chat-newpill';
  pill.textContent = '↓ הודעות חדשות';
  pill.onclick = () => { scrollChatToEnd(box, true); pill.remove(); };
  pane.appendChild(pill);
}
function renderChatMessage(message, grouped = false) {
  const mine = message.senderUid === store.user?.uid;
  const sys = message.senderUid === 'system';
  const attLabels = {'evidence-video': 'סרטון הרכב מבחוץ', 'evidence-fuel': 'תמונת דלק', 'evidence-odometer': 'תמונת קילומטראז׳', photo: 'קובץ מצורף'};
  const att = message.attachment;
  // Inline images are already the picture (data URL) — show them directly. Videos / legacy
  // storage paths keep the click-to-open button (fetched through signedRead).
  const attachment = att
    ? (/^data:image\//i.test(String(att.path || ''))
        ? `<img class="msg-img" src="${esc(att.path)}" alt="${esc(attLabels[att.type] || 'תמונה')}" loading="lazy" data-att-img="${esc(att.path)}">`
        : `<button class="msg-att" data-att-path="${esc(att.path)}">${attLabels[att.type] || 'קובץ'} · צפייה</button>`)
    : '';
  const time = (() => { const d = new Date(Number(message.createdAt) || 0); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('he-IL', {hour: '2-digit', minute: '2-digit'}); })();
  const tick = mine && !sys ? '<span class="msg-tick" title="נשלח" aria-hidden="true">✓</span>' : '';
  return `<div class="message ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''} ${sys ? 'sys' : ''}">${message.text ? `<p>${esc(message.text)}</p>` : ''}${attachment}<small>${time}${tick}</small></div>`;
}

function paymentModal(bookingId, onDone = null) {
  // The admin's corrected amount wins over the original quote (audit #6) — same rule as the server.
  const bk = store.bookings?.[bookingId];
  const adminAmount = Number(bk?.adminAmount);
  const expected = Number.isFinite(adminAmount) && adminAmount > 0 ? adminAmount : Number(bk?.quote?.total || 0);
  modal(`<div class="modal-head"><h2>דיווח על תשלום</h2><button class="close" data-close-modal>×</button></div><p class="mut">🔒 הצילום יישלח לבדיקה. התשלום ייחשב מאושר רק לאחר אישור בעל הרכב.</p><form id="payment-form"><div class="field pay-amount-field"><label>סכום ששולם</label><input name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" ${expected ? `value="${expected.toFixed(2)}" readonly` : ''} required>${expected ? `<small>${Number.isFinite(adminAmount) && adminAmount > 0 ? 'סכום מתוקן שנקבע על ידי המנהל' : 'הסכום נקבע לפי סיכום ההזמנה'}: ${money(expected)}</small>` : ''}</div><label class="upload-tile" id="pay-upload-tile"><span class="tile-ic">${ICON.image}</span><b>צילום הוכחת תשלום</b><small id="pay-upload-hint">לחצו לצילום או לבחירה מהגלריה</small><input name="file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required></label><div class="upload-state" role="status" aria-live="polite"></div><button class="btn primary block">שליחת הדיווח</button></form>`);
  const payFile = document.querySelector('#payment-form input[name="file"]');
  payFile?.addEventListener('change', () => {
    const tile = document.querySelector('#pay-upload-tile');
    const hint = document.querySelector('#pay-upload-hint');
    const name = payFile.files?.[0]?.name || '';
    tile?.classList.toggle('has-file', !!name);
    if (hint) hint.textContent = name ? `✓ ${name}` : 'לחצו לצילום או לבחירה מהגלריה';
  });
  document.querySelector('#payment-form').onsubmit = async event => {
    event.preventDefault();
    const btn = event.submitter; if (btn) { btn.disabled = true; btn.textContent = 'מעלה…'; }
    const state = event.target.querySelector('.upload-state'); if (state) state.textContent = 'מכווץ ומעלה את התמונה בצורה מאובטחת…';
    try {
      const amount = Number(event.target.amount.value);
      const path = await uploadPrivate(event.target.file.files[0], 'payment', bookingId);
      await savePayment(bookingId, {amount, mediaPath: path});
      closeModal(); toast('הוכחת התשלום נשמרה');
      await onDone?.(amount);
    } catch (error) { toast(error.message); if (state) state.textContent = 'ההעלאה לא הושלמה. אפשר לנסות שוב.'; if (btn) { btn.disabled = false; btn.textContent = 'שליחת הדיווח'; } }
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
  modal(`<div class="modal-head"><h2>${title}</h2><button class="close" data-close-modal>×</button></div><p class="mut">צלמו באור טוב והקיפו את הרכב לאט. אל תסגרו את החלון בזמן ההעלאה.</p><form id="handover-form"><label class="upload-tile"><span class="tile-ic">${ICON.video}</span><b>סרטון הרכב מבחוץ</b><small data-tile-hint>הקיפו את הרכב לאט — לחצו לצילום</small><input name="video" type="file" accept="video/*" capture="environment" required></label><label class="upload-tile"><span class="tile-ic">${ICON.image}</span><b>תמונת הדלק והמיילים</b><small data-tile-hint>צלמו את לוח המחוונים</small><input name="dash" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required></label><div class="form-grid"><div class="field"><label>מיילים / קילומטראז׳</label><input name="mileage" type="number" inputmode="numeric" min="0" required></div><div class="field"><label>רמת דלק</label><select name="fuel"><option>מלא</option><option>3/4</option><option>1/2</option><option>1/4</option><option>ריק</option></select></div></div><div class="field"><label>נזקים והערות</label><textarea name="notes" maxlength="2000" placeholder="תארו שריטות, מכות או מידע שחשוב לתעד"></textarea></div><div class="upload-state" role="status" aria-live="polite"></div><button class="btn primary block">שמירת התיעוד</button></form>`);
  // Shared tile feedback: chosen file → green tile + ✓ filename.
  document.querySelectorAll('#handover-form .upload-tile input[type="file"]').forEach(input => input.addEventListener('change', () => {
    const tile = input.closest('.upload-tile');
    const hint = tile.querySelector('[data-tile-hint]');
    const name = input.files?.[0]?.name || '';
    if (hint && !hint.dataset.orig) hint.dataset.orig = hint.textContent;
    tile.classList.toggle('has-file', !!name);
    if (hint) hint.textContent = name ? `✓ ${name}` : hint.dataset.orig;
  }));
  document.querySelector('#handover-form').onsubmit = async event => {
    event.preventDefault();
    const btn = event.submitter; if (btn) { btn.disabled = true; btn.textContent = 'מעלה…'; }
    const state = event.target.querySelector('.upload-state');
    try {
      if (state) state.textContent = 'מעלה את הסרטון…';
      const videoPath = await uploadPrivate(event.target.video.files[0], 'booking-media', bookingId);
      if (state) state.textContent = 'מעלה את תמונת לוח המחוונים…';
      const dashboardPhotoPath = await uploadPrivate(event.target.dash.files[0], 'booking-media', bookingId);
      if (state) state.textContent = 'שומר את התיעוד…';
      await saveHandover(bookingId, stage, {videoPath, dashboardPhotoPath, mileage: Number(event.target.mileage.value), fuel: event.target.fuel.value, notes: event.target.notes.value});
      closeModal(); toast('התיעוד נשמר');
    } catch (error) { toast(error.message); if (state) state.textContent = 'התיעוד לא הושלם. הקבצים נשארו בטופס ואפשר לנסות שוב.'; if (btn) { btn.disabled = false; btn.textContent = 'שמירת התיעוד'; } }
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

// Verification documents, shown as ACTUAL image tiles (not English-keyed links) so the admin can review
// the license + selfie inline and decide. Order is fixed (front → back → selfie); a missing one shows a
// clear placeholder. Tapping a tile opens the full image in a lightbox. Data URLs and signed URLs both work.
const DOC_LABELS = {licenseFront: 'רישיון — צד קדמי', licenseBack: 'רישיון — צד אחורי', selfie: 'סלפי לאימות'};
const DOC_ORDER = ['licenseFront', 'licenseBack', 'selfie'];
function docGallery(documents) {
  const docs = documents || {};
  const keys = [...DOC_ORDER, ...Object.keys(docs).filter(k => !DOC_ORDER.includes(k))];
  const present = keys.filter(k => k in docs);
  if (!present.length) return '<div class="empty">המשתמש עדיין לא הגיש מסמכים</div>';
  return `<div class="doc-gallery">${present.map(key => {
    const url = docs[key], label = DOC_LABELS[key] || key;
    return url
      ? `<button type="button" class="doc-tile" data-doc-view="${esc(url)}" data-doc-label="${esc(label)}"><img src="${esc(url)}" alt="${esc(label)}" loading="lazy"><span>${esc(label)}</span></button>`
      : `<div class="doc-tile doc-missing"><span>${esc(label)} · לא זמין</span></div>`;
  }).join('')}</div>`;
}
// Wire the lightbox on any doc-gallery in the current modal.
function bindDocGallery() {
  document.querySelectorAll('[data-doc-view]').forEach(tile => tile.onclick = () => {
    modal(`<div class="modal-head"><h2>${esc(tile.dataset.docLabel || 'מסמך')}</h2><button class="close" data-close-modal>×</button></div><div class="doc-full"><img src="${esc(tile.dataset.docView)}" alt="${esc(tile.dataset.docLabel || '')}"></div><a class="btn outline block" href="${esc(tile.dataset.docView)}" target="_blank" rel="noopener">פתיחה בכרטיסייה חדשה</a>`);
  });
}

async function ownerRenterModal(uid) {
  try {
    const data = await api('user-private-profile', {uid});
    const rating = userRating(uid);
    const reviews = list(store.ratings).filter(r => r.type === 'user' && r.targetUid === uid && r.review).slice(0, 6);
    modal(`<div class="modal-head"><h2 class="with-avatar">${avatarHtml(data.profile, 38)} ${esc(data.profile.name || data.profile.email || 'שוכר')}</h2><button class="close" data-close-modal>×</button></div><div class="summary"><span>מייל</span><b>${esc(data.profile.email || '—')}</b></div><div class="summary"><span>טלפון</span><b>${esc(data.profile.phone || '—')}</b></div><div class="summary"><span>דירוג</span><b>${stars(rating)} ${rating ? rating.toFixed(1) : 'חדש'}</b></div><div class="summary"><span>סטטוס אימות</span><b>${esc(verificationLabel(data.profile.verification?.status))}</b></div><h3 class="doc-h">מסמכי אימות</h3>${docGallery(data.documents)}${reviews.length ? `<div class="reviews"><h3>ביקורות על המשתמש</h3>${reviews.map(r => `<div class="review"><div class="review-head"><span class="review-stars">${stars(r.score)}</span><small>${fmtDate(r.createdAt)}</small></div><p>${esc(r.review)}</p></div>`).join('')}</div>` : ''}`);
    bindDocGallery();
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
    modal(`<div class="modal-head"><h2 class="with-avatar">${avatarHtml(data.profile, 38)} ${esc(data.profile.name || data.profile.email || 'משתמש')}</h2><button class="close" data-close-modal>×</button></div><div class="summary"><span>מייל</span><b>${esc(data.profile.email || '—')}</b></div><div class="summary"><span>טלפון</span><b>${esc(data.profile.phone || '—')}</b></div><div class="summary"><span>תפקיד</span><b>${esc(roleName(data.profile.role))}</b></div><div class="summary"><span>סך תשלומים מדווחים</span><b>${money(paymentTotal)}</b></div><div class="summary"><span>סטטוס</span><b>${esc(verificationLabel(data.profile.verification?.status))}</b></div><h3 class="doc-h">מסמכי אימות</h3>${docGallery(data.documents)}${paymentLinks.length ? `<h3 class="doc-h">הוכחות תשלום</h3><div class="doc-gallery">${paymentLinks.map(({payment,url}) => `<button type="button" class="doc-tile" data-doc-view="${esc(url)}" data-doc-label="תשלום · ${esc(money(payment.amount))}"><img src="${esc(url)}" alt="הוכחת תשלום" loading="lazy"><span>${money(payment.amount)} · ${fmtDate(payment.createdAt)}</span></button>`).join('')}</div>` : ''}<div class="summary"><span>סיסמה</span><b>מוצפנת · לא ניתנת לצפייה</b></div><button class="btn gold block" data-message-user="${esc(uid)}">💬 שליחת הודעה למשתמש</button><div class="chips"><button class="btn primary" data-review="approved">אישור אימות</button><button class="btn danger" data-review="rejected">דחייה</button><button class="btn outline" data-review="needs_resubmission">בקשת צילום מחדש</button><button class="btn outline" data-role-toggle="${data.profile.role === 'owner' ? 'renter' : 'owner'}">${data.profile.role === 'owner' ? 'הפיכה לשוכר' : 'הפיכה לבעל רכב'}</button><button class="btn outline" data-reset-pw="${esc(data.profile.email || '')}">שליחת קישור לאיפוס סיסמה</button></div>`);
    bindDocGallery();
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
  // Attribution for Wikimedia-sourced photos (audit #37) — Commons licenses require credit.
  const photoCredits = editing && Array.isArray(car?.photoCredits) ? car.photoCredits.slice() : [];
  let mainUrl = car?.photoUrl || photos[0] || '';
  let videoUrl = car?.videoUrl || '';
  const knownMake = CAR_MAKES.includes(car?.make);

  modal(`<div class="modal-head"><h2>${editing ? 'עריכת רכב' : 'הוספת רכב'}</h2><button class="close" data-close-modal>×</button></div><form id="car-form">
    <div class="wiz-head" aria-live="polite"><span>שלב <b id="wiz-num">1</b> מתוך 4 · <span id="wiz-title">פרטי הרכב</span></span><span class="wiz-bar"><i id="wiz-fill"></i></span></div>
    <section class="wiz-step active" data-step="1">
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
    </section>
    <section class="wiz-step" data-step="2">
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
    </section>
    <section class="wiz-step" data-step="3">
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
    </section>
    <section class="wiz-step" data-step="4">
    <p class="form-section-title">מיקום</p>
    <div class="field"><label>אזור ציבורי</label><input name="area" value="${esc(car?.area || 'Crown Heights')}"></div>
    <div class="field"><label>כתובת מלאה — תיחשף לשוכר רק לאחר אישור</label><input name="fullAddress"></div>
    </section>
    <div class="wiz-nav"><button type="button" class="btn outline" id="wiz-prev">חזרה</button><button type="button" class="btn primary" id="wiz-next">המשך</button></div>
    <button class="btn primary block" id="car-submit">${editing ? 'שמירת שינויים' : 'פרסום הרכב'}</button>
  </form>`);

  const form = document.querySelector('#car-form');

  // Mobile step-wizard (design spec §11): phones see one short step at a time with "שלב X מתוך 4";
  // desktop shows the whole form at once (the wizard chrome is CSS-hidden above 820px, every step
  // stays in the DOM so drafts/formData keep working). Each "המשך" validates its own step first.
  const wizSteps = [...form.querySelectorAll('.wiz-step')];
  const wizTitles = ['פרטי הרכב', 'מחיר ואופן ההשכרה', 'תמונות וסרטון', 'מיקום ופרסום'];
  const isPhone = () => window.matchMedia('(max-width:820px)').matches;
  let wizAt = 0, wizSettled = false;
  const showStep = index => {
    wizAt = Math.max(0, Math.min(wizSteps.length - 1, index));
    wizSteps.forEach((step, i) => step.classList.toggle('active', i === wizAt));
    form.querySelector('#wiz-num').textContent = wizAt + 1;
    form.querySelector('#wiz-title').textContent = wizTitles[wizAt];
    form.querySelector('#wiz-fill').style.width = `${((wizAt + 1) / wizSteps.length) * 100}%`;
    form.querySelector('#wiz-prev').disabled = wizAt === 0;
    form.querySelector('#wiz-next').style.display = wizAt === wizSteps.length - 1 ? 'none' : '';
    form.querySelector('#car-submit').classList.toggle('wiz-hidden', wizAt !== wizSteps.length - 1);
    if (wizSettled && isPhone()) form.querySelector('.wiz-head')?.scrollIntoView({block: 'start', behavior: 'smooth'});
    wizSettled = true;
  };
  form.querySelector('#wiz-prev').onclick = () => showStep(wizAt - 1);
  form.querySelector('#wiz-next').onclick = () => {
    // The current step must be valid before moving on — the error shows under the offending field.
    const invalid = wizSteps[wizAt].querySelector(':invalid');
    if (invalid && isPhone()) { invalid.reportValidity(); return; }
    showStep(wizAt + 1);
  };
  // Safety net: if the browser flags a field on a HIDDEN step at submit time, jump to that step so
  // the message can actually be shown (a display:none control is "not focusable").
  form.addEventListener('invalid', event => {
    const step = event.target.closest('.wiz-step');
    if (step && isPhone() && !step.classList.contains('active')) showStep(wizSteps.indexOf(step));
  }, true);
  showStep(0);

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

  // Wikimedia images are REHOSTED onto our own storage/CDN (audit #36): a hot-linked external URL
  // lets its host see every visitor and even swap the picture later. Falls back to the original
  // link if the rehost fails, so the owner is never blocked.
  const rehostWikiImage = async url => { try { return (await api('image-rehost', {url})).url || url; } catch { return url; } };

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
      const result = await api('car-image-search', {make, model, year: form.year.value}).catch(() => null);
      if (!result?.url) { box.innerHTML = ''; return; }
      box.innerHTML = `<div class="suggest-bubble"><img class="suggest-img" src="${esc(result.url)}" alt=""><div class="suggest-text"><b>מצאתי תמונה של ${esc(make)} ${esc(model)}</b><small>רוצים שאוסיף אותה לגלריה?</small><small class="mut">התמונה להמחשה — ייתכן דגם או שנתון שונה</small><div class="chips"><button type="button" class="btn primary" id="suggest-yes">כן, הוסף</button><button type="button" class="btn outline" id="suggest-no">לא תודה</button></div></div></div>`;
      box.querySelector('#suggest-yes').onclick = async () => {
        box.innerHTML = '<div class="suggest-bubble">מאחסן את התמונה…</div>';
        const stored = await rehostWikiImage(result.url);
        addPhoto(stored); photoCredits.push({url: stored, title: result.title || '', license: result.license || ''});
        box.innerHTML = ''; toast('התמונה נוספה לגלריה');
      };
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
      const result = await api('car-image-search', {make, model, year: form.year.value, trim: form.trim.value});
      if (!result?.url) throw new Error('לא נמצאה תמונה מתאימה — אפשר להעלות תמונה מהגלריה');
      note.textContent = 'מאחסן את התמונה…';
      const stored = await rehostWikiImage(result.url);
      addPhoto(stored);
      photoCredits.push({url: stored, title: result.title || '', license: result.license || ''});
      note.textContent = `${result.title || 'תמונה'} ${result.license ? '· ' + result.license : ''} · להמחשה — ייתכן דגם/שנתון שונה`;
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
    if (!photos.length) { showStep(2); return toast('יש להוסיף לפחות תמונה אחת של הרכב'); }
    const make = currentMake();
    const model = modelSelect.value === '__other' ? modelInput.value.trim() : modelSelect.value;
    if (!make || !model) { showStep(0); return toast('יש לבחור יצרן ודגם'); }
    const data = formData(event.target);
    const onRequest = !!priceOnReq?.checked;
    data.priceOnRequest = onRequest;
    if (!onRequest) {  // require the mode's prices only when a price is actually shown
      const mode = data.rentalMode || 'hourly_daily';
      const required = MODE_PRICES[mode] || MODE_PRICES.hourly_daily;
      const priceName = {hourly: 'priceHourly', daily: 'dailyPrice', weekly: 'priceWeekly'};
      for (const key of Object.keys(required)) {
        if (!(Number(data[priceName[key]]) > 0)) { showStep(1); return toast('יש להזין את כל המחירים הנדרשים לאופן ההשכרה שנבחר'); }
      }
    }
    // Weekend rental: only kept for hourly / hourly-daily cars (not long-term / price-on-request), and
    // a weekend price is then required.
    const weekendOn = weekendAllowed() && !!weekendCheck?.checked;
    data.weekendEnabled = weekendOn;
    if (weekendOn && !(Number(data.weekendPrice) > 0)) { showStep(1); return toast('יש להזין מחיר קבוע לסופ״ש, או לבטל את האפשרות'); }
    if (!weekendOn) data.weekendPrice = 0;
    data.make = make; data.model = model;
    data.photos = photos;
    data.photoCredits = photoCredits.filter(credit => photos.includes(credit.url));  // only photos still in the gallery
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

