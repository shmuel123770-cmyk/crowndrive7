const headers = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS'
};
const memory = globalThis.__crowndrive_memory || { collections: {}, auth: {} };
globalThis.__crowndrive_memory = memory;
const id = (p='id') => p+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
const ok = body => ({ statusCode: 200, headers, body: JSON.stringify({ ok:true, ...body }) });
const bad = (msg, code=400) => ({ statusCode: code, headers, body: JSON.stringify({ ok:false, error:String(msg) }) });
function col(name){ memory.collections[name] ||= {}; return memory.collections[name]; }
function applyWhere(rows, where){
  if(!where || !where.field) return rows;
  return rows.filter(r => {
    const v = (r.data||{})[where.field];
    if(where.op === '==' || !where.op) return v === where.value;
    if(where.op === 'array-contains') return Array.isArray(v) && v.includes(where.value);
    return true;
  });
}
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (!['GET','POST'].includes(event.httpMethod)) return bad('Method not allowed',405);
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const action = body.action || body.op || 'ping';
    const collection = body.collection || 'default';
    const store = col(collection);
    if(action==='ping') return ok({ mode:'local-memory-no-blobs' });
    if(action==='list') return ok({ records: applyWhere(Object.entries(store).map(([rid,data])=>({id:rid,data})), body.where) });
    if(action==='get') return ok({ record: body.id ? (store[body.id] || null) : null });
    if(action==='add') { const rid=id(collection.slice(0,2)); store[rid]=body.data||{}; return ok({ id:rid, record:store[rid] }); }
    if(action==='set') { const rid=body.id||id(collection.slice(0,2)); store[rid]=body.merge ? {...(store[rid]||{}), ...(body.data||{})} : (body.data||{}); return ok({ id:rid, record:store[rid] }); }
    if(action==='update') { if(!body.id) return bad('Missing id'); store[body.id]={...(store[body.id]||{}), ...(body.data||{})}; return ok({ id:body.id, record:store[body.id] }); }
    if(action==='delete') { if(body.id) delete store[body.id]; return ok({ id:body.id }); }
    if(action==='signup') { const email=String(body.email||'').toLowerCase(); if(!email||!body.pass) return bad('Missing email/pass'); if(memory.auth[email]) return bad('Email already exists',409); const uid=id('u'); memory.auth[email]={uid,email,pass:body.pass}; return ok({ user:{uid,email} }); }
    if(action==='login') { const email=String(body.email||'').toLowerCase(); const u=memory.auth[email]; if(!u||u.pass!==body.pass) return bad('Invalid login',401); return ok({ user:{uid:u.uid,email:u.email} }); }
    if(action==='updateAuth') { const entry=Object.values(memory.auth).find(u=>u.uid===body.uid); if(!entry) return bad('User not found',404); if(body.email){ delete memory.auth[entry.email]; entry.email=String(body.email).toLowerCase(); memory.auth[entry.email]=entry; } if(body.pass) entry.pass=body.pass; return ok({ user:{uid:entry.uid,email:entry.email} }); }
    if(action==='resetPassword') return ok({ sent:false, localOnly:true });
    return ok({ memory });
  } catch (e) { return bad(e && e.message || e, 500); }
};
