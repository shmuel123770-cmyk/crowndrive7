import { getStore } from "@netlify/blobs";

const FALLBACK_TYPE = "application/octet-stream";

export default async (request: Request) => {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key") || "";
    if (!key || key.includes("..")) {
      return new Response("Missing file key", { status: 400 });
    }

    const store = getStore({ name: "crowndrive-files", consistency: "strong" });
    const blob = await store.get(key, { type: "arrayBuffer" });
    if (!blob) return new Response("File not found", { status: 404 });

    const meta = await store.getMetadata(key).catch(() => null) as any;
    const contentType = meta?.metadata?.contentType || FALLBACK_TYPE;

    return new Response(blob, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=31536000, immutable",
        "access-control-allow-origin": "*",
      },
    });
  } catch (error: any) {
    return new Response(error?.message || "File error", { status: 500 });
  }
};
