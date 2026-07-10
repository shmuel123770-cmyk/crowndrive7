export default async (request: Request) => {
  return new Response(JSON.stringify({ ok: true, localOnly: true, message: 'Uploads are handled in the browser/localStorage in this build.' }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }
  });
};
export const config = { path: '/api/upload' };
