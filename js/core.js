export const $=(s,r=document)=>r.querySelector(s);
export const $$=(s,r=document)=>[...r.querySelectorAll(s)];
export const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':'&quot;'}[c]));
export const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n||0));
export const uid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const now=()=>Date.now();
export const fmtDate=v=>v?new Date(v).toLocaleString('he-IL'):'—';
export function toast(msg){const e=$('#toast');if(!e)return;clearTimeout(toast._t);e.textContent=String(msg||'אירעה שגיאה');e.classList.add('show');toast._t=setTimeout(()=>e.classList.remove('show'),3200)}
export function modal(html){const root=$('#modal-root');root.innerHTML=`<div class="modal-backdrop" role="presentation"><section class="modal" role="dialog" aria-modal="true">${html}</section></div>`;document.body.classList.add('modal-open');requestAnimationFrame(()=>root.querySelector('button,input,select,textarea,a')?.focus())}
export function closeModal(){const root=$('#modal-root');if(root)root.innerHTML='';document.body.classList.remove('modal-open')}
export async function withBusy(target,fn){const button=target?.querySelector?.('button[type=submit],button:not([type])')||target;const previous=button?.textContent;if(button){button.disabled=true;button.setAttribute('aria-busy','true');if(previous)button.textContent='טוען…'}try{return await fn()}finally{if(button){button.disabled=false;button.removeAttribute('aria-busy');if(previous)button.textContent=previous}}}
export function formData(form){return Object.fromEntries(new FormData(form).entries())}
export function statusLabel(s){return ({pending:'ממתינה',approved:'אושרה',active:'פעילה',done:'הסתיימה',rejected:'נדחתה',cancelled:'בוטלה'}[s]||s||'—')}
export function validPassword(v){return /[a-z]/.test(v)&&/[A-Z]/.test(v)&&v.length>=6}
export function validImageUrl(v){return typeof v==='string'&&/^https?:\/\//.test(v)}
