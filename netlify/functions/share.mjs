import {getAdmin} from './_firebase-admin.mjs';

// Share card: WhatsApp/Facebook crawlers don't run JS, so a shared SPA link always previews the
// generic site image. This endpoint serves a tiny per-car HTML page whose OG tags carry the CAR'S
// photo, name and price — the crawler reads those — and instantly forwards real visitors to the
// car's deep link (#car=<id>). Public data only (publicCars mirror — hidden cars never resolve).
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const SITE = 'https://crowndrive770.com';

export async function handler(event) {
  try {
    const carId = String(event.queryStringParameters?.car || '').slice(0, 100);
    let car = null;
    if (carId && !/[.#$\[\]\/]/.test(carId)) {
      car = (await getAdmin().database().ref(`publicCars/${carId}`).once('value')).val();
    }
    const title = car ? `${car.make || ''} ${car.model || ''}${car.year ? ' · ' + car.year : ''} · Crown Drive`.trim() : 'Crown Drive · השכרת רכבים · קראון הייטס';
    const desc = car
      ? [car.dailyPrice ? `$${car.dailyPrice} ליום` : '', car.priceHourly ? `$${car.priceHourly} לשעה` : '', 'השכרה בקראון הייטס, ברוקלין'].filter(Boolean).join(' · ')
      : 'השכרת רכבים בקראון הייטס, ברוקלין — הזמנה פשוטה ומאובטחת.';
    const image = car && /^https:\/\//.test(String(car.photoUrl || '')) ? car.photoUrl : `${SITE}/icons/og-ad.jpg`;
    const target = car ? `${SITE}/#car=${encodeURIComponent(carId)}` : SITE;
    const body = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="Crown Drive"><meta property="og:locale" content="he_IL">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}"><meta property="og:url" content="${esc(target)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0;url=${esc(target)}"></head>
<body><a href="${esc(target)}">${esc(title)}</a></body></html>`;
    return {statusCode: 200, headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300'}, body};
  } catch (error) {
    console.error('share card failed', error);
    return {statusCode: 302, headers: {location: SITE}, body: ''};
  }
}
