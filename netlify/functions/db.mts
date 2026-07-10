import { getStore } from "@netlify/blobs";
import crypto from "crypto";

const STORE_NAME = "crowndrive-data";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "shmuel123770@icloud.com").toLowerCase().trim();
const ADMIN_PASS = process.env.ADMIN_PASS || "amarZ770@";
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);

const headers = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "Content-Type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "cache-control": "no-store",
};

function json(data: unknown, statusCode = 200) {
  return { statusCode, headers, body: JSON.stringify(data ?? {}) };
}
function bad(message: string, statusCode = 400, extra: any = {}) { return json({ ok: false, error: message, ...extra }, statusCode); }
function sha(s: string) { return crypto.createHash("sha256").update(String(s)).digest("hex"); }
function id(prefix = "id") { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`; }
function cleanCollection(s: string) { return String(s || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80); }
function recKey(collection: string, rid: string) { return `records/${cleanCollection(collection)}/${encodeURIComponent(rid)}`; }
function authEmailKey(email: string) { return `auth/email/${sha(String(email).toLowerCase().trim())}`; }
function authUidKey(uid: string) { return `auth/uid/${encodeURIComponent(uid)}`; }
function sessionKey(tokenHash: string) { return `sessions/${tokenHash}`; }
function store() { return getStore({ name: STORE_NAME, consistency: "strong" }); }

function hashPassword(pass: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(pass, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(pass: string, stored?: string | null) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, key] = stored.split(":");
  const test = crypto.scryptSync(pass, salt, 64);
  const real = Buffer.from(key, "hex");
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}

async function getJSON<T=any>(key: string): Promise<T | null> {
  return await store().get(key, { type: "json", consistency: "strong" }) as any;
}
async function setJSON(key: string, value: any) {
  await store().setJSON(key, value, { metadata: { updatedAt: String(Date.now()) } });
}
async function deleteKey(key: string) { await store().delete(key); }

async function getRecord(collection: string, rid: string) {
  const entry = await getJSON<any>(recKey(collection, rid));
  if (!entry) return null;
  return { id: rid, data: entry.data || {}, updated_at: entry.updated_at || 0 };
}
async function setRecord(collection: string, rid: string, data: any, merge = false) {
  const existing = merge ? await getRecord(collection, rid) : null;
  const next = merge ? { ...(existing?.data || {}), ...(data || {}) } : (data || {});
  await setJSON(recKey(collection, rid), { id: rid, data: next, updated_at: Date.now() });
  return next;
}
async function listRecords(collection: string) {
  const prefix = `records/${cleanCollection(collection)}/`;
  const { blobs } = await store().list({ prefix });
  const rows: any[] = [];
  for (const b of blobs || []) {
    try {
      const entry = await getJSON<any>(b.key);
      if (!entry) continue;
      const rid = decodeURIComponent(String(b.key).slice(prefix.length));
      rows.push({ id: entry.id || rid, data: entry.data || {}, updated_at: entry.updated_at || 0 });
    } catch {}
  }
  rows.sort((a,b)=>(b.updated_at||0)-(a.updated_at||0));
  return rows;
}

async function setAuthUser(uid: string, email: string, passHash: string) {
  const cleanEmail = String(email).toLowerCase().trim();
  const user = { uid, email: cleanEmail, pass_hash: passHash, updated_at: Date.now() };
  await setJSON(authEmailKey(cleanEmail), user);
  await setJSON(authUidKey(uid), { uid, email: cleanEmail, updated_at: Date.now() });
}
async function getAuthByEmail(email: string) { return await getJSON<any>(authEmailKey(String(email).toLowerCase().trim())); }
async function getAuthByUid(uid: string) {
  const u = await getJSON<any>(authUidKey(uid));
  if (!u?.email) return null;
  return await getAuthByEmail(u.email);
}
async function updateAuth(uid: string, fields: any) {
  const current = await getAuthByUid(uid);
  if (!current) return false;
  const nextEmail = fields.email ? String(fields.email).toLowerCase().trim() : current.email;
  const nextHash = fields.pass ? hashPassword(String(fields.pass)) : current.pass_hash;
  await setAuthUser(uid, nextEmail, nextHash);
  if (nextEmail !== current.email) await deleteKey(authEmailKey(current.email)).catch(()=>null);
  return true;
}

async function bumpCar(carId: string) {
  // Requirement: any activity linked to a car bumps it to the top. Merge-only
  // update of updatedAt so no other car data is touched. Runs server-side so
  // renters (who cannot write cars) still trigger the bump on booking/chat.
  if (!carId) return;
  try {
    const existing = await getRecord("cars", carId);
    if (existing) await setRecord("cars", carId, { updatedAt: Date.now() }, true);
  } catch {}
}

async function getUser(uid: string) {
  const r = await getRecord("users", uid);
  return r ? { id: uid, ...(r.data || {}) } : { id: uid, role: "renter" };
}
async function ensureAdmin() {
  if (!ADMIN_EMAIL || !ADMIN_PASS) return;
  await setAuthUser("admin", ADMIN_EMAIL, hashPassword(ADMIN_PASS));
  await setRecord("users", "admin", { name: "מנהל האתר", role: "admin", email: ADMIN_EMAIL, createdAt: Date.now(), engine: "blobs-stable" }, true);
}
async function createSession(uid: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha(token);
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await setJSON(sessionKey(tokenHash), { uid, createdAt: Date.now(), expiresAt });
  return token;
}
async function authFromToken(token?: string) {
  if (!token) return null;
  const s = await getJSON<any>(sessionKey(sha(String(token))));
  if (!s || !s.uid || (s.expiresAt && s.expiresAt < Date.now())) return null;
  const u = await getUser(s.uid);
  return { uid: s.uid, role: u.role || "renter", email: u.email || "", name: u.name || "" };
}
function isAdmin(auth: any) { return auth && auth.role === "admin"; }
function participant(data: any, uid: string) {
  return data && (data.ownerId === uid || data.renterId === uid || data.uid === uid || data.userId === uid || (Array.isArray(data.participants) && data.participants.includes(uid)));
}
function sanitizeUser(id: string, data: any, auth: any) {
  if (isAdmin(auth) || (auth && auth.uid === id)) return data || {};
  return { name: data?.name || "משתמש", role: data?.role || "renter", createdAt: data?.createdAt || null };
}
function canRead(collection: string, rid: string, data: any, auth: any) {
  if (isAdmin(auth)) return true;
  if (["cars", "ratings"].includes(collection)) return true;
  if (collection === "users") return true;
  if (!auth) return false;
  if (collection === "private") return rid === auth.uid;
  if (["bookings", "messages"].includes(collection)) return participant(data, auth.uid);
  return participant(data, auth.uid);
}
function canWrite(collection: string, rid: string, data: any, auth: any, existing?: any) {
  if (!auth) return false;
  if (isAdmin(auth)) return true;
  if (collection === "users") return rid === auth.uid && data?.role !== "admin";
  if (collection === "private") return rid === auth.uid;
  if (collection === "cars") return (existing?.ownerId || data?.ownerId) === auth.uid;
  if (["bookings", "messages"].includes(collection)) return participant(existing || data, auth.uid);
  if (collection === "ratings") return data?.raterId === auth.uid || data?.uid === auth.uid || participant(data, auth.uid);
  return false;
}
function publicData(collection: string, rid: string, data: any, auth: any) {
  if (collection === "users") return sanitizeUser(rid, data, auth);
  return data || {};
}

async function sendEmailMessage(to: string | string[], subject: string, html: string, text?: string) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (!recipients.length) return { ok: false, skipped: true, reason: "missing recipients" };
  const from = process.env.SMTP_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER || "Crown Drive <no-reply@crowndrive770.com>";
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT || 587);
  if (!host || !user || !pass) {
    await setRecord("email_queue", id("em"), { to: recipients, subject, html, text, status: "missing_smtp_env", createdAt: Date.now() }, false);
    return { ok: true, queued: true, warning: "Missing SMTP variables" };
  }
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  await transporter.sendMail({ from, to: recipients.join(","), subject, html, text: text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
  return { ok: true, sent: recipients.length };
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === "OPTIONS") return json({ ok: true });
    if (event.httpMethod === "GET") {
      await ensureAdmin();
      return json({ ok: true, function: "db", engine: "netlify-blobs", message: "CrownDrive stable backend is alive" });
    }
    if (event.httpMethod !== "POST") return bad("POST only", 405);
    await ensureAdmin();
    let body: any = {};
    try { body = event.body ? JSON.parse(event.body) : {}; } catch { return bad("Invalid JSON"); }
    const action = String(body.action || "");
    const collection = cleanCollection(body.collection || "");
    const rid = String(body.id || "");
    const auth = await authFromToken(body.token);

    if (action === "list") {
      let rows = await listRecords(collection);
      if (body.where && body.where.field) {
        const field = String(body.where.field);
        const op = String(body.where.op || "==");
        const value = body.where.value;
        rows = rows.filter((r:any) => {
          const v = r.data?.[field];
          if (op === "array-contains") return Array.isArray(v) && v.includes(value);
          return String(v ?? "") === String(value ?? "");
        });
      }
      rows = rows.filter((r:any)=>canRead(collection, r.id, r.data, auth));
      return json({ ok: true, records: rows.map((r:any)=>({ id: r.id, data: publicData(collection, r.id, r.data, auth) })) });
    }

    if (action === "get") {
      const r = await getRecord(collection, rid);
      if (!r) return json({ ok: true, record: null });
      if (!canRead(collection, rid, r.data, auth)) return bad("Forbidden", 403);
      return json({ ok: true, record: publicData(collection, rid, r.data, auth) });
    }

    if (action === "add") {
      const data = { ...(body.data || {}) };
      if (!canWrite(collection, "", data, auth)) return bad("Forbidden", 403);
      if (collection === "cars") data.updatedAt = Date.now();
      const newId = id(collection.slice(0, 3) || "rec");
      await setRecord(collection, newId, data, false);
      // Bump the related car to the top on new booking / new chat message about it.
      if ((collection === "bookings" || collection === "messages") && data.carId) await bumpCar(String(data.carId));
      return json({ ok: true, id: newId });
    }

    if (action === "set" || action === "update") {
      const data = { ...(body.data || {}) };
      const existing = await getRecord(collection, rid);
      if (!canWrite(collection, rid, data, auth, existing?.data)) return bad("Forbidden", 403);
      if (collection === "cars") data.updatedAt = Date.now();
      await setRecord(collection, rid, data, action !== "set" || !!body.merge);
      return json({ ok: true });
    }

    if (action === "delete") {
      const existing = await getRecord(collection, rid);
      if (!existing || !canWrite(collection, rid, {}, auth, existing.data)) return bad("Forbidden", 403);
      await deleteKey(recKey(collection, rid));
      return json({ ok: true });
    }

    if (action === "signup") {
      const email = String(body.email || "").toLowerCase().trim();
      const pass = String(body.pass || "");
      if (!email || !pass) return bad("Missing email/password");
      if (pass.length < 6) return bad("Password too short");
      if (await getAuthByEmail(email)) return bad("Email already exists", 409);
      const uid = id("u");
      await setAuthUser(uid, email, hashPassword(pass));
      const token = await createSession(uid);
      return json({ ok: true, user: { uid, email }, token });
    }

    if (action === "login") {
      const email = String(body.email || "").toLowerCase().trim();
      const pass = String(body.pass || "");
      if (email === ADMIN_EMAIL && pass === ADMIN_PASS) {
        await ensureAdmin();
        const token = await createSession("admin");
        return json({ ok: true, user: { uid: "admin", email: ADMIN_EMAIL, role: "admin" }, token });
      }
      const u = await getAuthByEmail(email);
      if (!u) return bad("Invalid login", 401);
      const ok = verifyPassword(pass, u.pass_hash) || (!!u.pass && u.pass === pass);
      if (!ok) return bad("Invalid login", 401);
      if (!u.pass_hash || u.pass) await setAuthUser(u.uid, u.email, hashPassword(pass));
      const token = await createSession(u.uid);
      return json({ ok: true, user: { uid: u.uid, email: u.email }, token });
    }

    if (action === "logout") {
      if (body.token) await deleteKey(sessionKey(sha(String(body.token)))).catch(()=>null);
      return json({ ok: true });
    }

    if (action === "updateAuth") {
      if (!auth) return bad("Forbidden", 403);
      const uid = String(body.uid || "");
      if (!uid || (uid !== auth.uid && !isAdmin(auth))) return bad("Forbidden", 403);
      await updateAuth(uid, { email: body.email, pass: body.pass });
      return json({ ok: true });
    }

    if (action === "sendEmail") {
      if (!auth) return bad("Forbidden", 403);
      const result = await sendEmailMessage(body.to, String(body.subject || "Crown Drive"), String(body.html || ""), body.text ? String(body.text) : undefined);
      return json({ ok: true, ...result });
    }

    if (action === "resetPassword") {
      const email = String(body.email || "").toLowerCase().trim();
      if (email) await setRecord("password_resets", id("pw"), { email, createdAt: Date.now(), status: "requested" }, false);
      return json({ ok: true, message: "Password reset request saved." });
    }

    return bad("Unknown action");
  } catch (e: any) {
    const msg = e?.message || String(e || "Unknown server error");
    return json({ ok: false, function: "db", engine: "netlify-blobs", error: "BACKEND_ERROR", details: msg }, 500);
  }
};
