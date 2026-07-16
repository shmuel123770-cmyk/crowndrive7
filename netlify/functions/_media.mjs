// Real image validation for the inline data: URLs the app stores. Instead of trusting the declared
// MIME (which a client can forge) or the file extension, we DECODE the base64 and check the actual
// magic bytes. This rejects non-images and files disguised as images — notably SVG, which can carry
// scripts — and enforces a byte budget. Returns the cleaned value, or throws a 400-style error.
//
// Note on EXIF: the client re-encodes every upload through a <canvas> before sending, which already
// strips EXIF/GPS metadata from license & selfie photos (canvas export keeps only pixels).

function badImage(msg) { return Object.assign(new Error(msg), {status: 400}); }

// Identify the true image type from the first bytes; returns null if it's not a supported image.
function sniff(buffer) {
  const b = buffer;
  if (b.length < 12) return null;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 && b[4] === 0x0D && b[5] === 0x0A) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// Validate one image data URL. maxBytes is the DECODED size cap (default ~1MB, matching the DB rules).
export function validateImageDataUrl(value, maxBytes = 1000000) {
  const s = String(value || '');
  const match = /^data:image\/(?:jpeg|jpg|png|gif|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(s);
  if (!match) throw badImage('נדרשת תמונה תקינה (JPEG/PNG/WebP)');
  let buffer;
  try { buffer = Buffer.from(match[1].replace(/\s+/g, ''), 'base64'); }
  catch { throw badImage('קובץ התמונה פגום'); }
  if (buffer.length < 12) throw badImage('קובץ התמונה פגום');
  if (buffer.length > maxBytes) throw badImage(`התמונה גדולה מדי — עד ${Math.round((maxBytes / 1e6) * 10) / 10}MB`);
  if (!sniff(buffer)) throw badImage('הקובץ אינו תמונה תקינה');
  return s;
}

// Convenience: validate only if the value is a data: URL (legacy storage paths pass through untouched).
export function validateIfDataUrl(value, maxBytes = 1000000) {
  return /^data:/i.test(String(value || '')) ? validateImageDataUrl(value, maxBytes) : value;
}

// The TRUE content type from the magic bytes — for callers that hold raw bytes (media-upload,
// media-migrate) and must never trust a declared MIME. Returns '' when it's not a supported image.
export function detectedImageType(buffer) {
  return {jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp'}[sniff(buffer)] || '';
}
