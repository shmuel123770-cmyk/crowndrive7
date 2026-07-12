export default async (_request: Request) => {
  return new Response(JSON.stringify({ ok: true, localOnly: true, message: 'Uploads are handled in browser/localStorage/Firebase realtime. No Netlify Blobs dependency.' }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }
  });
};
export const config = { path: '/api/upload' };
