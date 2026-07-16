import {store, list, myRole, myBookings, myCars, carRating, carRatingCount, userRating} from './store.js';
import {esc, money, fmtDate, statusLabel, verificationLabel, modal, closeModal, formData, toast, stars, validEmail, paintApp, resetPaint, fieldError} from './core.js';
import {register, login, logout, sendVerify, refreshEmailStatus, sendPasswordReset, createOwnProfile, signInGuest} from './auth.js';
import {saveUser, setOwnPhoto, createCar, updateCar, deleteCar, createBooking, startInquiry, setBookingStatus, registerDocument, approveVerification, sendMessage, savePayment, saveHandover, submitRating, carMediaPublic, adminAction, setMaintenance, setCarStatus, setCarFeatured, checkIsAdmin} from './db.js';
import {uploadPrivate, uploadPublicMedia, signedRead, capturePhoto} from './media.js';
import {legacyStatus, migrateLegacy} from './migrate.js';
import {api} from './api.js';

export const app = () => document.querySelector('#app');
// The running build number, read from the app.js "?v=" in index.html — a single source of truth that
// bumps every deploy. Shown at the bottom of the site so anyone can confirm which version they're on
// after a refresh (that's how we verify a connected browser actually got the new version).
// Human-readable release number for the footer (bumped each rev via the meta tag). The content-hash Build
// ID handles cache-busting invisibly; this stays a friendly number so a refresh visibly confirms the build.
const APP_VERSION = document.querySelector('meta[name="crowndrive-version"]')?.content
  || (document.querySelector('script[src*="app.js"]')?.getAttribute('src')?.match(/[?&]v=(\d+)/) || [])[1] || '';
const APP_BUILD = document.querySelector('meta[name="crowndrive-build"]')?.content || '';
// Local SVG placeholder for a car with no photo (or one whose image fails to load) — self-contained, so it
// loads instantly and never 404s / hangs the way the old external Unsplash URL could (offline, blocked, down).
export const fallbackImage = 'data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='400' height='240' viewBox='0 0 400 240'><rect width='400' height='240' fill='#D3DAE2'/><g transform='translate(152 72) scale(2)' fill='#9AA7B5'><path d='M37 22l-2.6-6.5A3 3 0 0 0 31.6 14H16.4a3 3 0 0 0-2.8 1.9L11 22a3 3 0 0 0-2 2.8V32a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-2h22v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-7.2A3 3 0 0 0 37 22zm-21.2-4.7a1 1 0 0 1 .9-.6h14.6a1 1 0 0 1 .9.6L34 22H14l1.8-4.7zM15 28a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm18 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z'/></g></svg>");
const carPhotos = car => [...(Array.isArray(car.photos) ? car.photos : []), car.photoUrl].filter((url, i, arr) => url && arr.indexOf(url) === i);
export const carImage = car => carPhotos(car)[0] || fallbackImage;
// Responsive images (mobile audit #47): Wikimedia Commons renders on-the-fly thumbnails — rewrite a full-size
// commons URL (often 4000-5000px!) to phone-sized thumbs and serve a srcset. Storage/data URLs are already
// compressed to ≤~1000px on upload and pass through untouched.
export const wikiThumb = (url, w) => {
  const m = String(url || '').match(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^\/?#]+)$/i);
  if (!m) return null;
  const suffix = /\.svg$/i.test(m[3]) ? `${w}px-${m[3]}.png` : `${w}px-${m[3]}`;
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${m[1]}/${m[2]}/${m[3]}/${suffix}`;
};
// src/srcset/sizes attribute string for an <img>. data-orig keeps the original so a failed thumb falls back
// to the full image before giving up to the placeholder (see bindCarButtons).
export const carImgAttrs = (url, sizes = '(max-width:820px) 50vw, 33vw') => {
  // Wikimedia only renders WHITELISTED thumb widths (see w.wiki/GHai) — 500/960 are on the list.
  const small = wikiThumb(url, 500), mid = wikiThumb(url, 960);
  if (!small) return `src="${esc(url)}"`;
  return `src="${esc(mid)}" srcset="${esc(small)} 500w, ${esc(mid)} 960w" sizes="${sizes}" data-orig="${esc(url)}"`;
};
export const roleName = role => ({renter:'שוכר', owner:'בעל רכב', admin:'מנהל'}[role] || 'משתמש');
export const avatarHtml = (user, size = 42) => user?.photoURL
  ? `<img class="avatar" style="width:${size}px;height:${size}px" src="${esc(user.photoURL)}" alt="">`
  : `<span class="avatar avatar-fallback" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.4)}px">${esc(String(user?.name || 'מ').charAt(0))}</span>`;

// Inline icons for the KPI cards (match the reference dashboard look).
export const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  car: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H8v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><circle cx="7.5" cy="16.5" r="1"/><circle cx="16.5" cy="16.5" r="1"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15 8m-4 4 4-4m0 0 3 3 3-3-3-3"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  block: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
  id: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5.5 16.5c.7-2 2-2.7 3-2.7s2.3.7 3 2.7"/><line x1="14" y1="9" x2="19" y2="9"/><line x1="14" y1="13" x2="18" y2="13"/></svg>',
  rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
  selfie: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
};

export const TAB_ICONS = {overview: () => ICON.grid, bookings: () => ICON.calendar, cars: () => ICON.car, profile: () => ICON.selfie, messages: () => ICON.chat, chats: () => ICON.chat, users: () => ICON.users, notifications: () => ICON.bell};
export const kpi = (icon, value, label) => `<div class="kpi"><div class="kpi-head"><span class="kpi-label">${label}</span><i class="kpi-icon">${ICON[icon] || ''}</i></div><b>${value}</b></div>`;
// Friendly empty state — an icon, a line, and (optionally) an action button — instead of a dead-end.
export const emptyState = (icon, title, subtitle = '', cta = '') => `<div class="empty-state"><span class="empty-ic">${icon || ''}</span><b>${esc(title)}</b>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}${cta}</div>`;
export const carStatusPill = status => `<span class="pill ${status === 'available' ? 'ok' : 'mut'}">${status === 'available' ? 'זמין' : status === 'rented' ? 'מושכר' : 'מוסתר'}</span>`;
const DIAL_CODES = [
  ['+1', '🇺🇸 ארה״ב / קנדה'], ['+972', '🇮🇱 ישראל'], ['+44', '🇬🇧 בריטניה'], ['+33', '🇫🇷 צרפת'],
  ['+32', '🇧🇪 בלגיה'], ['+49', '🇩🇪 גרמניה'], ['+31', '🇳🇱 הולנד'], ['+41', '🇨🇭 שווייץ'],
  ['+43', '🇦🇹 אוסטריה'], ['+39', '🇮🇹 איטליה'], ['+34', '🇪🇸 ספרד'], ['+351', '🇵🇹 פורטוגל'],
  ['+30', '🇬🇷 יוון'], ['+46', '🇸🇪 שוודיה'], ['+47', '🇳🇴 נורווגיה'], ['+45', '🇩🇰 דנמרק'],
  ['+48', '🇵🇱 פולין'], ['+36', '🇭🇺 הונגריה'], ['+420', '🇨🇿 צ׳כיה'], ['+40', '🇷🇴 רומניה'],
  ['+7', '🇷🇺 רוסיה'], ['+380', '🇺🇦 אוקראינה'], ['+375', '🇧🇾 בלארוס'], ['+373', '🇲🇩 מולדובה'],
  ['+995', '🇬🇪 גאורגיה'], ['+994', '🇦🇿 אזרבייג׳ן'], ['+998', '🇺🇿 אוזבקיסטן'], ['+90', '🇹🇷 טורקיה'],
  ['+971', '🇦🇪 איחוד האמירויות'], ['+20', '🇪🇬 מצרים'], ['+212', '🇲🇦 מרוקו'], ['+27', '🇿🇦 דרום אפריקה'],
  ['+251', '🇪🇹 אתיופיה'], ['+91', '🇮🇳 הודו'], ['+86', '🇨🇳 סין'], ['+81', '🇯🇵 יפן'],
  ['+66', '🇹🇭 תאילנד'], ['+61', '🇦🇺 אוסטרליה'], ['+64', '🇳🇿 ניו זילנד'], ['+54', '🇦🇷 ארגנטינה'],
  ['+55', '🇧🇷 ברזיל'], ['+52', '🇲🇽 מקסיקו'], ['+56', '🇨🇱 צ׳ילה'], ['+57', '🇨🇴 קולומביה'],
  ['+51', '🇵🇪 פרו'], ['+598', '🇺🇾 אורוגוואי'], ['+507', '🇵🇦 פנמה'], ['+502', '🇬🇹 גואטמלה'],
];
const splitPhone = full => { const match = String(full || '').match(/^(\+\d{1,4})\s*(.*)$/); return match ? {dial: match[1], local: match[2]} : {dial: '+1', local: String(full || '')}; };
export const phoneField = (value = '') => { const {dial, local} = splitPhone(value); return `<div class="field"><label>טלפון</label><div class="phone-row"><select name="dial">${DIAL_CODES.map(([code, label]) => `<option value="${code}" ${code === dial ? 'selected' : ''}>${label} ${code}</option>`).join('')}</select><input name="phoneLocal" type="tel" inputmode="tel" placeholder="מספר טלפון" value="${esc(local)}"></div></div>`; };
export const composePhone = data => { data.phone = data.phoneLocal ? `${data.dial} ${String(data.phoneLocal).trim()}` : ''; delete data.dial; delete data.phoneLocal; return data; };

export const selectOptions = (options, selected) => `<option value="">בחר…</option>${options.map(option => `<option value="${esc(option)}" ${option === selected ? 'selected' : ''}>${esc(option)}</option>`).join('')}`;

// Car reference data — the owner picks make → model from these lists when listing a car.
export const CAR_TYPES = ['סדאן', 'סדאן יוקרה', 'SUV', 'SUV יוקרה', 'פיקאפ', 'מיניוואן', 'קרוסאובר', 'האצ׳בק', 'קופה', 'ספורט', 'מסחרי'];
export const MODELS_BY_MAKE = {
  Acura: ['ILX', 'Integra', 'MDX', 'RDX', 'TLX', 'ZDX'],
  'Alfa Romeo': ['Giulia', 'Stelvio', 'Tonale'],
  'Aston Martin': ['DB11', 'DB12', 'DBX', 'Vantage'],
  Audi: ['A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'e-tron', 'Q3', 'Q4 e-tron', 'Q5', 'Q7', 'Q8', 'R8', 'RS 5', 'S4', 'TT'],
  Bentley: ['Bentayga', 'Continental GT', 'Flying Spur'],
  BMW: ['2 Series', '3 Series', '4 Series', '5 Series', '7 Series', '8 Series', 'i4', 'i5', 'i7', 'iX', 'M3', 'M4', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'Z4'],
  Buick: ['Enclave', 'Encore GX', 'Envision', 'Envista'],
  Cadillac: ['CT4', 'CT5', 'Escalade', 'LYRIQ', 'XT4', 'XT5', 'XT6'],
  Chevrolet: ['Blazer', 'Bolt EV', 'Camaro', 'Colorado', 'Corvette', 'Equinox', 'Malibu', 'Silverado', 'Spark', 'Suburban', 'Tahoe', 'Trailblazer', 'Traverse', 'Trax'],
  Chrysler: ['300', 'Pacifica', 'Voyager'],
  Citroën: ['Berlingo', 'C3', 'C4', 'C5 Aircross'],
  Cupra: ['Born', 'Formentor', 'Leon'],
  Dodge: ['Challenger', 'Charger', 'Durango', 'Hornet'],
  Ferrari: ['296 GTB', 'F8', 'Portofino', 'Purosangue', 'Roma', 'SF90'],
  Fiat: ['500', '500X', '600', 'Panda', 'Tipo'],
  Ford: ['Bronco', 'Bronco Sport', 'Edge', 'Escape', 'Expedition', 'Explorer', 'F-150', 'F-250', 'Fiesta', 'Focus', 'Fusion', 'Maverick', 'Mustang', 'Mustang Mach-E', 'Ranger', 'Transit'],
  Genesis: ['G70', 'G80', 'G90', 'GV60', 'GV70', 'GV80'],
  GMC: ['Acadia', 'Canyon', 'Hummer EV', 'Sierra', 'Terrain', 'Yukon'],
  Honda: ['Accord', 'Civic', 'CR-V', 'Fit', 'HR-V', 'Odyssey', 'Passport', 'Pilot', 'Prologue', 'Ridgeline'],
  Hyundai: ['Accent', 'Elantra', 'Ioniq 5', 'Ioniq 6', 'Kona', 'Palisade', 'Santa Cruz', 'Santa Fe', 'Sonata', 'Tucson', 'Venue'],
  Infiniti: ['Q50', 'QX50', 'QX55', 'QX60', 'QX80'],
  Jaguar: ['E-Pace', 'F-Pace', 'F-Type', 'I-Pace', 'XF'],
  Jeep: ['Cherokee', 'Compass', 'Gladiator', 'Grand Cherokee', 'Renegade', 'Wagoneer', 'Wrangler'],
  Kia: ['Carnival', 'EV6', 'EV9', 'Forte', 'K5', 'Niro', 'Rio', 'Seltos', 'Sorento', 'Soul', 'Sportage', 'Stinger', 'Telluride'],
  Lamborghini: ['Aventador', 'Huracán', 'Revuelto', 'Urus'],
  'Land Rover': ['Defender', 'Discovery', 'Discovery Sport', 'Range Rover', 'Range Rover Evoque', 'Range Rover Sport', 'Range Rover Velar'],
  Lexus: ['ES', 'GX', 'IS', 'LC', 'LS', 'LX', 'NX', 'RX', 'RZ', 'UX'],
  Lincoln: ['Aviator', 'Corsair', 'Nautilus', 'Navigator'],
  Maserati: ['Ghibli', 'Grecale', 'GranTurismo', 'Levante', 'MC20', 'Quattroporte'],
  Mazda: ['CX-30', 'CX-5', 'CX-50', 'CX-70', 'CX-90', 'Mazda3', 'Mazda6', 'MX-5 Miata'],
  McLaren: ['720S', 'Artura', 'GT'],
  'Mercedes-Benz': ['A-Class', 'C-Class', 'CLA', 'E-Class', 'EQB', 'EQE', 'EQS', 'G-Class', 'GLA', 'GLB', 'GLC', 'GLE', 'GLS', 'S-Class', 'SL'],
  MINI: ['Clubman', 'Convertible', 'Countryman', 'Hardtop'],
  Mitsubishi: ['Eclipse Cross', 'Mirage', 'Outlander', 'Outlander Sport'],
  Nissan: ['Altima', 'Ariya', 'Frontier', 'Kicks', 'Leaf', 'Maxima', 'Murano', 'Pathfinder', 'Rogue', 'Sentra', 'Titan', 'Versa', 'Z'],
  Peugeot: ['208', '2008', '308', '3008', '5008'],
  Polestar: ['Polestar 2', 'Polestar 3', 'Polestar 4'],
  Porsche: ['718 Cayman', '911', 'Cayenne', 'Macan', 'Panamera', 'Taycan'],
  RAM: ['1500', '2500', '3500', 'ProMaster'],
  Renault: ['Arkana', 'Captur', 'Clio', 'Megane', 'Austral'],
  'Rolls-Royce': ['Cullinan', 'Ghost', 'Phantom', 'Spectre'],
  SEAT: ['Arona', 'Ateca', 'Ibiza', 'Leon'],
  Škoda: ['Fabia', 'Kamiq', 'Karoq', 'Kodiaq', 'Octavia', 'Superb'],
  Subaru: ['Ascent', 'BRZ', 'Crosstrek', 'Forester', 'Impreza', 'Legacy', 'Outback', 'Solterra', 'WRX'],
  Suzuki: ['Jimny', 'Swift', 'Vitara'],
  Tesla: ['Cybertruck', 'Model 3', 'Model S', 'Model X', 'Model Y'],
  Toyota: ['4Runner', 'bZ4X', 'Camry', 'C-HR', 'Corolla', 'Corolla Cross', 'GR86', 'Highlander', 'Land Cruiser', 'Prius', 'RAV4', 'Sequoia', 'Sienna', 'Tacoma', 'Tundra', 'Venza', 'Yaris'],
  Volkswagen: ['Arteon', 'Atlas', 'Golf', 'ID.4', 'Jetta', 'Passat', 'Taos', 'Tiguan'],
  Volvo: ['C40', 'EX30', 'EX90', 'S60', 'S90', 'V60', 'XC40', 'XC60', 'XC90'],
};
// Every manufacturer above, always sorted A→Z. Models are sorted A→Z at render (populateModels).
export const CAR_MAKES = Object.keys(MODELS_BY_MAKE).sort((a, b) => a.localeCompare(b, 'en'));
export const carYears = () => { const now = new Date().getFullYear() + 1; return Array.from({length: 30}, (_, i) => String(now - i)); };
export const carPhotoList = car => { const arr = (Array.isArray(car.photos) ? car.photos : []).filter(Boolean); const main = car.photoUrl; return [...new Set([main, ...arr].filter(Boolean))]; };
const carReviews = carId => list(store.ratings).filter(r => r.type === 'car' && r.carId === carId && (r.review || r.score)).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
const availPill = status => status === 'available'
  ? '<span class="avail-badge free">● פנוי</span>'
  : `<span class="avail-badge busy">● ${status === 'rented' ? 'מושכר' : 'לא זמין'}</span>`;
// A car is "new" for 2 days after it was added, then the badge disappears on its own (no cleanup needed —
// it's derived from createdAt at render time). Cars created before createdAt existed simply never show it.
const NEW_CAR_MS = 2 * 24 * 60 * 60 * 1000;
const isNewCar = car => car.createdAt && (Date.now() - Number(car.createdAt)) < NEW_CAR_MS;
const newBadge = car => isNewCar(car) ? '<span class="new-badge">חדש</span>' : '';

// Road-scene assets, taken 1:1 from the original CrownDrive design.
const carSil = cls => `<svg class="sil ${cls}" viewBox="0 0 200 70" aria-hidden="true" focusable="false"><path d="M14 52 q2 -12 16 -15 l18 -3 q10 -14 30 -16 l36 -1 q20 1 32 13 l10 9 q22 3 26 12 q2 7 -4 9 l-9 1 q-2 -11 -14 -11 t-14 11 l-70 0 q-2 -11 -14 -11 t-14 11 l-17 -1 q-9 -2 -8 -8 z"/><circle cx="57" cy="57" r="11"/><circle cx="155" cy="57" r="11"/></svg>`;
const blueprintSvg = `<svg class="blueprint" viewBox="0 0 640 300" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M60 210 q4 -30 36 -36 l52 -8 q28 -40 84 -46 l96 -3 q56 2 92 34 l26 24 q56 6 66 30 q6 16 -6 20 l-24 3"/><path d="M60 210 q-4 12 10 16 l40 2"/><path d="M174 228 l180 0"/><path d="M478 228 l36 -2"/><path d="M172 166 q26 -36 78 -42 l92 -3 q50 3 84 32"/><path d="M258 124 l6 42 M356 121 l10 44"/><path d="M262 166 l-6 60 M362 165 l-2 62"/><path d="M286 184 l30 0 M388 183 l30 0"/><path d="M64 196 l34 -6 M528 208 l24 -4"/><circle cx="204" cy="226" r="34"/><circle cx="204" cy="226" r="21"/><circle cx="204" cy="226" r="3"/><circle cx="452" cy="226" r="34"/><circle cx="452" cy="226" r="21"/><circle cx="452" cy="226" r="3"/><path d="M204 205 v42 M183 226 h42 M452 205 v42 M431 226 h42" opacity=".55"/><circle cx="204" cy="226" r="48" stroke-dasharray="4 7" opacity=".5"/><circle cx="452" cy="226" r="48" stroke-dasharray="4 7" opacity=".5"/><path d="M60 272 l520 0" stroke-dasharray="4 7" opacity=".5"/><path d="M60 265 l0 14 M580 265 l0 14" opacity=".6"/><path d="M110 96 l-18 0 0 18 M540 96 l18 0 0 18" opacity=".5"/></g></svg>`;
const STEP_ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  approve: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
};

const hourOptions = (selected = '10:00') => Array.from({length: 24}, (_, h) => { const v = `${String(h).padStart(2, '0')}:00`; return `<option value="${v}" ${v === selected ? 'selected' : ''}>${v}</option>`; }).join('');

// Custom big calendar picker (the native one is tiny and unstylable).
const pad2 = n => String(n).padStart(2, '0');
const fmtHe = iso => { if (!iso) return 'בחרו תאריך'; const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
function newYorkIso(dateValue, timeValue) {
  const match = `${dateValue || ''}T${timeValue || ''}`.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return '';
  const [, y, mo, d, h, mi] = match.map((value, index) => index ? Number(value) : value);
  const wallUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  const formatter = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'});
  let guess = wallUtc;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
    guess = wallUtc - (asUtc - guess);
  }
  return new Date(guess).toISOString();
}
const dateField = (name, label, value = '') => `<div class="date-field"><span class="df-label">${label}</span><button type="button" class="date-btn ${value ? 'has-val' : ''}" data-date-btn aria-expanded="false"><span>${fmtHe(value)}</span><i class="date-ic" aria-hidden="true">${ICON.cal}</i></button><input type="hidden" name="${name}" value="${value}"></div>`;
function bindDateFields(scope = document) {
  scope.querySelectorAll('[data-date-btn]').forEach(button => button.onclick = event => { event.stopPropagation(); openCalendar(button); });
}
function openCalendar(button) {
  document.querySelectorAll('.cal-pop').forEach(p => p.remove());
  const hidden = button.parentElement.querySelector('input[type="hidden"]');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let view = hidden.value ? new Date(`${hidden.value}T00:00`) : new Date();
  const pop = document.createElement('div');
  pop.className = 'cal-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'בחירת תאריך');
  button.setAttribute('aria-expanded', 'true');
  button.parentElement.appendChild(pop);
  const closePop = ({returnFocus = false} = {}) => {
    pop.remove();
    button.setAttribute('aria-expanded', 'false');
    if (returnFocus) button.focus({preventScroll: true});
  };
  const render = () => {
    const y = view.getFullYear(), m = view.getMonth();
    const startDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const monthName = new Intl.DateTimeFormat('he-IL', {month: 'long', year: 'numeric'}).format(new Date(y, m, 1));
    let cells = '';
    for (let i = 0; i < startDay; i++) cells += '<span></span>';
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${y}-${pad2(m + 1)}-${pad2(d)}`;
      const date = new Date(y, m, d);
      const fullDate = new Intl.DateTimeFormat('he-IL', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}).format(date);
      cells += `<button type="button" role="gridcell" aria-label="${fullDate}" aria-selected="${hidden.value === iso}" ${date.getTime() === today.getTime() ? 'aria-current="date"' : ''} class="cal-day ${hidden.value === iso ? 'sel' : ''} ${date.getTime() === today.getTime() ? 'today' : ''}" ${date < today ? 'disabled' : ''} data-iso="${iso}">${d}</button>`;
    }
    const monthId = `cal-month-${y}-${m}`;
    pop.innerHTML = `<div class="cal-head"><button type="button" class="cal-nav" data-nav="-1" aria-label="החודש הקודם">‹</button><b id="${monthId}">${monthName}</b><button type="button" class="cal-nav" data-nav="1" aria-label="החודש הבא">›</button></div><div class="cal-grid" role="grid" aria-labelledby="${monthId}">${['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'].map(x => `<span class="cal-dow" role="columnheader">${x}</span>`).join('')}${cells}</div>`;
    pop.querySelectorAll('.cal-nav').forEach(nav => nav.onclick = event => { event.stopPropagation(); view = new Date(y, m + Number(nav.dataset.nav), 1); render(); });
    pop.querySelectorAll('.cal-day').forEach(day => day.onclick = () => {
      hidden.value = day.dataset.iso;
      const text = button.querySelector('span'); if (text) text.textContent = fmtHe(day.dataset.iso);
      button.classList.add('has-val');
      closePop({returnFocus: true});
      hidden.dispatchEvent(new Event('change', {bubbles: true}));  // let price estimates react to a picked date
    });
    pop.querySelector('.cal-grid')?.addEventListener('keydown', event => {
      const days = [...pop.querySelectorAll('.cal-day:not(:disabled)')];
      const index = days.indexOf(document.activeElement);
      if (index < 0) return;
      const delta = {ArrowRight: -1, ArrowLeft: 1, ArrowUp: -7, ArrowDown: 7}[event.key];
      if (delta == null) return;
      event.preventDefault();
      days[Math.max(0, Math.min(days.length - 1, index + delta))]?.focus();
    });
  };
  render();
  pop.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closePop({returnFocus: true}); } });
  (pop.querySelector('.cal-day.sel:not(:disabled)') || pop.querySelector('.cal-day.today:not(:disabled)') || pop.querySelector('.cal-day:not(:disabled)'))?.focus({preventScroll: true});
  setTimeout(() => document.addEventListener('click', function close(event) {
    if (!pop.contains(event.target)) { closePop(); document.removeEventListener('click', close); }
  }), 0);
}

let pendingAuthRole = null, pendingAuthTab = null, pendingAdminLogin = false;
// Deep-link return (rev.104): remember where the user was headed before being sent to sign in, and take
// them back there after a successful login/registration. sessionStorage so it survives backgrounding.
export function saveAuthReturn(data) { try { sessionStorage.setItem('cd-auth-return', JSON.stringify(data)); } catch {} }
export function afterAuthDestination() {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem('cd-auth-return') || 'null'); sessionStorage.removeItem('cd-auth-return'); } catch {}
  if (saved?.carId && store.cars[saved.carId]) {
    location.hash = 'cars';
    setTimeout(() => openCar(saved.carId), 300);  // reopen the car they were about to book
    return;
  }
  location.hash = (saved?.hash && saved.hash !== 'auth') ? saved.hash : 'dashboard';
}
export function openAuthAs(role, tab) { pendingAuthRole = role; pendingAuthTab = tab; if (store.route === 'auth') authView(); else location.hash = 'auth'; }
export function openAdminLogin() { pendingAdminLogin = true; if (store.route === 'auth') authView(); else location.hash = 'auth'; }

export function nav() {
  const node = document.querySelector('#main-nav');
  const route = store.route || 'home';
  const role = myRole();
  const isOwner = role === 'owner' || role === 'admin';
  const links = [['home', 'בית'], ['cars', 'הרכבים'], ['how', 'איך זה עובד'], ['about', 'אודות'], ['contact', 'צור קשר']];
  node.innerHTML = `<div class="nav-links">${links.map(([key, label]) => `<button class="nav-link ${key === route ? 'active' : ''}" data-nav="${key}">${label}</button>`).join('')}</div>
    <div class="nav-actions">${store.user && !store.user.isAnonymous ? '<button class="dark-pill" data-route="dashboard">האזור שלי</button>' : '<button class="dark-pill" data-route="auth">התחבר</button>'}${isOwner ? '<button class="gold-pill" id="nav-add-car">+ הוסף רכב</button>' : ''}</div>`;
  const scrollToSection = id => {
    const go = () => document.getElementById(id)?.scrollIntoView({behavior: 'smooth'});
    if ((location.hash.slice(1) || 'home') !== 'home') { location.hash = 'home'; setTimeout(go, 400); } else go();
  };
  node.querySelectorAll('[data-nav]').forEach(button => button.onclick = () => {
    const key = button.dataset.nav;
    if (key === 'contact') {
      openSupportChat();
      return;
    }
    if (key === 'home' || key === 'cars') {
      if ((location.hash.slice(1) || 'home') === key) window.dispatchEvent(new HashChangeEvent('hashchange'));
      else location.hash = key;
      window.scrollTo({top: 0, behavior: 'smooth'});
    } else scrollToSection(key);
  });
  node.querySelectorAll('[data-route]').forEach(button => button.onclick = event => {
    event.stopPropagation();
    if ((location.hash.slice(1) || 'home') === button.dataset.route) window.dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = button.dataset.route;
  });
  node.querySelector('#nav-add-car')?.addEventListener('click', () => carForm());
}

// App-style fixed bottom tab bar (mobile only). Three tabs — בית / רכבים / אזור אישי — mirroring how a
// polished car app is navigated on a phone. Hidden on desktop (top nav is used there) and on the full-screen
// routes (chat / auth) + the blocked / maintenance screens, where a tab bar would fight the layout.
export function bottomNav() {
  const node = document.querySelector('#bottom-nav');
  if (!node) return;
  const route = store.route || 'home';
  const role = myRole();
  // Tag the body with the dashboard role so CSS can hide the built-in .dashboard-tabs bar for renter/owner
  // (the dynamic bar below replaces it) while KEEPING it for the admin.
  document.body.dataset.dashRole = route === 'dashboard' ? (role || '') : '';
  const blocked = store.profile?.blocked === true && !store.isAdmin;
  const maintenance = store.config?.maintenance?.on && !store.isAdmin && route !== 'auth';
  // Hidden on full-screen/edge routes, and on the ADMIN dashboard (the admin keeps its own fixed tab bar).
  if (blocked || maintenance || ['chats', 'auth'].includes(route) || (route === 'dashboard' && role === 'admin')) {
    node.classList.add('hide'); node.innerHTML = ''; return;
  }
  node.classList.remove('hide');

  // DYNAMIC personal-area toolbar (renter/owner): the bar becomes the role's own dashboard sections, and a tap
  // switches the section in place instead of leaving the area.
  if (route === 'dashboard') {
    const tabs = role === 'owner'
      ? [['overview', 'סקירה'], ['bookings', 'הזמנות'], ['cars', 'רכבים'], ['chats', 'צ׳אטים'], ['profile', 'פרופיל']]
      : [['overview', 'סקירה'], ['bookings', 'הזמנות'], ['chats', 'צ׳אטים'], ['profile', 'פרופיל']];
    node.innerHTML = tabs.map(([key, label]) =>
      `<button class="tab-item ${key === store.dashTab ? 'active' : ''}" data-dash-tab="${key}" aria-label="${esc(label)}"${key === store.dashTab ? ' aria-current="page"' : ''}>${(TAB_ICONS[key] || (() => ''))()}<span>${esc(label)}</span></button>`).join('');
    node.querySelectorAll('[data-dash-tab]').forEach(button => button.onclick = event => {
      event.stopPropagation();
      const tab = button.dataset.dashTab;
      if (tab === 'chats') { location.hash = 'chats'; return; }  // full-screen messaging page
      store.dashTab = tab; dashboard(); bottomNav();  // re-render the section in place, then refresh the bar's active state
    });
    return;
  }

  // Main-site bar (home / cars / …). הזמנות + אזור אישי open the dashboard on the right sub-tab when signed in.
  const area = (store.user && !store.user.isAnonymous) ? 'dashboard' : 'auth';
  const items = [
    {route: 'home', label: 'בית', icon: ICON.home, active: route === 'home'},
    {route: 'cars', label: 'רכבים', icon: ICON.car, active: route === 'cars'},
    {route: area, dash: 'bookings', label: 'הזמנות', icon: ICON.calendar},
    {route: area, dash: 'overview', label: 'אזור אישי', icon: ICON.selfie},
  ];
  node.innerHTML = items.map(it =>
    `<button class="tab-item ${it.active ? 'active' : ''}" data-route="${it.route}"${it.dash ? ` data-dash="${it.dash}"` : ''} aria-label="${esc(it.label)}"${it.active ? ' aria-current="page"' : ''}>${it.icon}<span>${esc(it.label)}</span></button>`).join('');
  node.querySelectorAll('[data-route]').forEach(button => button.onclick = event => {
    event.stopPropagation();
    const target = button.dataset.route;
    if (button.dataset.dash) store.dashTab = button.dataset.dash;  // preselect which dashboard tab opens (הזמנות → bookings)
    if ((location.hash.slice(1) || 'home') === target) { window.scrollTo({top: 0, behavior: 'smooth'}); window.dispatchEvent(new HashChangeEvent('hashchange')); }
    else location.hash = target;
  });
}

export function home() {
  const all = list(store.cars);
  const available = all.filter(car => car.status === 'available');
  const rented = all.filter(car => car.status === 'rented');
  const ready = store.publicReady;  // until the cars snapshot is in, show '·' instead of a flashing 0
  const html = `
  <section class="hero">
    <div class="aur aur-1" aria-hidden="true"></div><div class="aur aur-2" aria-hidden="true"></div><div class="aur aur-3" aria-hidden="true"></div>
    ${blueprintSvg}
    <div class="hero-in">
      <span class="kicker">קראון הייטס · ברוקלין</span>
      <h1>השכרת רכבים <em>קראון הייטס</em></h1>
      <p class="hero-copy">בחרו זמן איסוף והחזרה — וקבלו רק רכבים שמתאימים לחיפוש.</p>
      <div class="quick-search" aria-label="חיפוש מהיר לרכב">
        ${dateField('homeStart', 'תאריך איסוף', searchPeriod.startAt.slice(0, 10))}
        <label><span>שעת איסוף</span><select id="home-start-hour">${hourOptions(searchPeriod.startAt.slice(11, 16) || '10:00')}</select></label>
        ${dateField('homeEnd', 'תאריך החזרה', searchPeriod.endAt.slice(0, 10))}
        <label><span>שעת החזרה</span><select id="home-end-hour">${hourOptions(searchPeriod.endAt.slice(11, 16) || '10:00')}</select></label>
        <button class="btn gold" id="home-search">חפש רכב</button>
      </div>
      <div class="hero-stats">
        <div class="hstat"><b>${ready ? all.length : '·'}</b><span>רכבים באתר</span></div>
        <div class="hstat"><b>${ready ? available.length : '·'}</b><span>זמינים כעת</span></div>
      </div>
    </div>
    <div class="road" aria-hidden="true"><div class="cars-far">${carSil('s1')}</div><div class="asphalt"></div><div class="cars-near">${carSil('s3')}</div></div>
  </section>
  <div class="strip"><div class="strip-in">
    <span class="it"><span class="dot ok"></span><b>${ready ? available.length : '·'}</b> זמינים להשכרה</span>
    <span class="it"><span class="dot no"></span><b>${ready ? rented.length : '·'}</b> מושכרים</span>
    <span class="it"><span class="dot soon"></span><b>${ready ? Math.max(all.length - available.length - rented.length, 0) : '·'}</b> מתפנים בקרוב</span>
  </div></div>
  <section class="owner-cta-rich reveal"><div class="owner-cta-glow" aria-hidden="true"></div><div class="owner-cta-copy"><p class="eyebrow">לבעלי רכבים</p><h2>יש לך רכב פנוי?</h2></div><div class="owner-cta-features"><div class="feature-chip">אימות שוכרים</div><div class="feature-chip">ניהול הזמנות</div><div class="feature-chip">תיעוד מסירה</div><div class="feature-chip">דירוגים</div></div><button class="btn gold" id="cta-add-car">הוסף רכב</button></section>
  <section class="info-section fleet-zone reveal"><div class="sec-head"><p class="eyebrow">הצי שלנו</p><h2>הרכבים באתר</h2><p class="sec-sub">כל רכב עם תיעוד מלא ודירוגים אמיתיים. הסימון על כל כרטיס מראה מה פנוי ומה מושכר.</p></div>${carGrid(featuredFirst(all.filter(c => c.status !== 'hidden')).slice(0, 6))}<div class="see-all"><button class="btn primary see-all-btn" data-route="cars">כל הרכבים באתר ←</button></div></section>
  <section class="info-section reveal" id="how"><div class="sec-head"><p class="eyebrow">איך זה עובד</p><h2>שלושה צעדים ברורים</h2><p class="sec-sub">בלי תהליך מסובך.</p></div><div class="steps-grid">
    <div class="step-card"><span class="step-num">1</span><div class="step-icon">${STEP_ICONS.search}</div><h3>בוחרים רכב</h3><p>מחפשים לפי זמן ותנאים שמתאימים לכם.</p></div>
    <div class="step-card"><span class="step-num">2</span><div class="step-icon">${STEP_ICONS.approve}</div><h3>מקבלים אישור</h3><p>משלימים אימות קצר ובעל הרכב מאשר את הבקשה.</p></div>
    <div class="step-card"><span class="step-num">3</span><div class="step-icon">${STEP_ICONS.camera}</div><h3>מתעדים ויוצאים</h3><p>מתעדים את הרכב, הדלק והמיילים ויוצאים לדרך.</p></div>
  </div></section>
  <section class="info-section reveal" id="about"><div class="sec-head"><p class="eyebrow">אמון ובטיחות</p><h2>כלים שמגינים על שני הצדדים</h2></div><div class="trust-grid">
    <div class="trust-card"><div class="trust-icon">${ICON.shield}</div><h3>נהגים מאומתים</h3><p>רישיון, סלפי ובדיקה לפני הזמנה.</p></div>
    <div class="trust-card"><div class="trust-icon">${ICON.video}</div><h3>תיעוד מסירה</h3><p>וידאו, תמונות, דלק ומיילים בתחילת ההשכרה.</p></div>
    <div class="trust-card"><div class="trust-icon">${ICON.star}</div><h3>ביקורות אמיתיות</h3><p>רק לאחר השכרה שהושלמה בפועל.</p></div>
    <div class="trust-card"><div class="trust-icon">${ICON.chat}</div><h3>שירות לקוחות</h3><p>מענה מהיר ואישי לכל שאלה, ישירות בצ׳אט.</p></div>
  </div></section>
  <section class="info-section reveal" id="contact"><div class="foot-cta"><p class="kicker">צור קשר</p><h2>צריכים עזרה? אנחנו כאן</h2><p>צ׳אט ישיר עם שירות הלקוחות — מענה מהיר לכל שאלה.</p><button class="btn gold" id="contact-support">פתיחת צ׳אט עם התמיכה</button></div></section>
  <footer class="site-foot"><span${APP_BUILD ? ` title="build ${esc(APP_BUILD)}"` : ''}>© Crown Drive · קראון הייטס${APP_VERSION ? ` · גרסה ${esc(APP_VERSION)}` : ''}</span><nav class="foot-links"><a href="privacy.html">פרטיות</a><a href="terms.html">תנאי שימוש</a></nav><button type="button" class="admin-entry" id="admin-entry">כניסת מנהל</button></footer>`;
  if (!paintApp(html)) return;  // nothing changed → keep DOM + handlers (no flicker on repeated data events)
  bindCarButtons();
  bindDateFields();
  document.querySelector('#cta-add-car')?.addEventListener('click', () => {
    const role = myRole();
    if (role === 'owner' || role === 'admin') carForm();
    else openAuthAs('owner', 'register');
  });
  document.querySelector('#contact-support')?.addEventListener('click', () => openSupportChat());
  document.querySelector('#admin-entry')?.addEventListener('click', () => openAdminLogin());
  // "חפש רכב": carry the chosen dates into the cars page so it can price + filter by the rental mode.
  document.querySelector('#home-search')?.addEventListener('click', () => {
    const sd = document.querySelector('input[name="homeStart"]')?.value || '';
    const ed = document.querySelector('input[name="homeEnd"]')?.value || '';
    const sh = document.querySelector('#home-start-hour')?.value || '10:00';
    const eh = document.querySelector('#home-end-hour')?.value || '10:00';
    if (sd && ed) { searchPeriod.startAt = `${sd}T${sh}`; searchPeriod.endAt = `${ed}T${eh}`; if (!searchRange()) { searchPeriod.startAt = ''; searchPeriod.endAt = ''; } }
    persistSearch();
    location.hash = 'cars';
  });
}

// ---- Rental modes: the owner chooses how the car is offered; the listing + search adapt to it. ----
export const RENTAL_MODES = [
  {value: 'hourly', label: 'השכרה לפי שעות', short: 'לפי שעות', hint: 'לנסיעות קצרות ומשימות בעיר'},
  {value: 'hourly_daily', label: 'השכרה לפי שעות וימים', short: 'שעות · ימים', hint: 'גמיש — שעה, יום או כמה ימים'},
  {value: 'long_term', label: 'השכרה לתקופות ארוכות', short: 'טווח ארוך', hint: 'שבוע ומעלה, במחיר משתלם'},
];
// The car's rental mode. Legacy cars (published before modes existed) have none, so we infer a sensible
// one from the prices they set — daily → "שעות וימים", only weekly → "טווח ארוך", otherwise "לפי שעות".
function rentalModeOf(car) {
  const value = car.rentalMode || (car.dailyPrice ? 'hourly_daily' : (car.priceWeekly && !car.priceHourly ? 'long_term' : 'hourly'));
  return RENTAL_MODES.find(m => m.value === value) || null;
}
const MODE_BUCKETS = {hourly: ['hours'], hourly_daily: ['hours', 'days'], long_term: ['weeks']};
const BUCKET_HE = {hours: 'שעתית', days: 'לפי ימים', weeks: 'לטווח ארוך'};
// Which rental "buckets" (hours / days / weeks) a car serves. Uses the owner's explicit mode; legacy
// cars with no mode fall back to whatever prices they set, so they still surface for matching searches.
function carBuckets(car) {
  if (car.rentalMode && MODE_BUCKETS[car.rentalMode]) return MODE_BUCKETS[car.rentalMode];
  const b = [];
  if (car.priceHourly) b.push('hours');
  if (car.dailyPrice) b.push('days');
  if (car.priceWeekly) b.push('weeks');
  return b.length ? b : ['hours'];
}
// Classify a chosen date-range into hours (same-day) / days (1–6) / weeks (7+).
function periodBucket(ms) {
  if (ms < 24 * 3600000) return 'hours';
  if (ms < 7 * 86400000) return 'days';
  return 'weeks';
}
// Does the chosen range cover a Saturday (Shabbat)? Weekend availability keys off this.
function rangeIncludesSaturday(startMs, endMs) {
  const day = 86400000;
  for (let t = new Date(startMs).setHours(0, 0, 0, 0); t <= endMs; t += day) {
    if (new Date(t).getDay() === 6) return true;
  }
  return false;
}
// A "weekend stay": the owner enabled weekend rental (with a fixed weekend price), the range covers a
// Saturday, and it's short (≤4 days) — a long-weekend, not a full week. Lets an HOURLY car be booked
// for a weekend at the owner's fixed weekend rate. The weekend price is never shown in the listing.
function isWeekendStay(car, startMs, endMs) {
  return !!car.weekendEnabled && Number(car.weekendPrice) > 0
    && (endMs - startMs) <= 4 * 86400000 && (endMs - startMs) >= 20 * 3600000
    && rangeIncludesSaturday(startMs, endMs);
}
// Whether a car can actually serve the chosen range: its rental buckets match, OR it's a weekend stay.
function carServesPeriod(car, startMs, endMs) {
  if (carBuckets(car).includes(periodBucket(endMs - startMs))) return true;
  return isWeekendStay(car, startMs, endMs);
}
// Estimate a booking's price by its length. A qualifying weekend uses the owner's fixed weekend price;
// otherwise hours→hourly, a few days→daily, a week+→weekly, falling back to the nearest available rate.
function estimatePrice(car, startMs, endMs) {
  if (isWeekendStay(car, startMs, endMs)) return {total: Number(car.weekendPrice), label: 'מחיר קבוע לסופ״ש (כולל שבת)'};
  const ms = Math.max(0, endMs - startMs);
  const hours = Math.max(1, Math.ceil(ms / 3600000));
  const days = Math.max(1, Math.ceil(ms / 86400000));
  const weeks = Math.max(1, Math.ceil(days / 7));
  const bucket = periodBucket(ms);
  const hourly = Number(car.priceHourly || 0), daily = Number(car.dailyPrice || 0), weekly = Number(car.priceWeekly || 0);
  if (bucket === 'weeks' && weekly) return {total: weeks * weekly, label: `${weeks} × ${money(weekly)} לשבוע`};
  if (bucket !== 'hours' && daily) return {total: days * daily, label: `${days} × ${money(daily)} ליום`};
  if (hourly) return {total: hours * hourly, label: `${hours} × ${money(hourly)} לשעה`};
  if (daily) return {total: days * daily, label: `${days} × ${money(daily)} ליום`};
  if (weekly) return {total: weeks * weekly, label: `${weeks} × ${money(weekly)} לשבוע`};
  return null;
}
// The active date search (chosen on the home hero or the cars filter). Empty = no date search.
const readSession = (key, fallback) => { try { return {...fallback, ...JSON.parse(sessionStorage.getItem(key) || '{}')}; } catch { return {...fallback}; } };
const searchPeriod = readSession('cd-search-period', {startAt: '', endAt: ''});
const persistSearch = () => { try { sessionStorage.setItem('cd-search-period', JSON.stringify(searchPeriod)); } catch {} };
function searchRange() {
  const s = new Date(searchPeriod.startAt).getTime();
  const e = new Date(searchPeriod.endAt).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  return {startMs: s, endMs: e, bucket: periodBucket(e - s)};
}

function carCard(car, manage = false, period = null, index = 99) {
  const rating = carRating(car.id);
  const reviewCount = carRatingCount(car.id);
  const type = car.category || 'רכב';
  // The first few cards are above the fold — load them eagerly (lazy would DELAY visible images and hurt LCP).
  const eager = index < 4;
  const rented = car.status === 'rented';
  const mode = rentalModeOf(car);
  const onRequest = !!car.priceOnRequest;  // owner chose "price on request" → show "send a message" instead of a price
  // Headline price = daily if set, otherwise hourly (now required), otherwise weekly — never "לפי בקשה".
  const priceRows = [];
  if (car.dailyPrice) priceRows.push([money(car.dailyPrice), 'ליום']);
  if (car.priceHourly) priceRows.push([money(car.priceHourly), 'לשעה']);
  if (car.priceWeekly) priceRows.push([money(car.priceWeekly), 'לשבוע']);
  const priceMain = onRequest ? 'שלחו הודעה<small> לקבלת מחיר</small>' : (priceRows.length ? `${priceRows[0][0]}<small> ${priceRows[0][1]}</small>` : '');
  const priceAlt = onRequest ? '' : priceRows.slice(1).map(([value, label]) => `${value} ${label}`).join(' · ');
  const modeBadge = mode ? `<span class="mode-badge">${mode.short}</span>` : '';
  // Period-aware: when the visitor searched dates, matching cars show an estimated total and cars whose
  // rental mode doesn't fit the chosen range still appear — with a clear "available only for X" note.
  let periodHtml = '';
  let notFit = false;
  if (period && car.status === 'available') {
    if (onRequest) {
      periodHtml = '<div class="period-note contact">שלחו הודעה לבעל הרכב לקבלת מחיר — פתחו את המודעה</div>';
    } else if (carServesPeriod(car, period.startMs, period.endMs)) {
      const est = estimatePrice(car, period.startMs, period.endMs);
      if (est) periodHtml = `<div class="period-est"><span>מחיר משוער לטווח שבחרתם</span><b>${money(est.total)}</b><small>${est.label}</small></div>`;
    } else {
      notFit = true;
      const only = mode ? mode.short : carBuckets(car).map(b => BUCKET_HE[b]).join(' / ');
      periodHtml = `<div class="period-note">רכב זה זמין להשכרה ${only} בלבד — לא מתאים לטווח שבחרתם</div>`;
    }
  }
  const manageRow = manage ? `<div class="car-manage"><button type="button" class="btn ${rented ? 'gold' : 'outline'}" data-car-status="${esc(car.id)}" data-next="${rented ? 'available' : 'rented'}">${rented ? '↺ סמן כפנוי' : '⛔ סמן כתפוס'}</button><button type="button" class="btn outline" data-car-edit="${esc(car.id)}">✎ עריכת פרטים</button></div>` : '';
  // NOTE: a "featured" car is pinned to the top of the list by the admin, but it carries NO visible mark
  // on the public card (no badge, no highlight ring) — visitors must not be able to tell the admin
  // promoted it. The admin still sees/toggles featured in the admin cars table.
  // Clean, premium (Turo/Airbnb-style) card: photo hero, name + compact rating on one line, a single spec
  // line, price + a subtle "פרטים ←" affordance — the whole card is the link (no heavy button). Public cards
  // get role=button + keyboard support; owner "manage" cards keep their own action buttons instead.
  const cardRole = manage ? '' : ' role="button" tabindex="0"';
  return `<article class="card car car-clean${notFit ? ' car-nofit' : ''}" data-car-open="${esc(car.id)}"${cardRole} aria-label="${esc(`${car.make || ''} ${car.model || ''} — פתיחת פרטים`)}"><div class="car-photo"><img ${carImgAttrs(carImage(car))} alt="${esc(`${car.make || ''} ${car.model || ''}`)}" loading="${eager ? 'eager' : 'lazy'}"${eager ? ' fetchpriority="high"' : ''} decoding="async" data-car-image><div class="car-badges">${availPill(car.status)}${newBadge(car)}</div>${modeBadge}${car.videoUrl ? '<span class="has-video">▶ וידאו</span>' : ''}</div><div class="car-body"><div class="car-title-row"><h3>${esc(car.make || '')} ${esc(car.model || '')}</h3>${rating ? `<span class="car-rate">★ <b>${rating.toFixed(1)}</b>${reviewCount ? ` <small>(${reviewCount})</small>` : ''}</span>` : ''}</div><div class="car-specs"><span>${esc(car.year || '—')}</span><span>·</span><span>${esc(type)}</span>${car.fuel ? `<span>·</span><span>${esc(car.fuel)}</span>` : ''}</div>${periodHtml}<div class="car-foot"><div class="price-stack"><div class="price">${priceMain}</div>${priceAlt ? `<small class="price-alt">${priceAlt}</small>` : ''}</div><span class="car-go">${car.status === 'available' ? 'פרטים והזמנה' : 'צפייה'} ←</span></div>${manageRow}</div></article>`;
}
// Featured cars (pinned by the admin) always come first, newest-pin first.
export function featuredFirst(cars) {
  // Admin-pinned ("featured") cars stay on top; everything else is newest → oldest (by createdAt).
  return cars.slice().sort((a, b) =>
    (Number(b.featured || 0) - Number(a.featured || 0)) ||
    (Number(b.createdAt || 0) - Number(a.createdAt || 0)));
}
// Placeholder cards shown while the FIRST cars snapshot is still loading — so the catalog area has a
// calm shimmer instead of a "no cars" message or an empty gap (the hero above already rendered).
const carSkeletons = (n = 6) => Array.from({length: n}, () => '<article class="card car car-sk" aria-hidden="true"><div class="car-photo sk"></div><div class="car-body"><span class="sk-line sk-lg"></span><span class="sk-line sk-sm"></span><span class="sk-line sk-md"></span><span class="sk-btn"></span></div></article>').join('');
export function carGrid(cars, manage = false, period = null) {
  if (!cars.length) {
    if (!store.publicReady) return `<div class="grid">${carSkeletons(6)}</div>`;  // still loading — not "no cars"
    return `<div class="grid">${emptyState(ICON.car, 'אין כרגע רכבים זמינים', 'נסו שוב בקרוב — אנחנו מוסיפים רכבים כל הזמן.')}</div>`;
  }
  let ordered = featuredFirst(cars);
  if (period) {
    // Matching cars (and any rented ones) first; available cars whose rental mode doesn't fit the
    // chosen range are pushed to the end — shown, not hidden, with an "available only for X" note.
    const fits = c => c.status !== 'available' || carServesPeriod(c, period.startMs, period.endMs);
    ordered = [...ordered.filter(fits), ...ordered.filter(c => !fits(c))];
  }
  return `<div class="grid">${ordered.map((c, i) => carCard(c, manage, period, i)).join('')}</div>`;
}

export function bindCarButtons() {
  app().querySelectorAll('[data-car]').forEach(button => button.onclick = () => openCar(button.dataset.car));
  // The WHOLE card opens the detail — a click anywhere that isn't an inner control (buttons/links) counts.
  app().querySelectorAll('[data-car-open]').forEach(article => {
    article.addEventListener('click', event => {
      if (event.target.closest('button, a, select, input, label')) return;
      openCar(article.dataset.carOpen);
    });
    // Public cards are role=button (no inner button any more) — make them keyboard-openable too.
    if (article.getAttribute('role') === 'button') article.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button, a, select, input, label')) {
        event.preventDefault();
        openCar(article.dataset.carOpen);
      }
    });
  });
  app().querySelectorAll('[data-car-image]').forEach(image => {
    // Fade the photo in when it decodes (no more "pop"). If it's already cached, show it instantly — never
    // leave it stuck at opacity:0.
    const show = () => image.classList.add('loaded');
    if (image.complete && image.naturalWidth) show();
    else image.addEventListener('load', show, {once: true});
    image.addEventListener('error', () => {
      // A broken Wikimedia THUMB falls back to the original full image first; only then the placeholder.
      const orig = image.dataset.orig;
      if (orig && image.src !== orig) { image.removeAttribute('srcset'); image.removeAttribute('sizes'); image.src = orig; image.addEventListener('error', () => { image.src = fallbackImage; show(); }, {once: true}); }
      else { image.src = fallbackImage; }
      show();
    }, {once: true});
  });
  app().querySelectorAll('[data-car-status]').forEach(button => button.onclick = async () => {
    button.disabled = true;
    try { await setCarStatus(button.dataset.carStatus, button.dataset.next); toast(button.dataset.next === 'rented' ? 'הרכב סומן כתפוס' : 'הרכב סומן כפנוי'); }
    catch (error) { toast(error.message); button.disabled = false; }
  });
  // Owner can edit a published car's details straight from its card in the personal area.
  app().querySelectorAll('[data-car-edit]').forEach(button => button.onclick = () => carForm({id: button.dataset.carEdit, ...store.cars[button.dataset.carEdit]}));
}

// Default to showing the WHOLE fleet — available AND rented (each carries its own status badge), matching the
// home page. Filtering to 'available' only is opt-in via the "זמינים כעת" filter. (Was 'available', which hid
// every rented car from the cars page entirely.)
const carFilters = readSession('cd-car-filters', {make: '', model: '', year: '', category: '', availability: 'all', sort: 'new'});
function applyCarFilters(all, filters = carFilters) {
  let rows = all.filter(car => car.status !== 'hidden');
  const f = filters;
  if (f.availability === 'available') rows = rows.filter(car => car.status === 'available');
  if (f.make) rows = rows.filter(car => car.make === f.make);
  if (f.model) rows = rows.filter(car => car.model === f.model);
  if (f.year) rows = rows.filter(car => String(car.year || '') === f.year);
  if (f.category) rows = rows.filter(car => (car.category || '').includes(f.category));
  const sorters = {new: (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0), priceLow: (a, b) => (a.dailyPrice || 0) - (b.dailyPrice || 0), priceHigh: (a, b) => (b.dailyPrice || 0) - (a.dailyPrice || 0), rating: (a, b) => carRating(b.id) - carRating(a.id)};
  const primary = sorters[f.sort] || sorters.new;
  // Available cars first, then rented — so a browser sees what they can book now, while rented cars still show.
  const avail = car => (car.status === 'available' ? 0 : 1);
  return rows.sort((a, b) => (avail(a) - avail(b)) || primary(a, b));
}
// Mobile filter bottom-sheet (audit #16): all the filters in one touch-friendly sheet, editing a TEMP copy —
// a live result count updates as you pick, "נקה" resets, and only "הצגת התוצאות" applies + closes.
function openFilterSheet(all, rerender, persistFilters) {
  const temp = {...carFilters};
  const opt = (value, label, current) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;
  const makes = [...new Set(all.map(c => c.make).filter(Boolean))].sort();
  const years = [...new Set(all.map(c => String(c.year || '')).filter(Boolean))].sort((a, b) => b - a);
  const modelOpts = () => `<option value="">כל הדגמים</option>${[...new Set(all.filter(c => !temp.make || c.make === temp.make).map(c => c.model).filter(Boolean))].sort().map(t => opt(t, t, temp.model)).join('')}`;
  const count = () => applyCarFilters(all, temp).length;
  modal(`<div class="modal-head"><h2>סינון ומיון</h2><button class="close" data-close-modal>×</button></div>
    <div class="filter-sheet">
      <div class="field"><label>יצרן</label><select id="fs-make"><option value="">כל היצרנים</option>${makes.map(t => opt(t, t, temp.make)).join('')}</select></div>
      <div class="field"><label>דגם</label><select id="fs-model">${modelOpts()}</select></div>
      <div class="field"><label>שנה</label><select id="fs-year"><option value="">כל השנים</option>${years.map(t => opt(t, t, temp.year)).join('')}</select></div>
      <div class="field"><label>זמינות</label><select id="fs-availability">${opt('all', 'כל הרכבים', temp.availability)}${opt('available', 'זמינים כעת', temp.availability)}</select></div>
      <div class="field"><label>מיון</label><select id="fs-sort">${opt('new', 'החדשים ביותר', temp.sort)}${opt('priceLow', 'מהזול ליקר', temp.sort)}${opt('priceHigh', 'מהיקר לזול', temp.sort)}</select></div>
      <div class="field"><label>סוג רכב</label><div class="type-chips">${['סדאן', 'SUV', 'פיקאפ', 'מיניוואן'].map(t => `<button type="button" class="type-chip ${temp.category === t ? 'on' : ''}" data-fs-chip="${t}">${t}</button>`).join('')}</div></div>
      <div class="sheet-actions"><button type="button" class="btn outline" id="fs-clear">נקה מסננים</button><button type="button" class="btn primary" id="fs-apply">הצגת ${count()} רכבים</button></div>
    </div>`);
  const sheet = document.querySelector('#modal-root .filter-sheet');
  const refresh = () => {
    sheet.querySelector('#fs-model').innerHTML = modelOpts();
    sheet.querySelectorAll('[data-fs-chip]').forEach(c => c.classList.toggle('on', temp.category === c.dataset.fsChip));
    sheet.querySelector('#fs-apply').textContent = `הצגת ${count()} רכבים`;
  };
  [['#fs-make', 'make'], ['#fs-model', 'model'], ['#fs-year', 'year'], ['#fs-availability', 'availability'], ['#fs-sort', 'sort']].forEach(([id, key]) => {
    sheet.querySelector(id).onchange = e => { temp[key] = e.target.value; if (key === 'make') temp.model = ''; refresh(); };
  });
  sheet.querySelectorAll('[data-fs-chip]').forEach(chip => chip.onclick = () => { temp.category = temp.category === chip.dataset.fsChip ? '' : chip.dataset.fsChip; refresh(); });
  sheet.querySelector('#fs-clear').onclick = () => { Object.assign(temp, {make: '', model: '', year: '', category: '', availability: 'all', sort: 'new'}); ['#fs-make', '#fs-year', '#fs-availability', '#fs-sort'].forEach(id => { const el = sheet.querySelector(id); el.value = temp[id.slice(4)] ?? ''; }); sheet.querySelector('#fs-availability').value = 'all'; sheet.querySelector('#fs-sort').value = 'new'; refresh(); };
  sheet.querySelector('#fs-apply').onclick = () => { Object.assign(carFilters, temp); carsShown = CARS_PAGE; persistFilters(); closeModal(); rerender(); };
}
// Paged list (mobile audit #17): render at most this many cars, with a "show more" button for the rest.
const CARS_PAGE = 24;
let carsShown = CARS_PAGE;
// How many filters differ from the defaults — shown as a badge on the mobile filter button (audit #16).
const activeFilterCount = f => ['make', 'model', 'year', 'category'].filter(k => f[k]).length + (f.availability !== 'all' ? 1 : 0) + (f.sort !== 'new' ? 1 : 0);
export function cars() {
  const all = list(store.cars);
  const rows = applyCarFilters(all);
  const period = searchRange();
  const opt = (value, label, current) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;
  const startDate = searchPeriod.startAt ? searchPeriod.startAt.slice(0, 10) : '';
  const endDate = searchPeriod.endAt ? searchPeriod.endAt.slice(0, 10) : '';
  const startTime = searchPeriod.startAt ? searchPeriod.startAt.slice(11, 16) : '10:00';
  const endTime = searchPeriod.endAt ? searchPeriod.endAt.slice(11, 16) : '10:00';
  const periodNote = period ? `<div class="period-active"><span>מחירים מחושבים לפי הטווח שבחרתם (<b>${BUCKET_HE[period.bucket]}</b>). רכבים המושכרים בתנאים אחרים מוצגים בסוף עם הבהרה.</span><button type="button" class="link-btn" id="period-clear">ניקוי תאריכים</button></div>` : '';
  const html = `<div class="cars-page fleet-zone"><div class="section-head"><h1>כל הרכבים באתר</h1><span class="mut">${rows.length} רכבים</span></div>
    <div class="period-search" id="period-search">
      ${dateField('carsStart', 'תאריך איסוף', startDate)}
      <label class="hour-field"><span>שעת איסוף</span><select id="cars-start-hour">${hourOptions(startTime)}</select></label>
      ${dateField('carsEnd', 'תאריך החזרה', endDate)}
      <label class="hour-field"><span>שעת החזרה</span><select id="cars-end-hour">${hourOptions(endTime)}</select></label>
      <button type="button" class="btn gold" id="period-apply">חישוב מחיר לתאריכים</button>
    </div>
    ${periodNote}
    <div class="filter-mobile"><button type="button" class="btn outline block" id="open-filters">סינון ומיון${activeFilterCount(carFilters) ? ` · ${activeFilterCount(carFilters)} פעילים` : ''}</button></div>
    <div class="filter-bar" id="filter-bar">
      <select id="f-make" aria-label="סינון לפי יצרן"><option value="">כל היצרנים</option>${[...new Set(all.map(c => c.make).filter(Boolean))].sort().map(t => opt(t, t, carFilters.make)).join('')}</select>
      <select id="f-model" aria-label="סינון לפי דגם"><option value="">כל הדגמים</option>${[...new Set(all.filter(c => !carFilters.make || c.make === carFilters.make).map(c => c.model).filter(Boolean))].sort().map(t => opt(t, t, carFilters.model)).join('')}</select>
      <select id="f-year" aria-label="סינון לפי שנה"><option value="">כל השנים</option>${[...new Set(all.map(c => String(c.year || '')).filter(Boolean))].sort((a, b) => b - a).map(t => opt(t, t, carFilters.year)).join('')}</select>
      <select id="f-availability" aria-label="סינון לפי זמינות">${opt('all', 'כל הרכבים', carFilters.availability)}${opt('available', 'זמינים כעת', carFilters.availability)}</select>
      <select id="f-sort" aria-label="מיון רכבים">${opt('new', 'מיון: החדשים ביותר', carFilters.sort)}${opt('priceLow', 'מיון: מהזול ליקר', carFilters.sort)}${opt('priceHigh', 'מיון: מהיקר לזול', carFilters.sort)}</select>
      ${(carFilters.make || carFilters.model || carFilters.year || carFilters.category || carFilters.availability !== 'all' || carFilters.sort !== 'new') ? '<button class="btn outline" id="f-clear">ניקוי</button>' : ''}
      <div class="type-chips">${['סדאן', 'SUV', 'פיקאפ', 'מיניוואן'].map(t => `<button class="type-chip ${carFilters.category === t ? 'on' : ''}" data-type-chip="${t}">${t}</button>`).join('')}</div>
    </div>
    ${carGrid(rows.slice(0, carsShown), false, period)}
    ${rows.length > carsShown ? `<div class="see-all"><button type="button" class="btn primary see-all-btn" id="cars-more">הצגת עוד רכבים (${rows.length - carsShown})</button></div>` : ''}</div>`;
  if (!paintApp(html)) return;  // unchanged → keep DOM + handlers (avoids flicker + preserves open date-pickers)
  bindCarButtons();
  bindDateFields();
  const rerender = () => cars();
  const persistFilters = () => { try { sessionStorage.setItem('cd-car-filters', JSON.stringify(carFilters)); } catch {} };
  const bind = (id, key) => { const el = document.querySelector(id); if (el) el.onchange = () => { carFilters[key] = el.value; if (key === 'make') carFilters.model = ''; carsShown = CARS_PAGE; persistFilters(); rerender(); }; };
  document.querySelector('#cars-more')?.addEventListener('click', () => { carsShown += CARS_PAGE; rerender(); });
  document.querySelector('#open-filters')?.addEventListener('click', () => openFilterSheet(all, rerender, persistFilters));
  bind('#f-make', 'make');
  bind('#f-model', 'model');
  bind('#f-year', 'year');
  bind('#f-availability', 'availability');
  bind('#f-sort', 'sort');
  document.querySelectorAll('[data-type-chip]').forEach(chip => chip.onclick = () => { carFilters.category = carFilters.category === chip.dataset.typeChip ? '' : chip.dataset.typeChip; persistFilters(); rerender(); });
  document.querySelector('#f-clear')?.addEventListener('click', () => { Object.assign(carFilters, {make: '', model: '', year: '', category: '', availability: 'all', sort: 'new'}); persistFilters(); rerender(); });
  // Date search: set the shared search period and re-render so cards show estimates + fit/no-fit notes.
  document.querySelector('#period-apply')?.addEventListener('click', () => {
    const sd = document.querySelector('input[name="carsStart"]')?.value || '';
    const ed = document.querySelector('input[name="carsEnd"]')?.value || '';
    const sh = document.querySelector('#cars-start-hour')?.value || '10:00';
    const eh = document.querySelector('#cars-end-hour')?.value || '10:00';
    if (!sd || !ed) return toast('בחרו תאריך איסוף והחזרה');
    searchPeriod.startAt = `${sd}T${sh}`;
    searchPeriod.endAt = `${ed}T${eh}`;
    if (!searchRange()) { searchPeriod.startAt = ''; searchPeriod.endAt = ''; return toast('תאריך ההחזרה חייב להיות אחרי האיסוף'); }
    persistSearch();
    rerender();
  });
  document.querySelector('#period-clear')?.addEventListener('click', () => { searchPeriod.startAt = ''; searchPeriod.endAt = ''; persistSearch(); rerender(); });
}

function openCar(id) {
  const car = {id, ...store.cars[id]};
  if (!car.id) return toast('הרכב לא נמצא');
  const photos = carPhotoList(car);
  const gallery = photos.length ? `<div class="gallery"><div class="gallery-main"><img id="gallery-img" ${carImgAttrs(photos[0], '(max-width:820px) 100vw, 780px')} alt="${esc(`${car.make || ''} ${car.model || ''}`)}"></div>${photos.length > 1 || car.videoUrl ? `<div class="gallery-thumbs">${photos.map((p, i) => `<button class="thumb ${i === 0 ? 'active' : ''}" data-photo="${esc(p)}"><img src="${esc(wikiThumb(p, 250) || p)}" alt="תמונה ${i + 1}"></button>`).join('')}${car.videoUrl ? `<button class="thumb thumb-video" data-video="${esc(car.videoUrl)}">▶</button>` : ''}</div>` : ''}</div>` : `<img class="modal-car-image" id="gallery-img" ${carImgAttrs(carImage(car), '(max-width:820px) 100vw, 780px')} alt="${esc(car.make || '')}">`;
  const reviews = carReviews(car.id);
  const canRate = store.user && myBookings().some(b => b.carId === car.id && b.renterUid === store.user.uid && b.status === 'done');
  const rateNote = store.user && !canRate ? '<p class="rate-note">רק משתמש ששכר את הרכב בפועל יכול לדרג אותו — הדירוג נפתח מההזמנה לאחר סיום ההשכרה.</p>' : '';
  const reviewsAvg = carRating(car.id);
  const reviewsHtml = `${reviews.length ? `<div class="reviews"><div class="reviews-summary"><div class="reviews-avg"><b>${reviewsAvg.toFixed(1)}</b><span class="reviews-stars">${stars(reviewsAvg)}</span></div><span class="reviews-total">${reviews.length} ${reviews.length === 1 ? 'ביקורת' : 'ביקורות'}</span></div>${reviews.slice(0, 8).map(r => `<div class="review"><div class="review-head"><span class="review-stars">${stars(r.score)}</span><small>${fmtDate(r.createdAt)}</small></div>${r.review ? `<p>${esc(r.review)}</p>` : ''}</div>`).join('')}</div>` : ''}${rateNote}`;
  const rented = car.status !== 'available';
  const mode = rentalModeOf(car);
  const onRequest = !!car.priceOnRequest;
  // "Contact owner" is offered to everyone except the admin and the car's own owner (the handler asks a
  // guest / logged-out visitor to sign in). It opens a DIRECT renter↔owner thread — no booking needed.
  const canInquire = !store.isAdmin && (!store.user || car.ownerUid !== store.user.uid);
  const draftKey = `cd-booking-draft-${car.id}`;
  const draft = readSession(draftKey, {});
  const requestId = draft.requestId || crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const bStart = searchPeriod.startAt ? searchPeriod.startAt.slice(0, 10) : (draft.startDate || '');
  const bEnd = searchPeriod.endAt ? searchPeriod.endAt.slice(0, 10) : (draft.endDate || '');
  const bStartH = searchPeriod.startAt ? searchPeriod.startAt.slice(11, 16) : (draft.startHour || '10:00');
  const bEndH = searchPeriod.endAt ? searchPeriod.endAt.slice(11, 16) : (draft.endHour || '10:00');
  modal(`<div class="modal-head"><h2>${esc(car.make || '')} ${esc(car.model || '')} ${esc(car.trim || '')}</h2><button class="close" data-close-modal>×</button></div>
    ${gallery}
    <div class="car-detail-head">${availPill(car.status)}${newBadge(car)}${mode ? `<span class="mode-badge lg">${mode.label}</span>` : ''}${car.ownerName ? `<span class="owner-tag">בעל הרכב: ${esc(car.ownerName)}</span>` : ''}</div>
    <div class="detail-summaries">
      <div class="summary"><span>שנה</span><b>${esc(car.year || '—')}</b></div>
      ${car.category ? `<div class="summary"><span>סוג רכב</span><b>${esc(car.category)}</b></div>` : ''}
      ${car.fuel ? `<div class="summary"><span>סוג דלק</span><b>${esc(car.fuel)}</b></div>` : ''}
      ${car.gear ? `<div class="summary"><span>תיבת הילוכים</span><b>${esc(car.gear)}</b></div>` : ''}
      ${car.seats ? `<div class="summary"><span>מושבים</span><b>${esc(car.seats)}</b></div>` : ''}
      <div class="summary"><span>גיל מינימלי</span><b>${esc(car.minAge || 21)}</b></div>
      ${onRequest ? '<div class="summary"><span>מחיר</span><b>שלחו הודעה</b></div>' : `${car.priceHourly ? `<div class="summary"><span>מחיר לשעה</span><b>${money(car.priceHourly)}</b></div>` : ''}${car.dailyPrice ? `<div class="summary"><span>מחיר יומי</span><b>${money(car.dailyPrice)}</b></div>` : ''}${car.priceWeekly ? `<div class="summary"><span>מחיר לשבוע</span><b>${money(car.priceWeekly)}</b></div>` : ''}`}
      ${car.deliveryEnabled ? `<div class="summary"><span>מסירה</span><b>${car.deliveryCost ? money(car.deliveryCost) : 'זמינה'}</b></div>` : ''}
      <div class="summary"><span>דירוג</span><b>${stars(carRating(car.id))} ${carRating(car.id) ? carRating(car.id).toFixed(1) : 'חדש'}</b></div>
    </div>
    ${onRequest && canInquire ? '<div class="price-contact-cta"><div><b>שלחו הודעה לקבלת מחיר</b><small>המחיר נקבע מול בעל הרכב — שלחו הודעה כדי לקבל אותו.</small></div><button type="button" class="btn gold" id="price-contact">שליחת הודעה לקבלת מחיר</button></div>' : ''}
    ${canInquire && !onRequest ? `<div class="owner-contact-cta"><div><b>יש לכם שאלה על הרכב?</b><small>דברו ישירות עם בעל הרכב עוד לפני שליחת הבקשה.</small></div><button type="button" class="btn dark-out" id="contact-owner">${ICON.chat} צור קשר עם בעל הרכב</button></div>` : ''}
    ${reviewsHtml}
    ${rented ? '<div class="chat-closed">הרכב אינו זמין להזמנה כרגע</div>' : `<form id="booking-form" autocomplete="on"><div class="booking-form-head"><span>בקשת הזמנה</span><h3>בחירת מועד וקבלת מחיר</h3><small>כל השעות לפי ניו יורק (ET)</small></div><div class="form-grid">${dateField('startDate', 'תאריך איסוף', bStart)}<div class="field"><label>שעת איסוף</label><select name="startHour">${hourOptions(bStartH)}</select></div>${dateField('endDate', 'תאריך החזרה', bEnd)}<div class="field"><label>שעת החזרה</label><select name="endHour">${hourOptions(bEndH)}</select></div></div><div class="booking-est" id="booking-est" aria-live="polite"></div><div class="field"><label>אופן קבלה</label><select name="fulfillment"><option value="pickup" ${draft.fulfillment !== 'delivery' ? 'selected' : ''}>איסוף עצמי</option>${car.deliveryEnabled ? `<option value="delivery" ${draft.fulfillment === 'delivery' ? 'selected' : ''}>מסירה</option>` : ''}</select></div><div class="field" id="delivery-address-field"><label>כתובת מסירה</label><input name="deliveryAddress" autocomplete="street-address" value="${esc(draft.deliveryAddress || '')}" placeholder="רחוב, מספר, עיר"></div><label class="booking-consent"><input type="checkbox" name="termsAccepted" required><span>קראתי ואני מסכים/ה ל<a href="terms.html" target="_blank" rel="noopener">תנאי השימוש</a>, כולל תנאי הביטול המפורטים בהם.</span></label><button type="submit" class="btn primary block booking-submit-main">שליחת בקשה</button></form><div class="mobile-booking-bar"><div><small>סיכום הזמנה</small><b id="mobile-booking-total">בחרו תאריכים</b></div><button type="submit" form="booking-form" class="btn primary">שליחת בקשה</button></div>`}`);
  const galleryImg = document.querySelector('#gallery-img');
  galleryImg?.addEventListener('error', event => { event.currentTarget.src = fallbackImage; }, {once: true});
  document.querySelectorAll('[data-photo]').forEach(button => button.onclick = () => {
    // Clear the previous photo's srcset (it would override the new src), then prefer a 960px thumb.
    galleryImg.removeAttribute('srcset'); galleryImg.removeAttribute('sizes');
    galleryImg.src = wikiThumb(button.dataset.photo, 960) || button.dataset.photo;
    galleryImg.dataset.orig = button.dataset.photo;
    document.querySelectorAll('.thumb').forEach(t => t.classList.toggle('active', t === button));
  });
  document.querySelector('[data-video]')?.addEventListener('click', event => {
    const url = event.currentTarget.dataset.video;
    const main = document.querySelector('.gallery-main');
    if (main) main.innerHTML = `<video controls autoplay src="${esc(url)}" style="width:100%;border-radius:12px"></video>`;
    document.querySelectorAll('.thumb').forEach(t => t.classList.toggle('active', t === event.currentTarget));
  });
  const bookingForm = document.querySelector('#booking-form');
  if (bookingForm) bindDateFields(bookingForm);
  if (bookingForm) {
    // Live price estimate: recompute the total from the chosen dates by the same duration rule as
    // search (hours→hourly, days→daily, week+→weekly) and warn if the range doesn't fit this car.
    const estBox = bookingForm.querySelector('#booking-est');
    const mobileTotal = document.querySelector('#mobile-booking-total');
    const addressField = bookingForm.querySelector('#delivery-address-field');
    const fulfillment = bookingForm.querySelector('[name="fulfillment"]');
    const syncDelivery = () => {
      const delivery = fulfillment?.value === 'delivery';
      addressField?.classList.toggle('hide', !delivery);
      const input = addressField?.querySelector('input'); if (input) input.required = delivery;
    };
    const recalc = () => {
      if (!estBox) return;
      const sd = bookingForm.querySelector('input[name="startDate"]')?.value || '';
      const ed = bookingForm.querySelector('input[name="endDate"]')?.value || '';
      const sh = bookingForm.querySelector('select[name="startHour"]')?.value || '10:00';
      const eh = bookingForm.querySelector('select[name="endHour"]')?.value || '10:00';
      if (!sd || !ed) { estBox.innerHTML = ''; if (mobileTotal) mobileTotal.textContent = 'בחרו תאריכים'; return; }
      const s = new Date(`${sd}T${sh}`).getTime(), e = new Date(`${ed}T${eh}`).getTime();
      if (!(e > s)) { estBox.innerHTML = '<div class="period-note">תאריך ההחזרה חייב להיות אחרי האיסוף</div>'; if (mobileTotal) mobileTotal.textContent = 'טווח לא תקין'; return; }
      if (onRequest) { estBox.innerHTML = '<div class="period-note contact">שלחו הודעה לבעל הרכב לקבלת מחיר לטווח שבחרתם</div>'; if (mobileTotal) mobileTotal.textContent = 'מחיר בתיאום'; return; }
      if (!carServesPeriod(car, s, e)) {
        const only = mode ? mode.short : carBuckets(car).map(b => BUCKET_HE[b]).join(' / ');
        estBox.innerHTML = `<div class="period-note">רכב זה זמין להשכרה ${only} בלבד — לא מתאים לטווח שבחרתם</div>`;
        if (mobileTotal) mobileTotal.textContent = 'הטווח אינו מתאים';
        return;
      }
      const est = estimatePrice(car, s, e);
      estBox.innerHTML = est ? `<div class="period-est"><span>מחיר משוער</span><b>${money(est.total)}</b><small>${est.label}</small></div>` : '';
      if (mobileTotal) mobileTotal.textContent = est ? money(est.total + (fulfillment?.value === 'delivery' ? Number(car.deliveryCost || 0) : 0)) : 'המחיר יחושב';
    };
    bookingForm.addEventListener('change', () => {
      syncDelivery(); recalc();
      try { sessionStorage.setItem(draftKey, JSON.stringify({...formData(bookingForm), requestId})); } catch {}
    });
    syncDelivery(); recalc();
  }
  // "שלחו הודעה לקבלת מחיר" → open the support chat so the renter can ask the price (no public price).
  document.querySelector('#price-contact')?.addEventListener('click', () => openOwnerInquiry(car.id));
  document.querySelector('#contact-owner')?.addEventListener('click', () => openOwnerInquiry(car.id));
  if (bookingForm) bookingForm.onsubmit = async event => {
    event.preventDefault();
    const submitButtons = [...document.querySelectorAll('#booking-form [type="submit"], [type="submit"][form="booking-form"]')];
    try {
      // A guest/anonymous user (or nobody) can't book — send them to register/login. (Anonymous users HAVE a
      // store.user, so `!store.user` alone let them fall through to createBooking, which then failed.)
      if (!store.user || store.user.isAnonymous) { saveAuthReturn({carId: car.id}); toast('התחברו או הירשמו כדי להזמין רכב'); closeModal(); location.hash = 'auth'; return; }
      const data = formData(event.target);
      if (!data.startDate || !data.endDate) {
        const missing = event.target.querySelectorAll('.date-field')[!data.startDate ? 0 : 1];
        return fieldError(missing?.querySelector('[data-date-btn]'), 'בחרו תאריך כדי להמשיך');
      }
      if (!event.target.reportValidity()) return;
      data.startLocal = `${data.startDate}T${data.startHour}`;
      data.endLocal = `${data.endDate}T${data.endHour}`;
      data.startAt = newYorkIso(data.startDate, data.startHour);
      data.endAt = newYorkIso(data.endDate, data.endHour);
      if (!data.startAt || !data.endAt) return toast('התאריך או השעה אינם תקינים');
      data.timezone = 'America/New_York';
      data.termsAccepted = data.termsAccepted === 'on';
      data.termsVersion = '2026-07-14-rev101';
      data.requestId = requestId;
      // Immediate feedback for a range the car's rental mode doesn't cover (the server also enforces this).
      const s = new Date(data.startAt).getTime(), e = new Date(data.endAt).getTime();
      if (!onRequest && e > s && !carServesPeriod(car, s, e)) return toast('הרכב אינו מושכר לטווח שבחרתם');
      submitButtons.forEach(button => { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.dataset.label = button.textContent; button.textContent = 'שולח…'; });
      const bookingId = await createBooking(car, data);
      try { sessionStorage.removeItem(draftKey); } catch {}
      closeModal();
      // Clear success screen (mobile audit #26): booking number, status, what happens next, and a direct
      // link to the personal area — instead of a toast that vanishes before the renter reads it.
      modal(`<div class="modal-head"><h2>✓ הבקשה נשלחה!</h2><button class="close" data-close-modal>×</button></div>
        <div class="booking-success">
          <div class="summary"><span>מספר הזמנה</span><b dir="ltr">${esc(String(bookingId || '').slice(-7).toUpperCase())}</b></div>
          <div class="summary"><span>רכב</span><b>${esc(car.make || '')} ${esc(car.model || '')}</b></div>
          <div class="summary"><span>סטטוס</span><b><span class="status-badge pending">ממתינה לאישור</span></b></div>
          <p class="mut">בעל הרכב קיבל את הבקשה. תקבלו עדכון ברגע שיאשר — ואז נבקש הוכחת תשלום ותיעוד לפני הנסיעה.</p>
          <button class="btn primary block" data-route="dashboard">מעבר לאזור האישי</button>
        </div>`);
      document.querySelector('#modal-root [data-route]')?.addEventListener('click', () => closeModal());
    } catch (error) {
      toast(error.message);
      submitButtons.forEach(button => { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = button.dataset.label || 'שליחת בקשה'; });
    }
  };
}

export function authView() {
  resetPaint();
  app().innerHTML = `<section class="card auth-shell"><div id="auth-content"></div></section>`;
  const content = () => document.querySelector('#auth-content');

  // Step 1 — choose account type.
  function roleChoice() {
    content().innerHTML = `<div class="auth-head"><h2>האזור האישי</h2><p>בחרו את סוג החשבון כדי להמשיך</p></div>
      <div class="role-grid">
        <button class="role-card" data-role="renter"><span class="role-emoji">${ICON.key}</span><b>שוכר</b><small>מחפש רכב לשכור</small></button>
        <button class="role-card" data-role="owner"><span class="role-emoji">${ICON.car}</span><b>בעל רכב</b><small>משכיר רכב ומנהל הזמנות</small></button>
      </div>`;
    content().querySelectorAll('[data-role]').forEach(card => card.onclick = () => modeChoice(card.dataset.role));
  }

  // Step 2 — two separate options: Sign in / Sign up.
  function modeChoice(role) {
    const label = role === 'owner' ? 'בעל רכב' : 'שוכר';
    content().innerHTML = `<button class="link-back" id="auth-back">→ חזרה לבחירת סוג חשבון</button>
      <div class="auth-head"><span class="role-pill">${label}</span></div>
      <div class="role-grid">
        <button class="role-card" data-mode="login"><span class="role-emoji">${ICON.selfie}</span><b>כניסה</b><small>Sign in · כבר יש לי חשבון</small></button>
        <button class="role-card" data-mode="register"><span class="role-emoji">${ICON.edit}</span><b>הרשמה</b><small>Sign up · פתיחת חשבון חדש</small></button>
      </div>`;
    content().querySelector('#auth-back').onclick = roleChoice;
    content().querySelector('[data-mode="login"]').onclick = () => loginScreen(role);
    content().querySelector('[data-mode="register"]').onclick = () => registerScreen(role);
  }

  // Step 3a — Sign in: email + password only.
  function loginScreen(role) {
    const label = role === 'owner' ? 'בעל רכב' : 'שוכר';
    content().innerHTML = `<button class="link-back" id="auth-back">→ חזרה</button>
      <div class="auth-head"><h2>כניסה · Sign in</h2><p>${label} · הזינו מייל וסיסמה</p></div>
      <form id="login-form"><div class="field"><label>מייל</label><input name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" required></div><div class="field"><label>סיסמה</label><div class="password-field"><input id="login-password" name="password" type="password" autocomplete="current-password" required><button type="button" data-toggle-password="login-password" aria-pressed="false">הצגה</button></div></div><button class="btn primary block">כניסה</button><button type="button" class="forgot-pw" id="forgot-pw">שכחתי סיסמה</button></form>`;
    content().querySelector('#auth-back').onclick = () => modeChoice(role);
    content().querySelector('#login-form').onsubmit = async event => {
      event.preventDefault();
      const data = formData(event.target);
      const button = event.submitter; if (button) { button.disabled = true; button.textContent = 'מתחבר…'; }
      try {
        const user = await login(data.email, data.password);
        // Admins may enter ONLY through the "כניסת מנהל" button at the bottom of the home page.
        if (await checkIsAdmin(user.uid)) { await logout(); return toast('זהו חשבון מנהל — יש להיכנס דרך כפתור "כניסת מנהל" בתחתית דף הבית'); }
        afterAuthDestination();
      }
      catch (error) { toast(error.message); if (button) { button.disabled = false; button.textContent = 'כניסה'; } }
    };
    content().querySelector('#forgot-pw').onclick = async () => {
      const email = content().querySelector('#login-form')?.email?.value?.trim() || prompt('כתובת המייל של החשבון:');
      if (!email) return;
      try { await sendPasswordReset(email); toast('נשלח אליכם מייל עם קישור לאיפוס הסיסמה'); }
      catch (error) { toast(error.message); }
    };
  }

  // Step 3b — Sign up: full name, phone, email, password.
  function registerScreen(role) {
    const label = role === 'owner' ? 'בעל רכב' : 'שוכר';
    content().innerHTML = `<button class="link-back" id="auth-back">→ חזרה</button>
      <div class="auth-head"><h2>הרשמה · Sign up</h2><p>פתיחת חשבון ${label}</p></div>
      <form id="register-form"><input type="hidden" name="role" value="${role}"><div class="field"><label>שם מלא</label><input name="name" autocomplete="name" required></div>${phoneField()}<div class="field"><label>מייל</label><input name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" required></div><div class="field"><label>בחירת סיסמה</label><div class="password-field"><input id="register-password" name="password" type="password" minlength="6" autocomplete="new-password" required><button type="button" data-toggle-password="register-password" aria-pressed="false">הצגה</button></div><small>לפחות 6 תווים.</small></div><div class="field"><label>אישור סיסמה</label><input name="passwordConfirm" type="password" minlength="6" autocomplete="new-password" required></div><label class="booking-consent"><input type="checkbox" name="legalAccepted" required><span>קראתי ואני מסכים/ה ל<a href="terms.html" target="_blank" rel="noopener">תנאי השימוש</a> ול<a href="privacy.html" target="_blank" rel="noopener">מדיניות הפרטיות</a>.</span></label><button class="btn primary block">הרשמה כ${label}</button></form>`;
    content().querySelector('#auth-back').onclick = () => modeChoice(role);
    content().querySelector('#register-form').onsubmit = async event => {
      event.preventDefault();
      const button = event.target.querySelector('button[type=submit], .btn.primary');
      const data = composePhone(formData(event.target));
      const reset = () => { if (button) { button.disabled = false; button.textContent = `הרשמה כ${label}`; } };
      if (!validEmail(data.email)) return fieldError(event.target.email, 'כתובת המייל אינה תקינה — בדקו שהיא בפורמט name@example.com');
      if (String(data.password || '').length < 6) return fieldError(event.target.password, 'הסיסמה קצרה מדי — לפחות 6 תווים');
      if (data.password !== data.passwordConfirm) return fieldError(event.target.passwordConfirm, 'הסיסמאות אינן תואמות — הקלידו שוב את אותה הסיסמה');
      delete data.passwordConfirm;
      data.legalAccepted = data.legalAccepted === 'on';
      data.termsVersion = '2026-07-14-rev101';
      if (button) { button.disabled = true; button.textContent = 'נרשם…'; }
      try { await register(data); afterAuthDestination(); }
      catch (error) { toast(error.message); reset(); }
    };
  }

  // Admin sign-in — reached from the small "כניסת מנהל" link at the bottom of the home page.
  // Just email + password; admin rights come from the account's UID being under /admins.
  function adminLoginScreen() {
    content().innerHTML = `<button class="link-back" id="auth-back">→ חזרה</button>
      <div class="auth-head"><span class="role-pill">מנהל האתר</span><h2>כניסת מנהל · Sign in</h2><p>הזינו מייל וסיסמה של חשבון המנהל</p></div>
      <form id="login-form"><div class="field"><label>מייל</label><input name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" required></div><div class="field"><label>סיסמה</label><div class="password-field"><input id="admin-password" name="password" type="password" autocomplete="current-password" required><button type="button" data-toggle-password="admin-password" aria-pressed="false">הצגה</button></div></div><button class="btn primary block">כניסת מנהל</button><button type="button" class="forgot-pw" id="forgot-pw">שכחתי סיסמה</button></form>`;
    content().querySelector('#auth-back').onclick = roleChoice;
    content().querySelector('#login-form').onsubmit = async event => {
      event.preventDefault();
      const data = formData(event.target);
      const button = event.submitter; if (button) { button.disabled = true; button.textContent = 'מתחבר…'; }
      try { await login(data.email, data.password); location.hash = 'dashboard'; }
      catch (error) { toast(error.message); if (button) { button.disabled = false; button.textContent = 'כניסת מנהל'; } }
    };
    content().querySelector('#forgot-pw').onclick = async () => {
      const email = content().querySelector('#login-form')?.email?.value?.trim() || prompt('כתובת המייל של החשבון:');
      if (!email) return;
      try { await sendPasswordReset(email); toast('נשלח אליכם מייל עם קישור לאיפוס הסיסמה'); }
      catch (error) { toast(error.message); }
    };
  }

  if (pendingAdminLogin) { pendingAdminLogin = false; adminLoginScreen(); }
  else if (pendingAuthRole) { const role = pendingAuthRole, mode = pendingAuthTab; pendingAuthRole = pendingAuthTab = null; (mode === 'register' ? registerScreen : loginScreen)(role); }
  else roleChoice();
}

// ---------- Lazy chunk: the whole authenticated app (dashboard, chat, forms, modals) ----------
// Public visitors never download this. It loads on first navigation to the personal area / chats,
// or the first auth-only action (add car, support chat, contact owner). Once loaded it is cached,
// so tab switches inside the dashboard render synchronously (no flicker).
let __appMod = null;
const loadApp = () => __appMod
  ? Promise.resolve(__appMod)
  : import('./views-app.js').then(m => (__appMod = m)).catch(err => { console.error('views-app load failed', err); toast('שגיאה בטעינת האזור — נסו לרענן'); throw err; });
const APP_LOADER = '<div class="app-loader"><div class="spinner"></div><p>טוען…</p></div>';
export function dashboard() {
  resetPaint();
  if (store.user?.isAnonymous) { toast('הירשמו כדי לפתוח אזור אישי'); location.hash = 'auth'; return; }
  if (!store.user) { if (!store.authSettled) { app().innerHTML = APP_LOADER; return; } location.hash = 'auth'; return; }
  if (__appMod) return __appMod.dashboard();
  app().innerHTML = APP_LOADER;
  loadApp().then(m => m.dashboard()).catch(() => {});
}
export function chatsPage() {
  if (__appMod) return __appMod.chatsPage();
  resetPaint(); app().innerHTML = APP_LOADER;
  loadApp().then(m => m.chatsPage()).catch(() => {});
}
function carForm(car) { loadApp().then(m => m.carForm(car)).catch(() => {}); }
export function openSupportChat() { return loadApp().then(m => m.openSupportChat()).catch(() => {}); }
function openOwnerInquiry(id) { loadApp().then(m => m.openOwnerInquiry(id)).catch(() => {}); }
window.cdCloseModal = closeModal;
