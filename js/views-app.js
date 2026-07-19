import {store, list, myRole, myBookings, myCars, carRating, carRatingCount, userRating} from './store.js';
import {esc, money, fmtDate, statusLabel, verificationLabel, modal, closeModal, formData, toast, stars, validEmail, paintApp, resetPaint, TERMS_VERSION, heCount, heCountF} from './core.js';
import {register, login, logout, sendVerify, refreshEmailStatus, sendPasswordReset, createOwnProfile, signInGuest} from './auth.js';
import {saveUser, setOwnPhoto, createCar, updateCar, deleteCar, createBooking, startInquiry, setBookingStatus, registerDocument, approveVerification, sendMessage, deleteMessage, savePayment, saveHandover, submitRating, carMediaPublic, adminAction, setMaintenance, setCarStatus, setCarFeatured, checkIsAdmin, saveExternalRental, deleteExternalRental} from './db.js';
import {uploadPrivate, uploadPublicMedia, signedRead, capturePhoto} from './media.js';
import {legacyStatus, migrateLegacy} from './migrate.js';
import {api} from './api.js';
import {enablePush, pushPromptable, iosNeedsInstall, initPushForeground} from './push.js';
import {saveAuthReturn, afterAuthDestination, openCar, CAR_MAKES, CAR_TYPES, ICON, MODELS_BY_MAKE, RENTAL_MODES, TAB_ICONS, app, avatarHtml, carImage, carPhotoList, carStatusPill, carYears, composePhone, emptyState, fallbackImage, kpi, phoneField, roleName, selectOptions, bindCarButtons, carGrid, featuredFirst, userUnreadNotifs, bottomNav} from './views.js';

// ---------- New rental-request popup for owners (they were MISSING incoming requests) ----------
// The moment a pending request for the owner's car arrives, a prominent modal pops with the renter's
// name/phone/rating, the dates, the price and one-tap אישור/דחייה. Shown once per request (tracked
// per-device) — dismissing keeps it in the bookings tab + badge but stops re-popping. Also clears a
// BACKLOG: requests that came in while the owner was away pop one after another until handled.
let reqSeen = (() => { try { return new Set(JSON.parse(localStorage.getItem('cd-req-seen') || '[]')); } catch { return new Set(); } })();
let reqPopupOpen = false;
const persistReqSeen = () => { try { localStorage.setItem('cd-req-seen', JSON.stringify([...reqSeen].slice(-300))); } catch {} };
function pendingOwnerRequests() {
  const me = store.user?.uid;
  if (!me || store.user?.isAnonymous) return [];
  return list(store.bookings).filter(b => b.ownerUid === me && b.status === 'pending' && !b.done);
}
export function maybeShowRequestPopup() {
  if (reqPopupOpen || !store.user || store.user.isAnonymous) return;
  if (document.querySelector('.modal-backdrop')) return;   // don't hijack another open modal
  const fresh = pendingOwnerRequests().filter(b => !reqSeen.has(b.id)).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  if (fresh.length) showRequestModal(fresh[0]);
}
function showRequestModal(b) {
  reqPopupOpen = true;
  reqSeen.add(b.id); persistReqSeen();
  const car = store.cars[b.carId] || b.carSnapshot || {};
  const rating = userRating(b.renterUid);
  const price = b.quote?.total ? money(b.quote.total) : '';
  modal(`<div class="req-pop">
    <div class="req-pop-top"><span class="req-pop-bell">🔔</span><div class="req-pop-title"><b>בקשת השכרה חדשה</b><small>ממתינה לאישורך</small></div><button class="close" data-close-modal aria-label="סגירה">×</button></div>
    <div class="req-car">${esc(`${car.make || 'רכב'} ${car.model || ''}`.trim())}${car.year ? ` · ${esc(car.year)}` : ''}</div>
    <div class="req-rows">
      <div class="req-row"><span>שוכר</span><b>${esc(b.renterName || 'שוכר')}</b></div>
      ${b.renterPhone ? `<div class="req-row"><span>טלפון</span><b><a href="tel:${esc(b.renterPhone)}">${esc(b.renterPhone)}</a></b></div>` : ''}
      <div class="req-row"><span>דירוג שוכר</span><b>${rating ? `${stars(rating)} ${rating.toFixed(1)}` : 'חדש'}</b></div>
      <div class="req-row"><span>תאריכים</span><b>${esc(fmtDate(b.startAt))} → ${esc(fmtDate(b.endAt))}</b></div>
      ${price ? `<div class="req-row"><span>מחיר</span><b>${price}</b></div>` : ''}
      ${b.fulfillment === 'delivery' && b.deliveryAddress ? `<div class="req-row"><span>מסירה</span><b><bdi>${esc(b.deliveryAddress)}</bdi></b></div>` : ''}
    </div>
    <div class="req-actions"><button class="btn primary block" id="req-approve">✓ אישור ההזמנה</button><button class="btn danger block" id="req-reject">דחייה</button></div>
    <div class="req-links"><button class="btn outline" id="req-chat">💬 צ׳אט עם השוכר</button><button class="btn outline" id="req-later">אחר כך</button></div>
  </div>`);
  const done = () => { reqPopupOpen = false; closeModal(); refreshChatBadges(); setTimeout(() => { maybeShowRequestPopup(); maybeShowStatusPopup(); }, 350); };
  document.querySelector('#req-approve').onclick = async event => { event.currentTarget.disabled = true; try { await setBookingStatus(b.id, 'approved'); toast('ההזמנה אושרה ✓ — מסרו לשוכר מיקום ומפתח בצ׳אט'); done(); } catch (error) { toast(error.message); event.currentTarget.disabled = false; } };
  document.querySelector('#req-reject').onclick = async event => { if (!confirm('לדחות את הבקשה? השוכר יקבל הודעה שהבקשה נדחתה.')) return; event.currentTarget.disabled = true; try { await setBookingStatus(b.id, 'rejected'); toast('הבקשה נדחתה'); done(); } catch (error) { toast(error.message); event.currentTarget.disabled = false; } };
  document.querySelector('#req-chat').onclick = () => { reqPopupOpen = false; closeModal(); openChatThread(`b:${b.id}`); };
  document.querySelector('#req-later').onclick = () => done();
}
// ---------- Status popup for the RENTER (mirror of the owner's request popup) ----------
// When the owner approves/rejects, the renter used to get only a quiet badge — now a clear popup with
// the next step (approved → open the chat; rejected → find another car). Once per booking+status (device).
let statusSeen = (() => { try { return new Set(JSON.parse(localStorage.getItem('cd-status-seen') || '[]')); } catch { return new Set(); } })();
const persistStatusSeen = () => { try { localStorage.setItem('cd-status-seen', JSON.stringify([...statusSeen].slice(-400))); } catch {} };
const RENTER_POP = {
  approved: {emoji: '🎉', title: 'ההזמנה אושרה!', tone: 'ok'},
  rejected: {emoji: '😔', title: 'ההזמנה נדחתה', tone: 'danger'},
};
export function maybeShowStatusPopup() {
  if (reqPopupOpen || !store.user || store.user.isAnonymous) return;
  if (document.querySelector('.modal-backdrop')) return;
  const me = store.user.uid;
  const hit = list(store.bookings)
    .filter(b => b.renterUid === me && RENTER_POP[b.status] && !statusSeen.has(`${b.id}:${b.status}`))
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0];
  if (hit) showStatusModal(hit);
}
function showStatusModal(b) {
  reqPopupOpen = true;
  statusSeen.add(`${b.id}:${b.status}`); persistStatusSeen();
  const cfg = RENTER_POP[b.status];
  const car = store.cars[b.carId] || b.carSnapshot || {};
  const approved = b.status === 'approved';
  modal(`<div class="req-pop status-pop ${cfg.tone}">
    <div class="req-pop-top"><span class="req-pop-bell ${cfg.tone}">${cfg.emoji}</span><div class="req-pop-title"><b>${cfg.title}</b><small>${esc(`${car.make || 'רכב'} ${car.model || ''}`.trim())}</small></div><button class="close" data-close-modal aria-label="סגירה">×</button></div>
    <div class="req-rows">
      <div class="req-row"><span>תאריכים</span><b>${esc(fmtDate(b.startAt))} → ${esc(fmtDate(b.endAt))}</b></div>
      ${b.quote?.total ? `<div class="req-row"><span>מחיר</span><b>${money(b.quote.total)}</b></div>` : ''}
    </div>
    <p class="status-note">${approved ? 'מעולה! היכנסו לצ׳אט עם בעל הרכב לתיאום איסוף, השלמת תיעוד ותשלום.' : 'בעל הרכב לא אישר את הבקשה הפעם — אפשר לחפש רכב אחר לאותם תאריכים.'}</p>
    <div class="req-actions">${approved ? '<button class="btn primary block" id="status-chat">💬 לצ׳אט עם בעל הרכב</button>' : '<button class="btn primary block" id="status-cars">חיפוש רכב אחר</button>'}<button class="btn outline block" id="status-close">סגירה</button></div>
  </div>`);
  const close = () => { reqPopupOpen = false; closeModal(); setTimeout(() => { maybeShowStatusPopup(); maybeShowRequestPopup(); }, 300); };
  document.querySelector('#status-chat')?.addEventListener('click', () => { reqPopupOpen = false; closeModal(); openChatThread(`b:${b.id}`); });
  document.querySelector('#status-cars')?.addEventListener('click', () => { reqPopupOpen = false; closeModal(); location.hash = 'cars'; });
  document.querySelector('#status-close')?.addEventListener('click', close);
}

// The bookings listener is live everywhere — pop the owner's incoming request AND the renter's
// approval/rejection wherever they are (both share reqPopupOpen so they never stack).
window.addEventListener('storechange', event => {
  const k = String(event.detail || '');
  if (k === 'bookings' || k === 'private-ready') setTimeout(() => { maybeShowRequestPopup(); maybeShowStatusPopup(); }, 80);
});

// Foreground push binding is a no-op unless notifications are already enabled.
try { initPushForeground(); } catch {}

// A gentle banner offering to turn on Web-Push so the user is notified when the site is CLOSED. Shown
// only when the browser supports it, it isn't blocked/on already, and wasn't dismissed this session.
function pushBanner() {
  try {
    if (sessionStorage.getItem('cd-push-dismissed')) return '';
    // On iPhone the ONLY route to notifications is installing to the Home Screen, and iOS fires no
    // install prompt of its own — so spell out the two taps instead of showing nothing at all.
    if (iosNeedsInstall()) {
      return `<div class="push-banner" id="push-banner"><span class="pb-ic">📲</span><div class="pb-body"><b>כדי לקבל התראות באייפון</b><small>הוסיפו את האתר למסך הבית: כפתור השיתוף <b>􀈂</b> למטה ← "הוספה למסך הבית". אחר כך פתחו משם והפעילו התראות.</small></div><div class="pb-actions"><button class="pb-close" id="push-dismiss" aria-label="סגירה">×</button></div></div>`;
    }
    if (!pushPromptable()) return '';
    return `<div class="push-banner" id="push-banner"><span class="pb-ic">🔔</span><div class="pb-body"><b>אל תפספסו בקשות והודעות</b><small>הפעילו התראות כדי לקבל עדכון גם כשהאתר סגור</small></div><div class="pb-actions"><button class="btn primary" id="push-enable">הפעלה</button><button class="pb-close" id="push-dismiss" aria-label="סגירה">×</button></div></div>`;
  } catch { return ''; }
}
function bindPushBanner() {
  document.querySelector('#push-enable')?.addEventListener('click', async event => {
    const btn = event.currentTarget; btn.disabled = true; btn.textContent = 'מפעיל…';
    try { await enablePush(); toast('התראות הופעלו ✓ — תקבלו עדכון גם כשהאתר סגור'); document.querySelector('#push-banner')?.remove(); }
    catch (error) { toast(error.message); btn.disabled = false; btn.textContent = 'הפעלה'; }
  });
  document.querySelector('#push-dismiss')?.addEventListener('click', () => { try { sessionStorage.setItem('cd-push-dismissed', '1'); } catch {} document.querySelector('#push-banner')?.remove(); });
}

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
const NOTIF_EMOJI = {booking: '📅', payment: '💳', status: '🔔', reserve: '🚗', verification: '🪪'};
function userNotificationsView() {
  const rows = list(store.userNotifications).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  const seen = Number(localStorage.getItem('cd-notif-seen') || 0);
  try { localStorage.setItem('cd-notif-seen', String(Date.now())); } catch {}
  // A booking/status/payment notification jumps straight to that booking's chat (notifyUser spreads the
  // extras at the TOP level, so it's n.bookingId — not n.meta).
  const threadFor = n => (n.bookingId && ['status', 'payment', 'booking'].includes(n.type)) ? `b:${n.bookingId}` : '';
  return `<h2 style="margin-bottom:16px">התראות</h2><div class="list">${rows.length ? rows.map(n => {
    const thread = threadFor(n);
    return `<div class="notif-row ${Number(n.createdAt || 0) > seen ? 'unread' : ''}${thread ? ' clickable' : ''}"${thread ? ` role="button" tabindex="0" data-notif-thread="${esc(thread)}"` : ''}><span class="notif-icon">${NOTIF_EMOJI[n.type] || '🔔'}</span><div class="notif-main"><b>${esc(n.text || '')}</b><small>${fmtDate(n.createdAt)}</small></div>${thread ? '<span class="notif-go">לשיחה ←</span>' : ''}</div>`;
  }).join('')
    : '<div class="empty">אין התראות עדיין — עדכונים על הזמנות ותשלומים יופיעו כאן</div>'}</div>`;
}
// Wire notification rows that link to a conversation (shared by renter/owner/admin dashboards).
function bindNotifThreads() {
  document.querySelectorAll('[data-notif-thread]').forEach(row => {
    const go = () => openChatThread(row.dataset.notifThread);
    row.onclick = go;
    row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(); } };
  });
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
    ${carKeys.length > 1 ? `<div class="mini-panel ext-bycar"><div class="mini-panel-head"><h3>לפי רכב</h3><span>${heCount(carKeys.length, 'רכב', 'רכבים')}</span></div>${carKeys.map(k => `<div class="mini-row"><b>${esc(k)}</b><span class="mut">${byCar[k].count} · ${fmtHours(byCar[k].hours)} · ${money(byCar[k].amount)}</span></div>`).join('')}</div>` : ''}
    <div class="list">${rows.length ? rows.map(r => `<div class="card inset ext-row">
      <div class="ext-row-head"><b>${esc(carName(r))}</b><b class="ext-amount">${money(r.amount)}</b></div>
      <div class="ext-row-sub"><span>${esc(r.renterName || 'שוכר')}${r.renterPhone ? ` · ${esc(r.renterPhone)}` : ''}</span><span>${extDT(r.startAt)} ← ${extDT(r.endAt)} · ${fmtHours(extHours(r))}</span></div>
      ${r.notes ? `<p class="mut ext-notes">${esc(r.notes)}</p>` : ''}
      <div class="chips"><button class="btn outline" data-ext-edit="${esc(r.id)}">עריכה</button><button class="btn outline" data-ext-del="${esc(r.id)}">מחיקה</button></div>
    </div>`).join('') : emptyState(ICON.calendar, 'עוד לא נרשמו השכרות חוץ', 'השכרתם רכב שלא דרך האתר? הוסיפו אותה כאן ותקבלו סיכום שעות והכנסות מסודר.')}</div>`;
}
// ---- Rental summary: the owner's (and admin's) whole rental book in one place ----
// Two income sources exist and were only ever shown apart: bookings made through the site, and the
// "השכרות חוץ" the owner logs by hand. Neither view answered "how much did I rent out, and for how
// much". This merges them under one period filter, with the same hour/amount arithmetic as the
// external-rentals view so the two screens can never disagree.
const PERIODS = [['month', 'החודש'], ['year', 'השנה'], ['all', 'הכל']];
function periodStart(key) {
  const now = new Date();
  if (key === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (key === 'year') return new Date(now.getFullYear(), 0, 1).getTime();
  return 0;
}
// Realised income counts FINISHED rentals only. Money for a booking that is still running (or merely
// approved) is not earned yet, so it is reported separately rather than folded into the total.
const REALISED = new Set(['done']);
const UPCOMING = new Set(['approved', 'active']);
function bookingAmount(b) {
  const admin = Number(b.adminAmount);
  return Number.isFinite(admin) && admin > 0 ? admin : Number(b.quote?.total || 0);
}
const spanHours = (from, to) => {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms / 3600000 : 0;
};
function summaryRows(scope) {
  const uid = store.user?.uid;
  const rows = [];
  for (const b of myBookings()) {
    if (scope === 'owner' && b.ownerUid !== uid) continue;
    if (!REALISED.has(b.status) && !UPCOMING.has(b.status)) continue;
    const car = store.cars[b.carId] || b.carSnapshot || {};
    rows.push({
      source: 'site', id: b.id, status: b.status, ownerUid: b.ownerUid,
      carName: `${car.make || ''} ${car.model || ''}`.trim() || 'רכב',
      who: b.renterName || store.users[b.renterUid]?.name || 'שוכר',
      startAt: b.startAt, endAt: b.endAt,
      hours: spanHours(b.startAt, b.endAt), amount: bookingAmount(b),
    });
  }
  for (const r of list(store.externalRentals)) {
    const car = r.carId && store.cars[r.carId];
    rows.push({
      source: 'external', id: r.id, status: 'done', ownerUid: uid,
      carName: car ? `${car.make || ''} ${car.model || ''}`.trim() : (r.carLabel || 'רכב'),
      who: r.renterName || 'שוכר',
      startAt: r.startAt, endAt: r.endAt,
      hours: spanHours(r.startAt, r.endAt), amount: Number(r.amount || 0),
    });
  }
  return rows;
}
function groupPanel(title, groups, extra = '') {
  const keys = Object.keys(groups);
  if (keys.length < 2) return '';
  const ordered = keys.sort((a, b) => groups[b].amount - groups[a].amount);
  const max = Math.max(...ordered.map(k => groups[k].amount), 1);
  return `<div class="mini-panel"><div class="mini-panel-head"><h3>${esc(title)}</h3><span>${keys.length}${extra}</span></div>${ordered.map(k => `
    <div class="sum-row"><div class="sum-row-top"><b>${esc(k)}</b><b>${money(groups[k].amount)}</b></div>
    <div class="sum-bar"><span style="width:${Math.round(groups[k].amount / max * 100)}%"></span></div>
    <small>${heCountF(groups[k].count, 'השכרה', 'השכרות')} · ${fmtHours(groups[k].hours)}</small></div>`).join('')}</div>`;
}
function rentalSummaryView(scope) {
  const period = store.summaryPeriod || 'all';
  const from = periodStart(period);
  const all = summaryRows(scope).filter(r => new Date(r.startAt).getTime() >= from);
  const done = all.filter(r => REALISED.has(r.status));
  const open = all.filter(r => UPCOMING.has(r.status));
  const sum = (list, key) => list.reduce((t, r) => t + (Number(r[key]) || 0), 0);
  const totalHours = sum(done, 'hours'), totalAmount = sum(done, 'amount');
  const group = (list, keyFn) => { const g = {}; for (const r of list) { const k = keyFn(r) || '—';
    g[k] = g[k] || {hours: 0, amount: 0, count: 0}; g[k].hours += r.hours; g[k].amount += r.amount; g[k].count++; } return g; };
  const bySource = group(done, r => r.source === 'site' ? 'דרך האתר' : 'השכרות חוץ');
  const ownerName = uid => store.users[uid]?.name || store.users[uid]?.email || 'בעל רכב';
  return `<div class="section-head"><h2>סיכום השכרות</h2>
      <div class="chips period-chips">${PERIODS.map(([k, label]) => `<button class="type-chip ${period === k ? 'on' : ''}" data-period="${k}">${label}</button>`).join('')}</div></div>
    <p class="mut ext-sub">${scope === 'admin' ? 'כל ההשכרות באתר, יחד עם השכרות החוץ שרשמתם בעצמכם.' : 'ההזמנות שהתקבלו דרך האתר יחד עם השכרות החוץ שרשמתם — במקום אחד.'} הסכומים מחושבים על השכרות שהסתיימו בלבד.</p>
    <div class="kpis">${kpi('calendar', done.length, 'השכרות שהסתיימו')}${kpi('check', fmtHours(totalHours), 'סה״כ שעות השכרה')}${kpi('money', money(totalAmount), 'סה״כ הכנסות')}${kpi('users', done.length ? money(totalAmount / done.length) : money(0), 'ממוצע להשכרה')}</div>
    ${open.length ? `<div class="mini-panel sum-open"><div class="mini-panel-head"><h3>בתהליך כרגע</h3><span>${open.length}</span></div><div class="sum-row"><div class="sum-row-top"><b>${open.length === 1 ? 'השכרה אחת פעילה או מאושרת' : `${open.length} השכרות פעילות או מאושרות`}</b><b>${money(sum(open, 'amount'))}</b></div><small>טרם נכללות בסיכום — ייכנסו אליו עם סיום ההשכרה</small></div></div>` : ''}
    ${groupPanel('לפי רכב', group(done, r => r.carName), ' רכבים')}
    ${scope === 'admin' ? groupPanel('לפי בעל רכב', group(done.filter(r => r.source === 'site'), r => ownerName(r.ownerUid)), ' בעלי רכב') : ''}
    ${groupPanel('לפי מקור', bySource)}
    <div class="mini-panel-head sum-list-head"><h3>כל ההשכרות</h3><span>${all.length}</span></div>
    <div class="list">${all.length ? all.sort((a, b) => new Date(b.startAt) - new Date(a.startAt)).map(r => `<div class="card inset ext-row">
      <div class="ext-row-head"><b>${esc(r.carName)}</b><b class="ext-amount">${money(r.amount)}</b></div>
      <div class="ext-row-sub"><span>${esc(r.who)}${scope === 'admin' && r.source === 'site' ? ` · ${esc(ownerName(r.ownerUid))}` : ''}</span><span>${extDT(r.startAt)} ← ${extDT(r.endAt)} · ${fmtHours(r.hours)}</span></div>
      <div class="chips"><span class="pill ${r.source === 'site' ? 'ok' : ''}">${r.source === 'site' ? 'דרך האתר' : 'השכרת חוץ'}</span>${REALISED.has(r.status) ? '' : `<span class="pill warn">${statusLabel(r.status)}</span>`}</div>
    </div>`).join('') : emptyState(ICON.calendar, 'אין השכרות בתקופה שנבחרה', 'נסו לבחור טווח רחב יותר, או הוסיפו השכרת חוץ.')}</div>`;
}
function bindSummary(renderer) {
  document.querySelectorAll('[data-period]').forEach(btn => btn.onclick = () => {
    store.summaryPeriod = btn.dataset.period;
    renderer('summary');
  });
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
    reservation: reservationView(store.reservationId),
    overview: `${pushBanner()}${todoHtml}<div class="admin-stats-mini"><span><b>${active}</b> פעילות</span><span><b>${pending}</b> ממתינות</span><span><b>${done}</b> הושלמו</span><span><b>${verification.status === 'approved' ? '✓' : '—'}</b> אימות</span></div><h2>ההזמנות שלי</h2>${bookingList(bookings, 'renter')}`,
    bookings: `<h2>ההזמנות שלי</h2>${bookingList(bookings, 'renter')}`,
    profile: profileView(),
    notifications: userNotificationsView(),
    messages: messagesView(),
  };
  app().innerHTML = dashboardLayout('האזור האישי', [['overview','סקירה'],['bookings','הזמנות'],['chats','צ׳אטים'],['notifications',`התראות${userUnreadNotifs() ? ` (${userUnreadNotifs()})` : ''}`],['profile','פרופיל ואימות']], tab, contents[tab] || contents.overview);
  bindDashboardTabs(renterDashboard); bindActions(); bindProfileActions();
  if (tab === 'notifications') bindNotifThreads();
  if (tab === 'overview') bindPushBanner();
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
    overview: `${pushBanner()}${todoHtml}<div class="admin-stats-mini"><span><b>${cars.length}</b> רכבים</span><span><b>${cars.filter(c => c.status === 'available').length}</b> זמינים</span><button type="button" class="stat-link" data-nav-tab="summary"><b>${money(approvedTotal)}</b> תשלומים שאושרו</button><span><b>${bookings.filter(b => b.status === 'active').length}</b> פעילות</span></div><h2>הזמנות פעילות</h2>${bookingList(bookings.filter(b => ['pending','approved','active'].includes(b.status)), 'owner')}`,
    bookings: `<h2>הזמנות</h2>${bookingList(bookings, 'owner')}`,
    cars: `<div class="section-head"><h2>הרכבים שלי</h2><div class="chips"><button class="btn outline" id="goto-external">📒 השכרות חוץ</button><button class="btn gold" id="add-car">הוספת רכב</button></div></div>${carGrid(cars, true, null, emptyState(ICON.car, 'עוד לא פרסמתם רכב', 'הוסיפו את הרכב הראשון שלכם — תמונות, מחיר וזמינות, ואפשר להתחיל לקבל בקשות.', '<button class="btn primary" id="add-car-empty">הוספת רכב ראשון</button>'))}`,
    external: externalRentalsView(cars),
    summary: rentalSummaryView('owner'),
    notifications: userNotificationsView(),
    profile: ownerProfileView(),
  };
  app().innerHTML = dashboardLayout('לוח בעל רכב', [['overview','סקירה'],['bookings','הזמנות'],['cars','רכבים'],['summary','סיכום'],['external','השכרות חוץ'],['chats','צ׳אטים'],['notifications',`התראות${userUnreadNotifs() ? ` (${userUnreadNotifs()})` : ''}`],['profile','פרופיל']], tab, contents[tab] || contents.overview, '<button class="btn gold" id="add-car-head">+ הוספת רכב</button>');
  bindDashboardTabs(ownerDashboard); bindActions(); bindCarButtons(); bindProfileActions();
  // The overview's stats strip doubles as navigation (the admin hub already worked this way).
  document.querySelectorAll('[data-nav-tab]').forEach(btn => btn.onclick = () => { store.dashTab = btn.dataset.navTab; ownerDashboard(btn.dataset.navTab); });
  if (tab === 'notifications') bindNotifThreads();
  if (tab === 'overview') bindPushBanner();
  document.querySelector('#add-car')?.addEventListener('click', () => carForm());
  document.querySelector('#add-car-empty')?.addEventListener('click', () => carForm());
  document.querySelector('#add-car-head')?.addEventListener('click', () => carForm());
  document.querySelector('#goto-external')?.addEventListener('click', () => { store.dashTab = 'external'; ownerDashboard('external'); });
  if (tab === 'external') bindExternalRentals(cars, ownerDashboard);
  if (tab === 'summary') bindSummary(ownerDashboard);
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
    const strip = `<div class="car-stats"><span>📅 ${heCountF(carBookings.length, 'הזמנה', 'הזמנות')}</span><span>💵 ${money(earned)}</span>${rating ? `<span>⭐ ${rating.toFixed(1)}</span>` : ''}</div>`;
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
  // One-time privacy cleanup, rendered ONLY while there is something to clean — then it disappears for
  // good. publicRatings is world-readable and rows written before rev.177 are keyed
  // `<bookingId>_<type>_<authorUid>`, which hands back the two fields the record body strips on purpose.
  const legacyRatingKeys = Object.keys(store.ratings || {}).filter(k => !/^[0-9a-f]{40}$/.test(k)).length;
  const rekeyHtml = legacyRatingKeys
    ? `<div class="admin-todo"><div class="admin-sec-h">תחזוקה חד-פעמית</div><button class="todo-row" id="ratings-rekey"><span class="todo-count">${legacyRatingKeys}</span><span class="todo-label">הסתרת מזהי הזמנה בדירוגים ישנים</span><span class="todo-go" aria-hidden="true">›</span></button></div>`
    : '';
  const todoHtml = todo.length
    ? `<div class="admin-todo"><div class="admin-sec-h">דורש טיפול</div>${todo.map(([t, n, label]) => `<button class="todo-row" data-nav-tab="${t}"><span class="todo-count">${n}</span><span class="todo-label">${esc(label)}</span><span class="todo-go" aria-hidden="true">›</span></button>`).join('')}</div>`
    : `<div class="admin-allclear"><span class="ac-ic">✓</span><div><b>הכל מטופל</b><small>אין כרגע פעולות שממתינות לך</small></div></div>`;
  const navTile = (t, label, icon, tint, badge = 0) => `<button class="hub-tile" data-nav-tab="${t}"><span class="hub-ic tint-${tint}">${icon}</span><b>${esc(label)}</b>${badge ? `<span class="hub-badge">${badge}</span>` : ''}</button>`;
  const contents = {
    overview: `${pushBanner()}${todoHtml}${rekeyHtml}
      <div class="admin-sec-h">ניהול האתר</div>
      <div class="admin-hub">${navTile('users', 'משתמשים', ICON.users, 'purple', pendingVerif)}${navTile('bookings', 'הזמנות', ICON.calendar, 'blue', pendingPay + pendingBook)}${navTile('cars', 'רכבים', ICON.car, 'gold')}${navTile('chats', 'צ׳אטים', ICON.chat, 'green', unread)}</div>
      <div class="admin-sec-h">האזור שלי — בעל רכב</div>
      <div class="admin-hub">${navTile('myCars', 'הרכבים שלי', ICON.car, 'blue')}${navTile('summary', 'סיכום השכרות', ICON.check, 'green')}${navTile('external', 'השכרות חוץ', ICON.money, 'gold')}${navTile('profile', 'פרופיל', ICON.selfie, 'slate')}</div>
      <div class="admin-stats-mini"><span><b>${bookings.length}</b> הזמנות</span><span><b>${money(total)}</b> תשלומים</span><span><b>${users.length}</b> משתמשים</span><span><b>${cars.length}</b> רכבים</span></div>
      <div class="field admin-search-wrap"><input id="admin-search" aria-label="חיפוש משתמש, רכב או הזמנה" placeholder="🔎 חיפוש משתמש, רכב או הזמנה…" autocomplete="off"></div><div id="admin-search-results"></div>
      <details class="admin-tools"><summary>הגדרות וכלים</summary><div class="admin-tools-grid"><button class="btn ${store.config?.maintenance?.on ? 'danger' : 'outline'}" id="maintenance-toggle">${store.config?.maintenance?.on ? 'האתר בתחזוקה — לחצו לפתיחה' : 'מצב תחזוקה'}</button><button class="btn outline" id="export-json">ייצוא JSON</button><button class="btn outline" id="legacy-migrate">העברת נתונים ישנים</button><button class="btn outline" id="media-migrate" title="מעביר תמונות רכב ישנות מהמסד לאחסון CDN — מאיץ את טעינת האתר">⚡ האצת טעינה (תמונות)</button></div></details>`,
    users: adminUsersSplit(users),
    userPage: adminUserPage(store.adminUserUid, bookings),
    cars: `<h2 style="margin-bottom:16px">רכבים</h2>${adminCarsTable(cars)}`,
    // The admin is ALSO a car owner: a personal "הרכבים שלי" tab (strictly their own cars, with the
    // owner's per-car stats strip) and the off-site rentals log — same tools an owner gets.
    myCars: `<div class="section-head"><h2>הרכבים שלי</h2><div class="chips"><button class="btn outline" id="goto-external">📒 השכרות חוץ</button><button class="btn gold" id="add-car">הוספת רכב</button></div></div>${carGrid(adminOwnCars, true, null, emptyState(ICON.car, 'עוד לא פרסמתם רכב', 'הוסיפו את הרכב הראשון שלכם — תמונות, מחיר וזמינות, ואפשר להתחיל לקבל בקשות.', '<button class="btn primary" id="add-car-empty">הוספת רכב ראשון</button>'))}`,
    external: externalRentalsView(adminOwnCars),
    summary: rentalSummaryView('admin'),
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
    ['myCars','הרכבים שלי'],['summary','סיכום השכרות'],['external','השכרות חוץ'],['profile','פרופיל'],
  ], tab, contents[tab] || contents.overview, '<button class="btn gold" id="admin-add-car">+ הוספת רכב</button>', '<button class="btn dark-out block" id="admin-refresh" title="רענון נתונים">רענון</button><button class="btn dark-out block" id="admin-logout">יציאה</button>');
  document.querySelector('#admin-add-car')?.addEventListener('click', () => carForm());
  document.querySelector('#add-car')?.addEventListener('click', () => carForm());
  document.querySelector('#add-car-empty')?.addEventListener('click', () => carForm());
  document.querySelector('#goto-external')?.addEventListener('click', () => { store.dashTab = 'external'; adminDashboard('external'); });
  if (tab === 'external') bindExternalRentals(adminOwnCars, adminDashboard);
  if (tab === 'summary') bindSummary(adminDashboard);
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
  const rekeyBtn = document.querySelector('#ratings-rekey');
  if (rekeyBtn) rekeyBtn.onclick = async () => {
    rekeyBtn.disabled = true;
    try { const res = await adminAction('ratings-rekey'); toast(`הוסתרו ${res.moved || 0} מזהים`); }
    catch (error) { toast(error.message); rekeyBtn.disabled = false; }
  };
  document.querySelectorAll('[data-admin-user]').forEach(button => button.onclick = () => adminUserModal(button.dataset.adminUser));
  // The whole user card is the shortcut into that person's control page.
  document.querySelectorAll('[data-open-user]').forEach(el => el.onclick = event => {
    if (event.target.closest('button')) return;   // the card's own buttons keep their meaning
    store.adminUserUid = el.dataset.openUser; store.dashTab = 'userPage'; adminDashboard('userPage');
  });
  document.querySelector('[data-back-users]')?.addEventListener('click', () => { store.dashTab = 'users'; adminDashboard('users'); });
  const userQ = document.querySelector('#admin-user-q');
  if (userQ) userQ.oninput = () => {
    store.adminUserQ = userQ.value;
    clearTimeout(userQ._t);
    // Re-render on a pause, then put the caret back — a repaint per keystroke would fight the typing.
    userQ._t = setTimeout(() => { adminDashboard('users'); const box = document.querySelector('#admin-user-q'); box?.focus(); box?.setSelectionRange(box.value.length, box.value.length); }, 260);
  };
  if (store.dashTab === 'userPage') bindAdminUserPage();
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
    // Only an ADMIN can delete a car that still has live bookings (car-action 409s everyone else).
    // Deleting wipes privateCarDetails too, so a renter mid-rental loses the pickup address — that is
    // not something to discover from a generic "למחוק לצמיתות?".
    const live = myBookings().filter(b => b.carId === button.dataset.carDelete && ['pending', 'approved', 'active'].includes(b.status));
    const warning = live.length
      ? `לרכב יש ${live.length === 1 ? 'הזמנה אחת פעילה או ממתינה' : `${live.length} הזמנות פעילות או ממתינות`}. מחיקה תסיר גם את כתובת האיסוף, והשוכרים יאבדו אותה באמצע ההשכרה.\n\nלמחוק בכל זאת?`
      : 'למחוק את הרכב לצמיתות?';
    if (!confirm(warning)) return;
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
    bindNotifThreads();
  }
  if (tab === 'cars') bindAdminCarActions();
  if (tab === 'bookings') bindAdminBookingActions();
  if (tab === 'overview') bindPushBanner();
  document.querySelector('#export-json')?.addEventListener('click', () => {
    const payload = {exportedAt: new Date().toISOString(), users: store.users, cars: store.cars, bookings: store.bookings, payments: store.payments};
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `crowndrive-export-${Date.now()}.json`; anchor.click();
    URL.revokeObjectURL(url);
  });
}

function adminUsersTable(users, pageKey = 'users') {
  if (!users.length) return '<div class="empty">אין משתמשים</div>';
  const rentalCount = uid => myBookings().filter(b => b.renterUid === uid || b.ownerUid === uid).length;
  return `<div class="admin-cards">${users.slice(0, pageOf(pageKey)).map(user => {
    const count = rentalCount(user.id);
    const initial = esc(String(user.name || user.email || '?').trim().charAt(0) || '?');
    const vs = user.verification?.status;
    return `<div class="auc auc-click${user.blocked ? ' auc-blocked' : ''}" data-open-user="${esc(user.id)}" role="button" tabindex="0" title="פתיחת האזור האישי של המשתמש">
      <div class="auc-head">
        <span class="auc-ava" aria-hidden="true">${initial}</span>
        <div class="auc-id"><b class="auc-name">${esc(user.name || '—')}${user.blocked ? ' <span class="pill warn">חסום</span>' : ''}</b><span class="auc-role">${esc(roleName(user.role))} · ${heCountF(count, 'השכרה', 'השכרות')}</span></div>
        <span class="pill ${vs === 'approved' ? 'ok' : 'warn'}">${esc(verificationLabel(vs))}</span>
      </div>
      <div class="auc-contact"><span><span class="lab">מייל</span>${esc(user.email || '—')}</span><span><span class="lab">טלפון</span>${esc(user.phone || '—')}</span></div>
      <div class="auc-actions">
        ${vs === 'pending' ? `<button class="btn primary auc-approve" data-quick-approve="${esc(user.id)}">✓ אישור אימות</button>` : ''}
        <button class="btn outline" data-admin-user="${esc(user.id)}">מסמכים</button>
        <button class="btn outline" data-admin-rentals="${esc(user.id)}">${heCountF(count, 'השכרה', 'השכרות')}</button>
        <span class="auc-icons"><button class="icon-btn" title="שליחת הודעה" data-user-message="${esc(user.id)}">${ICON.chat}</button><button class="icon-btn" title="עריכה" data-user-edit="${esc(user.id)}">${ICON.edit}</button><button class="icon-btn ${user.blocked ? '' : 'danger'}" title="${user.blocked ? 'שחרור חסימה' : 'חסימה'}" data-user-block="${esc(user.id)}">${user.blocked ? ICON.check : ICON.block}</button><button class="icon-btn danger" title="מחיקה" data-user-delete="${esc(user.id)}">${ICON.trash}</button></span>
      </div>
    </div>`;
  }).join('')}</div>${listMoreBtn(pageKey, users.length)}`;
}

function bindAdminUserPage() {
  const uid = store.adminUserUid;
  if (!uid) return;
  const reload = () => adminDashboard('userPage');
  // Documents live behind a signed-read endpoint, so they load after the page paints.
  const docBox = document.querySelector('#up-docs');
  if (docBox) api('user-private-profile', {uid})
    .then(data => { docBox.className = ''; docBox.innerHTML = docGallery(data.documents); bindDocGallery(); })
    .catch(error => { docBox.textContent = `לא ניתן לטעון מסמכים: ${error.message}`; });

  const form = document.querySelector('#up-profile');
  if (form) form.onsubmit = async event => {
    event.preventDefault();
    const btn = event.submitter; if (btn) btn.disabled = true;
    const data = formData(form);
    const patch = {name: data.name, phone: data.phone, birthDate: data.birthDate};
    // Role is sent ONLY when it actually changed: user-update rejects a renter switch while the user
    // still owns cars, and re-sending the current role would fail a save that changed nothing else.
    if (data.role && data.role !== store.users[uid]?.role) patch.role = data.role;
    try { await adminAction('user-update', {uid, patch}); toast('הפרטים עודכנו'); reload(); }
    catch (error) { toast(error.message); if (btn) btn.disabled = false; }
  };
  document.querySelectorAll('[data-up-review]').forEach(btn => btn.onclick = async () => {
    const status = btn.dataset.upReview;
    const note = status === 'approved' ? '' : prompt('מה צריך לתקן? (נשלח למשתמש בהתראה וב-SMS)') || '';
    try { await approveVerification(uid, status, note); toast('סטטוס האימות עודכן'); reload(); }
    catch (error) { toast(error.message); }
  });
  document.querySelector('[data-up-addcar]')?.addEventListener('click', () => {
    if (store.users[uid]?.role !== 'owner') return toast('צריך להגדיר את המשתמש כבעל רכב לפני פרסום רכב עבורו');
    carForm(null, uid);
  });
  document.querySelector('[data-up-message]')?.addEventListener('click', () => openChatThread(`a:${uid}`));
  document.querySelector('[data-up-block]')?.addEventListener('click', async event => {
    const blocking = event.currentTarget.dataset.upBlock === '1';
    if (blocking && !confirm('לחסום את המשתמש? הוא יינעל מכל האתר, ותישלח לו הודעה. הוא יוכל לערער בצ׳אט התמיכה.')) return;
    try { await adminAction('user-block', {uid, blocked: blocking}); toast(blocking ? 'המשתמש נחסם' : 'החסימה הוסרה'); reload(); }
    catch (error) { toast(error.message); }
  });
  document.querySelector('[data-up-delete]')?.addEventListener('click', async () => {
    const name = store.users[uid]?.name || store.users[uid]?.email || 'המשתמש';
    if (!confirm(`למחוק לצמיתות את ${name}?\n\nיימחקו הפרופיל, המסמכים, הרכבים, הפניות והדירוגים. הזמנות יישמרו לצד השני עם שם מוסתר.\n\nהפעולה בלתי הפיכה.`)) return;
    try { await adminAction('user-delete', {uid}); toast('המשתמש נמחק'); store.dashTab = 'users'; adminDashboard('users'); }
    catch (error) { toast(error.message); }
  });
}
// A user's whole personal area, from the admin side (Shmuel: "קיצור דרך ישיר לתוך האזור האישי ...
// עם אפשרות לשנות הכל"). NOT impersonation: every request still carries the ADMIN's uid, and each
// control below calls an endpoint that already grants admins authority over that user's data. That
// keeps the audit trail honest — every change is recorded as the admin's, which is what it is.
function adminUserPage(uid, allBookings) {
  const user = store.users[uid];
  if (!user) return `<button type="button" class="up-back" data-back-users>← חזרה לרשימת המשתמשים</button>${emptyState(ICON.users, 'המשתמש לא נמצא', 'ייתכן שנמחק.')}`;
  const vs = store.verificationStatuses[uid] || 'missing';
  const cars = list(store.cars).filter(c => c.ownerUid === uid);
  const bookings = allBookings.filter(b => b.renterUid === uid || b.ownerUid === uid);
  const done = bookings.filter(b => b.status === 'done');
  const income = done.reduce((t, b) => { const a = Number(b.adminAmount); return t + (Number.isFinite(a) && a > 0 ? a : Number(b.quote?.total || 0)); }, 0);
  const hours = done.reduce((t, b) => t + spanHours(b.startAt, b.endAt), 0);
  const roleLabel = roleName(user.role) || 'ללא תפקיד';
  return `<button type="button" class="up-back" data-back-users>← חזרה לרשימת המשתמשים</button>
    <div class="up-head">
      <span class="auc-ava up-ava" aria-hidden="true">${esc(String(user.name || user.email || '?').trim().charAt(0) || '?')}</span>
      <div class="up-id"><b class="up-name">${esc(user.name || '—')}</b><small>${esc(roleLabel)} · <bdi>${esc(user.email || '—')}</bdi></small></div>
      <div class="up-pills">${user.blocked ? '<span class="pill warn">חסום</span>' : ''}<span class="pill ${vs === 'approved' ? 'ok' : 'warn'}">${esc(verificationLabel(vs))}</span></div>
    </div>
    <div class="kpis">${kpi('calendar', bookings.length, 'הזמנות')}${kpi('check', fmtHours(hours), 'שעות השכרה')}${kpi('money', money(income), 'סה״כ')}${kpi('car', cars.length, 'רכבים')}</div>

    <details class="up-sec" open><summary><b>פרטים אישיים</b><small>שם, טלפון, תאריך לידה, תפקיד</small></summary>
      <form id="up-profile" class="card inset"><div class="form-grid">
        <div class="field"><label>שם מלא</label><input name="name" value="${esc(user.name || '')}" required></div>
        <div class="field"><label>טלפון</label><input name="phone" type="tel" value="${esc(user.phone || '')}"></div>
        <div class="field"><label>תאריך לידה</label><input name="birthDate" type="date" value="${esc(user.birthDate || '')}"><small>נעול למשתמש בזמן אימות — כאן אפשר לתקן</small></div>
        <div class="field"><label>סוג חשבון</label><select name="role"><option value="renter" ${user.role === 'renter' ? 'selected' : ''}>שוכר</option><option value="owner" ${user.role === 'owner' ? 'selected' : ''}>בעל רכב</option></select><small>העברה לשוכר חסומה כל עוד יש רכבים</small></div>
        <div class="field"><label>מייל 🔒</label><input value="${esc(user.email || '')}" disabled></div>
      </div><button class="btn primary block">שמירת שינויים</button></form>
    </details>

    <details class="up-sec"><summary><b>אימות ומסמכים</b><small>${esc(verificationLabel(vs))}</small></summary>
      <div class="chips"><button class="btn primary" data-up-review="approved">אישור אימות</button><button class="btn danger" data-up-review="rejected">דחייה</button><button class="btn outline" data-up-review="needs_resubmission">בקשת צילום מחדש</button></div>
      <div id="up-docs" class="mut">טוען מסמכים…</div>
    </details>

    <details class="up-sec"><summary><b>הרכבים שלו</b><small>${cars.length}</small></summary>
      <div class="chips"><button class="btn gold" data-up-addcar>+ הוספת רכב עבורו</button></div>
      ${cars.length ? `<div class="list">${cars.map(c => `<div class="card inset ext-row"><div class="ext-row-head"><b>${esc(c.make || '')} ${esc(c.model || '')} ${esc(c.year || '')}</b><b class="ext-amount">${money(c.dailyPrice || 0)}/יום</b></div><div class="ext-row-sub"><span>${carStatusPill(c.status)}</span><span>${esc(c.id.slice(-6))}</span></div><div class="chips"><button class="btn outline" data-car-edit="${esc(c.id)}">עריכה</button><button class="btn outline" data-car-toggle="${esc(c.id)}">${c.status === 'hidden' ? 'הצגה' : 'הסתרה'}</button><button class="btn outline danger" data-car-delete="${esc(c.id)}">מחיקה</button></div></div>`).join('')}</div>` : '<div class="empty">אין רכבים</div>'}
    </details>

    <details class="up-sec"><summary><b>ההזמנות שלו</b><small>${bookings.length}</small></summary>
      ${bookings.length ? bookingList(bookings, 'admin') : '<div class="empty">אין הזמנות</div>'}
    </details>

    <details class="up-sec"><summary><b>פעולות חשבון</b><small>הודעה, סיסמה, חסימה, מחיקה</small></summary>
      <div class="chips">
        <button class="btn gold" data-up-message>💬 שליחת הודעה</button>
        <button class="btn outline" data-reset-pw="${esc(user.email || '')}">קישור לאיפוס סיסמה</button>
        <button class="btn outline" data-up-block="${user.blocked ? '' : '1'}">${user.blocked ? 'הסרת חסימה' : 'חסימת משתמש'}</button>
        <button class="btn danger" data-up-delete>מחיקת המשתמש</button>
      </div>
    </details>`;
}
// Users split into the two groups the admin actually thinks in (Shmuel: "2 רשימות ... שוכרים ובעלי
// רכבים"). Anyone whose role was never set lands in a third group so they can't silently disappear.
function adminUsersSplit(users) {
  const q = (store.adminUserQ || '').trim().toLowerCase();
  const match = u => !q || `${u.name || ''} ${u.email || ''} ${u.phone || ''}`.toLowerCase().includes(q);
  const shown = users.filter(match);
  const groups = [
    ['renter', 'שוכרים', shown.filter(u => u.role === 'renter')],
    ['owner', 'בעלי רכב', shown.filter(u => u.role === 'owner')],
    ['none', 'ללא תפקיד', shown.filter(u => !['renter', 'owner'].includes(u.role))],
  ].filter(([, , rows]) => rows.length);
  const pending = shown.filter(u => u.verification?.status === 'pending').length;
  return `<div class="section-head"><h2>משתמשים</h2><span class="mut">${users.length} סה״כ${pending ? ` · ${pending} ממתינים לאימות` : ''}</span></div>
    <input class="user-search" id="admin-user-q" type="search" placeholder="חיפוש לפי שם, מייל או טלפון" value="${esc(store.adminUserQ || '')}" aria-label="חיפוש משתמשים">
    ${groups.length ? groups.map(([key, label, rows]) => `<details class="user-group" ${rows.length <= 25 || q ? 'open' : ''}>
      <summary><b>${label}</b><span class="ug-count">${rows.length}</span></summary>
      ${adminUsersTable(rows, `users-${key}`)}
    </details>`).join('') : emptyState(ICON.users, 'לא נמצאו משתמשים', q ? 'נסו חיפוש אחר.' : '')}`;
}
// Admin notifications feed (new car / booking / status / payment / chat / block).
const NOTIF_ICONS = {car: ICON.car, booking: ICON.calendar, status: ICON.check, payment: ICON.money, chat: ICON.chat, block: ICON.block, user: ICON.users, verification: ICON.users};
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
      const car = store.cars[b.carId] || b.carSnapshot || {};
      const renter = store.users[b.renterUid] || {};
      return `${car.make || ''} ${car.model || ''} ${renter.name || ''} ${renter.email || ''} ${b.status || ''} ${statusLabel(b.status)} ${b.id}`.toLowerCase().includes(q);
    }).slice(0, 6);
    box.innerHTML = (users.length + cars.length + bookings.length) ? `
      ${users.length ? `<p class="search-group">משתמשים</p>${users.map(u => `<button class="search-hit" data-hit-user="${esc(u.id)}">👤 ${esc(u.name || '—')} · ${esc(u.email || '')} · ${esc(u.phone || '')}</button>`).join('')}` : ''}
      ${cars.length ? `<p class="search-group">רכבים</p>${cars.map(c => `<button class="search-hit" data-hit-car="${esc(c.id)}">🚗 ${esc(c.make || '')} ${esc(c.model || '')} · ${esc(c.ownerName || '')} · ${carStatusPill(c.status)}</button>`).join('')}` : ''}
      ${bookings.length ? `<p class="search-group">הזמנות</p>${bookings.map(b => { const car = store.cars[b.carId] || b.carSnapshot || {}; return `<button class="search-hit" data-hit-booking="${esc(b.renterUid)}">📅 ${esc(car.make || 'רכב')} ${esc(car.model || '')} · ${fmtDate(b.startAt)} · ${statusLabel(b.status)}</button>`; }).join('')}` : ''}
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
    const car = store.cars[booking.carId] || booking.carSnapshot || {};
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
// After approval, the correct order (per the owner's real flow) is: 1) the owner hands over the car —
// its LOCATION + the KEY (coordinated in chat) — THEN 2) the renter documents the car's condition at
// pickup (video / fuel / odometer), and 3) payment. A numbered mini-guide makes that order unmistakable.
function renterNextSteps(booking) {
  const ev = evidenceState(booking, booking.id);
  // Step 3 used to be a bare "ממתין לתשלום" with no amount, no method and no button, while steps 1-2
  // were actionable. The site never states HOW to pay (that's the owner's own arrangement), so the
  // honest instruction is: the owner gives the method in chat, and you report it here.
  const pmt = store.payments[booking.id];
  const payPending = pmt?.status === 'pending';
  const adminAmount = Number(booking.adminAmount);
  const payDue = Number.isFinite(adminAmount) && adminAmount > 0 ? adminAmount : Number(booking.quote?.total || 0);
  const isDelivery = booking.fulfillment === 'delivery';
  const docItems = [['סרטון חוץ', ev.video], ['תמונת דלק', ev.fuel], ['קילומטראז׳', ev.odometer]];
  const docsDone = docItems.every(([, ok]) => ok);
  if (docsDone && ev.payment) return `<div class="next-steps complete"><div class="next-head"><b>✓ הכל מוכן — ממתין שבעל הרכב יתחיל את ההשכרה</b></div></div>`;
  return `<div class="next-steps">
    <div class="next-head"><b>איך מקבלים את הרכב</b></div>
    <ol class="next-flow">
      <li class="nf-step"><span class="nf-num">1</span><div class="nf-body"><b>${isDelivery ? 'מסירת הרכב אליך' : 'קבלת מיקום ומפתח'}</b><small>${isDelivery ? `בעל הרכב יביא את הרכב אל <bdi>${booking.deliveryAddress ? esc(booking.deliveryAddress) : 'הכתובת שמסרתם'}</bdi> — תאמו איתו שעה בצ׳אט` : 'בעל הרכב מוסר לך את מיקום הרכב והמפתח בצ׳אט'}</small><div class="nf-actions">${isDelivery ? '' : `<button class="btn outline" data-address="${booking.id}">📍 כתובת איסוף</button>`}<button class="btn outline" data-chat="${booking.id}">💬 צ׳אט עם בעל הרכב</button></div></div></li>
      <li class="nf-step"><span class="nf-num">2</span><div class="nf-body"><b>תיעוד מצב הרכב — בעת האיסוף</b><small>אחרי שקיבלתם את הרכב, צלמו בצ׳אט:</small><div class="next-items">${docItems.map(([label, ok]) => `<span class="next-item${ok ? ' ok' : ''}">${ok ? '✓' : '○'} ${esc(label)}</span>`).join('')}</div></div></li>
      <li class="nf-step"><span class="nf-num">3</span><div class="nf-body"><b>תשלום${payDue ? ` — ${money(payDue)}` : ''}</b><small>${ev.payment ? 'התשלום אושר על ידי בעל הרכב.' : payPending ? 'הדיווח נשלח — ממתין לאישור בעל הרכב.' : 'אופן התשלום נמסר על ידי בעל הרכב בצ׳אט. אחרי ששילמתם, צלמו את האישור ודווחו כאן.'}</small><div class="next-items"><span class="next-item${ev.payment ? ' ok' : ''}">${ev.payment ? '✓ שולם ואושר' : payPending ? '⏳ ממתין לאישור' : '○ ממתין לתשלום'}</span></div>${ev.payment || payPending ? '' : `<div class="nf-actions"><button class="btn gold" data-payment="${booking.id}">💳 דיווח על תשלום</button><button class="btn outline" data-chat="${booking.id}">💬 איך משלמים?</button></div>`}</div></li>
    </ol>
    <button class="btn gold block" data-chat="${booking.id}">המשך בצ׳אט →</button>
  </div>`;
}
// Why "התחלת השכרה" can't be pressed yet — the same list the server checks, so the owner is never
// allowed to click a button that would just come back as a 409.
function startBlockedReason(booking) {
  const ev = evidenceState(booking, booking.id);
  const missing = [];
  if (!ev.video) missing.push('סרטון חוץ');
  if (!ev.fuel) missing.push('תמונת דלק');
  if (!ev.odometer) missing.push('קילומטראז׳');
  if (!ev.payment) missing.push('תשלום מאושר');
  return missing.length ? `אפשר להתחיל אחרי שהשוכר ישלים: ${missing.join(', ')}` : '';
}

// The owner's counterpart on an approved booking: hand over the car's location + key in chat, and see
// the renter's LIVE progress (each item they complete shows here) so the owner knows when to start.
function ownerHandoverHint(booking) {
  const ev = evidenceState(booking, booking.id);
  const items = [['סרטון חוץ', ev.video], ['תמונת דלק', ev.fuel], ['קילומטראז׳', ev.odometer], ['תשלום', ev.payment]];
  const done = items.filter(([, ok]) => ok).length;
  const allDone = done === items.length;
  return `<div class="next-steps owner-hint${allDone ? ' complete' : ''}">
    <div class="next-head"><b>${booking.fulfillment === 'delivery' ? '🚚 מסירת הרכב לשוכר' : '📍 מסרו לשוכר את מיקום הרכב והמפתח'}</b></div>
    <small class="oh-note">${booking.fulfillment === 'delivery' ? `הזמנה עם מסירה: הביאו את הרכב אל <bdi>${booking.deliveryAddress ? esc(booking.deliveryAddress) : 'הכתובת שהשוכר מסר'}</bdi> ותאמו שעה בצ׳אט. לאחר שהשוכר יתעד את מצב הרכב וישלם — תוכלו להתחיל את ההשכרה.` : 'תאמו מקום איסוף ומסירת מפתח בצ׳אט. לאחר שהשוכר יתעד את מצב הרכב וישלם — תוכלו להתחיל את ההשכרה.'}</small>
    <div class="oh-progress"><div class="oh-progress-head"><b>התקדמות השוכר</b><span class="next-count${allDone ? ' ok' : ''}">${done}/${items.length}</span></div><div class="next-items">${items.map(([label, ok]) => `<span class="next-item${ok ? ' ok' : ''}">${ok ? '✓' : '○'} ${esc(label)}</span>`).join('')}</div></div>
    ${allDone ? '<div class="oh-ready">✓ השוכר השלים הכל — אפשר להתחיל את ההשכרה</div>' : ''}
    <div class="nf-actions"><button class="btn outline" data-chat="${booking.id}">💬 צ׳אט עם השוכר</button></div>
  </div>`;
}

// ---- Reservation page: the confirmation a renter expects after booking ----
// Modelled on how a rental company shows a reservation: one confirmation number, the two ends of the
// rental laid out side by side, an itemised price, and the actions for THIS booking. Previously a
// booking was only ever a row in a list, so there was nowhere to see the full record.
const RES_STEPS = [['pending', 'ממתינה לאישור'], ['approved', 'אושרה'], ['active', 'בהשכרה'], ['done', 'הסתיימה']];
function resDateBlock(label, iso, note) {
  const d = new Date(iso);
  const ok = !Number.isNaN(d.getTime());
  const day = ok ? d.toLocaleDateString('he-IL', {day: 'numeric', month: 'long', timeZone: 'America/New_York'}) : '—';
  const wd = ok ? d.toLocaleDateString('he-IL', {weekday: 'long', timeZone: 'America/New_York'}) : '';
  const time = ok ? d.toLocaleTimeString('he-IL', {hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York'}) : '';
  return `<div class="res-when"><span class="res-when-lab">${esc(label)}</span>
    <b class="res-when-day">${esc(day)}</b>
    <span class="res-when-meta">${esc(wd)}${time ? ` · ${esc(time)}` : ''}</span>
    ${note ? `<small class="res-when-note">${esc(note)}</small>` : ''}</div>`;
}
export function reservationView(id) {
  const b = store.bookings[id];
  if (!b) return `<button type="button" class="up-back" data-back-bookings>← חזרה להזמנות</button>${emptyState(ICON.calendar, 'ההזמנה לא נמצאה', 'ייתכן שהיא נמחקה.')}`;
  const car = store.cars[b.carId] || b.carSnapshot || {};
  const carName = `${car.make || ''} ${car.model || ''}`.trim() || 'רכב שאינו מוצג יותר באתר';
  const q = b.quote || {};
  const adminAmount = Number(b.adminAmount);
  const total = Number.isFinite(adminAmount) && adminAmount > 0 ? adminAmount : Number(q.total || 0);
  const pmt = store.payments[id];
  const isDelivery = b.fulfillment === 'delivery';
  const stepIdx = RES_STEPS.findIndex(([k]) => k === b.status);
  const dead = ['cancelled', 'rejected', 'expired'].includes(b.status);
  const modeLabel = {hourly: 'לפי שעות', daily: 'לפי ימים', weekly: 'לפי שבועות', weekend: 'מחיר סופ״ש'}[q.pricingMode] || '';
  return `<button type="button" class="up-back" data-back-bookings>← חזרה להזמנות</button>
    <div class="res-head">
      <div class="res-head-top">
        <span class="res-conf-lab">מספר הזמנה</span>
        <b class="res-conf" dir="ltr">${esc(String(id).slice(-7).toUpperCase())}</b>
      </div>
      <div class="res-head-car"><b>${esc(carName)}</b><span>${esc(car.year || '')}${car.type ? ` · ${esc(car.type)}` : ''}</span></div>
      <span class="status-badge ${esc(b.status)}">${statusLabel(b.status)}</span>
    </div>
    ${dead ? '' : `<ol class="res-track">${RES_STEPS.map(([k, label], i) =>
      `<li class="res-step${i <= stepIdx ? ' done' : ''}${i === stepIdx ? ' now' : ''}"><span></span><small>${esc(label)}</small></li>`).join('')}</ol>`}
    <div class="res-when-row">
      ${resDateBlock('איסוף', b.startAt, isDelivery ? 'מסירה אליך' : 'איסוף עצמי')}
      ${resDateBlock('החזרה', b.endAt, '')}
    </div>
    ${isDelivery && b.deliveryAddress ? `<div class="res-line"><span>כתובת מסירה</span><b><bdi>${esc(b.deliveryAddress)}</bdi></b></div>` : ''}
    <div class="res-price">
      <div class="res-price-head"><b>פירוט מחיר</b>${modeLabel ? `<span>${esc(modeLabel)}</span>` : ''}</div>
      ${Number(q.baseAmount) ? `<div class="res-line"><span>מחיר ההשכרה</span><b>${money(q.baseAmount)}</b></div>` : ''}
      ${Number(q.deliveryFee) ? `<div class="res-line"><span>מסירה</span><b>${money(q.deliveryFee)}</b></div>` : ''}
      ${Number.isFinite(adminAmount) && adminAmount > 0 ? `<div class="res-line"><span>סכום מתוקן על ידי המנהל</span><b>${money(adminAmount)}</b></div>` : ''}
      <div class="res-line res-total"><span>סה״כ</span><b>${total ? money(total) : 'בתיאום'}</b></div>
      <small class="res-pay-note">${pmt ? (pmt.status === 'approved' ? '✓ התשלום אושר על ידי בעל הרכב' : pmt.status === 'rejected' ? '✗ התשלום נדחה — יש לשלוח הוכחה מעודכנת' : '⏳ הוכחת התשלום ממתינה לאישור') : 'התשלום מתבצע ישירות מול בעל הרכב. אחרי התשלום מדווחים עליו כאן.'}</small>
    </div>
    <div class="chips res-actions">
      ${['pending', 'approved', 'active'].includes(b.status) || (b.status === 'cancelled' && pmt) ? `<button class="btn primary" data-chat="${esc(id)}">💬 צ׳אט</button>` : ''}
      ${['approved', 'active'].includes(b.status) ? `<button class="btn outline" data-address="${esc(id)}">📍 פרטי איסוף</button>` : ''}
      ${b.status === 'approved' && (!pmt || pmt.status === 'rejected') ? `<button class="btn gold" data-payment="${esc(id)}">💳 דיווח על תשלום</button>` : ''}
      ${store.cars[b.carId] ? `<button class="btn outline" data-view-car="${esc(b.carId)}">פרטי הרכב</button>` : ''}
      ${['pending', 'approved'].includes(b.status) ? `<button class="btn outline" data-cancel-booking="${esc(id)}">ביטול הזמנה</button>` : ''}
    </div>`;
}
function bookingList(bookings, role) {
  const sorted = bookings.slice().sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return `<div class="list">${sorted.length ? sorted.slice(0, pageOf(`bookings-${role}`)).map(booking => {
    const car = store.cars[booking.carId] || booking.carSnapshot || {};
    // Bookings made before carSnapshot existed have no name to fall back on — an empty <h3> reads as a
    // broken card, so say plainly that the car is gone rather than showing nothing.
    const carTitle = `${car.make || ''} ${car.model || ''}`.trim() || 'רכב שאינו מוצג יותר באתר';
    // A rating can be submitted ONCE (rating-submit aborts the transaction on a second attempt), so the
    // button retires itself instead of letting someone write a whole review and lose it to a 409.
    // rating-submit records the flag here on the booking — the ratings node itself is admin-only.
    const rated = type => !!booking.ratedBy?.[`${store.user?.uid}_${type}`];
    const rateBtn = (type, label) => rated(type)
      ? `<span class="rated-done">✓ ${label.replace('דרג', 'דירגת')}</span>`
      : `<button class="btn outline" data-rate="${booking.id}" data-rate-type="${type}">${label}</button>`;
    const ratingButtons = booking.status === 'done' ? (role === 'renter' ? `${rateBtn('car', 'דרג רכב')}${rateBtn('user', 'דרג בעל רכב')}` : role === 'owner' ? rateBtn('user', 'דרג שוכר') : '') : '';
    const evidence = booking.evidence || {};
    const pmt = store.payments[booking.id];
    const evidenceDone = evidence.video && evidence.fuel && evidence.odometer && paymentApproved(pmt);
    // Mobile clutter fix: only the DECISIVE actions stay on the card; everything else collapses into
    // an "עוד פעולות" menu. The buttons keep their data-* attributes and stay in the DOM (just hidden),
    // so every existing binding keeps working with no re-binding.
    const payPills = ['owner', 'admin'].includes(role) && pmt
      ? `${pmt.status === 'approved' ? '<span class="pill ok">תשלום אושר</span>' : pmt.status === 'rejected' ? '<span class="pill warn">תשלום נדחה</span>' : pmt.status === 'pending' ? '<span class="pill warn">ממתין לאישור</span>' : ''}`
      : '';
    const primaryChips = [
      role === 'owner' && booking.status === 'pending' ? `<button class="btn primary" data-status="approved" data-booking="${booking.id}">אישור</button><button class="btn danger" data-status="rejected" data-booking="${booking.id}">דחייה</button>` : '',
      role === 'owner' && booking.status === 'approved' ? `<button class="btn gold" data-status="active" data-booking="${booking.id}"${evidenceDone ? '' : ` disabled title="${esc(startBlockedReason(booking))}"`}>התחלת השכרה</button>` : '',
      role === 'owner' && booking.status === 'active' ? `<button class="btn gold" data-status="done" data-booking="${booking.id}">סיום השכרה</button>` : '',
      role === 'renter' && booking.status === 'approved' && (!pmt || pmt.status === 'rejected') ? `<button class="btn gold" data-payment="${booking.id}">💳 דיווח על תשלום</button>` : '',
      ['owner', 'admin'].includes(role) && pmt && pmt.status === 'pending' ? `<button class="btn primary" data-pay-approve="${booking.id}">אישור תשלום</button><button class="btn danger" data-pay-reject="${booking.id}">דחיית תשלום</button>` : '',
      role === 'renter' && (booking.status === 'active' || (booking.status === 'done' && !booking.handover?.return && Date.now() - Number(booking.endedAt || 0) <= 24 * 60 * 60 * 1000))
        ? `<button class="btn ${booking.status === 'done' ? 'gold' : 'outline'}" data-handover="${booking.id}" data-stage="return">תיעוד החזרה${booking.status === 'done' ? ' — נותרו שעות אחרונות' : ''}</button>` : '',
      ratingButtons,
      ['pending', 'approved', 'active'].includes(booking.status) || (booking.status === 'cancelled' && pmt) ? `<button class="btn outline" data-chat="${booking.id}">צ׳אט${booking.status === 'cancelled' ? ' — סגירת ההחזר' : ''}</button>` : '',
      // A request that died left the renter with a badge and nothing else — no chat, no action, no
      // explanation. The expiry SMS already tells them "אפשר לשלוח בקשה חדשה"; this is that path.
      role === 'renter' ? `<button class="btn outline" data-reservation="${esc(booking.id)}">פרטי ההזמנה</button>` : '',
      role === 'renter' && ['expired', 'rejected', 'cancelled'].includes(booking.status) && booking.carId
        ? `<button class="btn primary" data-rebook="${esc(booking.carId)}" data-rebook-from="${esc(booking.id)}">בקשה חדשה לרכב הזה</button>` : '',
    ].filter(Boolean).join('');
    const moreChips = [
      role === 'owner' && ['pending', 'approved', 'active'].includes(booking.status) ? `<button class="btn outline" data-renter="${booking.renterUid}">פרטי שוכר</button>` : '',
      ['approved', 'active'].includes(booking.status) ? `<button class="btn outline" data-address="${booking.id}">כתובת איסוף</button>` : '',
      booking.carId && store.cars[booking.carId] ? `<button class="btn outline" data-view-car="${esc(booking.carId)}">פרטי הרכב</button>` : '',
      ['owner', 'admin'].includes(role) && pmt ? `<button class="btn outline" data-view-payment="${booking.id}">הוכחת תשלום</button>` : '',
      ['owner', 'admin'].includes(role) && booking.handover ? `<button class="btn outline" data-view-handover="${booking.id}">צפייה בתיעוד</button>` : '',
      role === 'admin' ? `<select class="admin-status-select" data-admin-status="${booking.id}"><option value="">שינוי סטטוס…</option><option value="approved">אישור</option><option value="rejected">דחייה</option><option value="active">התחלת השכרה</option><option value="done">סיום</option><option value="cancelled">ביטול</option></select><button class="btn outline" data-admin-note="${booking.id}">הערת מנהל</button>` : '',
      ['renter', 'owner'].includes(role) && ['pending', 'approved'].includes(booking.status) ? `<button class="btn outline" data-cancel-booking="${booking.id}">ביטול הזמנה</button>` : '',
    ].filter(Boolean).join('');
    const moreBlock = moreChips ? `<details class="bk-more"><summary>עוד פעולות</summary><div class="chips">${moreChips}</div></details>` : '';
    // "פג תוקף"/"נדחתה" as a bare badge reads like a system error. Name the cause.
    const endedNote = role === 'renter' && booking.status === 'expired'
      ? '<p class="ev-note">הבקשה פגה — בעל הרכב לא השיב תוך 48 שעות. אפשר לשלוח בקשה חדשה, או לבחור רכב אחר.</p>'
      : role === 'renter' && booking.status === 'rejected'
      ? '<p class="ev-note">בעל הרכב לא אישר את הבקשה לתאריכים האלה. אפשר לנסות תאריכים אחרים, או לבחור רכב אחר.</p>'
      : '';
    const cancelledPaidNote = booking.status === 'cancelled' && pmt
      ? `<p class="ev-note">שולם על ההזמנה הזו ${money(pmt.amount)}. הביטול אינו מבצע החזר אוטומטי — סגרו את ההחזר ישירות בצ׳אט, ואם צריך עזרה פנו לתמיכה.</p>`
      : '';
    const renterPaymentNote = role === 'renter' && pmt && booking.status !== 'cancelled' ? `<p class="ev-note">${pmt.status === 'approved' ? '✓ התשלום שלך אושר על ידי בעל הרכב.' : pmt.status === 'rejected' ? '✗ התשלום נדחה — שלחו הוכחה מעודכנת בצ׳אט.' : '⏳ הוכחת התשלום ממתינה לאישור בעל הרכב.'}</p>` : '';
    return `<article class="booking-card"><div class="booking-main"><div><small>הזמנה ${esc(booking.id.slice(-7))}</small><h3>${esc(carTitle)}</h3><p>${fmtDate(booking.startAt)} — ${fmtDate(booking.endAt)}</p>${booking.quote?.total ? `<p class="bk-total">${money(booking.quote.total)}</p>` : ''}${booking.status === 'pending' && booking.pendingExpiresAt ? `<p class="bk-expiry">ממתינה לאישור עד ${fmtDate(booking.pendingExpiresAt)}</p>` : ''}</div><span class="status-badge ${esc(booking.status)}">${statusLabel(booking.status)}</span></div>${bookingTimeline(booking, pmt)}${role === 'renter' && booking.status === 'approved' ? renterNextSteps(booking) : ''}${role === 'renter' && booking.status === 'active' && !booking.handover?.return ? '<p class="ev-note">לפני שמחזירים את הרכב — צלמו אותו שוב (סרטון, דלק, קילומטראז׳) דרך "תיעוד החזרה". זו ההוכחה שלכם למצב שבו הוחזר.</p>' : ''}${role === 'owner' && booking.status === 'approved' ? ownerHandoverHint(booking) : ''}${payPills ? `<div class="chips pill-row">${payPills}</div>` : ''}${booking.fulfillment === 'delivery' ? `<div class="ev-note deliv-note">🚚 מסירה${booking.deliveryAddress ? ` לכתובת: <bdi>${esc(booking.deliveryAddress)}</bdi>` : ' — הכתובת תואמה בצ׳אט'}</div>` : ''}<div class="chips">${primaryChips}</div>${moreBlock}${booking.adminNote || booking.adminAmount !== undefined ? `<p class="ev-note">הערת מנהל: ${esc(booking.adminNote || '')}${booking.adminAmount !== undefined ? ` · סכום מתוקן: ${money(booking.adminAmount)}` : ''}</p>` : ''}${booking.status === 'cancelled' && (booking.cancelledByRole || booking.cancelReason) ? `<p class="ev-note">בוטלה${booking.cancelledByRole ? ` על ידי ${({renter: 'השוכר', owner: 'בעל הרכב', admin: 'המנהל'})[booking.cancelledByRole] || ''}` : ''}${booking.cancelReason ? ` · סיבה: ${esc(booking.cancelReason)}` : ''}</p>` : ''}${endedNote}${cancelledPaidNote}${renterPaymentNote}</article>`;
  }).join('') : emptyState(ICON.calendar,
      role === 'renter' ? 'אין לך הזמנות עדיין' : 'אין הזמנות עדיין',
      // The owner's "כשתתקבל בקשה היא תופיע כאן" is wrong for an ADMIN looking at the whole site's
      // bookings — nobody is going to send THEM a request.
      role === 'renter' ? 'מצאו רכב מהצי שלנו והזמינו — זה מהיר ופשוט.'
        : role === 'admin' ? 'עדיין לא בוצעו הזמנות באתר. ברגע שתתקבל הזמנה ראשונה היא תופיע כאן.'
        : 'כשתתקבל בקשת הזמנה היא תופיע כאן.',
      role === 'renter' ? '<button class="btn primary" data-route="cars">חיפוש רכב</button>' : '')}</div>${listMoreBtn(`bookings-${role}`, sorted.length)}`;
}

function bindActions() {
  // "פרטי הרכב" on a booking card → open the car's detail modal (data-car-open can't be used on a button —
  // bindCarButtons deliberately ignores clicks landing on buttons).
  document.querySelectorAll('[data-reservation]').forEach(b => b.onclick = () => {
    store.reservationId = b.dataset.reservation; store.dashTab = 'reservation'; renterDashboard('reservation');
  });
  document.querySelector('[data-back-bookings]')?.addEventListener('click', () => { store.dashTab = 'bookings'; renterDashboard('bookings'); });
  document.querySelectorAll('[data-view-car]').forEach(button => button.onclick = () => openCar(button.dataset.viewCar));
  // Re-open the car with the original dates already filled in — but only while they are still in the
  // future, and NEVER carrying the old requestId: booking-create treats a repeated requestId from the
  // same renter as a duplicate and would hand back the dead booking instead of creating a new one.
  document.querySelectorAll('[data-rebook]').forEach(button => button.onclick = () => {
    const carId = button.dataset.rebook;
    const previous = store.bookings[button.dataset.rebookFrom];
    const [startDate, startHour] = String(previous?.startLocal || '').split('T');
    const [endDate, endHour] = String(previous?.endLocal || '').split('T');
    const stillAhead = startDate && new Date(`${startDate}T00:00`).getTime() > Date.now();
    try {
      if (stillAhead) sessionStorage.setItem(`cd-booking-draft-${carId}`, JSON.stringify({
        startDate, endDate, startHour: startHour || '10:00', endHour: endHour || '10:00',
        fulfillment: previous?.fulfillment || 'pickup', deliveryAddress: previous?.deliveryAddress || '',
      }));
      else sessionStorage.removeItem(`cd-booking-draft-${carId}`);
    } catch {}
    openCar(carId);
    if (!stillAhead) toast('התאריכים הקודמים כבר עברו — בחרו תאריכים חדשים');
  });
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
    // Ending the rental is the moment the renter's return documentation stops being routine — say so
    // when it's still missing, instead of letting the owner close it without realising.
    if (status === 'done') {
      const bk = store.bookings[button.dataset.booking] || {};
      const msg = bk.handover?.return
        ? 'לסיים את ההשכרה?'
        : 'השוכר עדיין לא תיעד את החזרת הרכב.\n\nאפשר לסיים — יישארו לו 24 שעות להשלים את התיעוד, ואחר כך לא תהיה הוכחה למצב שבו הרכב הוחזר.\n\nלסיים בכל זאת?';
      if (!confirm(msg)) return;
    }
    button.disabled = true;
    try { await setBookingStatus(button.dataset.booking, status); toast('ההזמנה עודכנה'); }
    catch (error) { toast(error.message); button.disabled = false; }
  });
  // audit #19: renter/owner can cancel a pending/approved booking themselves (with confirmation).
  document.querySelectorAll('[data-cancel-booking]').forEach(button => button.onclick = async () => {
    // The reason is optional but recorded (audit #12) — Escape/ביטול in the prompt aborts the whole action.
    // Cancelling never touches the payment record, so a paid booking is being cancelled with money
    // outstanding. Say the amount out loud before it happens, not after.
    const cancelPmt = store.payments[button.dataset.cancelBooking];
    if (cancelPmt && !confirm(`שולם על ההזמנה הזו ${money(cancelPmt.amount)}.\n\nביטול אינו מבצע החזר אוטומטי — תצטרכו לסגור את ההחזר ישירות מול הצד השני (הצ׳אט יישאר פתוח).\n\nלהמשיך לביטול?`)) return;
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
  // The birth date locks only once it HAS a value: registration never collects it, so a user who
  // uploads documents first would otherwise be stuck with a blank, un-editable field that
  // booking-create demands. Mirrors the same carve-out in profile-save.mjs.
  const dobLocked = verLocked && !!profile.birthDate;
  return `<div class="section-head"><h2>פרופיל ואימות</h2><span class="status-badge ${approved ? 'approved' : 'pending'}">${esc(verificationLabel(verification.status))}</span></div>
    <div class="avatar-row"><button type="button" class="avatar-click" id="avatar-open" title="החלפת תמונת פרופיל">${avatarHtml(profile, 84)}<span class="avatar-cam">${ICON.camera}</span></button><input hidden type="file" accept="image/jpeg,image/png,image/webp" id="avatar-file"><div class="avatar-actions"><b>תמונת פרופיל</b><button type="button" class="btn outline" id="avatar-open2">בחירת תמונה מהגלריה</button></div></div><form id="profile-form" class="card inset"><div class="form-grid"><div class="field"><label>שם חוקי ${verLocked ? '🔒' : ''}</label><input name="name" value="${esc(profile.name || '')}" disabled ${verLocked ? 'data-locked' : ''} required>${verLocked ? '<small>נעול לאחר הגשת מסמכים. לשינוי פנו לתמיכה.</small>' : ''}</div><div class="field"><label>טלפון</label><input name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(profile.phone || '')}" disabled></div><div class="field"><label>תאריך לידה ${dobLocked ? '🔒' : ''}</label><input name="birthDate" type="date" value="${esc(profile.birthDate || '')}" disabled ${dobLocked ? 'data-locked' : ''} required>${!profile.birthDate ? '<small>חסר — נדרש כדי להזמין רכב. אפשר להשלים גם עכשיו.</small>' : ''}</div><div class="field"><label>מייל 🔒</label><input value="${esc(profile.email || store.user?.email || '')}" disabled data-locked></div></div><button type="button" class="btn outline block" id="profile-edit">עריכה</button><button class="btn primary block" id="profile-save" style="display:none">שמירת שינויים</button></form>
    ${verLocked
      ? `<div class="ver-card ver-locked ${approved ? 'ver-ok' : ''}"><span class="ver-illustration">${cardSvg}</span><span class="ver-main"><b>אימות רישיון נהיגה</b><small>${approved ? 'האימות אושר ונעול 🔒 — אפשר להזמין רכבים' : 'המסמכים נשלחו ונעולים 🔒 · בבדיקת מנהל'}</small></span><span class="ver-arrow">${approved ? '✓' : '🔒'}</span></div>`
      : `<button type="button" class="ver-card" id="ver-wizard"><span class="ver-illustration">${cardSvg}</span><span class="ver-main"><b>אימות רישיון נהיגה</b><small>${verification.status === 'needs_resubmission' ? 'המנהל ביקש צילום מחדש — לחצו להעלאה' : verification.status === 'rejected' ? 'האימות לא אושר — אפשר לצלם ולשלוח שוב' : 'צלמו רישיון (2 צדדים) וסלפי — לוקח דקה'}</small></span><span class="ver-arrow">←</span></button>`}
    ${verification.reviewNote ? `<p class="ev-note">${['rejected', 'needs_resubmission'].includes(verification.status) ? 'מה צריך לתקן' : 'הערת מנהל'}: ${esc(verification.reviewNote)}</p>` : ''}<button type="button" class="btn outline block" id="logout-profile">יציאה מהחשבון</button>`;
}
function ownerProfileView() {
  const profile = store.profile || {};
  return `<h2>פרופיל</h2><div class="avatar-row"><button type="button" class="avatar-click" id="avatar-open" title="החלפת תמונת פרופיל">${avatarHtml(profile, 84)}<span class="avatar-cam">${ICON.camera}</span></button><input hidden type="file" accept="image/*" id="avatar-file"><div class="avatar-actions"><b>תמונת פרופיל</b><button type="button" class="btn outline" id="avatar-open2">בחירת תמונה מהגלריה</button></div></div><form id="profile-form" class="card inset"><div class="form-grid"><div class="field"><label>שם מלא</label><input name="name" value="${esc(profile.name || '')}" disabled required></div><div class="field"><label>טלפון</label><input name="phone" value="${esc(profile.phone || '')}" disabled></div><div class="field"><label>מייל 🔒</label><input value="${esc(profile.email || store.user?.email || '')}" disabled data-locked></div></div><button type="button" class="btn outline block" id="profile-edit">עריכה</button><button class="btn primary block" id="profile-save" style="display:none">שמירת שינויים</button></form><button type="button" class="btn outline block" id="logout-profile">יציאה מהחשבון</button>`;
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
  // Compare like with like. threadUnread() tests against threadMeta().at — the SUMMARY timestamp the
  // server writes (bookings.lastMsgAt / inquiries.updatedAt). Marking read with the message's own
  // createdAt mixed sources: the server writes the summary in a SECOND update, so lastMsgAt is always
  // a few ms LATER than createdAt, and mixing in the phone's Date.now() made it worse whenever the
  // device clock ran behind the server. Either way the thread sprang back to unread on the next draw.
  // Reading also means "I've seen everything up to now", so the wall clock still counts — but the
  // summary timestamp is now always included, which is what the unread test actually compares to.
  const ts = Math.max(Number(at || 0), Number(threadMeta(key)?.at || 0), Date.now());
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
      <div class="chat-list-head"><button type="button" class="chat-page-back" id="chat-page-back" title="חזרה לאזור האישי" aria-label="חזרה">→</button><h2>צ׳אטים</h2><button type="button" class="chat-refresh" id="chat-refresh" title="רענון השיחות" aria-label="רענון השיחות">⟳</button>${store.isAdmin ? '<input id="chat-search" aria-label="חיפוש משתמש בצ׳אטים" placeholder="חיפוש משתמש…" autocomplete="off">' : ''}</div>
      <div class="chat-filter" id="chat-filter"></div>
      <div class="chat-items" id="chat-items"></div>
    </aside>
    <section class="chat-pane" id="chat-pane"><div class="chat-empty"><span class="chat-empty-ic">${ICON.chat}</span><p>בחרו שיחה מהרשימה</p></div></section>
  </div>`;
  document.querySelector('#chat-refresh')?.addEventListener('click', async event => {
    // The list is driven by live listeners, so a refresh is really "re-read what the store has and
    // repaint" — plus a spin so the tap visibly did something even when nothing changed.
    const btn = event.currentTarget;
    btn.classList.add('spinning');
    renderChatItems();
    refreshChatBadges();
    if (store.isAdmin) ensureAdminChatFeed();
    await new Promise(r => setTimeout(r, 420));
    btn.classList.remove('spinning');
    toast('השיחות עודכנו');
  });
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
        const car = store.cars[inq.carId] || inq.carSnapshot || {};
        const renter = {name: inq.renterName, ...(store.users[inq.renterUid] || {})};
        return !query || `פנייה ${car.make || ''} ${car.model || ''} ${renter.name || ''} ${car.ownerName || ''}`.toLowerCase().includes(query);
      })
      .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
      .map(inq => {
        const car = store.cars[inq.carId] || inq.carSnapshot || {};
        const renter = {name: inq.renterName, ...(store.users[inq.renterUid] || {})};
        return {key: `i:${inq.id}`, emoji: ICON.car, title: `פנייה: ${`${car.make || 'רכב'} ${car.model || ''}`.trim()}`, subtitle: `${renter.name || 'שוכר'} ↔ ${car.ownerName || 'בעל הרכב'}`, live: true};
      });
    return [...supportThreads, ...inquiryThreads];
  }
  const role = myRole();
  // A one-line preview like WhatsApp: prefer the last message text the server stored on the thread.
  const preview = (key, fallback) => { const m = threadMeta(key); return m?.text ? `${m.from === store.user?.uid ? 'את/ה: ' : ''}${m.text}` : fallback; };
  const timeOf = key => threadMeta(key)?.at || 0;
  const bookingItems = myBookings()
    // A cancelled booking that had money in it keeps its thread open for the refund (rev.187) — it has
    // to be reachable from the chat list, not only from the booking card.
    .filter(b => ['pending', 'approved', 'active', 'done'].includes(b.status) || (b.status === 'cancelled' && store.payments[b.id]))
    .map(b => {
      const car = store.cars[b.carId] || b.carSnapshot || {};
      const key = `b:${b.id}`;
      return {key, at: timeOf(key) || Number(b.updatedAt || b.createdAt || 0), emoji: ICON.car, title: `${car.make || 'רכב'} ${car.model || ''}`.trim(), subtitle: preview(key, role === 'owner' ? 'שיחה עם השוכר' : 'שיחה עם בעל הרכב'), status: b.status, live: ['pending', 'approved', 'active'].includes(b.status), unread: threadUnread(key)};
    });
  // Pre-booking inquiry threads (store.inquiries is already role-filtered: a renter sees ones they opened,
  // an owner sees ones about their cars).
  const inquiryItems = list(store.inquiries)
    .map(inq => {
      const car = store.cars[inq.carId] || inq.carSnapshot || {};
      const key = `i:${inq.id}`;
      // Two people asking about the SAME car produced two identical rows — the asker's name is the
      // only thing that tells them apart, and store.users is unreadable to an owner.
      const askerName = inq.renterName || store.users[inq.renterUid]?.name || '';
      const carName = `${car.make || 'רכב'} ${car.model || ''}`.trim();
      return {key, at: timeOf(key) || Number(inq.updatedAt || inq.createdAt || 0), emoji: ICON.chat, title: role === 'owner' && askerName ? `${carName} · ${askerName}` : carName, subtitle: preview(key, role === 'owner' ? `פנייה${askerName ? ` מ${askerName}` : ' משוכר'} (טרם הזמנה)` : 'שיחה עם בעל הרכב (טרם הזמנה)'), live: true, unread: threadUnread(key)};
    });
  // A blocked user is allowed onto this page for one reason only — to appeal. Their booking and
  // inquiry threads stay out of reach (the server would refuse them anyway).
  const blocked = store.profile?.blocked === true && !store.isAdmin;
  const supportKey = `a:${store.user.uid}`;
  const support = {key: supportKey, at: timeOf(supportKey), emoji: ICON.chat, title: 'שירות לקוחות', subtitle: preview(supportKey, 'תמיכה טכנית · מענה מהיר'), live: true, unread: threadUnread(supportKey)};
  // Newest-active conversations first (support pinned when it has recent activity, else near the top).
  if (blocked) return [support];
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
  const car = booking ? (store.cars[booking.carId] || booking.carSnapshot || {}) : (inquiry ? store.cars[inquiry.carId] || inquiry.carSnapshot || {} : {});
  const title = isSupport ? (store.isAdmin ? (store.users[id]?.name || store.users[id]?.email || `אורח · ${id.slice(-5)}`) : 'שירות לקוחות') : `${car.make || 'רכב'} ${car.model || ''}`.trim();
  // Who is on the other end. The owner already has renterName on the booking; the renter gets the
  // owner's name from the car record, which is public.
  const otherParty = isSupport ? '' : (() => {
    const meIsOwner = booking ? booking.ownerUid === store.user?.uid : inquiry?.ownerUid === store.user?.uid;
    if (store.isAdmin) return [booking?.renterName || store.users[booking?.renterUid]?.name, car.ownerName].filter(Boolean).join(' ↔ ');
    if (meIsOwner) {
      const name = booking?.renterName || inquiry?.renterName || store.users[booking?.renterUid || inquiry?.renterUid]?.name || 'השוכר';
      const score = userRating(booking?.renterUid || inquiry?.renterUid);
      return score ? `${name} · ★ ${score.toFixed(1)}` : name;
    }
    return car.ownerName || 'בעל הרכב';
  })();
  const isOwner = booking && booking.ownerUid === store.user.uid;
  const isRenter = booking && booking.renterUid === store.user.uid;
  const convEnded = booking ? booking.chatEnded === true : false;   // owner/admin pressed "סיום שיחה"
  // rev.187 keeps a cancelled booking's thread open when money changed hands, so the refund can be
  // arranged — the server allows it and the chat button offers it. The composer has to agree, or the
  // renter arrives at the conversation and cannot type a word.
  const refundOpen = booking?.status === 'cancelled' && !!store.payments[booking.id];
  // A blocked user may write to support and nowhere else — the same rule message-send enforces.
  const blockedElsewhere = store.profile?.blocked === true && !store.isAdmin && !isSupport;
  const live = (isSupport || isInquiry || refundOpen || ['pending', 'approved', 'active'].includes(booking?.status)) && !(convEnded && isRenter) && !blockedElsewhere;
  const ev = booking ? evidenceState(booking, id) : null;
  const evReady = ev && ev.video && ev.fuel && ev.odometer && ev.payment;

  const headActions = `${booking && isOwner
    ? (booking.status === 'approved' ? `<button class="btn gold" id="rental-start"${evReady ? '' : ` disabled title="${esc(startBlockedReason({...booking, id}))}"`}>התחלת השכרה</button>`
      : booking.status === 'active' ? `<button class="btn primary" id="rental-end">סיום השכרה</button>` : '')
    : ''}${booking && (isOwner || store.isAdmin) && !convEnded && ['done', 'cancelled', 'rejected', 'expired'].includes(booking.status) ? '<button class="btn dark-out" id="chat-end" title="הצד השני לא יוכל לשלוח עוד הודעות">סיום שיחה</button>' : ''}${booking && (isOwner || store.isAdmin) && convEnded ? '<button class="btn dark-out" id="chat-reopen" title="פתיחה מחדש של השיחה לשני הצדדים">פתיחת שיחה מחדש</button>' : ''}${store.isAdmin ? '<button class="btn dark-out" id="chat-clear" title="מחיקת כל ההודעות">ניקוי</button>' : ''}`;
  const checklist = booking && booking.status === 'approved' && !isRenter
    ? `<div class="ev-checklist">${[['video', 'סרטון חוץ'], ['fuel', 'דלק'], ['odometer', 'קילומטראז׳'], ['payment', 'תשלום']].map(([k, label]) => `<span class="ev-status ${ev[k] ? 'ok' : ''}">${ev[k] ? '✓' : '○'} ${label}</span>`).join('')}</div>` : '';
  const evidenceRow = booking && booking.status === 'approved' && isRenter
    ? `<div class="evidence-row">
        <label class="ev-chip ${ev.video ? 'ok' : ''}">סרטון חוץ<input hidden type="file" accept="video/*" data-ev="video"></label>
        <label class="ev-chip ${ev.fuel ? 'ok' : ''}">דלק<input hidden type="file" accept="image/*" capture="environment" data-ev="fuel"></label>
        <label class="ev-chip ${ev.odometer ? 'ok' : ''}">קילומטראז׳<input hidden type="file" accept="image/*" capture="environment" data-ev="odometer"></label>
        <button type="button" class="ev-chip ${ev.payment ? 'ok' : ''}" id="ev-payment">תשלום</button>
      </div>` : '';
  const composer = live
    ? `${evidenceRow}<form class="chat-composer" id="chat-composer" autocomplete="off"><label class="chat-attach" title="שליחת תמונה">${ICON.image}<input hidden type="file" accept="image/*" id="chat-photo"></label><input name="text" aria-label="כתיבת הודעה" maxlength="2000" placeholder="כתבו הודעה…" value="${esc(chatState.draft)}"><button class="btn primary">שליחה</button></form>`
    : `<div class="chat-closed">${convEnded && isRenter ? 'השיחה נסגרה על ידי הצד השני — לא ניתן לשלוח הודעות נוספות' : 'ההשכרה הסתיימה — הצ׳אט פתוח רק מאישור ההזמנה ועד סיום ההשכרה'}</div>`;

  pane.innerHTML = `<header class="chat-head">
      <button class="chat-back" id="chat-back" aria-label="חזרה לרשימה">→</button><button class="chat-x" id="chat-close" aria-label="סגירת הצ׳אט">×</button>
      <div class="chat-head-main"><h3>${esc(title)}</h3>${otherParty ? `<span class="chat-who">${esc(otherParty)}</span>` : ''}${booking ? `<span class="status-badge ${esc(booking.status)}">${statusLabel(booking.status)}</span>` : isInquiry ? '<span class="pill ok">פנייה על רכב · טרם הזמנה</span>' : '<span class="pill ok">שירות לקוחות</span>'}</div>
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
      // The message travels through a serverless function, so the bubble only appears once the write
      // lands AND the listener echoes it back. Clearing the field is the double-send guard, but on a
      // slow connection it also means the text vanishes with nothing yet in the thread — which reads
      // as "my message disappeared". Hold a visible sending state until the round trip finishes.
      const sendBtn = form.querySelector('button');
      const sendLabel = sendBtn ? sendBtn.textContent : '';
      if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'שולח…'; }
      // ALWAYS pass userUid = the thread's user id. For the admin it's the person they're messaging;
      // for a regular user it's their own uid (harmlessly ignored server-side). Previously this was
      // gated on store.isAdmin — if that flag was momentarily false the message lost its target and
      // went to the admin's OWN thread instead of the user's. THAT was the "can't message users" bug.
      try { await sendMessage(isSupport ? {thread: 'admin', userUid: id, text} : isInquiry ? {inquiryId: id, text} : {bookingId: id, text}); }
      catch (error) { toast(error.message); form.text.value = text; chatState.draft = text; }
      finally { if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = sendLabel; } }
    };
  }
  pane.querySelector('#chat-photo')?.addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    // Same gap the evidence chips had: one 3-second toast for an upload that can run much longer, with
    // the attach button still live the whole time — so a second tap sends the photo twice.
    const attach = pane.querySelector('.chat-attach');
    attach?.classList.add('busy');
    try {
      toast('מעלה תמונה…');
      const dataUrl = await uploadPublicMedia(file, 'chat-photo', id);
      const attachment = {path: dataUrl, type: 'photo'};
      await sendMessage(isSupport ? {thread: 'admin', userUid: id, text: '', attachment} : isInquiry ? {inquiryId: id, text: '', attachment} : {bookingId: id, text: '', attachment});
      toast('התמונה נשלחה');
    } catch (error) { toast(error.message); }
    finally { attach?.classList.remove('busy'); }
  });
  pane.querySelectorAll('[data-ev]').forEach(input => input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    // A phone video is easily 60MB+ and can upload for minutes. The old feedback was one toast that
    // vanished after 3 seconds, leaving the renter staring at an unchanged chip with no idea whether
    // anything was happening — and free to tap again and start a second upload of the same file.
    const chip = input.closest('.ev-chip');
    const label = chip ? chip.childNodes[0] : null;   // the text node before the hidden <input>
    const original = label ? label.textContent : '';
    const big = file.size > 25 * 1024 * 1024;
    input.disabled = true;
    chip?.classList.add('busy');
    if (label) label.textContent = big ? 'מעלה… (קובץ גדול)' : 'מעלה…';
    try {
      if (big) toast('הקובץ גדול — ההעלאה עשויה לקחת דקה או שתיים. אפשר להשאיר את המסך פתוח.');
      const path = await uploadPrivate(file, 'booking-media', id);
      await sendMessage({bookingId: id, text: EV_LABELS[input.dataset.ev], attachment: {path, type: `evidence-${input.dataset.ev}`}});
      toast('התיעוד נשלח לבעל הרכב');
    } catch (error) { toast(error.message); }
    finally {
      input.disabled = false; input.value = '';
      chip?.classList.remove('busy');
      if (label) label.textContent = original;
    }
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
    if (!messages.length) { box.innerHTML = '<div class="empty">אין הודעות עדיין — כתבו הודעה כדי להתחיל 👋</div>'; seen.clear(); firstBatch = true; lastDay = ''; prevSender = ''; return; }
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 130;
    // A message was DELETED (a previously-rendered id is gone) → clean rebuild (deletions are rare, so the
    // full repaint is fine and keeps day dividers / grouping correct). New messages still just append.
    const currentIds = new Set(messages.map(m => m.id));
    let deleted = false; for (const sid of seen) if (!currentIds.has(sid)) { deleted = true; break; }
    if (deleted) { seen.clear(); lastDay = ''; prevSender = ''; box.innerHTML = ''; firstBatch = true; }
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
    box.querySelectorAll('[data-del]:not([data-bound])').forEach(button => { button.dataset.bound = '1'; button.onclick = async event => {
      event.stopPropagation();
      if (!confirm('למחוק את ההודעה? הפעולה בלתי הפיכה.')) return;
      const ref = isSupport ? {thread: 'admin', userUid: id, deleteId: button.dataset.del} : isInquiry ? {inquiryId: id, deleteId: button.dataset.del} : {bookingId: id, deleteId: button.dataset.del};
      try { await deleteMessage(ref); } catch (error) { toast(error.message); }
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
  // You can delete your OWN messages; the admin can delete any. (Server re-checks.)
  const canDelete = (mine || store.isAdmin) && !sys && message.id;
  const del = canDelete ? `<button class="msg-del" data-del="${esc(message.id)}" title="מחיקת הודעה" aria-label="מחיקת הודעה">🗑</button>` : '';
  return `<div class="message ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''} ${sys ? 'sys' : ''}" data-mid="${esc(message.id || '')}">${del}${message.text ? `<p>${esc(message.text)}</p>` : ''}${attachment}<small>${time}${tick}</small></div>`;
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

// Contact strip shared by both sides of a booking. A number printed as text is not much use while
// you're standing next to a car — these are the two actions people actually take.
const waNumber = phone => String(phone || '').replace(/[^\d]/g, '').replace(/^0+/, '');
function contactBlock(name, phone, role) {
  if (!phone) return `<p class="mut">${esc(role)} לא הזין טלפון — אפשר להמשיך בצ׳אט.</p>`;
  const wa = waNumber(phone);
  return `<div class="contact-block">
    <div class="cb-id"><b>${esc(name || role)}</b><span dir="ltr">${esc(phone)}</span></div>
    <div class="chips"><a class="btn primary" href="tel:${esc(phone.replace(/\s/g, ''))}">📞 חיוג</a>${wa.length >= 8 ? `<a class="btn outline" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">💬 וואטסאפ</a>` : ''}</div>
  </div>`;
}
async function addressModal(bookingId) {
  try {
    const data = await api('private-car-details', {bookingId});
    const mapQ = encodeURIComponent(data.fullAddress || '');
    modal(`<div class="modal-head"><h2>פרטי איסוף</h2><button class="close" data-close-modal>×</button></div>
      <div class="summary"><span>כתובת מלאה</span><b><bdi>${esc(data.fullAddress || 'לא הוגדרה')}</bdi></b></div>
      ${data.fullAddress ? `<a class="btn outline block" href="https://maps.google.com/?q=${mapQ}" target="_blank" rel="noopener">🗺️ ניווט לכתובת</a>` : ''}
      <h3 class="doc-h">בעל הרכב</h3>${contactBlock(data.ownerName, data.ownerPhone, 'בעל הרכב')}
      <button type="button" class="btn gold block" data-addr-chat="${esc(bookingId)}">💬 צ׳אט עם בעל הרכב</button>`);
    document.querySelector('[data-addr-chat]')?.addEventListener('click', () => { closeModal(); openChatThread(`b:${bookingId}`); });
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
    modal(`<div class="modal-head"><h2 class="with-avatar">${avatarHtml(data.profile, 38)} ${esc(data.profile.name || data.profile.email || 'שוכר')}</h2><button class="close" data-close-modal>×</button></div><div class="summary"><span>מייל</span><b>${esc(data.profile.email || '—')}</b></div><div class="summary"><span>דירוג</span><b>${stars(rating)} ${rating ? rating.toFixed(1) : 'חדש'}</b></div><div class="summary"><span>סטטוס אימות</span><b>${esc(verificationLabel(data.profile.verification?.status))}</b></div>${contactBlock(data.profile.name, data.profile.phone, 'השוכר')}<h3 class="doc-h">מסמכי אימות</h3>${docGallery(data.documents)}${reviews.length ? `<div class="reviews"><h3>ביקורות על המשתמש</h3>${reviews.map(r => `<div class="review"><div class="review-head"><span class="review-stars">${stars(r.score)}</span><small>${fmtDate(r.createdAt)}</small></div><p>${esc(r.review)}</p></div>`).join('')}</div>` : ''}`);
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
      // This note is the user's ONLY explanation — it goes into their notification, SMS and profile.
      const note = button.dataset.review === 'approved' ? '' : prompt('מה צריך לתקן? (נשלח למשתמש בהתראה וב-SMS)') || '';
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

export function carForm(car = null, forOwnerUid = '') {
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
      <div class="field"><label>שנה</label><select name="year">${selectOptions(carYears(), String(car?.year || new Date().getFullYear()))}</select></div>
      <div class="field"><label>סוג רכב <span class="req">*</span></label><select name="category" required>${selectOptions(CAR_TYPES, car?.category)}</select></div>
    </div>
    <!-- Everything below has a sensible default, so it folds away: an owner can publish a car after
         four fields instead of scrolling past nine. The inputs stay in the DOM, so formData() and the
         per-step :invalid gating are unaffected. -->
    <details class="field-more"><summary>פרטים נוספים <span class="mut">(רשות)</span></summary>
      <div class="form-grid">
        <div class="field"><label>תת דגם</label><input name="trim" value="${esc(car?.trim || '')}" placeholder="לדוגמה Sport, Limited"></div>
        <div class="field"><label>סוג דלק</label><select name="fuel">${selectOptions(['בנזין','דיזל','היברידי','PHEV','חשמלי'], car?.fuel)}</select></div>
        <div class="field"><label>תיבת הילוכים</label><select name="gear">${selectOptions(['אוטומט','ידני'], car?.gear)}</select></div>
        <div class="field"><label>מספר מושבים</label><input name="seats" type="number" min="1" max="20" value="${esc(car?.seats || 5)}"></div>
        <div class="field"><label>גיל מינימלי</label><input name="minAge" type="number" min="18" max="99" value="${esc(car?.minAge || 21)}"></div>
      </div>
    </details>
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
      if (editing) await updateCar(car.id, data); else await createCar(data, forOwnerUid);
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

