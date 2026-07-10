export default async function handler() {
  return new Response(JSON.stringify({ ok: true, disabled: true, message: "Uploads are handled locally in the browser." }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
