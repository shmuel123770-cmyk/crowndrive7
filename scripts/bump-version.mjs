// Bump the human-readable release number in index.html.
//
// The Build ID beside it is a content hash — it changes on its own and proves WHAT shipped. This
// number is the one a person can read off the footer and say out loud, which is what makes it useful
// when the owner reports something: "I'm on 219" answers a question the hash cannot.
//
// Run before building, on every change that reaches the site:  node scripts/bump-version.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const pattern = /(<meta name="crowndrive-version" content=")(\d+)(">)/;
const match = html.match(pattern);
if (!match) {
  console.error('bump-version: the crowndrive-version meta tag is missing from index.html');
  process.exit(1);
}
const next = Number(match[2]) + 1;
fs.writeFileSync(file, html.replace(pattern, `$1${next}$3`));
console.log(`version ${match[2]} → ${next}`);
