import { getStore } from "@netlify/blobs";

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
    body: JSON.stringify(body),
  };
}

function safeExt(type: string, fallback = "bin") {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  if (type === "application/pdf") return "pdf";
  return fallback.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
}

export default async (request: Request) => {
  if (request.method === "OPTIONS") return json(200, { ok: true });
  if (request.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  try {
    const contentType = request.headers.get("content-type") || "";
    let folder = "uploads";
    let filename = "file";
    let mime = "application/octet-stream";
    let buffer: Buffer;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      folder = String(form.get("folder") || "uploads").replace(/[^a-zA-Z0-9/_-]/g, "").slice(0, 80) || "uploads";
      if (!(file instanceof File)) return json(400, { ok: false, error: "Missing file" });
      filename = file.name || "file";
      mime = file.type || "application/octet-stream";
      buffer = Buffer.from(await file.arrayBuffer());
    } else {
      const body = await request.json().catch(() => null);
      if (!body?.dataUrl && !body?.base64) return json(400, { ok: false, error: "Missing file data" });
      folder = String(body.folder || "uploads").replace(/[^a-zA-Z0-9/_-]/g, "").slice(0, 80) || "uploads";
      filename = String(body.filename || "file");
      const data = String(body.dataUrl || body.base64);
      const match = data.match(/^data:([^;]+);base64,(.*)$/);
      mime = body.type || (match ? match[1] : "application/octet-stream");
      const b64 = match ? match[2] : data;
      buffer = Buffer.from(b64, "base64");
    }

    if (!ALLOWED_TYPES.has(mime)) return json(415, { ok: false, error: "Unsupported file type" });
    if (buffer.byteLength > MAX_FILE_BYTES) return json(413, { ok: false, error: "File too large. Max 8MB." });

    const ext = safeExt(mime, filename.split(".").pop() || "bin");
    const rand = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const key = `${folder}/${Date.now()}-${rand}.${ext}`;

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
