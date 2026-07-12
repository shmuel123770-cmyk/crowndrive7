import {json, cleanText} from './_firebase-admin.mjs';
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed'});
    const {make, model, year, trim} = JSON.parse(event.body || '{}');
    const query = [cleanText(make, 50), cleanText(model, 50), cleanText(year, 4), cleanText(trim, 50), 'automobile'].filter(Boolean).join(' ');
    if (!make || !model) return json(400, {error: 'יש לבחור יצרן ודגם'});
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query', generator: 'search', gsrsearch: query, gsrnamespace: '6', gsrlimit: '8',
      prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1400', format: 'json', origin: '*',
    }).toString();
    const response = await fetch(url, {headers: {'user-agent': 'CrownDrive/2.0 image lookup'}});
    if (!response.ok) throw new Error('שירות התמונות לא זמין');
    const data = await response.json();
    const pages = Object.values(data.query?.pages || {});
    const image = pages.map(page => ({page, info: page.imageinfo?.[0]})).find(item => item.info?.thumburl && !/logo|badge|icon|map/i.test(item.page.title || ''));
    if (!image) return json(404, {error: 'לא נמצאה תמונה מתאימה; אפשר להוסיף קישור ידנית'});
    const meta = image.info.extmetadata || {};
    return json(200, {
      url: image.info.thumburl,
      sourceUrl: image.info.descriptionurl || '',
      attribution: cleanText(meta.Artist?.value?.replace(/<[^>]+>/g, '') || 'Wikimedia Commons', 300),
      license: cleanText(meta.LicenseShortName?.value || '', 100),
      title: cleanText(image.page.title?.replace(/^File:/, '') || '', 200),
    });
  } catch (error) {
    console.error(error);
    return json(error.status || 500, {error: error.message});
  }
}
