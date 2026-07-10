export default async (_request: Request) => {
  return new Response('No Netlify Blobs dependency. CrownDrive uses localStorage plus optional Firebase Realtime Database.', {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' }
  });
};
export const config = { path: '/api/file/*' };
