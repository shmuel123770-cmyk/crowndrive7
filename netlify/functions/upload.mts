import { getStore } from "@netlify/blobs";
import crypto from "crypto";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB per file
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);

const headers = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(statusCode: number, body: unknown) {
  return { statusCode, headers, body: JSON.stringify(body ?? {}) };
}

function safeExt(type: string, fallback = "bin") {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  if (type === "application/pdf") return "pdf";
  return fallback.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
}

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  try {
    const body = event.body ? JSON.parse(event.body) : null;
    if (!body?.dataUrl && !body?.base64) return json(400, { ok: false, error: "Missing file data" });

    const folder = String(body.folder || "uploads").replace(/[^a-zA-Z0-9/_-]/g, "").slice(0, 80) || "uploads";
    const filename = String(body.filename || "file");
    const data = String(body.dataUrl || body.base64);
    const match = data.match(/^data:([^;]+);base64,(.*)$/);
    const mime = String(body.type || (match ? match[1] : "application/octet-stream"));
    const b64 = match ? match[2] : data;
    const buffer = Buffer.from(b64, "base64");

    if (!ALLOWED_TYPES.has(mime)) return json(415, { ok: false, error: "Unsupported file type" });
    if (buffer.byteLength > MAX_FILE_BYTES) return json(413, { ok: false, error: "File too large. Max 25MB." });

    const ext = safeExt(mime, filename.split(".").pop() || "bin");
    const key = `${folder}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const store = getStore({ name: "crowndrive-files", consistency: "strong" });
    await store.set(key, buffer, {
      metadata: {
        contentType: mime,
        originalName: filename.slice(0, 180),
        uploadedAt: new Date().toISOString(),
      },
    });

    return json(200, {
      ok: true,
      key,
      url: `/.netlify/functions/file?key=${encodeURIComponent(key)}`,
      type: mime,
      size: buffer.byteLength,
    });
  } catch (error: any) {
    return json(500, { ok: false, error: error?.message || "Upload failed" });
  }
};
