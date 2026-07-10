const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

const STORE_NAME = 'crowndrive-data';
const DB_KEY = 'main-db-v1';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: JSON.stringify(body || {})
  };
}

function newId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function hashPass(pass) {
  return crypto.createHash('sha256').update(String(pass || '')).digest('hex');
}

async function loadDb() {
  const store = getStore(STORE_NAME);
  const data = await store.get(DB_KEY, { type: 'json' });
  return data && typeof data === 'object' ? data : { collections: {}, auth: {} };
}

async function saveDb(db) {
  const store = getStore(STORE_NAME);
  await store.setJSON(DB_KEY, db);
}

function ensureCollection(db, name) {
  if (!db.collections) db.collections = {};
  if (!db.collections[name]) db.collections[name] = {};
  return db.collections[name];
}

function publicUser(authUser) {
  return authUser ? { uid: authUser.uid, email: authUser.email } : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid JSON' });
  }

  const action = body.action;
  if (!action) return json(400, { error: 'Missing action' });

  try {
    const db = await loadDb();
    db.auth = db.auth || {};

    if (action === 'signup') {
      const email = String(body.email || '').trim().toLowerCase();
      const pass = String(body.pass || '');
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(400, { error: 'מייל לא תקין' });
      if (pass.length < 6) return json(400, { error: 'סיסמה חייבת לפחות 6 תווים' });
      const exists = Object.values(db.auth).some(u => u.email === email);
      if (exists) return json(409, { error: 'המייל כבר רשום במערכת' });
      const uid = newId('u');
      db.auth[uid] = { uid, email, passHash: hashPass(pass), createdAt: Date.now(), updatedAt: Date.now() };
      await saveDb(db);
      return json(200, { user: publicUser(db.auth[uid]) });
    }

    if (action === 'login') {
      const email = String(body.email || '').trim().toLowerCase();
      const passHash = hashPass(body.pass || '');
      const user = Object.values(db.auth).find(u => u.email === email && u.passHash === passHash);
      if (!user) return json(401, { error: 'מייל או סיסמה לא נכונים' });
      return json(200, { user: publicUser(user) });
    }

    if (action === 'resetPassword') {
      // אין כאן שליחת מייל אמיתית. שינוי סיסמה נעשה מתוך החשבון לאחר כניסה.
      return json(200, { ok: true });
    }

    if (action === 'updateAuth') {
      const uid = String(body.uid || '');
      const user = db.auth[uid];
      if (!user) return json(404, { error: 'משתמש לא נמצא' });
      if (body.email) {
        const email = String(body.email).trim().toLowerCase();
        const exists = Object.values(db.auth).some(u => u.email === email && u.uid !== uid);
        if (exists) return json(409, { error: 'המייל החדש כבר רשום במערכת' });
        user.email = email;
      }
      if (body.pass) user.passHash = hashPass(body.pass);
      user.updatedAt = Date.now();
      await saveDb(db);
      return json(200, { user: publicUser(user) });
    }

    const collectionName = String(body.collection || '').trim();
    if (!collectionName) return json(400, { error: 'Missing collection' });
    const col = ensureCollection(db, collectionName);

    if (action === 'get') {
      const id = String(body.id || '');
      return json(200, { record: col[id] ? { ...col[id] } : null });
    }

    if (action === 'set') {
      const id = String(body.id || '');
      if (!id) return json(400, { error: 'Missing id' });
      const prev = col[id] || {};
      col[id] = body.merge ? { ...prev, ...(body.data || {}) } : { ...(body.data || {}) };
      await saveDb(db);
      return json(200, { ok: true, id });
    }

    if (action === 'update') {
      const id = String(body.id || '');
      if (!id) return json(400, { error: 'Missing id' });
      col[id] = { ...(col[id] || {}), ...(body.data || {}) };
      await saveDb(db);
      return json(200, { ok: true, id });
    }

    if (action === 'delete') {
      const id = String(body.id || '');
      delete col[id];
      await saveDb(db);
      return json(200, { ok: true, id });
    }

    if (action === 'add') {
      const id = newId(collectionName.slice(0, 2) || 'r');
      col[id] = { ...(body.data || {}) };
      await saveDb(db);
      return json(200, { ok: true, id });
    }

    if (action === 'list') {
      let records = Object.entries(col).map(([id, data]) => ({ id, data: { ...data } }));
      const where = body.where;
      if (where && where.field) {
        const field = where.field;
        const op = where.op || '==';
        const value = where.value;
        records = records.filter(r => {
          const v = r.data ? r.data[field] : undefined;
          if (op === 'array-contains') return Array.isArray(v) && v.includes(value);
          if (op === '==') return v === value;
          return false;
        });
      }
      records.sort((a, b) => (b.data.updatedAt || b.data.createdAt || 0) - (a.data.updatedAt || a.data.createdAt || 0));
      return json(200, { records });
    }

    return json(400, { error: 'Unknown action: ' + action });
  } catch (e) {
    console.error(e);
    return json(500, { error: e && e.message ? e.message : 'Server error' });
  }
};
