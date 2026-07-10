export default async (_request: Request) => {
  return new Response('Local browser storage build. No Netlify Blobs dependency.', {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' }
  });
};
export const config = { path: '/api/file/*' };
