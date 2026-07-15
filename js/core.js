export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
export const money = value => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', maximumFractionDigits:0}).format(Number(value || 0));
// Date + time WITHOUT seconds ("22.7.2026, 10:00", not "…10:00:00") — seconds are noise on booking/message times.
export const fmtDate = value => value ? new Date(value).toLocaleString('he-IL', {dateStyle: 'short', timeStyle: 'short'}) : '—';
export function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 3200);
}
// Accessible modal (audit #41): role="dialog" + aria-modal, focus moves into the dialog and is trapped,
// Escape closes, focus returns to the trigger, and icon-only close buttons get an aria-label.
let _modalReturnFocus = null;
const _focusableSel = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export function modal(html) {
  _modalReturnFocus = document.activeElement;
  document.documentElement.classList.add('modal-open');  // lock the background from scrolling behind the modal
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" tabindex="-1">${html}</section></div>`;
  const section = $('#modal-root .modal');
  if (!section) return;
  section.querySelectorAll('.close, [data-close-modal]').forEach(b => { if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', 'סגירה'); });
  section.focus({preventScroll: true});
  section.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); return; }
    if (event.key !== 'Tab') return;
    const items = [...section.querySelectorAll(_focusableSel)].filter(el => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
}
export function closeModal() {
  $('#modal-root').innerHTML = '';
  document.documentElement.classList.remove('modal-open');
  const back = _modalReturnFocus; _modalReturnFocus = null;
  if (back && back.focus) { try { back.focus({preventScroll: true}); } catch {} }
}
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
  return ({pending:'ממתינה', approved:'אושרה', active:'פעילה', done:'הסתיימה', rejected:'נדחתה', cancelled:'בוטלה', expired:'פג תוקף'}[status] || (typeof status === 'string' && status) || '—');
}
export function verificationLabel(status) {
  return ({missing:'חסר', pending:'ממתין לבדיקה', approved:'מאומת', rejected:'נדחה', needs_resubmission:'נדרש צילום מחדש'}[status] || (typeof status === 'string' && status) || 'חסר');
}
export function validPassword(value) { return /[a-z]/.test(value) && /[A-Z]/.test(value) && value.length >= 6; }
// A real email: something@something.tld, no spaces, a dot in the domain.
export function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim()); }
export function validImageUrl(value) { return typeof value === 'string' && /^https:\/\//.test(value); }
export function stars(score) { return `${'★'.repeat(Math.round(score || 0))}${'☆'.repeat(5 - Math.round(score || 0))}`; }
