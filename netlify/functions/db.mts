import { getConnectionString } from "@netlify/database";
import pg from "pg";
import crypto from "crypto";

const { Pool } = pg;
let pool: any = null;
function getPool() {
  if (pool) return pool;
  const connectionString = getConnectionString();
  pool = new Pool({ connectionString });
  return pool;
}

// חובה להגדיר ב-Netlify Environment variables:
// ADMIN_EMAIL=...
// ADMIN_PASS=...
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
const ADMIN_PASS = process.env.ADMIN_PASS || "";
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);

const headers = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "Content-Type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(data: unknown, statusCode = 200) {
  return { statusCode, headers, body: JSON.stringify(data ?? {}) };
}
function bad(message: string, statusCode = 400) { return json({ error: message }, statusCode); }
function id(prefix = "id") { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`; }
function sha(s: string) { return crypto.createHash("sha256").update(s).digest("hex"); }
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

async function ensureTables() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS crown_records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(collection, id)
    );
    CREATE TABLE IF NOT EXISTS crown_auth (
      uid TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      pass TEXT,
      pass_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS crown_sessions (
      token_hash TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await getPool().query(`ALTER TABLE crown_auth ADD COLUMN IF NOT EXISTS pass_hash TEXT;`);

  if (ADMIN_EMAIL && ADMIN_PASS) {
    await getPool().query(
      `INSERT INTO crown_auth(uid,email,pass,pass_hash)
       VALUES($1,$2,NULL,$3)
       ON CONFLICT(email) DO UPDATE SET uid=EXCLUDED.uid, pass=NULL, pass_hash=EXCLUDED.pass_hash, updated_at=NOW()`,
      ["admin", ADMIN_EMAIL, hashPassword(ADMIN_PASS)]
    );
    await getPool().query(
      `INSERT INTO crown_records(collection,id,data)
       VALUES('users','admin',$1::jsonb)
       ON CONFLICT(collection,id) DO UPDATE SET data=crown_records.data || EXCLUDED.data, updated_at=NOW()`,
      [JSON.stringify({ name: "מנהל האתר", role: "admin", email: ADMIN_EMAIL, createdAt: Date.now() })]
    );
  }
}

async function getRecord(collection: string, rid: string) {
  const { rows } = await getPool().query(`SELECT id, data FROM crown_records WHERE collection=$1 AND id=$2`, [collection, rid]);
  return rows[0] || null;
}
async function getUser(uid: string) {
  const r = await getRecord("users", uid);
  return r ? { id: uid, ...(r.data || {}) } : { id: uid, role: "renter" };
}
async function createSession(uid: string) {
  const token = crypto.randomBytes(32).toString("hex");
  await getPool().query(
    `INSERT INTO crown_sessions(token_hash,uid,expires_at)
     VALUES($1,$2,NOW()+($3 || ' days')::interval)`,
    [sha(token), uid, String(SESSION_DAYS)]
  );
  return token;
}
async function authFromToken(token?: string) {
  if (!token) return null;
  const { rows } = await getPool().query(
    `SELECT uid FROM crown_sessions WHERE token_hash=$1 AND expires_at>NOW() LIMIT 1`,
    [sha(String(token))]
  );
  if (!rows[0]) return null;
  const u = await getUser(rows[0].uid);
  return { uid: rows[0].uid, role: u.role || "renter", email: u.email || "", name: u.name || "" };
}
function isAdmin(auth: any) { return auth && auth.role === "admin"; }
function participant(data: any, uid: string) {
  return data && (data.ownerId === uid || data.renterId === uid || data.uid === uid || data.userId === uid || (Array.isArray(data.participants) && data.participants.includes(uid)));
}
function sanitizeUser(id: string, data: any, auth: any) {
  if (isAdmin(auth) || (auth && auth.uid === id)) return data || {};
  // מידע ציבורי בלבד — בלי טלפון, רישיון, כתובת, סיסמה או פרטי תשלום.
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
  if (collection === "users") {
    if (rid !== auth.uid) return false;
    if (data?.role === "admin") return false;
    return true;
  }
  if (collection === "private") return rid === auth.uid;
  if (collection === "cars") {
    const ownerId = existing?.ownerId || data?.ownerId;
    return ownerId === auth.uid;
  }
  if (collection === "bookings") {
    const p = existing || data;
    return participant(p, auth.uid);
  }
  if (collection === "messages") {
    const p = existing || data;
    return participant(p, auth.uid);
  }
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
    await getPool().query(`INSERT INTO crown_records(collection,id,data) VALUES('email_queue',$1,$2::jsonb)`, [id("em"), JSON.stringify({ to: recipients, subject, html, text, status: "missing_smtp_env", createdAt: Date.now() })]);
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
    if (event.httpMethod !== "POST") return bad("POST only", 405);
    await ensureTables();
    let body: any = {};
    try { body = event.body ? JSON.parse(event.body) : {}; } catch { return bad("Invalid JSON"); }
    const action = body.action;
    const collection = String(body.collection || "");
    const rid = String(body.id || "");
    const auth = await authFromToken(body.token);

    try {
    if (action === "list") {
      let rows: any[] = [];
      if (body.where && body.where.field) {
        const field = String(body.where.field);
        const op = String(body.where.op || "==");
        const value = body.where.value;
        if (op === "array-contains") {
          const q = await getPool().query(`SELECT id,data FROM crown_records WHERE collection=$1 AND (data -> $2) @> $3::jsonb ORDER BY updated_at DESC`, [collection, field, JSON.stringify([value])]);
          rows = q.rows;
        } else {
          const q = await getPool().query(`SELECT id,data FROM crown_records WHERE collection=$1 AND data ->> $2 = $3 ORDER BY updated_at DESC`, [collection, field, String(value)]);
          rows = q.rows;
        }
      } else {
        const q = await getPool().query(`SELECT id,data FROM crown_records WHERE collection=$1 ORDER BY updated_at DESC`, [collection]);
        rows = q.rows;
      }
      const allowed = rows.filter((r: any) => canRead(collection, r.id, r.data, auth));
      return json({ records: allowed.map((r: any) => ({ id: r.id, data: publicData(collection, r.id, r.data, auth) })) });
    }

    if (action === "get") {
      const r = await getRecord(collection, rid);
      if (!r) return json({ record: null });
      if (!canRead(collection, rid, r.data, auth)) return bad("Forbidden", 403);
      return json({ record: publicData(collection, rid, r.data, auth) });
    }

    if (action === "add") {
      const data = body.data || {};
      if (!canWrite(collection, "", data, auth)) return bad("Forbidden", 403);
      const newId = id(collection.slice(0, 3) || "rec");
      await getPool().query(`INSERT INTO crown_records(collection,id,data) VALUES($1,$2,$3::jsonb)`, [collection, newId, JSON.stringify(data)]);
      return json({ id: newId });
    }

    if (action === "set" || action === "update") {
      const data = body.data || {};
      const existing = await getRecord(collection, rid);
      if (!canWrite(collection, rid, data, auth, existing?.data)) return bad("Forbidden", 403);
      if (action === "set" && !body.merge) {
        await getPool().query(`INSERT INTO crown_records(collection,id,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(collection,id) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()`, [collection, rid, JSON.stringify(data)]);
      } else {
        await getPool().query(`INSERT INTO crown_records(collection,id,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(collection,id) DO UPDATE SET data=crown_records.data || EXCLUDED.data, updated_at=NOW()`, [collection, rid, JSON.stringify(data)]);
      }
      return json({ ok: true });
    }

    if (action === "delete") {
      const existing = await getRecord(collection, rid);
      if (!existing || !canWrite(collection, rid, {}, auth, existing.data)) return bad("Forbidden", 403);
      await getPool().query(`DELETE FROM crown_records WHERE collection=$1 AND id=$2`, [collection, rid]);
      return json({ ok: true });
    }

    if (action === "signup") {
      const email = String(body.email || "").toLowerCase().trim();
      const pass = String(body.pass || "");
      if (!email || !pass) return bad("Missing email/password");
      if (pass.length < 6) return bad("Password too short");
      const uid = id("u");
      await getPool().query(`INSERT INTO crown_auth(uid,email,pass,pass_hash) VALUES($1,$2,NULL,$3)`, [uid, email, hashPassword(pass)]);
      const token = await createSession(uid);
      return json({ user: { uid, email }, token });
    }

    if (action === "login") {
      const email = String(body.email || "").toLowerCase().trim();
      const pass = String(body.pass || "");
      const { rows } = await getPool().query(`SELECT uid,email,pass,pass_hash FROM crown_auth WHERE email=$1 LIMIT 1`, [email]);
      const u = rows[0];
      if (!u) return bad("Invalid login", 401);
      const ok = verifyPassword(pass, u.pass_hash) || (!!u.pass && u.pass === pass);
      if (!ok) return bad("Invalid login", 401);
      if (!u.pass_hash || u.pass) await getPool().query(`UPDATE crown_auth SET pass=NULL, pass_hash=$1, updated_at=NOW() WHERE uid=$2`, [hashPassword(pass), u.uid]);
      const token = await createSession(u.uid);
      return json({ user: { uid: u.uid, email: u.email }, token });
    }

    if (action === "logout") {
      if (body.token) await getPool().query(`DELETE FROM crown_sessions WHERE token_hash=$1`, [sha(String(body.token))]);
      return json({ ok: true });
    }

    if (action === "updateAuth") {
      if (!auth) return bad("Forbidden", 403);
      const uid = String(body.uid || "");
      if (!uid || (uid !== auth.uid && !isAdmin(auth))) return bad("Forbidden", 403);
      if (body.email) await getPool().query(`UPDATE crown_auth SET email=$1, updated_at=NOW() WHERE uid=$2`, [String(body.email).toLowerCase().trim(), uid]);
      if (body.pass) await getPool().query(`UPDATE crown_auth SET pass=NULL, pass_hash=$1, updated_at=NOW() WHERE uid=$2`, [hashPassword(String(body.pass)), uid]);
      return json({ ok: true });
    }

    if (action === "sendEmail") {
      if (!auth) return bad("Forbidden", 403);
      const to = body.to;
      const subject = String(body.subject || "Crown Drive");
      const html = String(body.html || "");
      const text = body.text ? String(body.text) : undefined;
      if (!to || !subject || !html) return bad("Missing email fields");
      const result = await sendEmailMessage(to, subject, html, text);
      return json(result);
    }

    if (action === "resetPassword") {
      const email = String(body.email || "").toLowerCase().trim();
      if (email) await getPool().query(`INSERT INTO crown_records(collection,id,data) VALUES('password_resets',$1,$2::jsonb)`, [id("pw"), JSON.stringify({ email, createdAt: Date.now(), status: "requested" })]);
      return json({ ok: true, message: "Password reset request saved." });
    }

    return bad("Unknown action");
    } catch (e: any) {
      const msg = e && e.code === "23505" ? "Email already exists" : (e?.message || String(e));
      return bad(msg, 500);
    }
  } catch (e: any) {
    // Always return valid JSON so Netlify will not show a Lambda 502 / invalid response.
    const msg = e?.message || String(e || "Unknown server error");
    return json({ error: "שגיאת שרת במסד הנתונים", details: msg }, 500);
  }
};
