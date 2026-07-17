import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root = new URL('..', import.meta.url).pathname;
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
if (!/type="module" src="js\/app\.js(\?v=\d+)?"/.test(html)) throw new Error('app module missing');
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) throw new Error(`duplicate ids: ${duplicates.join(',')}`);
const jsFiles = fs.readdirSync(path.join(root, 'js')).filter(file => file.endsWith('.js'));
const functionFiles = fs.readdirSync(path.join(root, 'netlify/functions')).filter(file => file.endsWith('.mjs'));
for (const file of [...jsFiles.map(x => `js/${x}`), ...functionFiles.map(x => `netlify/functions/${x}`)]) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], {stdio: 'pipe'});
}
const allClient = jsFiles.map(file => read(`js/${file}`)).join('\n');
const authObservers = (allClient.match(/onAuthStateChanged/g) || []).length;
if (authObservers !== 1) throw new Error(`expected exactly one auth observer, found ${authObservers}`);
if (/RT_REF\.set/.test(allClient)) throw new Error('unsafe legacy full-state write found');
// Direct client DB writes are forbidden EXCEPT the intentional, rules-guarded ones:
//  - "client-write:own-profile"      self-profile create on registration
//  - "client-write:admin-maintenance" admin toggling config/maintenance (admin-only rule)
const allowedClientWrites = ['client-write:own-profile', 'client-write:admin-maintenance', 'client-write:own-car', 'client-write:admin-chat', 'client-write:own-role', 'client-write:own-external-rentals'];
const writeLines = allClient.split('\n').filter(line => /\.ref\([^)]*\)\.(set|update|remove|push)\(/.test(line) && !allowedClientWrites.some(tag => line.includes(tag)));
if (writeLines.length) throw new Error(`direct client database write found: ${writeLines[0].trim()}`);
const rules = JSON.parse(read('FIREBASE_DATABASE_RULES_V2.json'));
if (rules.rules['.write'] !== false) throw new Error('database root writes are not denied');
const storageRules = read('FIREBASE_STORAGE_RULES_V2.txt');
if (/allow\s+(read\s*,\s*)?write\s*:\s*if\s+true/.test(storageRules)) throw new Error('storage allows unrestricted write');
if (!/request\.auth\.uid\s*==\s*uid/.test(storageRules)) throw new Error('storage writes are not scoped to the file owner');
const requiredFunctions = ['profile-save.mjs','document-register.mjs','verification-review.mjs','car-action.mjs','booking-create.mjs','booking-action.mjs','payment-submit.mjs','message-send.mjs','rating-submit.mjs','private-car-details.mjs','media-sign-upload.mjs','media-upload.mjs','media-migrate.mjs','media-sign-read.mjs','user-private-profile.mjs','migrate-legacy.mjs','car-media-public.mjs','admin-action.mjs','admin-chat-threads.mjs','inquiry-start.mjs','booking-expire-scheduled.mjs'];
for (const file of requiredFunctions) if (!functionFiles.includes(file)) throw new Error(`missing function ${file}`);
console.log(`Static/security check passed: ${jsFiles.length} client modules, ${functionFiles.length} server functions, ${ids.length} static ids`);
