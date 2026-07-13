export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
export const money = value => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', maximumFractionDigits:0}).format(Number(value || 0));
export const fmtDate = value => value ? new Date(value).toLocaleString('he-IL') : '—';
export function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 3200);
}
export function modal(html) { $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal">${html}</section></div>`; }
export function closeModal() { $('#modal-root').innerHTML = ''; }
// Paint #app only when the HTML actually changed. The Firebase listeners (cars/ratings/config/auth…)
// resolve over ~1–2s and each used to fully rebuild the DOM — the "whole site flashes 5 times" on load.
// paintApp() diffs the new HTML against what's on screen and touches the DOM only when it differs.
// Returns true if it painted (caller should (re)bind), false if nothing changed (keep DOM + handlers).
let _paintedHTML = null;
export function paintApp(html) {
  const el = $('#app');
  if (el && _paintedHTML === html && el.innerHTML) return false;
  _paintedHTML = html;
  if (el) el.innerHTML = html;
  return true;
}
// Views that write #app directly (dashboard/chats/auth/loaders/maintenance) call this so the memo can't
// later skip a repaint when we return to a memoized page.
export function resetPaint() { _paintedHTML = null; }
export function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
export function statusLabel(status) {
  return ({pending:'ממתינה', approved:'אושרה', active:'פעילה', done:'הסתיימה', rejected:'נדחתה', cancelled:'בוטלה'}[status] || (typeof status === 'string' && status) || '—');
}
export function verificationLabel(status) {
  return ({missing:'חסר', pending:'ממתין לבדיקה', approved:'מאומת', rejected:'נדחה', needs_resubmission:'נדרש צילום מחדש'}[status] || (typeof status === 'string' && status) || 'חסר');
}
export function validPassword(value) { return /[a-z]/.test(value) && /[A-Z]/.test(value) && value.length >= 6; }
// A real email: something@something.tld, no spaces, a dot in the domain.
export function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim()); }
export function validImageUrl(value) { return typeof value === 'string' && /^https:\/\//.test(value); }
export function stars(score) { return `${'★'.repeat(Math.round(score || 0))}${'☆'.repeat(5 - Math.round(score || 0))}`; }
