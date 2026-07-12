import {json, cleanText} from './_firebase-admin.mjs';

// Reject crops/details that are not a clean exterior shot of the whole car.
const BAD = /logo|badge|emblem|icon|map|wheel|rim|tyre|tire|interior|dashboard|cockpit|engine|seat|gauge|detail|headlamp|taillight|tail.?light|grille|mirror|\bdoor\b|assembly|gearbox|boot|trunk|sticker/i;
// Prefer official-looking exterior / press angles.
const GOOD = /front|exterior|side|three.?quarter|3.?4|frontal|profile|press/i;

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const {make, model, year, trim} = JSON.parse(event.body || '{}');
    const mk = cleanText(make, 50), md = cleanText(model, 50), yr = cleanText(year, 4);
    if (!mk || !md) return json(400, {error: 'יש לבחור יצרן ודגם'});

    // Query the exact manufacturer + model (+ year/trim). The make+model phrase is the
    // dominant ranking signal so we surface the real car, not a random look-alike.
    const query = [mk, md, yr, cleanText(trim, 50)].filter(Boolean).join(' ');
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query', generator: 'search', gsrsearch: `${query} car`, gsrnamespace: '6', gsrlimit: '24',
      prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1600', format: 'json', origin: '*',
    }).toString();
    const response = await fetch(url, {headers: {'user-agent': 'CrownDrive/2.0 image lookup'}});
    if (!response.ok) throw new Error('שירות התמונות לא זמין');
    const data = await response.json();

    const mkL = mk.toLowerCase(), mdL = md.toLowerCase();
    const candidates = Object.values(data.query?.pages || {})
      .map(page => ({info: page.imageinfo?.[0], descurl: page.imageinfo?.[0]?.descriptionurl || '', title: String(page.title || '').replace(/^File:/, '')}))
      .filter(item => item.info?.thumburl && /\.(jpe?g|png)$/i.test(item.title) && !BAD.test(item.title));
    // Score: model match is essential; make + year + exterior angle are bonuses.
    const score = item => {
      const t = item.title.toLowerCase();
      return (t.includes(mkL) ? 4 : 0) + (t.includes(mdL) ? 5 : 0) + (yr && t.includes(yr) ? 3 : 0) + (GOOD.test(t) ? 2 : 0);
    };
    const best = candidates.map(item => ({item, s: score(item)})).sort((a, b) => b.s - a.s)[0];
    // Require at least the model to appear (score >= 5) so we never hand back the wrong car.
    if (!best || best.s < 5) return json(404, {error: 'לא נמצאה תמונה רשמית מדויקת; אפשר להעלות תמונה או להדביק קישור'});

    const image = best.item;
    const meta = image.info.extmetadata || {};
    return json(200, {
      url: image.info.thumburl,
      sourceUrl: image.descurl,
      attribution: cleanText(meta.Artist?.value?.replace(/<[^>]+>/g, '') || 'Wikimedia Commons', 300),
      license: cleanText(meta.LicenseShortName?.value || '', 100),
      title: cleanText(image.title, 200),
    });
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
