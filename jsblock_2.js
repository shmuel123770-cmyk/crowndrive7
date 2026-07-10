
(function(){
  'use strict';
  window.CROWNDRIVE_MOBILE_ADMIN_UPGRADE='v1-mobile-admin-control';
  function now(){return Date.now()}
  function userList(){
    const m=new Map();
    Object.entries(state.users||{}).forEach(([id,u])=>{ if(u) m.set(id,{id,...u}); });
    (state.owners||[]).forEach(u=>{ if(u&&u.id) m.set(u.id,{...(m.get(u.id)||{}),...u,role:'owner'}); });
    (state.renters||[]).forEach(u=>{ if(u&&u.id) m.set(u.id,{...(m.get(u.id)||{}),...u,role:'renter'}); });
    if(state.session&&state.session.role==='admin') m.set(state.session.id||'admin',{id:state.session.id||'admin',name:state.session.name||'מנהל האתר',email:state.session.email||'',role:'admin',...(m.get(state.session.id||'admin')||{})});
    return Array.from(m.values()).sort((a,b)=>(+(b.updatedAt||b.createdAt||0))-(+(a.updatedAt||a.createdAt||0)));
  }
  function uidLabel(u){return esc((u&&u.id)||'')}
  function roleLabel(r){return r==='admin'?'מנהל':r==='owner'?'בעל רכב':'שוכר'}
  window.isUserBlocked=function(idOrEmail){
    const email=normalizeEmail(idOrEmail||'');
    const u=(state.users&&state.users[idOrEmail]) || userList().find(x=>x.id===idOrEmail || normalizeEmail(x.email)===email);
    return !!(u && (u.blocked || u.status==='blocked'));
  };
  function syncUserRecord(id, patch){
    if(!id)return;
    state.users=state.users||{};
    state.users[id]={...(state.users[id]||{}),...patch,updatedAt:now()};
    [state.owners,state.renters].forEach(arr=>safeArr(arr).forEach(u=>{ if(u&&u.id===id) Object.assign(u,patch,{updatedAt:now()}); }));
  }
  window.adminToggleUserBlock=function(id){
    const u=userList().find(x=>x.id===id); if(!u)return;
    if(u.role==='admin'){safeToast('לא ניתן לחסום מנהל');return;}
    const blocked=!isUserBlocked(id);
    syncUserRecord(id,{blocked,status:blocked?'blocked':'active',blockedAt:blocked?now():null});
    persistState(); renderAdminDashboard(); safeToast(blocked?'המשתמש נחסם':'החסימה הוסרה');
  };
  window.adminEditUser=function(id){
    const u=userList().find(x=>x.id===id); if(!u)return;
    const name=prompt('שם המשתמש',u.name||''); if(name===null)return;
    const phone=prompt('טלפון',u.phone||''); if(phone===null)return;
    const role=prompt('תפקיד: owner / renter / admin',u.role||'renter'); if(role===null)return;
    const cleanRole=['owner','renter','admin'].includes(role)?role:(u.role||'renter');
    syncUserRecord(id,{name:name.trim(),phone:phone.trim(),role:cleanRole});
    if(cleanRole==='owner' && !state.owners.some(x=>x.id===id)) state.owners.push({id,name:name.trim(),phone:phone.trim(),email:u.email||'',createdAt:u.createdAt||now()});
    if(cleanRole==='renter' && !state.renters.some(x=>x.id===id)) state.renters.push({id,name:name.trim(),phone:phone.trim(),email:u.email||'',createdAt:u.createdAt||now()});
    persistState(); renderAdminDashboard(); safeToast('פרטי המשתמש עודכנו');
  };
  window.adminDeleteUser=function(id){
    const u=userList().find(x=>x.id===id); if(!u)return;
    if(u.role==='admin'){safeToast('לא ניתן למחוק מנהל');return;}
    const hasCars=state.cars.some(c=>c.ownerId===id), hasBookings=state.bookings.some(b=>b.ownerId===id||b.renterId===id);
    const msg='למחוק משתמש '+(u.email||u.name||id)+'?'+(hasCars||hasBookings?'\n\nיש לו רכבים/הזמנות. מומלץ לחסום במקום למחוק. להמשיך?':'');
    if(!confirm(msg))return;
    delete state.users[id];
    state.owners=state.owners.filter(x=>x.id!==id); state.renters=state.renters.filter(x=>x.id!==id);
    if(state.session&&state.session.id===id) state.session=null;
    persistState(); renderAdminDashboard(); renderNav(); renderMyAreaFab(); safeToast('המשתמש נמחק מהרשימות המקומיות');
  };
  window.adminViewUser=function(id){
    const u=userList().find(x=>x.id===id); if(!u)return;
    const data={user:u,cars:state.cars.filter(c=>c.ownerId===id),bookings:state.bookings.filter(b=>b.ownerId===id||b.renterId===id),messages:state.msgs.filter(m=>m.uid===id || (Array.isArray(m.participants)&&m.participants.includes(id)))};
    alert(JSON.stringify(data,null,2).slice(0,5000));
  };
  window.adminQuickEditCar=function(id){
    const c=state.cars.find(x=>x.id===id); if(!c)return;
    const price=prompt('מחיר יומי / מחיר ראשי',c.priceDaily||c.price||''); if(price===null)return;
    const status=prompt('סטטוס: available / rented / soon',c.status||'available'); if(status===null)return;
    const ret=prompt('טקסט זמינות / חזרה',c.ret||''); if(ret===null)return;
    c.priceDaily=price; c.price=price; c.status=['available','rented','soon'].includes(status)?status:c.status; c.ret=ret; c.updatedAt=now();
    persistState(); render(); renderAdminDashboard(); safeToast('הרכב עודכן');
  };
  window.adminChangeCarOwner=function(id){
    const c=state.cars.find(x=>x.id===id); if(!c)return;
    const owners=userList().filter(u=>u.role==='owner');
    const email=prompt('העבר לבעל רכב לפי מייל:\n'+owners.map(o=>o.email||o.id).join('\n'), '');
    if(!email)return;
    const o=owners.find(x=>normalizeEmail(x.email)===normalizeEmail(email) || x.id===email.trim());
    if(!o){safeToast('לא נמצא בעל רכב כזה');return;}
    c.ownerId=o.id; c.updatedAt=now(); persistState(); render(); renderAdminDashboard(); safeToast('הרכב הועבר לבעל רכב אחר');
  };
  window.adminSetBookingStatusPrompt=function(id){
    const b=state.bookings.find(x=>x.id===id); if(!b)return;
    const st=prompt('סטטוס הזמנה: pending / approved / rejected / done',b.status||'pending'); if(!st)return;
    if(!['pending','approved','rejected','done'].includes(st)){safeToast('סטטוס לא תקין');return;}
    adminSetBooking(id,st);
  };
  window.adminQuickEditBooking=function(id){
    const b=state.bookings.find(x=>x.id===id); if(!b)return;
    const total=prompt('סכום ההזמנה',b.total||''); if(total===null)return;
    const note=prompt('הערת מנהל להזמנה',b.adminNote||''); if(note===null)return;
    b.total=+total||b.total; b.adminNote=note; b.updatedAt=now(); persistState(); renderAdminDashboard(); safeToast('ההזמנה עודכנה');
  };
  window.adminUsersHTML=function(){
    const list=userList();
    if(!list.length)return '<div class="adm-empty">אין משתמשים רשומים עדיין.</div>';
    const card=(u)=>`<div class="admin-user-card"><div class="admin-card-top"><div><b>${esc(u.name||u.email||'משתמש')}</b><div class="admin-card-meta">${esc(u.email||'אין מייל')}<br>ID: ${uidLabel(u)}<br>${esc(u.phone||'אין טלפון')}</div></div><span class="status-chip ${isUserBlocked(u.id)?'blocked':'ok'}">${isUserBlocked(u.id)?'חסום':'פעיל'} · ${roleLabel(u.role)}</span></div><div class="admin-action-row"><button class="mini gold" onclick="adminViewUser('${u.id}')">כל המידע</button><button class="mini" onclick="adminEditUser('${u.id}')">עריכה</button><button class="mini ${isUserBlocked(u.id)?'gold':'danger'}" onclick="adminToggleUserBlock('${u.id}')">${isUserBlocked(u.id)?'שחרור חסימה':'חסימה'}</button><button class="mini danger" onclick="adminDeleteUser('${u.id}')">מחיקה</button></div></div>`;
    const rows=list.map(u=>`<tr><td><b>${esc(u.name||'')}</b><div class="sm">ID: ${uidLabel(u)}</div></td><td>${roleLabel(u.role)}</td><td>${esc(u.email||'')}</td><td>${esc(u.phone||'')}</td><td>${isUserBlocked(u.id)?'<span class="badge-status rejected">חסום</span>':'<span class="badge-status approved">פעיל</span>'}</td><td class="num">${state.cars.filter(c=>c.ownerId===u.id).length}</td><td class="num">${state.bookings.filter(b=>b.ownerId===u.id||b.renterId===u.id).length}</td><td><button class="mini gold" onclick="adminViewUser('${u.id}')">מידע</button> <button class="mini" onclick="adminEditUser('${u.id}')">עריכה</button> <button class="mini ${isUserBlocked(u.id)?'gold':'danger'}" onclick="adminToggleUserBlock('${u.id}')">${isUserBlocked(u.id)?'שחרור':'חסימה'}</button> <button class="mini danger" onclick="adminDeleteUser('${u.id}')">מחיקה</button></td></tr>`).join('');
    return `<div class="mobile-only-list">${list.map(card).join('')}</div><div class="desktop-table-wrap"><table class="tbl"><thead><tr><th>שם</th><th>תפקיד</th><th>מייל</th><th>טלפון</th><th>סטטוס</th><th>רכבים</th><th>הזמנות</th><th>שליטה</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  };
  window.adminFullUsersHTML=window.adminUsersHTML;
  window.adminCarsHTML=function(){
    if(!state.cars.length)return '<div class="adm-empty">אין רכבים באתר.</div>';
    const card=(c)=>{const o=userOf(c.ownerId)||{};const s=statusInfo(c);return `<div class="admin-car-card"><div class="admin-card-top"><div><b>${esc(c.make)} ${esc(c.model)} ${esc(c.yr||'')}</b><div class="admin-card-meta">משכיר: ${esc(o.name||o.email||c.ownerId||'')}<br>${esc(c.cat||'')} · ${esc(c.seats||'')} מושבים · ${rateSummary(c)||money(primaryRate(c))}</div></div><span class="status-chip info">${s.txt}</span></div><div class="admin-action-row"><button class="mini" onclick="adminToggleCar('${c.id}')">${c.status==='available'?'סימון כמושכר':'סימון כזמין'}</button><button class="mini gold" onclick="adminQuickEditCar('${c.id}')">עריכה מהירה</button><button class="mini" onclick="adminChangeCarOwner('${c.id}')">החלפת בעלים</button><button class="mini danger" onclick="adminDeleteCar('${c.id}')">הסרה</button></div></div>`};
    const rows=state.cars.map(c=>{const o=userOf(c.ownerId)||{};const s=statusInfo(c);return `<tr><td><b>${esc(c.make)} ${esc(c.model)} ${esc(c.yr||'')}</b><div class="sm">${esc(c.color||'')} · ${esc(c.cat||'')} · ${esc(c.seats||'')} מושבים</div></td><td>${esc(o.name||o.email||c.ownerId||'')}</td><td>${rentalTypesOf(c).map(rentalLabel).join(' / ')||'—'}</td><td class="num">${rateSummary(c)||money(primaryRate(c))}</td><td><span class="pill ${s.cls}" style="font-size:.62rem;padding:1px 8px">${s.txt}</span><div class="sm">${esc(c.ret||'זמין עכשיו / לא הוגדר')}</div></td><td><button class="mini" onclick="adminToggleCar('${c.id}')">${c.status==='available'?'מושכר':'זמין'}</button><button class="mini gold" onclick="adminQuickEditCar('${c.id}')">עריכה</button><button class="mini" onclick="adminChangeCarOwner('${c.id}')">בעלים</button><button class="mini danger" onclick="adminDeleteCar('${c.id}')">הסרה</button></td></tr>`}).join('');
    return `<div class="mobile-only-list">${state.cars.map(card).join('')}</div><div class="desktop-table-wrap"><table class="tbl"><thead><tr><th>רכב</th><th>משכיר</th><th>סוג השכרה</th><th>מחירים</th><th>סטטוס וזמינות</th><th>שליטה</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  };
  const oldAdminBookingsTable=window.adminBookingsTable;
  window.adminBookingsTable=function(list=allBookingsSorted()){
    if(!list.length)return '<div class="adm-empty">אין עדיין השכרות באתר.</div>';
    const cards=list.map(b=>{const c=state.cars.find(x=>x.id===b.carId)||{make:'—',model:''};const o=userOf(b.ownerId)||{};return `<div class="admin-booking-card"><div class="admin-card-top"><div><b>${esc(b.num||'הזמנה')}</b><div class="admin-card-meta">${esc(c.make)} ${esc(c.model)}<br>שוכר: ${esc(b.signName||b.renterName||'')} · משכיר: ${esc(o.name||'')}<br>${fmt(b.from)} ${esc(b.tmFrom||'')} → ${fmt(b.to)} ${esc(b.tmTo||'')}</div></div>${bookingStatusHTML(b)}</div><div class="admin-action-row"><button class="mini gold" onclick="openChatTo('b${b.id}')">צ׳אט</button><button class="mini" onclick="adminSetBookingStatusPrompt('${b.id}')">סטטוס</button><button class="mini" onclick="adminQuickEditBooking('${b.id}')">עריכה</button><button class="mini danger" onclick="adminDeleteBooking('${b.id}')">מחיקה</button></div></div>`;}).join('');
    return `<div class="mobile-only-list">${cards}</div><div class="desktop-table-wrap">${oldAdminBookingsTable?oldAdminBookingsTable(list):''}</div>`;
  };
  const oldAdminOverview=window.adminOverviewHTML;
  window.adminOverviewHTML=function(){
    const blocked=userList().filter(u=>isUserBlocked(u.id)).length;
    return adminKPIs()+`<div class="admin-actions-bar"><div><b>מרכז שליטה מלא</b><br><span>צפייה ועריכה של משתמשים, רכבים, השכרות, צ׳אטים וגיבוי — מותאם למובייל.</span></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-gold" onclick="setAdminTab('users')">ניהול משתמשים</button><button class="btn btn-out" onclick="setAdminTab('cars')">ניהול רכבים</button><button class="btn btn-out" onclick="setAdminTab('bookings')">ניהול השכרות</button></div></div><div class="admin-section-grid"><div class="admin-mini-card"><b>${userList().length}</b><span>משתמשים רשומים</span></div><div class="admin-mini-card"><b>${blocked}</b><span>משתמשים חסומים</span></div><div class="admin-mini-card"><b>${state.cars.length}</b><span>רכבים באתר</span></div><div class="admin-mini-card"><b>${state.bookings.length}</b><span>השכרות באתר</span></div></div><div class="admin-overview-grid"><div class="admin-panel"><h4>השכרות אחרונות</h4>${adminBookingsTable(allBookingsSorted().slice(0,8))}</div><div class="admin-panel"><h4>משתמשים אחרונים</h4>${adminUsersHTML()}</div></div>`;
  };
  window.renderAdminDashboard=function(){
    const box=document.getElementById('admin-body'); if(!box)return;
    const note='<div class="admin-mobile-note">מובייל ראשון: כל השליטה זמינה בכרטיסים נוחים; בדסקטופ יש גם טבלאות רחבות.</div>';
    if(adminTab==='all') box.innerHTML=note+adminOverviewHTML();
    if(adminTab==='bookings') box.innerHTML=note+adminKPIs()+`<div class="admin-panel"><h4>כל ההשכרות באתר</h4>${adminBookingsTable()}</div>`;
    if(adminTab==='chats') box.innerHTML=note+adminKPIs()+`<div class="admin-panel"><h4>כל הצ׳אטים באתר</h4>${adminChatsHTML()}</div>`;
    if(adminTab==='cars') box.innerHTML=note+adminKPIs()+`<div class="admin-panel"><h4>ניהול כל הרכבים באתר</h4>${adminCarsHTML()}</div>`;
    if(adminTab==='users') box.innerHTML=note+adminKPIs()+`<div class="admin-panel"><h4>שליטה במשתמשים</h4>${adminUsersHTML()}</div>`;
    if(adminTab==='data') box.innerHTML=note+adminKPIs()+`<div class="admin-panel"><h4>גישה מלאה וייצוא מידע</h4>${adminDataHTML()}</div>`;
  };
  const oldAfterLogin=window.afterLoginUI;
  window.afterLoginUI=function(){
    const s=state.session;
    if(s && s.role!=='admin' && isUserBlocked(s.id||s.email)){
      state.session=null; persistState(); renderNav(); renderMyAreaFab(); closeOv('ov-auth'); safeToast('החשבון חסום. פנה למנהל המערכת.'); return;
    }
    return oldAfterLogin.apply(this,arguments);
  };
  const oldSaveCar=window.saveCar;
  window.saveCar=function(){
    if(state.session && isUserBlocked(state.session.id)){safeToast('החשבון חסום ואין אפשרות לפרסם רכב');return;}
    return oldSaveCar.apply(this,arguments);
  };
  const oldOpenBook=window.openBook;
  if(oldOpenBook){window.openBook=function(c){ if(state.session && isUserBlocked(state.session.id)){safeToast('החשבון חסום ואין אפשרות לבצע הזמנה');return;} return oldOpenBook.apply(this,arguments); };}
  // Keep header tidy after this upgrade.
  try{renderNav(); renderMyAreaFab(); if(document.getElementById('ov-admin')&&document.getElementById('ov-admin').classList.contains('open')) renderAdminDashboard();}catch(e){console.warn('mobile admin upgrade post-render failed',e)}
})();
