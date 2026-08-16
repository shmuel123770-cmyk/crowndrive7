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

// ---------------------------------------------------------------------------------------------
// Voice notes and documents. Same principle as the image sniffer above: the DECLARED content type
// arrives from the client and can say anything, so the real type comes from the leading bytes.
//
// Audio is deliberately narrow — the two containers a browser MediaRecorder actually produces
// (WebM/Opus on Chrome and Android, MP4/AAC on Safari and iOS), plus Ogg and the two formats a
// person is likely to attach from their phone's files. Documents are PDF only: it is what people
// send for a licence, an insurance page or a rental agreement, and every other office format is a
// zip container that would need unpacking to know what is really inside it.
function sniffMedia(b) {
  if (b.length < 12) return null;
  const ascii = (from, to) => b.toString('ascii', from, to);
  if (ascii(0, 4) === '%PDF') return 'application/pdf';
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'audio/webm';   // EBML (WebM/Matroska)
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(0, 3) === 'ID3' || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) return 'audio/mpeg';
  // ISO-BMFF: '....ftyp<brand>'. Safari's MediaRecorder writes M4A/MP4 audio here. A brand check
  // keeps a VIDEO mp4 from arriving through the audio door and being played as a voice note.
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (['M4A ', 'M4B ', 'mp42', 'isom', 'iso2', 'mp41'].includes(brand)) return 'audio/mp4';
  }
  return null;
}

// The true type for a voice note or a document, or '' when the bytes are neither. Kept separate
// from detectedImageType so an image endpoint can never accidentally start accepting audio.
export function detectedMediaType(buffer) {
  return sniffMedia(buffer) || '';
}
export const AUDIO_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp4']);
export const DOC_TYPES = new Set(['application/pdf']);
