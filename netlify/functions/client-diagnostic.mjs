const ALLOWED_TYPES = new Set([
  'admin-check-timeout',
  'catalog-realtime-timeout',
  'catalog-rest-used',
  'catalog-rest-failed',
]);

export default async request => {
  if (request.method !== 'POST') return new Response(null, {status: 405});
  let body;
  try { body = await request.json(); }
  catch { return new Response(null, {status: 400}); }
  const type = String(body?.type || '');
  if (!ALLOWED_TYPES.has(type)) return new Response(null, {status: 400});
  console.warn('client-diagnostic', {
    type,
    route: String(body?.route || '').slice(0, 30),
    version: String(body?.version || '').slice(0, 20),
  });
  return new Response(null, {status: 204});
};

export const config = {path: '/api/client-diagnostic'};
