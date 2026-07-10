import { getStore } from "@netlify/blobs";

const FALLBACK_TYPE = "application/octet-stream";

export const handler = async (event: any) => {
  try {
    const key = String(event.queryStringParameters?.key || "");
    if (!key || key.includes("..")) {
      return { statusCode: 400, headers: { "content-type": "text/plain" }, body: "Missing file key" };
    }

    const store = getStore({ name: "crowndrive-files", consistency: "strong" });
    const blob = await store.get(key, { type: "arrayBuffer" });
    if (!blob) return { statusCode: 404, headers: { "content-type": "text/plain" }, body: "File not found" };

    const meta = await store.getMetadata(key).catch(() => null) as any;
    const contentType = meta?.metadata?.contentType || FALLBACK_TYPE;
    const buffer = Buffer.from(blob);

    return {
      statusCode: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=31536000, immutable",
        "access-control-allow-origin": "*",
      },
      isBase64Encoded: true,
      body: buffer.toString("base64"),
    };
  } catch (error: any) {
    return { statusCode: 500, headers: { "content-type": "text/plain" }, body: error?.message || "File error" };
  }
};
