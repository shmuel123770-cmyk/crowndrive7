import {getAdmin} from './_firebase-admin.mjs';
import {visiblePublicCars} from './_public-cars.mjs';

export default async function carsPublic(request) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return Response.json({error: 'Method not allowed'}, {status: 405, headers: {allow: 'GET, HEAD'}});
  }
  try {
    const snapshot = await getAdmin().database().ref('publicCars').once('value');
    const cars = visiblePublicCars(snapshot.val());
    const headers = {'cache-control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=30', 'x-content-type-options': 'nosniff'};
    if (request.method === 'HEAD') return new Response(null, {status: 200, headers});
    return Response.json({cars}, {headers});
  } catch (error) {
    console.error('cars-public error', error);
    return Response.json({error: 'שגיאה בטעינת הרכבים'}, {status: 500, headers: {'cache-control': 'no-store'}});
  }
}
