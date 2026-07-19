// The SINGLE source of the current terms/privacy version on the client (server twin: netlify/functions/_terms.mjs).
// Bump BOTH when the legal documents change — signed-in users are then asked to re-consent.
export const TERMS_VERSION = '2026-07-14-rev101';
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
// Hebrew number agreement. "1 רכבים" is simply wrong — a single item takes the singular, and the
// numeral is dropped because "רכב אחד" reads better than "1 רכב". Zero keeps the plural ("0 רכבים").
export const heCount = (n, one, many) => Number(n) === 1 ? `${one} אחד` : `${Number(n) || 0} ${many}`;
// Same, for feminine nouns: "הזמנה אחת", "השכרה אחת".
export const heCountF = (n, one, many) => Number(n) === 1 ? `${one} אחת` : `${Number(n) || 0} ${many}`;
export const money = value => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', maximumFractionDigits:0}).format(Number(value || 0));
// Date + time WITHOUT seconds ("22.7.2026, 10:00", not "…10:00:00") — seconds are noise on booking/message times.
export const fmtDate = value => value ? new Date(value).toLocaleString('he-IL', {dateStyle: 'short', timeStyle: 'short', timeZone: 'America/New_York'}) : '—';
export function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 3200);
}

// Give dynamically-rendered forms a dependable accessible name without requiring every template to
// hand-maintain unique ids. The helper is idempotent and also runs for lazy-loaded dashboard screens.
let _autoControlId = 0;
export function enhanceUI(root = document) {
  root.querySelectorAll?.('.field').forEach(field => {
    const label = field.querySelector(':scope > label');
    if (!label) return;
    const controls = [...field.querySelectorAll('input:not([type="hidden"]), select, textarea')];
    if (!controls.length) return;
    const text = label.textContent.trim().replace(/\s+/g, ' ');
    const primary = controls.find(control => control.style.display !== 'none') || controls[0];
    if (!primary.id) primary.id = `cd-field-${++_autoControlId}`;
    if (!label.htmlFor) label.htmlFor = primary.id;
    controls.filter(control => control !== primary && !control.getAttribute('aria-label')).forEach(control => control.setAttribute('aria-label', text));
  });
  root.querySelectorAll?.('.phone-row').forEach(group => {
    const field = group.closest('.field');
    const label = field?.querySelector(':scope > label');
    if (label) {
      if (!label.id) label.id = `cd-label-${++_autoControlId}`;
      group.setAttribute('role', 'group');
      group.setAttribute('aria-labelledby', label.id);
    }
    group.querySelector('select')?.setAttribute('aria-label', 'מדינה וקידומת');
    group.querySelector('input')?.setAttribute('aria-label', 'מספר טלפון');
  });
  root.querySelectorAll?.('.date-field').forEach(field => {
    const label = field.querySelector('.df-label');
    const button = field.querySelector('[data-date-btn]');
    if (!label || !button) return;
    if (!label.id) label.id = `cd-date-label-${++_autoControlId}`;
    button.setAttribute('aria-labelledby', label.id);
    button.setAttribute('aria-haspopup', 'dialog');
  });
}
// Inline field errors (mobile audit #36): show the message UNDER the offending field, mark it, focus it,
// and clear automatically once the user edits it. `control` may be an input/select or a date-field button.
export function fieldError(control, message) {
  if (!control) { toast(message); return; }
  const holder = control.closest('.field, .date-field') || control.parentElement;
  clearFieldError(control);
  holder.classList.add('has-error');
  const note = document.createElement('p');
  note.className = 'field-error';
  note.id = `cd-err-${++_autoControlId}`;
  note.textContent = message;
  holder.appendChild(note);
  control.setAttribute('aria-invalid', 'true');
  control.setAttribute('aria-describedby', note.id);
  try { control.scrollIntoView({block: 'center', behavior: 'smooth'}); control.focus({preventScroll: true}); } catch {}
  const clear = () => { clearFieldError(control); control.removeEventListener('input', clear); control.removeEventListener('change', clear); };
  control.addEventListener('input', clear);
  control.addEventListener('change', clear);
}
export function clearFieldError(control) {
  const holder = control?.closest?.('.field, .date-field') || control?.parentElement;
  holder?.classList?.remove('has-error');
  holder?.querySelectorAll?.('.field-error').forEach(n => n.remove());
  control?.removeAttribute?.('aria-invalid');
}
// Accessible modal (audit #41): role="dialog" + aria-modal, focus moves into the dialog and is trapped,
// Escape closes, focus returns to the trigger, and icon-only close buttons get an aria-label.
let _modalReturnFocus = null;
const _focusableSel = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export function modal(html) {
  _modalReturnFocus = document.activeElement;
  // Android/browser BACK closes the modal instead of leaving the page (mobile audit #11): opening a modal
  // pushes one marked history entry (not stacked for modal-over-modal); popstate with a modal open = close it.
  // UI closes (X / Escape / backdrop) tear down the DOM only and leave the entry — the next Back consumes it
  // invisibly, so programmatic `closeModal(); location.hash=…` flows are never raced by an async history.back().
  if (!history.state?.cdModal) { try { history.pushState({cdModal: true}, ''); } catch {} }
  document.documentElement.classList.add('modal-open');  // lock the background from scrolling behind the modal
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" tabindex="-1">${html}</section></div>`;
  const section = $('#modal-root .modal');
  if (!section) return;
  const heading = section.querySelector('h1, h2, h3');
  if (heading) {
    if (!heading.id) heading.id = `cd-modal-title-${++_autoControlId}`;
    section.setAttribute('aria-labelledby', heading.id);
  } else section.setAttribute('aria-label', 'חלון מידע');
  section.querySelectorAll('.close, [data-close-modal]').forEach(b => { if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', 'סגירה'); });
  enhanceUI(section);
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
  $('#modal-root .modal')?.dispatchEvent(new CustomEvent('cd:modal-close'));
  $('#modal-root').innerHTML = '';
  document.documentElement.classList.remove('modal-open');
  const back = _modalReturnFocus; _modalReturnFocus = null;
  if (back && back.focus) { try { back.focus({preventScroll: true}); } catch {} }
}
// BACK pressed while a modal is open → close the modal (the pushed entry was just consumed). With no modal
// open this is either a stale modal entry (ignore — nothing visible happens) or a real hash navigation,
// which the router's hashchange listener handles on its own.
if (typeof window !== 'undefined') window.addEventListener('popstate', () => { if ($('#modal-root .modal')) closeModal(); });
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
// Unknown statuses map to a NEUTRAL label — never echoed back raw, since several screens interpolate
// the label into HTML (audit #19 stored-XSS defense; the server also whitelists on write).
export function statusLabel(status) {
  return ({pending:'ממתינה', approved:'אושרה', active:'פעילה', done:'הסתיימה', rejected:'נדחתה', cancelled:'בוטלה', expired:'פג תוקף'}[status] || '—');
}
export function verificationLabel(status) {
  return ({missing:'חסר', pending:'ממתין לבדיקה', approved:'מאומת', rejected:'נדחה', needs_resubmission:'נדרש צילום מחדש'}[status] || 'חסר');
}
export function validPassword(value) { return String(value || '').length >= 6; }
// A real email: something@something.tld, no spaces, a dot in the domain.
export function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim()); }
export function validImageUrl(value) { return typeof value === 'string' && /^https:\/\//.test(value); }
export function stars(score) { return `${'★'.repeat(Math.round(score || 0))}${'☆'.repeat(5 - Math.round(score || 0))}`; }
