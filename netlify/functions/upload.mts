export default async (request: Request) => {
  return new Response(JSON.stringify({
    ok: false,
    message: "File upload is disabled in this deploy. Use base64/local browser storage from index.html."
  }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
};
