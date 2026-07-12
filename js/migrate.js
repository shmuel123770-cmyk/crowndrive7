import {api} from './api.js';
import {store} from './store.js';
export async function legacyStatus() {
  if (!store.isAdmin) return null;
  return api('migrate-legacy', {action: 'status'});
}
export async function migrateLegacy() {
  if (!store.isAdmin) throw new Error('מנהל בלבד');
  return (await api('migrate-legacy', {action: 'migrate'})).count;
}
