import { getConnectionString } from "@netlify/database";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: getConnectionString() });

const ADMIN_EMAIL = "shmuel123770@icloud.com";
const ADMIN_PASS = "amarZ770@";

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
function stampData(data:any){
  return { ...(data || {}), updatedAt: Date.now() };
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
      pass TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(
    `INSERT INTO crown_auth(uid,email,pass)
     VALUES($1,$2,$3)
     ON CONFLICT(email) DO UPDATE SET pass=EXCLUDED.pass, updated_at=NOW()`,
    ["admin", ADMIN_EMAIL, ADMIN_PASS]
  );
  await pool.query(
    `INSERT INTO crown_records(collection,id,data)
     VALUES('users','admin',$1::jsonb)
     ON CONFLICT(collection,id) DO UPDATE SET data=crown_records.data || EXCLUDED.data, updated_at=NOW()`,
    [JSON.stringify({ name: "מנהל האתר", role: "admin", createdAt: Date.now() })]
  );
}
async function getRecord(collection: string, rid: string) {
  const { rows } = await pool.query(
    `SELECT id, data FROM crown_records WHERE collection=$1 AND id=$2`,
    [collection, rid]
  );
  return rows[0] || null;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method === "GET") {
    try { await ensureTables(); return json({ ok:true, function:"db", engine:"netlify-database" }); }
    catch(e:any){ return json({ ok:false, function:"db", error:"DB_NOT_READY", details:e?.message||String(e) }, 500); }
  }
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
        const q = await pool.query(
          `SELECT id,data FROM crown_records WHERE collection=$1 ORDER BY updated_at DESC`,
          [collection]
        );
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
      await pool.query(
        `INSERT INTO crown_records(collection,id,data) VALUES($1,$2,$3::jsonb)`,
        [collection, newId, JSON.stringify(stampData(body.data))]
      );
      return json({ id: newId });
    }

    if (action === "set" || action === "update") {
      const data = stampData(body.data);
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
      const uid = id("u");
      await pool.query(`INSERT INTO crown_auth(uid,email,pass) VALUES($1,$2,$3)`, [uid, email, pass]);
      return json({ user: { uid, email } });
    }

    if (action === "login") {
      const email = String(body.email || "").toLowerCase().trim();
      const pass = String(body.pass || "");
      const { rows } = await pool.query(`SELECT uid,email,pass FROM crown_auth WHERE email=$1 LIMIT 1`, [email]);
      const u = rows[0];
      if (!u || u.pass !== pass) return bad("Invalid login", 401);
      return json({ user: { uid: u.uid, email: u.email } });
    }

    if (action === "updateAuth") {
      const uid = String(body.uid || "");
      if (!uid) return bad("Missing uid");
      if (body.email) await pool.query(`UPDATE crown_auth SET email=$1, updated_at=NOW() WHERE uid=$2`, [String(body.email).toLowerCase().trim(), uid]);
      if (body.pass) await pool.query(`UPDATE crown_auth SET pass=$1, updated_at=NOW() WHERE uid=$2`, [String(body.pass), uid]);
      return json({ ok: true });
    }

    if (action === "resetPassword") {
      return json({ ok: true, message: "Password reset requires email provider setup." });
    }

    return bad("Unknown action");
  } catch (e: any) {
    const msg = e && e.code === "23505" ? "Email already exists" : (e?.message || String(e));
    return bad(msg, 500);
  }
};
