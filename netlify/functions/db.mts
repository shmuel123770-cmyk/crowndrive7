import { getConnectionString } from "@netlify/database";
import pg from "pg";
import crypto from "crypto";

const { Pool } = pg;
const pool = new Pool({ connectionString: getConnectionString() });

// מומלץ לשים ב-Netlify Environment variables:
// ADMIN_EMAIL=...
// ADMIN_PASS=...
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "shmuel123770@icloud.com").toLowerCase().trim();
const ADMIN_PASS = process.env.ADMIN_PASS || "amarZ770@";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}
function bad(message: string, status = 400) {
  return json({ error: message }, status);
}
function id(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
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
  await pool.query(`
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
  `);
  // Migration for older table that had only plain pass
  await pool.query(`ALTER TABLE crown_auth ADD COLUMN IF NOT EXISTS pass_hash TEXT;`);

  const adminHash = hashPassword(ADMIN_PASS);
  await pool.query(
    `INSERT INTO crown_auth(uid,email,pass,pass_hash)
     VALUES($1,$2,NULL,$3)
     ON CONFLICT(email) DO UPDATE SET uid=EXCLUDED.uid, pass=NULL, pass_hash=EXCLUDED.pass_hash, updated_at=NOW()`,
    ["admin", ADMIN_EMAIL, adminHash]
  );
  await pool.query(
    `INSERT INTO crown_records(collection,id,data)
     VALUES('users','admin',$1::jsonb)
     ON CONFLICT(collection,id) DO UPDATE SET data=crown_records.data || EXCLUDED.data, updated_at=NOW()`,
    [JSON.stringify({ name: "מנהל האתר", role: "admin", email: ADMIN_EMAIL, createdAt: Date.now() })]
  );
}
async function getRecord(collection: string, rid: string) {
  const { rows } = await pool.query(
    `SELECT id, data FROM crown_records WHERE collection=$1 AND id=$2`,
    [collection, rid]
  );
  return rows[0] || null;
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
    await pool.query(
      `INSERT INTO crown_records(collection,id,data) VALUES('email_queue',$1,$2::jsonb)`,
      [id("em"), JSON.stringify({ to: recipients, subject, html, text, status: "missing_smtp_env", createdAt: Date.now() })]
    );
    return { ok: true, queued: true, warning: "Missing SMTP_HOST / SMTP_USER / SMTP_PASS environment variables" };
  }

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  await transporter.sendMail({
    from,
    to: recipients.join(","),
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  });
  return { ok: true, sent: recipients.length };
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return bad("POST only", 405);
  await ensureTables();

  let body: any = {};
  try { body = await req.json(); } catch { return bad("Invalid JSON"); }

  const action = body.action;
  const collection = String(body.collection || "");
  const rid = String(body.id || "");

  try {
    if (action === "list") {
      let rows;
      if (body.where && body.where.field) {
        const field = String(body.where.field);
        const op = String(body.where.op || "==");
        const value = body.where.value;
        if (op === "array-contains") {
          const q = await pool.query(
            `SELECT id,data FROM crown_records WHERE collection=$1 AND (data -> $2) @> $3::jsonb ORDER BY updated_at DESC`,
            [collection, field, JSON.stringify([value])]
          );
          rows = q.rows;
        } else {
          const q = await pool.query(
            `SELECT id,data FROM crown_records WHERE collection=$1 AND data ->> $2 = $3 ORDER BY updated_at DESC`,
            [collection, field, String(value)]
          );
          rows = q.rows;
        }
      } else {
        const q = await pool.query(`SELECT id,data FROM crown_records WHERE collection=$1 ORDER BY updated_at DESC`, [collection]);
        rows = q.rows;
      }
      return json({ records: rows.map((r: any) => ({ id: r.id, data: r.data })) });
    }

    if (action === "get") {
      const r = await getRecord(collection, rid);
      return json({ record: r ? r.data : null });
    }

    if (action === "add") {
      const newId = id(collection.slice(0, 3) || "rec");
      await pool.query(`INSERT INTO crown_records(collection,id,data) VALUES($1,$2,$3::jsonb)`, [collection, newId, JSON.stringify(body.data || {})]);
      return json({ id: newId });
    }

    if (action === "set" || action === "update") {
      const data = body.data || {};
      if (action === "set" && !body.merge) {
        await pool.query(
          `INSERT INTO crown_records(collection,id,data) VALUES($1,$2,$3::jsonb)
           ON CONFLICT(collection,id) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()`,
          [collection, rid, JSON.stringify(data)]
        );
      } else {
        await pool.query(
          `INSERT INTO crown_records(collection,id,data) VALUES($1,$2,$3::jsonb)
           ON CONFLICT(collection,id) DO UPDATE SET data=crown_records.data || EXCLUDED.data, updated_at=NOW()`,
          [collection, rid, JSON.stringify(data)]
        );
      }
      return json({ ok: true });
    }

    if (action === "delete") {
      await pool.query(`DELETE FROM crown_records WHERE collection=$1 AND id=$2`, [collection, rid]);
      return json({ ok: true });
    }

    if (action === "signup") {
      const email = String(body.email || "").toLowerCase().trim();
      const pass = String(body.pass || "");
      if (!email || !pass) return bad("Missing email/password");
      if (pass.length < 6) return bad("Password too short");
      const uid = id("u");
      await pool.query(`INSERT INTO crown_auth(uid,email,pass,pass_hash) VALUES($1,$2,NULL,$3)`, [uid, email, hashPassword(pass)]);
      return json({ user: { uid, email } });
    }

    if (action === "login") {
      const email = String(body.email || "").toLowerCase().trim();
      const pass = String(body.pass || "");
      const { rows } = await pool.query(`SELECT uid,email,pass,pass_hash FROM crown_auth WHERE email=$1 LIMIT 1`, [email]);
      const u = rows[0];
      if (!u) return bad("Invalid login", 401);
      const ok = verifyPassword(pass, u.pass_hash) || (!!u.pass && u.pass === pass);
      if (!ok) return bad("Invalid login", 401);
      if (!u.pass_hash || u.pass) {
        await pool.query(`UPDATE crown_auth SET pass=NULL, pass_hash=$1, updated_at=NOW() WHERE uid=$2`, [hashPassword(pass), u.uid]);
      }
      return json({ user: { uid: u.uid, email: u.email } });
    }

    if (action === "updateAuth") {
      const uid = String(body.uid || "");
      if (!uid) return bad("Missing uid");
      if (body.email) await pool.query(`UPDATE crown_auth SET email=$1, updated_at=NOW() WHERE uid=$2`, [String(body.email).toLowerCase().trim(), uid]);
      if (body.pass) await pool.query(`UPDATE crown_auth SET pass=NULL, pass_hash=$1, updated_at=NOW() WHERE uid=$2`, [hashPassword(String(body.pass)), uid]);
      return json({ ok: true });
    }

    if (action === "sendEmail") {
      const to = body.to;
      const subject = String(body.subject || "Crown Drive");
      const html = String(body.html || "");
      const text = body.text ? String(body.text) : undefined;
      if (!to || !subject || !html) return bad("Missing email fields");
      const result = await sendEmailMessage(to, subject, html, text);
      return json(result);
    }

    if (action === "resetPassword") {
      // שומר בקשה כדי שמנהל יוכל לראות — שליחת לינק איפוס אמיתי דורשת ספק מייל/אימות מתקדם.
      const email = String(body.email || "").toLowerCase().trim();
      if (email) {
        await pool.query(`INSERT INTO crown_records(collection,id,data) VALUES('password_resets',$1,$2::jsonb)`, [id("pw"), JSON.stringify({ email, createdAt: Date.now(), status: "requested" })]);
      }
      return json({ ok: true, message: "Password reset request saved." });
    }

    return bad("Unknown action");
  } catch (e: any) {
    const msg = e && e.code === "23505" ? "Email already exists" : (e?.message || String(e));
    return bad(msg, 500);
  }
};
