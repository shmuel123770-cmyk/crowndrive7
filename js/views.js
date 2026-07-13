import {store, list, myRole, myBookings, myCars, carRating, userRating} from './store.js';
import {esc, money, fmtDate, statusLabel, verificationLabel, modal, closeModal, formData, toast, stars, validEmail} from './core.js';
import {register, login, logout, sendVerify, refreshEmailStatus, sendPasswordReset, createOwnProfile} from './auth.js';
import {saveUser, setOwnPhoto, createCar, updateCar, deleteCar, createBooking, setBookingStatus, registerDocument, approveVerification, sendMessage, savePayment, saveHandover, submitRating, carMediaPublic, adminAction, setMaintenance, setCarStatus, setCarFeatured, checkIsAdmin} from './db.js';
import {uploadPrivate, uploadPublicMedia, signedRead, capturePhoto} from './media.js';
import {legacyStatus, migrateLegacy} from './migrate.js';
import {api} from './api.js';

const app = () => document.querySelector('#app');
const fallbackImage = 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=1200&q=75';
const carPhotos = car => [...(Array.isArray(car.photos) ? car.photos : []), car.photoUrl].filter((url, i, arr) => url && arr.indexOf(url) === i);
const carImage = car => carPhotos(car)[0] || fallbackImage;
const roleName = role => ({renter:'שוכר', owner:'בעל רכב', admin:'מנהל'}[role] || 'משתמש');
const avatarHtml = (user, size = 42) => user?.photoURL
  ? `<img class="avatar" style="width:${size}px;height:${size}px" src="${esc(user.photoURL)}" alt="">`
  : `<span class="avatar avatar-fallback" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.4)}px">${esc(String(user?.name || 'מ').charAt(0))}</span>`;

// Inline icons for the KPI cards (match the reference dashboard look).
const ICON = {
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

const TAB_ICONS = {overview: () => ICON.grid, bookings: () => ICON.calendar, cars: () => ICON.car, profile: () => ICON.selfie, messages: () => ICON.chat, chats: () => ICON.chat, users: () => ICON.users, notifications: () => ICON.bell};
const kpi = (icon, value, label) => `<div class="kpi"><div class="kpi-head"><span class="kpi-label">${label}</span><i class="kpi-icon">${ICON[icon] || ''}</i></div><b>${value}</b></div>`;
const carStatusPill = status => `<span class="pill ${status === 'available' ? 'ok' : 'mut'}">${status === 'available' ? 'זמין' : status === 'rented' ? 'מושכר' : 'מוסתר'}</span>`;
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
const phoneField = (value = '') => { const {dial, local} = splitPhone(value); return `<div class="field"><label>טלפון</label><div class="phone-row"><select name="dial">${DIAL_CODES.map(([code, label]) => `<option value="${code}" ${code === dial ? 'selected' : ''}>${label} ${code}</option>`).join('')}</select><input name="phoneLocal" type="tel" inputmode="tel" placeholder="מספר טלפון" value="${esc(local)}"></div></div>`; };
const composePhone = data => { data.phone = data.phoneLocal ? `${data.dial} ${String(data.phoneLocal).trim()}` : ''; delete data.dial; delete data.phoneLocal; return data; };

const selectOptions = (options, selected) => `<option value="">בחר…</option>${options.map(option => `<option value="${esc(option)}" ${option === selected ? 'selected' : ''}>${esc(option)}</option>`).join('')}`;

// Car reference data — the owner picks make → model from these lists when listing a car.
const CAR_TYPES = ['סדאן', 'סדאן יוקרה', 'SUV', 'SUV יוקרה', 'פיקאפ', 'מיניוואן', 'קרוסאובר', 'האצ׳בק', 'קופה', 'ספורט', 'מסחרי'];
const MODELS_BY_MAKE = {
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
const CAR_MAKES = Object.keys(MODELS_BY_MAKE).sort((a, b) => a.localeCompare(b, 'en'));
const carYears = () => { const now = new Date().getFullYear() + 1; return Array.from({length: 30}, (_, i) => String(now - i)); };
const carPhotoList = car => { const arr = (Array.isArray(car.photos) ? car.photos : []).filter(Boolean); const main = car.photoUrl; return [...new Set([main, ...arr].filter(Boolean))]; };
const carReviews = carId => list(store.ratings).filter(r => r.type === 'car' && r.carId === carId && (r.review || r.score)).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
const availPill = status => status === 'available'
  ? '<span class="avail-badge free">● פנוי</span>'
  : `<span class="avail-badge busy">● ${status === 'rented' ? 'מושכר' : 'לא זמין'}</span>`;

// Road-scene assets, taken 1:1 from the original CrownDrive design.
const carSil = cls => `<svg class="sil ${cls}" viewBox="0 0 200 70" aria-hidden="true"><path d="M14 52 q2 -12 16 -15 l18 -3 q10 -14 30 -16 l36 -1 q20 1 32 13 l10 9 q22 3 26 12 q2 7 -4 9 l-9 1 q-2 -11 -14 -11 t-14 11 l-70 0 q-2 -11 -14 -11 t-14 11 l-17 -1 q-9 -2 -8 -8 z"/><circle cx="57" cy="57" r="11"/><circle cx="155" cy="57" r="11"/></svg>`;
const blueprintSvg = `<svg class="blueprint" viewBox="0 0 640 300" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M60 210 q4 -30 36 -36 l52 -8 q28 -40 84 -46 l96 -3 q56 2 92 34 l26 24 q56 6 66 30 q6 16 -6 20 l-24 3"/><path d="M60 210 q-4 12 10 16 l40 2"/><path d="M174 228 l180 0"/><path d="M478 228 l36 -2"/><path d="M172 166 q26 -36 78 -42 l92 -3 q50 3 84 32"/><path d="M258 124 l6 42 M356 121 l10 44"/><path d="M262 166 l-6 60 M362 165 l-2 62"/><path d="M286 184 l30 0 M388 183 l30 0"/><path d="M64 196 l34 -6 M528 208 l24 -4"/><circle cx="204" cy="226" r="34"/><circle cx="204" cy="226" r="21"/><circle cx="204" cy="226" r="3"/><circle cx="452" cy="226" r="34"/><circle cx="452" cy="226" r="21"/><circle cx="452" cy="226" r="3"/><path d="M204 205 v42 M183 226 h42 M452 205 v42 M431 226 h42" opacity=".55"/><circle cx="204" cy="226" r="48" stroke-dasharray="4 7" opacity=".5"/><circle cx="452" cy="226" r="48" stroke-dasharray="4 7" opacity=".5"/><path d="M60 272 l520 0" stroke-dasharray="4 7" opacity=".5"/><path d="M60 265 l0 14 M580 265 l0 14" opacity=".6"/><path d="M110 96 l-18 0 0 18 M540 96 l18 0 0 18" opacity=".5"/></g></svg>`;
const STEP_ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  approve: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
};

const hourOptions = (selected = '10:00') => Array.from({length: 24}, (_, h) => { const v = `${String(h).padStart(2, '0')}:00`; return `<option value="${v}" ${v === selected ? 'selected' : ''}>${v}</option>`; }).join('');

// Custom big calendar picker (the native one is tiny and unstylable).
const pad2 = n => String(n).padStart(2, '0');
const fmtHe = iso => { if (!iso) return 'בחרו תאריך'; const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
const dateField = (name, label, value = '') => `<div class="date-field"><span class="df-label">${label}</span><button type="button" class="date-btn ${value ? 'has-val' : ''}" data-date-btn><span>${fmtHe(value)}</span><i class="date-ic">${ICON.cal}</i></button><input type="hidden" name="${name}" value="${value}"></div>`;
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
  button.parentElement.appendChild(pop);
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
      cells += `<button type="button" class="cal-day ${hidden.value === iso ? 'sel' : ''} ${date.getTime() === today.getTime() ? 'today' : ''}" ${date < today ? 'disabled' : ''} data-iso="${iso}">${d}</button>`;
    }
    pop.innerHTML = `<div class="cal-head"><button type="button" class="cal-nav" data-nav="-1">‹</button><b>${monthName}</b><button type="button" class="cal-nav" data-nav="1">›</button></div><div class="cal-grid">${['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'].map(x => `<span class="cal-dow">${x}</span>`).join('')}${cells}</div>`;
    pop.querySelectorAll('.cal-nav').forEach(nav => nav.onclick = event => { event.stopPropagation(); view = new Date(y, m + Number(nav.dataset.nav), 1); render(); });
    pop.querySelectorAll('.cal-day').forEach(day => day.onclick = () => {
      hidden.value = day.dataset.iso;
      button.textContent = fmtHe(day.dataset.iso);
      button.classList.add('has-val');
      pop.remove();
      hidden.dispatchEvent(new Event('change', {bubbles: true}));  // let price estimates react to a picked date
    });
  };
  render();
  setTimeout(() => document.addEventListener('click', function close(event) {
    if (!pop.contains(event.target)) { pop.remove(); document.removeEventListener('click', close); }
  }), 0);
}

let pendingAuthRole = null, pendingAuthTab = null, pendingAdminLogin = false;
export function openAuthAs(role, tab) { pendingAuthRole = role; pendingAuthTab = tab; if (store.route === 'auth') authView(); else location.hash = 'auth'; }
export function openAdminLogin() { pendingAdminLogin = true; if (store.route === 'auth') authView(); else location.hash = 'auth'; }

export function nav() {
  const node = document.querySelector('#main-nav');
  const route = store.route || 'home';
  const role = myRole();
  const isOwner = role === 'owner' || role === 'admin';
  const links = [['home', 'בית'], ['cars', 'הרכבים'], ['how', 'איך זה עובד'], ['about', 'אודות'], ['contact', 'צור קשר']];
  node.innerHTML = `<div class="nav-links">${links.map(([key, label]) => `<button class="nav-link ${key === route ? 'active' : ''}" data-nav="${key}">${label}</button>`).join('')}</div>
    <div class="nav-actions">${store.user ? '<button class="dark-pill" data-route="dashboard">האזור שלי</button>' : '<button class="dark-pill" data-route="auth">התחבר</button>'}${isOwner ? '<button class="gold-pill" id="nav-add-car">+ הוסף רכב</button>' : ''}</div>`;
  const scrollToSection = id => {
    const go = () => document.getElementById(id)?.scrollIntoView({behavior: 'smooth'});
    if ((location.hash.slice(1) || 'home') !== 'home') { location.hash = 'home'; setTimeout(go, 400); } else go();
  };
  node.querySelectorAll('[data-nav]').forEach(button => button.onclick = () => {
    const key = button.dataset.nav;
    if (key === 'contact') {
      if (store.user) openChatThread(`a:${store.user.uid}`);
      else { toast('התחברו כדי לפתוח צ׳אט עם שירות הלקוחות'); location.hash = 'auth'; }
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

export function home() {
  const all = list(store.cars);
  const available = all.filter(car => car.status === 'available');
  const rented = all.filter(car => car.status === 'rented');
  app().innerHTML = `
  <section class="hero">
    <div class="aur aur-1" aria-hidden="true"></div><div class="aur aur-2" aria-hidden="true"></div><div class="aur aur-3" aria-hidden="true"></div>
    ${blueprintSvg}
    <div class="hero-in">
      <span class="kicker">קראון הייטס · ברוקלין</span>
      <h1>השכרת רכבים <em>קראון הייטס</em></h1>
      <p class="hero-copy">בחרו זמן איסוף והחזרה — וקבלו רק רכבים שמתאימים לחיפוש.</p>
      <div class="quick-search" aria-label="חיפוש מהיר לרכב">
        ${dateField('homeStart', 'תאריך איסוף')}
        <label><span>שעת איסוף</span><select id="home-start-hour">${hourOptions('10:00')}</select></label>
        ${dateField('homeEnd', 'תאריך החזרה')}
        <label><span>שעת החזרה</span><select id="home-end-hour">${hourOptions('10:00')}</select></label>
        <button class="btn gold" id="home-search">חפש רכב</button>
      </div>
      <div class="hero-stats">
        <div class="hstat"><b>${all.length}</b><span>רכבים באתר</span></div>
        <div class="hstat"><b>${available.length}</b><span>זמינים כעת</span></div>
      </div>
    </div>
    <div class="road" aria-hidden="true"><div class="cars-far">${carSil('s1')}</div><div class="asphalt"></div><div class="cars-near">${carSil('s3')}</div></div>
  </section>
  <div class="strip"><div class="strip-in">
    <span class="it"><span class="dot ok"></span><b>${available.length}</b> זמינים להשכרה</span>
    <span class="it"><span class="dot no"></span><b>${rented.length}</b> מושכרים</span>
    <span class="it"><span class="dot soon"></span><b>${Math.max(all.length - available.length - rented.length, 0)}</b> מתפנים בקרוב</span>
  </div></div>
  <section class="owner-cta-rich reveal"><div class="owner-cta-glow" aria-hidden="true"></div><div class="owner-cta-main"><p class="eyebrow">לבעלי רכבים</p><h2>יש לך רכב פנוי?</h2><p>פרסם רכב, קבע תנאים, גיל מינימלי, זמינות ואפשרות מסירה — והכל מנוהל באזור אישי אחד.</p><button class="btn gold" id="cta-add-car">הוסף רכב</button></div><div class="owner-cta-features"><div class="feature-chip">אימות שוכרים</div><div class="feature-chip">ניהול הזמנות</div><div class="feature-chip">תיעוד מסירה והחזרה</div><div class="feature-chip">דירוגים וביקורות</div></div></section>
  <section class="info-section fleet-zone reveal"><div class="sec-head"><p class="eyebrow">הצי שלנו</p><h2>רכבים זמינים</h2><p class="sec-sub">כל רכב עם תיעוד, דירוגים ובעלים מאומתים.</p></div>${carGrid(featuredFirst(available).slice(0, 8))}<div class="see-all"><button class="btn primary" data-route="cars">לכל הרכבים באתר ←</button></div></section>
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
  <footer class="site-foot"><span>© Crown Drive · קראון הייטס</span><button type="button" class="admin-entry" id="admin-entry">כניסת מנהל</button></footer>`;
  bindCarButtons();
  bindDateFields();
  document.querySelector('#cta-add-car')?.addEventListener('click', () => {
    const role = myRole();
    if (role === 'owner' || role === 'admin') carForm();
    else openAuthAs('owner', 'register');
  });
  document.querySelector('#contact-support')?.addEventListener('click', () => {
    if (!store.user) { toast('נדרשת התחברות קצרה כדי לפתוח צ׳אט'); location.hash = 'auth'; return; }
    openChatThread(`a:${store.user.uid}`);
  });
  document.querySelector('#admin-entry')?.addEventListener('click', () => openAdminLogin());
  // "חפש רכב": carry the chosen dates into the cars page so it can price + filter by the rental mode.
  document.querySelector('#home-search')?.addEventListener('click', () => {
    const sd = document.querySelector('input[name="homeStart"]')?.value || '';
    const ed = document.querySelector('input[name="homeEnd"]')?.value || '';
    const sh = document.querySelector('#home-start-hour')?.value || '10:00';
    const eh = document.querySelector('#home-end-hour')?.value || '10:00';
    if (sd && ed) { searchPeriod.startAt = `${sd}T${sh}`; searchPeriod.endAt = `${ed}T${eh}`; if (!searchRange()) { searchPeriod.startAt = ''; searchPeriod.endAt = ''; } }
    location.hash = 'cars';
  });
}

// ---- Rental modes: the owner chooses how the car is offered; the listing + search adapt to it. ----
const RENTAL_MODES = [
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
// Estimate a booking's price by its length: hours→hourly, a few days→daily, a week+→weekly. Falls
// back to the nearest available rate so a partial price setup still produces a sensible number.
function estimatePrice(car, startMs, endMs) {
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
const searchPeriod = {startAt: '', endAt: ''};
function searchRange() {
  const s = new Date(searchPeriod.startAt).getTime();
  const e = new Date(searchPeriod.endAt).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  return {startMs: s, endMs: e, bucket: periodBucket(e - s)};
}

function carCard(car, manage = false, period = null) {
  const rating = carRating(car.id);
  const type = car.category || 'רכב';
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
  const modeLine = mode ? `<div class="mode-line">${mode.label}</div>` : '';
  // Period-aware: when the visitor searched dates, matching cars show an estimated total and cars whose
  // rental mode doesn't fit the chosen range still appear — with a clear "available only for X" note.
  let periodHtml = '';
  let notFit = false;
  if (period && car.status === 'available') {
    if (onRequest) {
      periodHtml = '<div class="period-note contact">שלחו הודעה לבעל הרכב לקבלת מחיר — פתחו את המודעה</div>';
    } else if (carBuckets(car).includes(period.bucket)) {
      const est = estimatePrice(car, period.startMs, period.endMs);
      if (est) periodHtml = `<div class="period-est"><span>מחיר משוער לטווח שבחרתם</span><b>${money(est.total)}</b><small>${est.label}</small></div>`;
    } else {
      notFit = true;
      const only = mode ? mode.short : carBuckets(car).map(b => BUCKET_HE[b]).join(' / ');
      periodHtml = `<div class="period-note">רכב זה זמין להשכרה ${only} בלבד — לא מתאים לטווח שבחרתם</div>`;
    }
  }
  const manageRow = manage ? `<div class="car-manage"><button type="button" class="btn ${rented ? 'gold' : 'outline'}" data-car-status="${esc(car.id)}" data-next="${rented ? 'available' : 'rented'}">${rented ? '↺ סמן כפנוי' : '⛔ סמן כתפוס'}</button><button type="button" class="btn outline" data-car-edit="${esc(car.id)}">✎ עריכת פרטים</button></div>` : '';
  return `<article class="card car${car.featured ? ' is-featured' : ''}${notFit ? ' car-nofit' : ''}" data-car-open="${esc(car.id)}"><div class="car-photo"><img src="${esc(carImage(car))}" alt="${esc(`${car.make || ''} ${car.model || ''}`)}" loading="lazy" data-car-image>${availPill(car.status)}${modeBadge}${car.featured ? '<span class="feat-badge">★ מומלץ</span>' : ''}${car.videoUrl ? '<span class="has-video">▶ וידאו</span>' : ''}</div><div class="car-body"><h3>${esc(car.make || '')} ${esc(car.model || '')}</h3><div class="car-specs"><span>${esc(car.year || '—')}</span><span>·</span><span>${esc(type)}</span>${car.fuel ? `<span>·</span><span>${esc(car.fuel)}</span>` : ''}${car.gear ? `<span>·</span><span>${esc(car.gear)}</span>` : ''}</div>${modeLine}<div class="rating" aria-label="דירוג ${rating.toFixed(1)} מתוך 5">${stars(rating)} <small>${rating ? rating.toFixed(1) : 'חדש'}</small></div>${periodHtml}<div class="car-foot"><div class="price-stack"><div class="price">${priceMain}</div>${priceAlt ? `<small class="price-alt">${priceAlt}</small>` : ''}</div></div><button class="btn primary block" data-car="${esc(car.id)}">${car.status === 'available' ? 'פרטים והזמנה' : 'צפייה בפרטים'}</button>${manageRow}</div></article>`;
}
// Featured cars (pinned by the admin) always come first, newest-pin first.
function featuredFirst(cars) {
  return cars.slice().sort((a, b) => (Number(b.featured || 0) - Number(a.featured || 0)));
}
function carGrid(cars, manage = false, period = null) {
  if (!cars.length) return '<div class="grid"><div class="card empty">אין כרגע רכבים זמינים</div></div>';
  let ordered = featuredFirst(cars);
  if (period) {
    // Matching cars (and any rented ones) first; available cars whose rental mode doesn't fit the
    // chosen range are pushed to the end — shown, not hidden, with an "available only for X" note.
    const fits = c => c.status !== 'available' || carBuckets(c).includes(period.bucket);
    ordered = [...ordered.filter(fits), ...ordered.filter(c => !fits(c))];
  }
  return `<div class="grid">${ordered.map(c => carCard(c, manage, period)).join('')}</div>`;
}

function bindCarButtons() {
  app().querySelectorAll('[data-car]').forEach(button => button.onclick = () => openCar(button.dataset.car));
  // The WHOLE card opens the detail — a click anywhere that isn't an inner control (buttons/links) counts.
  app().querySelectorAll('[data-car-open]').forEach(article => article.addEventListener('click', event => {
    if (event.target.closest('button, a, select, input, label')) return;
    openCar(article.dataset.carOpen);
  }));
  app().querySelectorAll('[data-car-image]').forEach(image => image.addEventListener('error', () => { image.src = fallbackImage; }, {once:true}));
  app().querySelectorAll('[data-car-status]').forEach(button => button.onclick = async () => {
    button.disabled = true;
    try { await setCarStatus(button.dataset.carStatus, button.dataset.next); toast(button.dataset.next === 'rented' ? 'הרכב סומן כתפוס' : 'הרכב סומן כפנוי'); }
    catch (error) { toast(error.message); button.disabled = false; }
  });
  // Owner can edit a published car's details straight from its card in the personal area.
  app().querySelectorAll('[data-car-edit]').forEach(button => button.onclick = () => carForm({id: button.dataset.carEdit, ...store.cars[button.dataset.carEdit]}));
}

const carFilters = {make: '', model: '', year: '', category: '', availability: 'available', sort: 'new'};
function applyCarFilters(all) {
  let rows = all.filter(car => car.status !== 'hidden');
  const f = carFilters;
  if (f.availability === 'available') rows = rows.filter(car => car.status === 'available');
  if (f.make) rows = rows.filter(car => car.make === f.make);
  if (f.model) rows = rows.filter(car => car.model === f.model);
  if (f.year) rows = rows.filter(car => String(car.year || '') === f.year);
  if (f.category) rows = rows.filter(car => (car.category || '').includes(f.category));
  const sorters = {new: (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0), priceLow: (a, b) => (a.dailyPrice || 0) - (b.dailyPrice || 0), priceHigh: (a, b) => (b.dailyPrice || 0) - (a.dailyPrice || 0), rating: (a, b) => carRating(b.id) - carRating(a.id)};
  return rows.sort(sorters[f.sort] || sorters.new);
}
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
  app().innerHTML = `<div class="cars-page fleet-zone"><div class="section-head"><h1>כל הרכבים באתר</h1><span class="mut">${rows.length} רכבים</span></div>
    <div class="period-search" id="period-search">
      ${dateField('carsStart', 'תאריך איסוף', startDate)}
      <label class="hour-field"><span>שעת איסוף</span><select id="cars-start-hour">${hourOptions(startTime)}</select></label>
      ${dateField('carsEnd', 'תאריך החזרה', endDate)}
      <label class="hour-field"><span>שעת החזרה</span><select id="cars-end-hour">${hourOptions(endTime)}</select></label>
      <button type="button" class="btn gold" id="period-apply">חישוב מחיר לתאריכים</button>
    </div>
    ${periodNote}
    <div class="filter-bar" id="filter-bar">
      <select id="f-make"><option value="">כל היצרנים</option>${[...new Set(all.map(c => c.make).filter(Boolean))].sort().map(t => opt(t, t, carFilters.make)).join('')}</select>
      <select id="f-model"><option value="">כל הדגמים</option>${[...new Set(all.filter(c => !carFilters.make || c.make === carFilters.make).map(c => c.model).filter(Boolean))].sort().map(t => opt(t, t, carFilters.model)).join('')}</select>
      <select id="f-year"><option value="">כל השנים</option>${[...new Set(all.map(c => String(c.year || '')).filter(Boolean))].sort((a, b) => b - a).map(t => opt(t, t, carFilters.year)).join('')}</select>
      <select id="f-availability">${opt('available', 'זמינים כעת', carFilters.availability)}${opt('all', 'כל הרכבים', carFilters.availability)}</select>
      <select id="f-sort">${opt('new', 'מיון: החדשים ביותר', carFilters.sort)}${opt('priceLow', 'מיון: מהזול ליקר', carFilters.sort)}${opt('priceHigh', 'מיון: מהיקר לזול', carFilters.sort)}</select>
      ${(carFilters.make || carFilters.model || carFilters.year || carFilters.category || carFilters.availability !== 'available' || carFilters.sort !== 'new') ? '<button class="btn outline" id="f-clear">ניקוי</button>' : ''}
      <div class="type-chips">${['סדאן', 'SUV', 'פיקאפ', 'מיניוואן'].map(t => `<button class="type-chip ${carFilters.category === t ? 'on' : ''}" data-type-chip="${t}">${t}</button>`).join('')}</div>
    </div>
    ${carGrid(rows, false, period)}</div>`;
  bindCarButtons();
  bindDateFields();
  const rerender = () => cars();
  const bind = (id, key) => { const el = document.querySelector(id); if (el) el.onchange = () => { carFilters[key] = el.value; if (key === 'make') carFilters.model = ''; rerender(); }; };
  bind('#f-make', 'make');
  bind('#f-model', 'model');
  bind('#f-year', 'year');
  bind('#f-availability', 'availability');
  bind('#f-sort', 'sort');
  document.querySelectorAll('[data-type-chip]').forEach(chip => chip.onclick = () => { carFilters.category = carFilters.category === chip.dataset.typeChip ? '' : chip.dataset.typeChip; rerender(); });
  document.querySelector('#f-clear')?.addEventListener('click', () => { Object.assign(carFilters, {make: '', model: '', year: '', category: '', availability: 'available', sort: 'new'}); rerender(); });
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
    rerender();
  });
  document.querySelector('#period-clear')?.addEventListener('click', () => { searchPeriod.startAt = ''; searchPeriod.endAt = ''; rerender(); });
}

function openCar(id) {
  const car = {id, ...store.cars[id]};
  if (!car.id) return toast('הרכב לא נמצא');
  const photos = carPhotoList(car);
  const gallery = photos.length ? `<div class="gallery"><div class="gallery-main"><img id="gallery-img" src="${esc(photos[0])}" alt="${esc(`${car.make || ''} ${car.model || ''}`)}"></div>${photos.length > 1 || car.videoUrl ? `<div class="gallery-thumbs">${photos.map((p, i) => `<button class="thumb ${i === 0 ? 'active' : ''}" data-photo="${esc(p)}"><img src="${esc(p)}" alt="תמונה ${i + 1}"></button>`).join('')}${car.videoUrl ? `<button class="thumb thumb-video" data-video="${esc(car.videoUrl)}">▶</button>` : ''}</div>` : ''}</div>` : `<img class="modal-car-image" id="gallery-img" src="${esc(carImage(car))}" alt="${esc(car.make || '')}">`;
  const reviews = carReviews(car.id);
  const canRate = store.user && myBookings().some(b => b.carId === car.id && b.renterUid === store.user.uid && b.status === 'done');
  const rateNote = store.user && !canRate ? '<p class="rate-note">רק משתמש ששכר את הרכב בפועל יכול לדרג אותו — הדירוג נפתח מההזמנה לאחר סיום ההשכרה.</p>' : '';
  const reviewsHtml = `${reviews.length ? `<div class="reviews"><h3>ביקורות (${reviews.length})</h3>${reviews.slice(0, 8).map(r => `<div class="review"><div class="review-head"><span class="review-stars">${stars(r.score)}</span><small>${fmtDate(r.createdAt)}</small></div>${r.review ? `<p>${esc(r.review)}</p>` : ''}</div>`).join('')}</div>` : ''}${rateNote}`;
  const rented = car.status !== 'available';
  const mode = rentalModeOf(car);
  const onRequest = !!car.priceOnRequest;
  const bStart = searchPeriod.startAt ? searchPeriod.startAt.slice(0, 10) : '';
  const bEnd = searchPeriod.endAt ? searchPeriod.endAt.slice(0, 10) : '';
  const bStartH = searchPeriod.startAt ? searchPeriod.startAt.slice(11, 16) : '10:00';
  const bEndH = searchPeriod.endAt ? searchPeriod.endAt.slice(11, 16) : '10:00';
  modal(`<div class="modal-head"><h2>${esc(car.make || '')} ${esc(car.model || '')} ${esc(car.trim || '')}</h2><button class="close" data-close-modal>×</button></div>
    ${gallery}
    <div class="car-detail-head">${availPill(car.status)}${mode ? `<span class="mode-badge lg">${mode.label}</span>` : ''}${car.ownerName ? `<span class="owner-tag">בעל הרכב: ${esc(car.ownerName)}</span>` : ''}</div>
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
    ${onRequest ? '<div class="price-contact-cta"><div><b>שלחו הודעה לקבלת מחיר</b><small>המחיר נקבע מול בעל הרכב — שלחו הודעה כדי לקבל אותו.</small></div><button type="button" class="btn gold" id="price-contact">שליחת הודעה לקבלת מחיר</button></div>' : ''}
    ${reviewsHtml}
    ${rented ? '<div class="chat-closed">הרכב אינו זמין להזמנה כרגע</div>' : `<form id="booking-form"><h3>הזמנת הרכב</h3><div class="form-grid">${dateField('startDate', 'תאריך איסוף', bStart)}<div class="field"><label>שעת איסוף</label><select name="startHour">${hourOptions(bStartH)}</select></div>${dateField('endDate', 'תאריך החזרה', bEnd)}<div class="field"><label>שעת החזרה</label><select name="endHour">${hourOptions(bEndH)}</select></div></div><div class="booking-est" id="booking-est"></div><div class="field"><label>אופן קבלה</label><select name="fulfillment"><option value="pickup">איסוף עצמי</option>${car.deliveryEnabled ? '<option value="delivery">מסירה</option>' : ''}</select></div><div class="field"><label>כתובת מסירה, אם נבחרה</label><input name="deliveryAddress"></div><button class="btn primary block">שליחת בקשה</button></form>`}`);
  const galleryImg = document.querySelector('#gallery-img');
  galleryImg?.addEventListener('error', event => { event.currentTarget.src = fallbackImage; }, {once: true});
  document.querySelectorAll('[data-photo]').forEach(button => button.onclick = () => {
    galleryImg.src = button.dataset.photo;
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
    const recalc = () => {
      if (!estBox) return;
      const sd = bookingForm.querySelector('input[name="startDate"]')?.value || '';
      const ed = bookingForm.querySelector('input[name="endDate"]')?.value || '';
      const sh = bookingForm.querySelector('select[name="startHour"]')?.value || '10:00';
      const eh = bookingForm.querySelector('select[name="endHour"]')?.value || '10:00';
      if (!sd || !ed) { estBox.innerHTML = ''; return; }
      const s = new Date(`${sd}T${sh}`).getTime(), e = new Date(`${ed}T${eh}`).getTime();
      if (!(e > s)) { estBox.innerHTML = '<div class="period-note">תאריך ההחזרה חייב להיות אחרי האיסוף</div>'; return; }
      if (onRequest) { estBox.innerHTML = '<div class="period-note contact">שלחו הודעה לבעל הרכב לקבלת מחיר לטווח שבחרתם</div>'; return; }
      if (!carBuckets(car).includes(periodBucket(e - s))) {
        const only = mode ? mode.short : carBuckets(car).map(b => BUCKET_HE[b]).join(' / ');
        estBox.innerHTML = `<div class="period-note">רכב זה זמין להשכרה ${only} בלבד — לא מתאים לטווח שבחרתם</div>`;
        return;
      }
      const est = estimatePrice(car, s, e);
      estBox.innerHTML = est ? `<div class="period-est"><span>מחיר משוער</span><b>${money(est.total)}</b><small>${est.label}</small></div>` : '';
    };
    bookingForm.addEventListener('change', recalc);
    recalc();
  }
  // "שלחו הודעה לקבלת מחיר" → open the support chat so the renter can ask the price (no public price).
  document.querySelector('#price-contact')?.addEventListener('click', () => {
    if (!store.user) { closeModal(); toast('נדרשת התחברות קצרה כדי לשלוח הודעה'); location.hash = 'auth'; return; }
    closeModal();
    openChatThread(`a:${store.user.uid}`);
  });
  if (bookingForm) bookingForm.onsubmit = async event => {
    event.preventDefault();
    try {
      if (!store.user) { closeModal(); location.hash = 'auth'; return; }
      const data = formData(event.target);
      if (!data.startDate || !data.endDate) return toast('בחרו תאריך איסוף והחזרה');
      data.startAt = `${data.startDate}T${data.startHour}`;
      data.endAt = `${data.endDate}T${data.endHour}`;
      await createBooking(car, data);
      toast('ההזמנה נשלחה'); closeModal(); location.hash = 'dashboard';
    } catch (error) { toast(error.message); }
  };
}

export function authView() {
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
      <form id="login-form"><div class="field"><label>מייל</label><input name="email" type="email" autocomplete="email" required></div><div class="field"><label>סיסמה</label><input name="password" type="password" autocomplete="current-password" required></div><button class="btn primary block">כניסה</button><button type="button" class="forgot-pw" id="forgot-pw">שכחתי סיסמה</button></form>`;
    content().querySelector('#auth-back').onclick = () => modeChoice(role);
    content().querySelector('#login-form').onsubmit = async event => {
      event.preventDefault();
      const data = formData(event.target);
      try {
        const user = await login(data.email, data.password);
        // Admins may enter ONLY through the "כניסת מנהל" button at the bottom of the home page.
        if (await checkIsAdmin(user.uid)) { await logout(); return toast('זהו חשבון מנהל — יש להיכנס דרך כפתור "כניסת מנהל" בתחתית דף הבית'); }
        location.hash = 'dashboard';
      }
      catch (error) { toast(error.message); }
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
      <form id="register-form"><input type="hidden" name="role" value="${role}"><div class="field"><label>שם מלא</label><input name="name" autocomplete="name" required></div>${phoneField()}<div class="field"><label>מייל</label><input name="email" type="email" autocomplete="email" required></div><div class="field"><label>בחירת סיסמה</label><input name="password" type="password" minlength="6" autocomplete="new-password" required><small>לפחות 6 תווים, אות גדולה ואות קטנה באנגלית.</small></div><button class="btn primary block">הרשמה כ${label}</button></form>`;
    content().querySelector('#auth-back').onclick = () => modeChoice(role);
    content().querySelector('#register-form').onsubmit = async event => {
      event.preventDefault();
      const button = event.target.querySelector('button[type=submit], .btn.primary');
      const data = composePhone(formData(event.target));
      const reset = () => { if (button) { button.disabled = false; button.textContent = `הרשמה כ${label}`; } };
      if (!validEmail(data.email)) return toast('כתובת המייל אינה תקינה — בדקו שהיא בפורמט name@example.com');
      if (button) { button.disabled = true; button.textContent = 'נרשם…'; }
      try { await register(data); location.hash = 'dashboard'; }
      catch (error) { toast(error.message); reset(); }
    };
  }

  // Admin sign-in — reached from the small "כניסת מנהל" link at the bottom of the home page.
  // Just email + password; admin rights come from the account's UID being under /admins.
  function adminLoginScreen() {
    content().innerHTML = `<button class="link-back" id="auth-back">→ חזרה</button>
      <div class="auth-head"><span class="role-pill">מנהל האתר</span><h2>כניסת מנהל · Sign in</h2><p>הזינו מייל וסיסמה של חשבון המנהל</p></div>
      <form id="login-form"><div class="field"><label>מייל</label><input name="email" type="email" autocomplete="email" required></div><div class="field"><label>סיסמה</label><input name="password" type="password" autocomplete="current-password" required></div><button class="btn primary block">כניסת מנהל</button><button type="button" class="forgot-pw" id="forgot-pw">שכחתי סיסמה</button></form>`;
    content().querySelector('#auth-back').onclick = roleChoice;
    content().querySelector('#login-form').onsubmit = async event => {
      event.preventDefault();
      const data = formData(event.target);
      try { await login(data.email, data.password); location.hash = 'dashboard'; }
      catch (error) { toast(error.message); }
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
function bindDashboardTabs(renderer) {
  document.querySelectorAll('[data-dashboard-tab]').forEach(button => button.onclick = () => {
    const tab = button.dataset.dashboardTab;
    if (tab === 'chats') { location.hash = 'chats'; return; }  // full-screen messaging page
    renderer(tab);
  });
  const headAvatar = document.querySelector('[data-goto-profile]');
  if (headAvatar) headAvatar.onclick = () => renderer('profile');
}
export function dashboard() {
  if (!store.user) {
    if (!store.authSettled) { app().innerHTML = '<div class="app-loader"><div class="spinner"></div><p>טוען…</p></div>'; return; }
    location.hash = 'auth'; return;
  }
  const role = myRole();
  if (role === 'admin') adminDashboard();
  else if (role === 'owner') ownerDashboard();
  else if (role === 'renter') renterDashboard();
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
    try { await createOwnProfile({name: data.name, phone: data.phone, role: data.role}); location.hash = 'dashboard'; toast('הפרופיל נשמר!'); }
    catch (error) { toast(error.message); }
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
  const users = list(store.users).map(user => ({...user, verification: {...(user.verification || {}), status: store.verificationStatuses[user.id] || 'missing'}}));
  const bookings = myBookings();
  const cars = list(store.cars);
  const total = Object.values(store.payments).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const recentCars = cars.slice().sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 5);
  const recentBookings = bookings.slice().sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 5);
  const contents = {
    overview: `<div class="panel-head-actions"><h2>סקירה</h2><div class="chips"><button class="btn primary" data-route="chats">הודעות למשתמשים</button><button class="btn ${store.config?.maintenance?.on ? 'danger' : 'outline'}" id="maintenance-toggle">${store.config?.maintenance?.on ? 'האתר בתחזוקה — לחצו לפתיחה' : 'מצב תחזוקה'}</button><button class="btn outline" id="export-json">ייצוא JSON</button><button class="btn outline" id="legacy-migrate">העברת נתונים ישנים</button></div></div>
      <div class="field admin-search-wrap"><input id="admin-search" placeholder="🔎 חיפוש מנהל: שם, מייל, טלפון, רכב, בעל רכב, סטטוס הזמנה…" autocomplete="off"></div><div id="admin-search-results"></div>
      <div class="kpis">${kpi('money', money(total), 'תשלומים מדווחים')}${kpi('calendar', bookings.length, 'הזמנות')}${kpi('car', cars.length, 'רכבים')}${kpi('users', users.length, 'משתמשים')}</div>
      <div class="overview-grid">
        <div class="mini-panel"><div class="mini-panel-head"><h3>רכבים חדשים</h3><span>${recentCars.length} אחרונים</span></div>${recentCars.length ? recentCars.map(c => `<div class="mini-row"><b>${esc(c.make || '')} ${esc(c.model || '')}</b><span class="mut">${money(c.dailyPrice || 0)}/יום</span></div>`).join('') : '<div class="mini-row"><span class="mut">אין רכבים</span></div>'}</div>
        <div class="mini-panel"><div class="mini-panel-head"><h3>הזמנות אחרונות</h3><span>${recentBookings.length} אחרונות</span></div>${recentBookings.length ? recentBookings.map(b => { const c = store.cars[b.carId] || {}; return `<div class="mini-row"><b>${esc(c.make || 'רכב')} ${esc(c.model || '')}</b><span class="mut">${statusLabel(b.status)}</span></div>`; }).join('') : '<div class="mini-row"><span class="mut">אין הזמנות</span></div>'}</div>
      </div>`,
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
  document.querySelector('#maintenance-toggle')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const on = !store.config?.maintenance?.on;
    if (!confirm(on ? 'להעביר את האתר למצב תחזוקה? רק מנהלים יוכלו לגלוש.' : 'לפתוח את האתר לכולם? כל המבקרים יחזרו לגלישה רגילה.')) return;
    button.disabled = true;
    try { await setMaintenance(on); toast(on ? 'האתר עבר למצב תחזוקה' : 'האתר חזר למצב רגיל — פתוח לכולם'); }
    catch (error) { toast('לא ניתן לעדכן את מצב התחזוקה — יש לפרסם את חוקי ה-Firebase המעודכנים'); button.disabled = false; }
  });
  bindAdminSearch();
  if (tab === 'notifications') localStorage.setItem('cd-admin-seen', String(Date.now()));
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
  return `<div class="table-wrap"><table class="data"><thead><tr><th>שם</th><th>מייל</th><th>טלפון</th><th>תפקיד</th><th>אימות</th><th>רישיון וסלפי</th><th>השכרות</th><th>ניהול</th></tr></thead><tbody>${users.map(user => {
    const count = rentalCount(user.id);
    return `<tr class="${user.blocked ? 'row-blocked' : ''}"><td class="t-main" data-label="שם">${esc(user.name || '—')}${user.blocked ? ' <span class="pill warn">חסום</span>' : ''}</td><td data-label="מייל">${esc(user.email || '—')}</td><td data-label="טלפון">${esc(user.phone || '—')}</td><td data-label="תפקיד">${esc(roleName(user.role))}</td><td data-label="אימות"><span class="pill ${user.verification?.status === 'approved' ? 'ok' : 'warn'}">${esc(verificationLabel(user.verification?.status))}</span></td><td data-label="מסמכים"><button class="btn outline" data-admin-user="${esc(user.id)}">צפייה במסמכים</button></td><td data-label="השכרות"><button class="btn outline" data-admin-rentals="${esc(user.id)}">${count} השכרות</button></td><td data-label="ניהול"><div class="t-actions"><button class="icon-btn" title="שליחת הודעה" data-user-message="${esc(user.id)}">${ICON.chat}</button><button class="icon-btn" title="עריכה" data-user-edit="${esc(user.id)}">${ICON.edit}</button><button class="icon-btn ${user.blocked ? '' : 'danger'}" title="${user.blocked ? 'שחרור חסימה' : 'חסימה'}" data-user-block="${esc(user.id)}">${user.blocked ? ICON.check : ICON.block}</button><button class="icon-btn danger" title="מחיקה" data-user-delete="${esc(user.id)}">${ICON.trash}</button></div></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

// Admin notifications feed (new car / booking / status / payment / chat / block).
const NOTIF_ICONS = {car: ICON.car, booking: ICON.calendar, status: ICON.check, payment: ICON.money, chat: ICON.chat, block: ICON.block, user: ICON.users};
function adminUnreadCount() {
  const seen = Number(localStorage.getItem('cd-admin-seen') || 0);
  return list(store.adminNotifications).filter(n => Number(n.createdAt || 0) > seen).length;
}
function adminNotificationsView() {
  const rows = list(store.adminNotifications).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  const seen = Number(localStorage.getItem('cd-admin-seen') || 0);
  return `<h2 style="margin-bottom:16px">התראות מנהל</h2><div class="list">${rows.length ? rows.map(n => `<div class="notif-row ${Number(n.createdAt || 0) > seen ? 'unread' : ''}"><span class="notif-icon">${NOTIF_ICONS[n.type] || ICON.check}</span><div class="notif-main"><b>${esc(n.text || '')}</b><small>${fmtDate(n.createdAt)}</small></div></div>`).join('') : '<div class="empty">אין התראות עדיין — כל אירוע באתר יופיע כאן</div>'}</div>`;
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
  return `<div class="table-wrap"><table class="data"><thead><tr><th>רכב</th><th>בעל הרכב</th><th>מחיר/יום</th><th>סטטוס (לחצו)</th><th>ניהול</th></tr></thead><tbody>${featuredFirst(cars).map(car => `<tr><td class="t-main">${car.featured ? '★ ' : ''}${esc(car.make || '')} ${esc(car.model || '')} ${esc(car.year || '')}</td><td>${esc(car.ownerName || '—')}</td><td>${money(car.dailyPrice || 0)}</td><td><button type="button" class="pill-btn" data-car-avail="${esc(car.id)}" data-next="${car.status === 'rented' ? 'available' : 'rented'}" title="לחצו לשינוי תפוס / פנוי">${carStatusPill(car.status)}</button></td><td><div class="t-actions"><button class="icon-btn feat-btn ${car.featured ? 'feat-on' : ''}" title="${car.featured ? 'ביטול קידום לראש הרשימה' : 'קידום לראש הרשימה'}" data-car-feature="${esc(car.id)}" data-on="${car.featured ? '' : '1'}">★</button><button class="icon-btn" title="עריכת רכב" data-car-edit="${esc(car.id)}">${ICON.edit}</button><button class="icon-btn" title="${car.status === 'hidden' ? 'הצגת הרכב' : 'הסתרת הרכב'}" data-car-toggle="${esc(car.id)}">${ICON.eye}</button><button class="icon-btn" title="החלפת בעלים" data-car-owner="${esc(car.id)}">${ICON.key}</button><button class="icon-btn danger" title="מחיקה" data-car-delete="${esc(car.id)}">${ICON.trash}</button></div></td></tr>`).join('')}</tbody></table></div>`;
}

function bookingList(bookings, role) {
  const sorted = bookings.slice().sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return `<div class="list">${sorted.length ? sorted.map(booking => {
    const car = store.cars[booking.carId] || {};
    const ratingButtons = booking.status === 'done' ? (role === 'renter' ? `<button class="btn outline" data-rate="${booking.id}" data-rate-type="car">דרג רכב</button><button class="btn outline" data-rate="${booking.id}" data-rate-type="user">דרג בעל רכב</button>` : role === 'owner' ? `<button class="btn outline" data-rate="${booking.id}" data-rate-type="user">דרג שוכר</button>` : '') : '';
    const evidence = booking.evidence || {};
    const evidenceDone = evidence.video && evidence.fuel && evidence.odometer && store.payments[booking.id];
    return `<article class="booking-card"><div class="booking-main"><div><small>הזמנה ${esc(booking.id.slice(-7))}</small><h3>${esc(car.make || '')} ${esc(car.model || '')}</h3><p>${fmtDate(booking.startAt)} — ${fmtDate(booking.endAt)}</p></div><span class="status-badge ${esc(booking.status)}">${statusLabel(booking.status)}</span></div><div class="chips">${role === 'owner' && booking.status === 'pending' ? `<button class="btn primary" data-status="approved" data-booking="${booking.id}">אישור</button><button class="btn danger" data-status="rejected" data-booking="${booking.id}">דחייה</button>` : ''}${role === 'owner' && booking.status === 'approved' ? `<button class="btn gold ${evidenceDone ? '' : 'soft-disabled'}" data-status="active" data-booking="${booking.id}">התחלת השכרה</button>` : ''}${role === 'owner' && booking.status === 'active' ? `<button class="btn gold" data-status="done" data-booking="${booking.id}">סיום השכרה</button>` : ''}${role === 'owner' && ['pending','approved','active'].includes(booking.status) ? `<button class="btn outline" data-renter="${booking.renterUid}">פרטי שוכר</button>` : ''}${['approved','active'].includes(booking.status) ? `<button class="btn outline" data-address="${booking.id}">כתובת איסוף</button><button class="btn outline" data-chat="${booking.id}">צ׳אט</button>` : ''}${role === 'renter' && booking.status === 'active' ? `<button class="btn outline" data-handover="${booking.id}" data-stage="return">תיעוד החזרה</button>` : ''}${['owner','admin'].includes(role) && store.payments[booking.id] ? `<button class="btn outline" data-view-payment="${booking.id}">הוכחת תשלום</button>` : ''}${['owner','admin'].includes(role) && booking.handover ? `<button class="btn outline" data-view-handover="${booking.id}">צפייה בתיעוד</button>` : ''}${role === 'admin' ? `<select class="admin-status-select" data-admin-status="${booking.id}"><option value="">שינוי סטטוס…</option><option value="approved">אישור</option><option value="rejected">דחייה</option><option value="active">התחלת השכרה</option><option value="done">סיום</option><option value="cancelled">ביטול</option></select><button class="btn outline" data-admin-note="${booking.id}">הערת מנהל</button>` : ''}${ratingButtons}</div>${booking.adminNote || booking.adminAmount !== undefined ? `<p class="ev-note">הערת מנהל: ${esc(booking.adminNote || '')}${booking.adminAmount !== undefined ? ` · סכום מתוקן: ${money(booking.adminAmount)}` : ''}</p>` : ''}${role === 'renter' && booking.status === 'approved' ? `<p class="ev-note">לפני תחילת ההשכרה שלחו בצ׳אט: סרטון חוץ, תמונת דלק, קילומטראז׳ והוכחת תשלום.</p>` : ''}</article>`;
  }).join('') : '<div class="empty">אין נתונים</div>'}</div>`;
}

function bindActions() {
  document.querySelectorAll('[data-status]').forEach(button => button.onclick = async () => {
    try { await setBookingStatus(button.dataset.booking, button.dataset.status); toast('ההזמנה עודכנה'); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-chat]').forEach(button => button.onclick = () => openChatThread(`b:${button.dataset.chat}`));
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
  } catch (error) { toast(error.message); }
}

function messagesView() {
  return `<h2>מרכז הודעות</h2><p class="mut">כל השיחות מרוכזות בעמוד הצ׳אטים — כמו אפליקציית הודעות.</p><button class="btn primary" data-route="chats">מעבר לצ׳אטים</button>`;
}

// ---------- Chats page: app-like messaging (thread list + conversation) ----------
const chatState = {thread: null, unsub: null, draft: ''};
let pendingThread = null;
let adminChatActivity = null;

export function openChatThread(threadKey) {
  pendingThread = threadKey;
  if (store.route === 'chats') chatsPage();
  else location.hash = 'chats';
}

const EV_LABELS = {video: 'סרטון הרכב מבחוץ', fuel: 'תמונת דלק', odometer: 'תמונת קילומטראז׳'};
const evidenceState = (booking, bookingId) => {
  const ev = booking?.evidence || {};
  return {video: Boolean(ev.video), fuel: Boolean(ev.fuel), odometer: Boolean(ev.odometer), payment: Boolean(store.payments[bookingId])};
};

export function chatsPage() {
  if (!store.user) {
    if (!store.authSettled) { app().innerHTML = '<div class="app-loader"><div class="spinner"></div><p>טוען…</p></div>'; return; }
    location.hash = 'auth'; return;
  }
  app().innerHTML = `<div class="chat-shell" id="chat-shell">
    <aside class="chat-list">
      <div class="chat-list-head"><h2>צ׳אטים</h2>${store.isAdmin ? '<input id="chat-search" placeholder="חיפוש משתמש…" autocomplete="off">' : ''}</div>
      <div class="chat-items" id="chat-items"></div>
    </aside>
    <section class="chat-pane" id="chat-pane"><div class="chat-empty"><span class="chat-empty-ic">${ICON.chat}</span><p>בחרו שיחה מהרשימה</p></div></section>
  </div>`;
  if (store.isAdmin) ensureAdminChatFeed();
  renderChatItems();
  document.querySelector('#chat-search')?.addEventListener('input', renderChatItems);
  const wanted = pendingThread || chatState.thread;
  pendingThread = null;
  if (wanted) selectThread(wanted);
  else if (window.matchMedia('(min-width: 900px)').matches) {
    const first = document.querySelector('[data-thread]');
    if (first) selectThread(first.dataset.thread);
  }
}

// Real-time feed of every support thread, so the admin's chat list re-orders and updates
// the moment any user sends a message — not just on the first load.
let adminFeedRef = null;
function teardownAdminChatFeed() {
  if (adminFeedRef) { adminFeedRef.off(); adminFeedRef = null; }
  adminChatActivity = null;
}
function ensureAdminChatFeed() {
  if (adminFeedRef || !store.isAdmin) return;
  const ref = firebase.database().ref('messages/admin');
  adminFeedRef = ref;
  ref.on('value', snap => {
    if (!store.isAdmin) return teardownAdminChatFeed();  // e.g. after logout
    adminChatActivity = {};
    for (const [uid, msgs] of Object.entries(snap.val() || {})) {
      const times = Object.values(msgs || {}).map(m => Number(m.createdAt || 0));
      adminChatActivity[uid] = times.length ? Math.max(...times) : 0;
    }
    if (store.route === 'chats') renderChatItems();
  }, () => teardownAdminChatFeed());  // permission change / error → reset so it re-inits on next admin login
}

function chatItems() {
  if (store.isAdmin) {
    if (adminChatActivity === null) adminChatActivity = {};
    const query = (document.querySelector('#chat-search')?.value || '').trim().toLowerCase();
    return list(store.users)
      .filter(user => !query || `${user.name || ''} ${user.email || ''}`.toLowerCase().includes(query))
      .sort((a, b) => (adminChatActivity[b.id] || 0) - (adminChatActivity[a.id] || 0) || String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''), 'he'))
      .map(user => ({key: `a:${user.id}`, avatar: avatarHtml(user, 42), title: user.name || user.email || 'משתמש', subtitle: `${roleName(user.role)}${adminChatActivity[user.id] ? ' · ' + fmtDate(adminChatActivity[user.id]) : ''}`, live: true}));
  }
  const role = myRole();
  const bookingItems = myBookings()
    .filter(b => ['approved', 'active', 'done'].includes(b.status))
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
    .map(b => {
      const car = store.cars[b.carId] || {};
      return {key: `b:${b.id}`, emoji: ICON.car, title: `${car.make || 'רכב'} ${car.model || ''}`.trim(), subtitle: role === 'owner' ? 'שיחה עם השוכר' : 'שיחה עם בעל הרכב', status: b.status, live: ['approved', 'active'].includes(b.status)};
    });
  return [{key: `a:${store.user.uid}`, emoji: ICON.chat, title: 'שירות לקוחות', subtitle: 'תמיכה טכנית · מענה מהיר', live: true}, ...bookingItems];
}

function renderChatItems() {
  const box = document.querySelector('#chat-items');
  if (!box) return;
  const items = chatItems();
  box.innerHTML = items.length ? items.map(item => `<button class="chat-item ${item.key === chatState.thread ? 'active' : ''} ${item.live ? '' : 'ended'}" data-thread="${esc(item.key)}">${item.avatar || `<span class="chat-item-emoji">${item.emoji}</span>`}<span class="chat-item-main"><b>${esc(item.title)}</b><small>${esc(item.subtitle)}</small></span>${item.status ? `<span class="status-badge ${esc(item.status)}">${statusLabel(item.status)}</span>` : ''}</button>`).join('') : '<div class="empty">אין שיחות פעילות</div>';
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
  const id = key.slice(2);
  const booking = isSupport ? null : store.bookings[id];
  if (!isSupport && !booking) { pane.innerHTML = '<div class="chat-empty"><p>השיחה לא נמצאה</p></div>'; return; }
  const car = booking ? store.cars[booking.carId] || {} : {};
  const title = isSupport ? (store.isAdmin ? (store.users[id]?.name || store.users[id]?.email || 'משתמש') : 'שירות לקוחות') : `${car.make || 'רכב'} ${car.model || ''}`.trim();
  const live = isSupport || ['approved', 'active'].includes(booking.status);
  const isOwner = booking && booking.ownerUid === store.user.uid;
  const isRenter = booking && booking.renterUid === store.user.uid;
  const ev = booking ? evidenceState(booking, id) : null;
  const evReady = ev && ev.video && ev.fuel && ev.odometer && ev.payment;

  const headActions = `${booking && isOwner
    ? (booking.status === 'approved' ? `<button class="btn gold ${evReady ? '' : 'soft-disabled'}" id="rental-start">התחלת השכרה</button>`
      : booking.status === 'active' ? `<button class="btn primary" id="rental-end">סיום השכרה</button>` : '')
    : ''}${store.isAdmin ? '<button class="btn dark-out" id="chat-clear" title="מחיקת כל ההודעות">ניקוי</button>' : ''}`;
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
    : `<div class="chat-closed">ההשכרה הסתיימה — הצ׳אט פתוח רק מאישור ההזמנה ועד סיום ההשכרה</div>`;

  pane.innerHTML = `<header class="chat-head">
      <button class="chat-back" id="chat-back" aria-label="חזרה לרשימה">→</button><button class="chat-x" id="chat-close" aria-label="סגירת הצ׳אט">×</button>
      <div class="chat-head-main"><h3>${esc(title)}</h3>${booking ? `<span class="status-badge ${esc(booking.status)}">${statusLabel(booking.status)}</span>` : '<span class="pill ok">שירות לקוחות</span>'}</div>
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
      try { await sendMessage(isSupport ? {thread: 'admin', ...(store.isAdmin ? {userUid: id} : {}), text} : {bookingId: id, text}); }
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
      await sendMessage(isSupport ? {thread: 'admin', ...(store.isAdmin ? {userUid: id} : {}), text: '', attachment} : {bookingId: id, text: '', attachment});
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

  const ref = firebase.database().ref(isSupport ? `messages/admin/${id}` : `messages/${id}`).limitToLast(300);
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
    try {
      const amount = Number(event.target.amount.value);
      const path = await uploadPrivate(event.target.file.files[0], 'payment', bookingId);
      await savePayment(bookingId, {amount, mediaPath: path});
      closeModal(); toast('הוכחת התשלום נשמרה');
      await onDone?.(amount);
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
    try { const data = formData(event.target); await submitRating({bookingId, type, score: Number(data.score), review: data.review}); closeModal(); toast('הדירוג נשמר'); }
    catch (error) { toast(error.message); }
  };
}

function carForm(car = null) {
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
  function updatePriceFields() {
    // "שלחו הודעה לקבלת מחיר" hides all price fields; otherwise show the ones the rental mode needs.
    if (priceOnReq?.checked) { priceGrid.style.display = 'none'; return; }
    priceGrid.style.display = '';
    const mode = form.querySelector('input[name="rentalMode"]:checked')?.value || 'hourly_daily';
    const cfg = MODE_PRICES[mode] || MODE_PRICES.hourly_daily;
    form.querySelectorAll('#price-grid [data-price]').forEach(field => { field.style.display = cfg[field.dataset.price] ? '' : 'none'; });
  }
  form.querySelectorAll('input[name="rentalMode"]').forEach(radio => radio.addEventListener('change', updatePriceFields));
  priceOnReq?.addEventListener('change', updatePriceFields);
  updatePriceFields();

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
    data.make = make; data.model = model;
    data.photos = photos;
    data.photoUrl = mainUrl || photos[0];
    data.videoUrl = videoUrl;
    delete data.makeSelect; delete data.modelSelect;
    const submit = document.querySelector('#car-submit');
    submit.disabled = true; submit.textContent = 'שומר…';
    try {
      if (editing) await updateCar(car.id, data); else await createCar(data);
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

window.cdCloseModal = closeModal;
