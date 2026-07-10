export default async (request: Request) => {
  return new Response(JSON.stringify({
    ok: false,
    message: "File serving is disabled in this deploy. No Netlify Blobs required."
  }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
};
