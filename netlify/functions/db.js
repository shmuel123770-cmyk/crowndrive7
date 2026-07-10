const memory = globalThis.__CROWNDRIVE_MEMORY__ || (globalThis.__CROWNDRIVE_MEMORY__ = {});
exports.handler = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { action, collection, id, data, merge, where } = body;
    if (!collection && !['login','signup','resetPassword','updateAuth'].includes(action)) return json({ ok: true, localOnly: true });
    memory[collection] = memory[collection] || {};
    if (action === 'list') {
      let records = Object.entries(memory[collection]).map(([rid, rdata]) => ({ id: rid, data: rdata }));
      if (where && where.field) records = records.filter(r => {
        const v = r.data[where.field];
        if (where.op === '==') return v === where.value;
        if (where.op === 'array-contains') return Array.isArray(v) && v.includes(where.value);
        return true;
      });
      return json({ records });
    }
    if (action === 'get') return json({ record: memory[collection][id] || null });
    if (action === 'add') { const rid = collection.slice(0,2)+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,8); memory[collection][rid] = data || {}; return json({ id: rid }); }
    if (action === 'set') { memory[collection][id] = merge ? { ...(memory[collection][id]||{}), ...(data||{}) } : (data||{}); return json({ ok:true }); }
    if (action === 'update') { memory[collection][id] = { ...(memory[collection][id]||{}), ...(data||{}) }; return json({ ok:true }); }
    if (action === 'delete') { delete memory[collection][id]; return json({ ok:true }); }
    return json({ ok: true, localOnly: true });
  } catch (e) { return json({ error: e.message || String(e) }, 500); }
};
function json(obj, statusCode=200){ return { statusCode, headers:{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*'}, body:JSON.stringify(obj) }; }
