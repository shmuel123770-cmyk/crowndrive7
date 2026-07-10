const headers = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
let memory = globalThis.__crowndrive_memory || { collections: {} };
globalThis.__crowndrive_memory = memory;
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const action = body.action || body.op || 'ping';
    const col = body.collection || 'default';
    memory.collections[col] ||= {};
    if (action === 'ping') return { statusCode: 200, headers, body: JSON.stringify({ ok: true, mode: 'memory' }) };
    if (action === 'list') return { statusCode: 200, headers, body: JSON.stringify({ ok: true, items: Object.entries(memory.collections[col]).map(([id,data])=>({ id, ...data })) }) };
    if (action === 'get') return { statusCode: 200, headers, body: JSON.stringify({ ok: true, item: memory.collections[col][body.id] || null }) };
    if (action === 'set' || action === 'save') { memory.collections[col][body.id || Date.now().toString()] = body.data || body.item || {}; return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }; }
    if (action === 'delete') { delete memory.collections[col][body.id]; return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }; }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, memory }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: String(e && e.message || e) }) };
  }
};
