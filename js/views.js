import {store, list, myRole, myBookings, myCars, carRating, userRating} from './store.js';
import {esc, money, fmtDate, statusLabel, verificationLabel, modal, closeModal, formData, toast, stars} from './core.js';
import {register, login, logout, sendVerify, refreshEmailStatus} from './auth.js';
import {saveUser, createCar, updateCar, deleteCar, createBooking, setBookingStatus, registerDocument, approveVerification, sendMessage, savePayment, saveHandover, submitRating} from './db.js';
import {uploadPrivate, signedRead, capturePhoto} from './media.js';
import {legacyStatus, migrateLegacy} from './migrate.js';
import {api} from './api.js';

const app = () => document.querySelector('#app');
const fallbackImage = 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=1200&q=75';
const carImage = car => car.photoUrl || fallbackImage;
const roleName = role => ({renter:'שוכר', owner:'בעל רכב', admin:'מנהל'}[role] || 'משתמש');

export function nav() {
  const node = document.querySelector('#main-nav');
  node.innerHTML = `<button class="nav-btn" data-route="home">בית</button><button class="nav-btn" data-route="cars">רכבים</button>${store.user ? '<button class="nav-btn" data-route="dashboard">האזור שלי</button><button class="nav-btn" id="logout">יציאה</button>' : '<button class="nav-btn primary" data-route="auth">כניסה / הרשמה</button>'}`;
  node.querySelectorAll('[data-route]').forEach(button => button.onclick = () => { location.hash = button.dataset.route; });
  node.querySelector('#logout')?.addEventListener('click', async () => {
    try { await logout(); location.hash = 'home'; toast('יצאת מהחשבון'); }
    catch (error) { toast(error.message); }
  });
}

export function home() {
  const available = list(store.cars).filter(car => car.status === 'available');
  app().innerHTML = `<section class="hero"><div class="hero-card"><p class="eyebrow">קראון הייטס · ברוקלין</p><h1>השכרת רכבים <em>קראון הייטס</em></h1><p>בוחרים רכב, שולחים בקשה, מתעדים את המסירה ויוצאים לדרך.</p><button class="btn gold" data-route="cars">חיפוש רכב</button></div><div class="card search-box"><h2>הזמנת רכב</h2><div class="form-grid"><div class="field"><label>איסוף</label><input id="home-start" type="datetime-local"></div><div class="field"><label>החזרה</label><input id="home-end" type="datetime-local"></div></div><button class="btn primary" data-route="cars">הצג רכבים זמינים</button><div class="kpis two"><div class="kpi"><b>${list(store.cars).length}</b><span>רכבים באתר</span></div><div class="kpi"><b>${available.length}</b><span>זמינים כעת</span></div></div></div></section><section class="card panel owner-cta"><h2>יש לך רכב פנוי?</h2><p>פרסם אותו, נהל הזמנות ותיעוד מסירה במקום אחד.</p><button class="btn gold" data-route="${store.user ? 'dashboard' : 'auth'}">הוסף רכב</button></section><div class="section-head"><h2>רכבים זמינים</h2><button class="btn outline" data-route="cars">לכל הרכבים</button></div>${carGrid(available.slice(0, 6))}`;
  bindCarButtons();
}

function carGrid(cars) {
  return `<div class="grid">${cars.length ? cars.map(car => {
    const rating = carRating(car.id);
    return `<article class="card car"><img src="${esc(carImage(car))}" alt="${esc(`${car.make || ''} ${car.model || ''}`)}" loading="lazy" data-car-image><div class="car-body"><h3>${esc(car.make)} ${esc(car.model)} ${esc(car.year || '')}</h3><div class="chips"><span class="chip">מגיל ${esc(car.minAge || 21)}</span>${car.deliveryEnabled ? '<span class="chip">מסירה זמינה</span>' : ''}</div><p>${esc(car.area || 'Crown Heights')}</p><div class="rating" aria-label="דירוג ${rating.toFixed(1)} מתוך 5">${stars(rating)} <small>${rating ? rating.toFixed(1) : 'חדש'}</small></div><div class="price">${money(car.dailyPrice || 0)} ליום</div><button class="btn primary" data-car="${esc(car.id)}">פרטים והזמנה</button></div></article>`;
  }).join('') : '<div class="card empty">אין כרגע רכבים זמינים</div>'}</div>`;
}

function bindCarButtons() {
  app().querySelectorAll('[data-car]').forEach(button => button.onclick = () => openCar(button.dataset.car));
  app().querySelectorAll('[data-car-image]').forEach(image => image.addEventListener('error', () => { image.src = fallbackImage; }, {once:true}));
}

export function cars() {
  app().innerHTML = `<div class="section-head"><h1>רכבים באתר</h1></div>${carGrid(list(store.cars))}`;
  bindCarButtons();
}

function openCar(id) {
  const car = {id, ...store.cars[id]};
  if (!car.id) return toast('הרכב לא נמצא');
  modal(`<div class="modal-head"><h2>${esc(car.make)} ${esc(car.model)}</h2><button class="close" data-close-modal>×</button></div><img class="modal-car-image" id="modal-car-image" src="${esc(carImage(car))}" alt="${esc(`${car.make || ''} ${car.model || ''}`)}"><div class="summary"><span>שנה</span><b>${esc(car.year || '—')}</b></div><div class="summary"><span>גיל מינימלי</span><b>${esc(car.minAge || 21)}</b></div><div class="summary"><span>מחיר יומי</span><b>${money(car.dailyPrice)}</b></div><div class="summary"><span>דירוג</span><b>${stars(carRating(car.id))}</b></div><form id="booking-form"><div class="form-grid"><div class="field"><label>איסוף</label><input name="startAt" type="datetime-local" required></div><div class="field"><label>החזרה</label><input name="endAt" type="datetime-local" required></div></div><div class="field"><label>אופן קבלה</label><select name="fulfillment"><option value="pickup">איסוף עצמי</option>${car.deliveryEnabled ? '<option value="delivery">מסירה</option>' : ''}</select></div><div class="field"><label>כתובת מסירה, אם נבחרה</label><input name="deliveryAddress"></div><button class="btn primary">שליחת בקשה</button></form>`);
  document.querySelector('#modal-car-image')?.addEventListener('error', event => { event.currentTarget.src = fallbackImage; }, {once:true});
  document.querySelector('#booking-form').onsubmit = async event => {
    event.preventDefault();
    try {
      if (!store.user) { closeModal(); location.hash = 'auth'; return; }
      await createBooking(car, formData(event.target));
      toast('ההזמנה נשלחה'); closeModal(); location.hash = 'dashboard';
    } catch (error) { toast(error.message); }
  };
}

export function authView() {
  app().innerHTML = `<section class="card auth-shell"><div class="tabs"><button class="tab active" data-auth="login">כניסה</button><button class="tab" data-auth="register">הרשמה</button></div><div id="auth-content"></div></section>`;
  const draw = type => {
    document.querySelectorAll('[data-auth]').forEach(button => button.classList.toggle('active', button.dataset.auth === type));
    document.querySelector('#auth-content').innerHTML = type === 'login' ? `<form id="login-form"><div class="field"><label>מייל</label><input name="email" type="email" autocomplete="email" required></div><div class="field"><label>סיסמה</label><input name="password" type="password" autocomplete="current-password" required></div><button class="btn primary">כניסה</button></form>` : `<form id="register-form"><div class="field"><label>שם מלא</label><input name="name" autocomplete="name" required></div><div class="field"><label>מייל</label><input name="email" type="email" autocomplete="email" required></div><div class="field"><label>טלפון</label><input name="phone" autocomplete="tel"></div><div class="field"><label>סוג חשבון</label><select name="role"><option value="renter">שוכר</option><option value="owner">בעל רכב</option></select></div><div class="field"><label>סיסמה</label><input name="password" type="password" minlength="6" autocomplete="new-password" required><small>חובה לפחות 6 תווים, אות גדולה ואות קטנה באנגלית.</small></div><button class="btn primary">יצירת חשבון</button></form>`;
    document.querySelector('#login-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const data = formData(event.target);
      try { await login(data.email, data.password); location.hash = 'dashboard'; }
      catch (error) { toast(error.message); }
    });
    document.querySelector('#register-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      try { await register(formData(event.target)); location.hash = 'dashboard'; }
      catch (error) { toast(error.message); }
    });
  };
  document.querySelectorAll('[data-auth]').forEach(button => button.onclick = () => draw(button.dataset.auth));
  draw('login');
}

function dashboardLayout(title, tabs, active, content) {
  return `<div class="dashboard-shell"><header class="dashboard-head"><div><p class="eyebrow">CrownDrive</p><h1>${esc(title)}</h1></div><span class="role-pill">${esc(roleName(myRole()))}</span></header><nav class="dashboard-tabs" aria-label="תפריט אזור אישי">${tabs.map(([key, label]) => `<button class="tab ${key === active ? 'active' : ''}" data-dashboard-tab="${key}">${label}</button>`).join('')}</nav><section class="card panel dashboard-panel">${content}</section></div>`;
}
function bindDashboardTabs(renderer) {
  document.querySelectorAll('[data-dashboard-tab]').forEach(button => button.onclick = () => renderer(button.dataset.dashboardTab));
}
export function dashboard() {
  if (!store.user) { location.hash = 'auth'; return; }
  const role = myRole();
  if (role === 'admin') adminDashboard();
  else if (role === 'owner') ownerDashboard();
  else renterDashboard();
}

function renterDashboard(tab = 'overview') {
  const bookings = myBookings();
  const verification = store.profile?.verification || {};
  const contents = {
    overview: `<div class="kpis"><div class="kpi"><b>${bookings.filter(b => b.status === 'active').length}</b><span>פעילות</span></div><div class="kpi"><b>${bookings.filter(b => b.status === 'pending').length}</b><span>ממתינות</span></div><div class="kpi"><b>${bookings.filter(b => b.status === 'done').length}</b><span>הושלמו</span></div><div class="kpi"><b>${verification.status === 'approved' ? '✓' : '!'}</b><span>${verificationLabel(verification.status)}</span></div></div><h2>הזמנות אחרונות</h2>${bookingList(bookings, 'renter')}`,
    bookings: `<h2>ההזמנות שלי</h2>${bookingList(bookings, 'renter')}`,
    profile: profileView(),
    messages: messagesView(bookings),
  };
  app().innerHTML = dashboardLayout('האזור האישי', [['overview','סקירה'],['bookings','הזמנות'],['profile','פרופיל ואימות'],['messages','הודעות']], tab, contents[tab] || contents.overview);
  bindDashboardTabs(renterDashboard); bindActions(); bindProfileActions();
}

function ownerDashboard(tab = 'overview') {
  const bookings = myBookings();
  const cars = myCars();
  const total = Object.values(store.payments).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const contents = {
    overview: `<div class="kpis"><div class="kpi"><b>${cars.length}</b><span>רכבים</span></div><div class="kpi"><b>${cars.filter(c => c.status === 'available').length}</b><span>זמינים</span></div><div class="kpi"><b>${bookings.filter(b => b.status === 'pending').length}</b><span>ממתינות</span></div><div class="kpi"><b>${money(total)}</b><span>תשלומים מדווחים</span></div></div><h2>הזמנות פעילות</h2>${bookingList(bookings.filter(b => ['pending','approved','active'].includes(b.status)), 'owner')}`,
    bookings: `<h2>הזמנות</h2>${bookingList(bookings, 'owner')}`,
    cars: `<div class="section-head"><h2>הרכבים שלי</h2><button class="btn gold" id="add-car">הוספת רכב</button></div>${carGrid(cars)}`,
    profile: ownerProfileView(),
  };
  app().innerHTML = dashboardLayout('לוח בעל רכב', [['overview','סקירה'],['bookings','הזמנות'],['cars','רכבים'],['profile','פרופיל']], tab, contents[tab] || contents.overview);
  bindDashboardTabs(ownerDashboard); bindActions(); bindCarButtons(); bindProfileActions();
  document.querySelector('#add-car')?.addEventListener('click', () => carForm());
}

function adminDashboard(tab = 'overview') {
  const users = list(store.users).map(user => ({...user, verification: {...(user.verification || {}), status: store.verificationStatuses[user.id] || 'missing'}}));
  const bookings = myBookings();
  const cars = list(store.cars);
  const total = Object.values(store.payments).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const contents = {
    overview: `<div class="section-head"><h2>סקירה</h2><button class="btn outline" id="legacy-migrate">העברת נתונים ישנים</button></div><div class="kpis"><div class="kpi"><b>${users.length}</b><span>משתמשים</span></div><div class="kpi"><b>${cars.length}</b><span>רכבים</span></div><div class="kpi"><b>${bookings.length}</b><span>הזמנות</span></div><div class="kpi"><b>${money(total)}</b><span>תשלומים מדווחים</span></div></div><h2>הזמנות אחרונות</h2>${bookingList(bookings.slice().sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 10), 'admin')}`,
    users: `<h2>משתמשים</h2>${adminUserList(users)}`,
    cars: `<h2>רכבים</h2>${carGrid(cars)}`,
    bookings: `<h2>הזמנות</h2>${bookingList(bookings, 'admin')}`,
  };
  app().innerHTML = dashboardLayout('לוח ניהול מנהל', [['overview','סקירה'],['users','משתמשים'],['cars','רכבים'],['bookings','הזמנות']], tab, contents[tab] || contents.overview);
  bindDashboardTabs(adminDashboard); bindActions(); bindCarButtons();
  document.querySelectorAll('[data-admin-user]').forEach(button => button.onclick = () => adminUserModal(button.dataset.adminUser));
  document.querySelector('#legacy-migrate')?.addEventListener('click', migratePrompt);
}

function adminUserList(users) {
  return `<div class="list">${users.length ? users.map(user => `<div class="row"><div><b>${esc(user.name || user.email)}</b><small>${esc(user.email || '')}</small></div><span>${esc(roleName(user.role))}</span><span class="status ${user.verification?.status === 'approved' ? 'ok' : 'warn'}">${esc(verificationLabel(user.verification?.status))}</span><button class="btn outline" data-admin-user="${esc(user.id)}">פרטים</button></div>`).join('') : '<div class="empty">אין משתמשים</div>'}</div>`;
}

function bookingList(bookings, role) {
  const sorted = bookings.slice().sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return `<div class="list">${sorted.length ? sorted.map(booking => {
    const car = store.cars[booking.carId] || {};
    const ratingButtons = booking.status === 'done' ? (role === 'renter' ? `<button class="btn outline" data-rate="${booking.id}" data-rate-type="car">דרג רכב</button><button class="btn outline" data-rate="${booking.id}" data-rate-type="user">דרג בעל רכב</button>` : role === 'owner' ? `<button class="btn outline" data-rate="${booking.id}" data-rate-type="user">דרג שוכר</button>` : '') : '';
    return `<article class="booking-card"><div class="booking-main"><div><small>הזמנה ${esc(booking.id.slice(-7))}</small><h3>${esc(car.make || '')} ${esc(car.model || '')}</h3><p>${fmtDate(booking.startAt)} — ${fmtDate(booking.endAt)}</p></div><span class="status-badge ${esc(booking.status)}">${statusLabel(booking.status)}</span></div><div class="chips">${role === 'owner' && booking.status === 'pending' ? `<button class="btn primary" data-status="approved" data-booking="${booking.id}">אישור</button><button class="btn danger" data-status="rejected" data-booking="${booking.id}">דחייה</button>` : ''}${role === 'owner' && ['pending','approved','active'].includes(booking.status) ? `<button class="btn outline" data-renter="${booking.renterUid}">פרטי שוכר</button>` : ''}${role === 'owner' && booking.status === 'active' ? `<button class="btn gold" data-status="done" data-booking="${booking.id}">סיום הזמנה</button>` : ''}${['approved','active'].includes(booking.status) ? `<button class="btn outline" data-address="${booking.id}">כתובת איסוף</button><button class="btn outline" data-chat="${booking.id}">הודעות</button>` : ''}${role === 'renter' && booking.status === 'approved' ? `<button class="btn outline" data-payment="${booking.id}">הוכחת תשלום</button><button class="btn outline" data-handover="${booking.id}" data-stage="pickup">תיעוד לפני נסיעה</button>` : ''}${role === 'renter' && booking.status === 'active' ? `<button class="btn outline" data-handover="${booking.id}" data-stage="return">תיעוד החזרה</button>` : ''}${['owner','admin'].includes(role) && store.payments[booking.id] ? `<button class="btn outline" data-view-payment="${booking.id}">הוכחת תשלום</button>` : ''}${['owner','admin'].includes(role) && booking.handover ? `<button class="btn outline" data-view-handover="${booking.id}">צפייה בתיעוד</button>` : ''}${ratingButtons}</div></article>`;
  }).join('') : '<div class="empty">אין נתונים</div>'}</div>`;
}

function bindActions() {
  document.querySelectorAll('[data-status]').forEach(button => button.onclick = async () => {
    try { await setBookingStatus(button.dataset.booking, button.dataset.status); toast('ההזמנה עודכנה'); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-chat]').forEach(button => button.onclick = () => chatModal(button.dataset.chat));
  document.querySelectorAll('[data-payment]').forEach(button => button.onclick = () => paymentModal(button.dataset.payment));
  document.querySelectorAll('[data-renter]').forEach(button => button.onclick = () => ownerRenterModal(button.dataset.renter));
  document.querySelectorAll('[data-handover]').forEach(button => button.onclick = () => handoverModal(button.dataset.handover, button.dataset.stage));
  document.querySelectorAll('[data-view-payment]').forEach(button => button.onclick = () => viewPaymentModal(button.dataset.viewPayment));
  document.querySelectorAll('[data-view-handover]').forEach(button => button.onclick = () => viewHandoverModal(button.dataset.viewHandover));
  document.querySelectorAll('[data-address]').forEach(button => button.onclick = () => addressModal(button.dataset.address));
  document.querySelectorAll('[data-rate]').forEach(button => button.onclick = () => ratingModal(button.dataset.rate, button.dataset.rateType));
}

function profileView() {
  const profile = store.profile || {};
  const verification = profile.verification || {};
  const documentRow = (key, label, facing = 'environment') => `<div class="verification-row"><div><b>${label}</b><small>${verification[key] ? 'הועלה לבדיקה' : 'חסר'}</small></div><span class="status ${verification[key] ? 'ok' : 'warn'}">${verification[key] ? 'הושלם' : 'חסר'}</span><div class="chips"><label class="btn outline">גלריה<input hidden type="file" accept="image/*" data-doc-file="${key}"></label><button class="btn outline" data-doc-camera="${key}" data-facing="${facing}">מצלמה</button></div></div>`;
  return `<div class="section-head"><h2>פרופיל ואימות</h2><span class="status-badge">${esc(verificationLabel(verification.status))}</span></div><form id="profile-form" class="card inset"><div class="form-grid"><div class="field"><label>שם מלא</label><input name="name" value="${esc(profile.name || '')}" required></div><div class="field"><label>טלפון</label><input name="phone" value="${esc(profile.phone || '')}"></div><div class="field"><label>תאריך לידה</label><input name="birthDate" type="date" value="${esc(profile.birthDate || '')}" required></div><div class="field"><label>מייל</label><input value="${esc(profile.email || store.user?.email || '')}" disabled></div></div><button class="btn primary">שמירת פרטים</button></form><div class="list verification-list"><div class="verification-row"><div><b>אימות מייל</b><small>${verification.email ? 'המייל מאומת' : 'נשלח קישור למייל'}</small></div><span class="status ${verification.email ? 'ok' : 'warn'}">${verification.email ? 'מאומת' : 'חסר'}</span>${verification.email ? '<span></span>' : '<button class="btn outline" id="verify-email">שליחת קישור</button>'}</div>${documentRow('licenseFront','חזית רישיון')}${documentRow('licenseBack','גב רישיון')}${documentRow('selfie','סלפי','user')}<div class="verification-row"><div><b>אישור מנהל</b><small>${esc(profile.verification?.reviewNote || '')}</small></div><span class="status ${verification.status === 'approved' ? 'ok' : 'warn'}">${esc(verificationLabel(verification.status))}</span><span></span></div></div>`;
}
function ownerProfileView() {
  const profile = store.profile || {};
  return `<h2>פרופיל</h2><form id="profile-form" class="card inset"><div class="form-grid"><div class="field"><label>שם מלא</label><input name="name" value="${esc(profile.name || '')}" required></div><div class="field"><label>טלפון</label><input name="phone" value="${esc(profile.phone || '')}"></div></div><button class="btn primary">שמירת פרטים</button></form>`;
}
function bindProfileActions() {
  document.querySelector('#profile-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    try { await saveUser(formData(event.target)); toast('הפרטים נשמרו'); }
    catch (error) { toast(error.message); }
  });
  document.querySelector('#verify-email')?.addEventListener('click', async () => {
    try { await sendVerify(); toast('נשלח קישור אימות למייל'); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-doc-file]').forEach(input => input.onchange = () => uploadDocument(input.dataset.docFile, input.files[0]));
  document.querySelectorAll('[data-doc-camera]').forEach(button => button.onclick = async () => {
    try { const file = await capturePhoto({facingMode: button.dataset.facing, title: `צילום ${button.dataset.docCamera}`}); await uploadDocument(button.dataset.docCamera, file); }
    catch (error) { if (error.message !== 'הצילום בוטל') toast(error.message); }
  });
}
async function uploadDocument(type, file) {
  try {
    const path = await uploadPrivate(file, 'user-document', type);
    await registerDocument(type, path);
    toast('המסמך נשמר לבדיקה');
  } catch (error) { toast(error.message); }
}

function messagesView(bookings) {
  return `<h2>מרכז הודעות</h2>${bookingList(bookings.filter(booking => ['pending','approved','active'].includes(booking.status)), myRole())}`;
}

async function chatModal(bookingId) {
  try {
    const snap = await firebase.database().ref(`messages/${bookingId}`).once('value');
    const messages = list(snap.val() || {});
    modal(`<div class="modal-head"><h2>הודעות</h2><button class="close" data-close-modal>×</button></div><div class="list messages">${messages.map(message => `<div class="message ${message.senderUid === store.user.uid ? 'mine' : ''}"><p>${esc(message.text)}</p><small>${fmtDate(message.createdAt)}</small></div>`).join('') || '<div class="empty">אין הודעות</div>'}</div><form id="chat-form"><div class="field"><input name="text" maxlength="2000" placeholder="כתוב הודעה" required></div><button class="btn primary">שליחה</button></form>`);
    document.querySelector('#chat-form').onsubmit = async event => {
      event.preventDefault();
      try { await sendMessage(bookingId, formData(event.target).text); closeModal(); toast('ההודעה נשלחה'); }
      catch (error) { toast(error.message); }
    };
  } catch (error) { toast(error.message); }
}

function paymentModal(bookingId) {
  modal(`<div class="modal-head"><h2>הוכחת תשלום</h2><button class="close" data-close-modal>×</button></div><form id="payment-form"><div class="field"><label>סכום ששולם</label><input name="amount" type="number" min="0.01" step="0.01" required></div><div class="field"><label>צילום הוכחה</label><input name="file" type="file" accept="image/*" required></div><button class="btn primary">שמירה</button></form>`);
  document.querySelector('#payment-form').onsubmit = async event => {
    event.preventDefault();
    try {
      const path = await uploadPrivate(event.target.file.files[0], 'payment', bookingId);
      await savePayment(bookingId, {amount: event.target.amount.value, mediaPath: path});
      closeModal(); toast('הוכחת התשלום נשמרה');
    } catch (error) { toast(error.message); }
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
    try {
      const videoPath = await uploadPrivate(event.target.video.files[0], 'booking-media', bookingId);
      const dashboardPhotoPath = await uploadPrivate(event.target.dash.files[0], 'booking-media', bookingId);
      await saveHandover(bookingId, stage, {videoPath, dashboardPhotoPath, mileage: Number(event.target.mileage.value), fuel: event.target.fuel.value, notes: event.target.notes.value});
      closeModal(); toast('התיעוד נשמר');
    } catch (error) { toast(error.message); }
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
    modal(`<div class="modal-head"><h2>${esc(data.profile.name || data.profile.email || 'שוכר')}</h2><button class="close" data-close-modal>×</button></div><div class="summary"><span>מייל</span><b>${esc(data.profile.email || '—')}</b></div><div class="summary"><span>טלפון</span><b>${esc(data.profile.phone || '—')}</b></div><div class="summary"><span>דירוג</span><b>${stars(rating)} ${rating ? rating.toFixed(1) : 'חדש'}</b></div><div class="summary"><span>סטטוס אימות</span><b>${esc(verificationLabel(data.profile.verification?.status))}</b></div><div class="list">${Object.entries(data.documents || {}).map(([key, url]) => `<a class="btn outline" href="${esc(url)}" target="_blank" rel="noopener">${esc(key)}</a>`).join('') || '<div class="empty">אין מסמכים זמינים</div>'}</div>`);
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
    modal(`<div class="modal-head"><h2>${esc(data.profile.name || data.profile.email || 'משתמש')}</h2><button class="close" data-close-modal>×</button></div><div class="summary"><span>מייל</span><b>${esc(data.profile.email || '—')}</b></div><div class="summary"><span>טלפון</span><b>${esc(data.profile.phone || '—')}</b></div><div class="summary"><span>תפקיד</span><b>${esc(roleName(data.profile.role))}</b></div><div class="summary"><span>סך תשלומים מדווחים</span><b>${money(paymentTotal)}</b></div><div class="summary"><span>סטטוס</span><b>${esc(verificationLabel(data.profile.verification?.status))}</b></div><div class="list">${Object.entries(data.documents || {}).map(([key, url]) => `<a class="btn outline" href="${esc(url)}" target="_blank" rel="noopener">${esc(key)}</a>`).join('') || '<div class="empty">אין מסמכים</div>'}</div>${paymentLinks.length ? `<h3>הוכחות תשלום</h3><div class="list">${paymentLinks.map(({payment,url}) => `<a class="btn outline" href="${esc(url)}" target="_blank" rel="noopener">${money(payment.amount)} · ${fmtDate(payment.createdAt)}</a>`).join('')}</div>` : ''}<div class="chips"><button class="btn primary" data-review="approved">אישור</button><button class="btn danger" data-review="rejected">דחייה</button><button class="btn outline" data-review="needs_resubmission">בקשת צילום מחדש</button></div>`);
    document.querySelectorAll('[data-review]').forEach(button => button.onclick = async () => {
      const note = button.dataset.review === 'approved' ? '' : prompt('הערה למשתמש:') || '';
      try { await approveVerification(uid, button.dataset.review, note); closeModal(); toast('סטטוס האימות עודכן'); }
      catch (error) { toast(error.message); }
    });
  } catch (error) { toast(error.message); }
}

function ratingModal(bookingId, type) {
  modal(`<div class="modal-head"><h2>דירוג וביקורת</h2><button class="close" data-close-modal>×</button></div><form id="rating-form"><div class="field"><label>דירוג</label><select name="score"><option value="5">5 — מצוין</option><option value="4">4 — טוב מאוד</option><option value="3">3 — טוב</option><option value="2">2 — טעון שיפור</option><option value="1">1 — לא טוב</option></select></div><div class="field"><label>ביקורת</label><textarea name="review" maxlength="1000"></textarea></div><button class="btn primary">שליחה</button></form>`);
  document.querySelector('#rating-form').onsubmit = async event => {
    event.preventDefault();
    try { const data = formData(event.target); await submitRating({bookingId, type, score: Number(data.score), review: data.review}); closeModal(); toast('הדירוג נשמר'); }
    catch (error) { toast(error.message); }
  };
}

function carForm(car = null) {
  const editing = Boolean(car?.id);
  modal(`<div class="modal-head"><h2>${editing ? 'עריכת רכב' : 'הוספת רכב'}</h2><button class="close" data-close-modal>×</button></div><form id="car-form"><div class="form-grid"><div class="field"><label>יצרן</label><input name="make" value="${esc(car?.make || '')}" required></div><div class="field"><label>דגם</label><input name="model" value="${esc(car?.model || '')}" required></div><div class="field"><label>שנה</label><input name="year" type="number" value="${esc(car?.year || new Date().getFullYear())}" required></div><div class="field"><label>תת דגם</label><input name="trim" value="${esc(car?.trim || '')}"></div><div class="field"><label>מחיר יומי</label><input name="dailyPrice" type="number" min="0" value="${esc(car?.dailyPrice || '')}" required></div><div class="field"><label>גיל מינימלי</label><input name="minAge" type="number" min="18" max="99" value="${esc(car?.minAge || 21)}"></div></div><div class="field"><label>אזור ציבורי</label><input name="area" value="${esc(car?.area || 'Crown Heights')}"></div><div class="field"><label>כתובת מלאה — תיחשף לאחר אישור</label><input name="fullAddress"></div><div class="field"><label>תמונת הרכב</label><div class="chips"><button type="button" class="btn outline" id="auto-car-image">חיפוש תמונה אוטומטי</button></div><input name="photoUrl" type="url" value="${esc(car?.photoUrl || '')}" placeholder="או קישור HTTPS"><small id="car-image-note">החיפוש משתמש ב-Wikimedia Commons; התמונה היא להמחשה ויש לבדוק התאמה.</small><img id="car-image-preview" class="image-preview" src="${esc(car?.photoUrl || fallbackImage)}" alt="תצוגה מקדימה"></div><div class="field"><label>עלות מסירה</label><input name="deliveryCost" type="number" min="0" value="${esc(car?.deliveryCost || 0)}"></div><label class="check"><input name="deliveryEnabled" type="checkbox" ${car?.deliveryEnabled ? 'checked' : ''}> מסירה זמינה</label><button class="btn primary">${editing ? 'שמירת שינויים' : 'פרסום'}</button></form>`);
  const form = document.querySelector('#car-form');
  const preview = document.querySelector('#car-image-preview');
  const note = document.querySelector('#car-image-note');
  document.querySelector('#auto-car-image').onclick = async () => {
    try {
      const data = formData(form);
      const response = await fetch('/api/car-image-search', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(data)});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'לא נמצאה תמונה');
      form.photoUrl.value = result.url;
      preview.src = result.url;
      note.textContent = `${result.title || 'Wikimedia Commons'}${result.license ? ` · ${result.license}` : ''}`;
      toast('נמצאה תמונה אוטומטית');
    } catch (error) { toast(error.message); }
  };
  form.photoUrl.addEventListener('input', () => { if (/^https:\/\//.test(form.photoUrl.value)) preview.src = form.photoUrl.value; });
  form.onsubmit = async event => {
    event.preventDefault();
    try {
      const data = formData(event.target);
      data.deliveryEnabled = event.target.deliveryEnabled.checked;
      if (!data.photoUrl) data.photoUrl = fallbackImage;
      if (editing) await updateCar(car.id, data); else await createCar(data);
      closeModal(); toast(editing ? 'הרכב עודכן' : 'הרכב פורסם');
    } catch (error) { toast(error.message); }
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

window.cdCloseModal = closeModal;
