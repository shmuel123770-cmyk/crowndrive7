import {json, cleanText, parseBody} from './_firebase-admin.mjs';

// Junk that is not a clean, current exterior studio/press shot of the whole car.
const BAD = /logo|badge|emblem|icon|\bmap\b|wheel|rim|tyre|tire|interior|dashboard|cockpit|engine|seat|gauge|detail|headlamp|taillight|tail.?light|grille|mirror|\bdoor\b|assembly|gearbox|boot|trunk|sticker|wash|dirty|dirt|mud|snow|rust|rusty|damaged|crash|accident|wreck|abandoned|junk|scrap|police|taxi|toy|model.?car|diecast/i;

async function getJson(url) {
  const res = await fetch(url, {headers: {'user-agent': 'CrownDrive/2.0 (car listing image lookup)'}});
  if (!res.ok) throw new Error('image service unavailable');
  return res.json();
}

// 1) Wikipedia article lead image for "<make> <model>" — a clean, representative photo of the
//    CURRENT generation (so it reads as recent, not a random dirty street shot).
async function fromWikipedia(mk, md) {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query', titles: `${mk} ${md}`, prop: 'pageimages', piprop: 'original|thumbnail',
    pithumbsize: '1600', redirects: '1', format: 'json', origin: '*',
  }).toString();
  const data = await getJson(url);
  const page = Object.values(data.query?.pages || {}).find(p => p.original?.source || p.thumbnail?.source);
  if (!page) return null;
  const src = page.original?.source || page.thumbnail?.source;
  if (BAD.test(src)) return null;
  return {url: src, sourceUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`, attribution: 'Wikipedia', license: 'ראו מקור', title: cleanText(page.title, 200)};
}

// 2) Fallback: Wikimedia Commons search, biased to the exact model, recent years, exterior.
async function fromCommons(mk, md, yr, trim) {
  const query = [mk, md, yr, cleanText(trim, 50)].filter(Boolean).join(' ');
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: `${query} car`, gsrnamespace: '6', gsrlimit: '30',
    prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1600', format: 'json', origin: '*',
  }).toString();
  const data = await getJson(url);
  const mkL = mk.toLowerCase(), mdL = md.toLowerCase();
  const yearNum = Number(yr) || 0;
  const candidates = Object.values(data.query?.pages || {})
    .map(page => ({info: page.imageinfo?.[0], descurl: page.imageinfo?.[0]?.descriptionurl || '', title: String(page.title || '').replace(/^File:/, '')}))
    .filter(item => item.info?.thumburl && /\.(jpe?g|png)$/i.test(item.title) && !BAD.test(item.title));
  const score = item => {
    const t = item.title.toLowerCase();
    // Reward newer model years found in the filename; penalise clearly old ones.
    const ym = t.match(/\b(19|20)\d{2}\b/);
    const fileYear = ym ? Number(ym[0]) : 0;
    let recency = 0;
    if (fileYear) recency = fileYear >= 2023 ? 3 : fileYear >= 2018 ? 1 : -2;
    if (yearNum && fileYear && Math.abs(fileYear - yearNum) <= 1) recency += 3;
    return (t.includes(mkL) ? 4 : 0) + (t.includes(mdL) ? 5 : 0) + recency;
  };
  const best = candidates.map(item => ({item, s: score(item)})).sort((a, b) => b.s - a.s)[0];
  if (!best || best.s < 5) return null;  // require the model to match — never a wrong car
  const meta = best.item.info.extmetadata || {};
  return {
    url: best.item.info.thumburl, sourceUrl: best.item.descurl,
    attribution: cleanText(meta.Artist?.value?.replace(/<[^>]+>/g, '') || 'Wikimedia Commons', 300),
    license: cleanText(meta.LicenseShortName?.value || '', 100), title: cleanText(best.item.title, 200),
  };
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const body = parseBody(event);
    if (!body) return json(400, {error: 'בקשה לא תקינה — נסו שוב'});
    const {make, model, year, trim} = body;
    const mk = cleanText(make, 50), md = cleanText(model, 50), yr = cleanText(year, 4);
    if (!mk || !md) return json(400, {error: 'יש לבחור יצרן ודגם'});

    let result = null;
    try { result = await fromWikipedia(mk, md); } catch (error) { console.error('wiki lookup failed', error); }
    if (!result) { try { result = await fromCommons(mk, md, yr, trim); } catch (error) { console.error('commons lookup failed', error); } }
    if (!result) return json(404, {error: 'לא נמצאה תמונה רשמית מדויקת; אפשר להעלות תמונה או להדביק קישור'});
    return json(200, result);
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: 'שירות התמונות אינו זמין כרגע'});
  }
}
