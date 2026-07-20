import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

// CrownDrive production build. Emits a PUBLIC-ONLY `dist/` whose JS/CSS carry a content-based Build ID and
// are cached immutably, while HTML / config / service-worker are never stored. This permanently fixes:
//   1) "different devices see different versions" — a new build changes the Build ID, so every asset URL
//      (INCLUDING internal ESM imports) is new; a device can never mix a fresh HTML shell with an old
//      cached module, and immutable assets never need revalidation.
//   2) private-file exposure — the previous `publish = "."` served the whole repo (Firebase rules, tests,
//      package.json, changelogs) publicly. dist/ contains ONLY the runtime files, enforced by a leak guard.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const runtimeFiles = ['index.html', 'privacy.html', 'terms.html', 'firebase-config.js', 'manifest.json', 'sw.js', 'firebase-messaging-sw.js', '_headers'];
const runtimeDirs = ['js', 'css', 'icons'];
const optionalPublicFiles = ['googlef21d119a5e0daadb.html', 'robots.txt', 'sitemap.xml'];

const listFiles = dir => fs.readdirSync(dir, {withFileTypes: true})
  .flatMap(entry => entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const relative = file => path.relative(root, file).split(path.sep).join('/');
function copy(relativePath) {
  const source = path.join(root, relativePath);
  if (!fs.existsSync(source)) throw new Error(`Missing runtime file: ${relativePath}`);
  const target = path.join(dist, relativePath);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.copyFileSync(source, target);
}

// Build ID = short sha256 over every runtime file's path + bytes (sorted, deterministic).
const inputs = [
  ...runtimeFiles.map(file => path.join(root, file)),
  ...runtimeDirs.flatMap(dir => listFiles(path.join(root, dir))),
].sort();
const hash = crypto.createHash('sha256');
for (const file of inputs) {
  hash.update(relative(file)); hash.update('\0');
  hash.update(fs.readFileSync(file)); hash.update('\0');
}
const buildId = hash.digest('hex').slice(0, 12);

fs.rmSync(dist, {recursive: true, force: true});
fs.mkdirSync(dist, {recursive: true});
for (const file of runtimeFiles) copy(file);
for (const dir of runtimeDirs) for (const file of listFiles(path.join(root, dir))) copy(relative(file));
for (const file of optionalPublicFiles) if (fs.existsSync(path.join(root, file))) copy(file);

// Stamp the Build ID onto every internal ESM import so the whole module graph is versioned together.
for (const file of listFiles(path.join(dist, 'js')).filter(f => f.endsWith('.js'))) {
  const source = fs.readFileSync(file, 'utf8')
    .replace(/(from\s+['"])(\.[^'"]+\.js)(?:\?[^'"]*)?(['"])/g, `$1$2?v=${buildId}$3`)
    .replace(/(import\s*\(\s*['"])(\.[^'"]+\.js)(?:\?[^'"]*)?(['"]\s*\))/g, `$1$2?v=${buildId}$3`);
  fs.writeFileSync(file, source);
}

// Stamp the Build ID onto css/js/icons references in index.html (leaving firebase-config.js + manifest.json
// as stable, always-revalidated URLs), and record the build in a meta tag.
for (const htmlName of ['index.html', 'privacy.html', 'terms.html']) {
  const htmlPath = path.join(dist, htmlName);
  let html = fs.readFileSync(htmlPath, 'utf8').replace(
    /\b(href|src)="((?:css|js|icons)\/[^"?]+)(?:\?[^"#]*)?(#[^"]*)?"/g,
    (_, attribute, asset, fragment = '') => `${attribute}="${asset}?v=${buildId}${fragment || ''}"`,
  );
  if (htmlName === 'index.html' && !/name="crowndrive-build"/.test(html)) {
    html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta name="crowndrive-build" content="${buildId}">`);
  }
  fs.writeFileSync(htmlPath, html);
}

// Make sw.js bytes change every build so the worker updates, without touching its logic.
const swPath = path.join(dist, 'sw.js');
fs.writeFileSync(swPath, `/* CrownDrive build ${buildId} */\n${fs.readFileSync(swPath, 'utf8')}`);

// Rebuild _headers: keep the existing security block (everything before the first blank line), then set
// cache rules — HTML/config/SW/manifest/icons always revalidate; the content-hashed JS/CSS are immutable.
const headersPath = path.join(dist, '_headers');
const securityBlock = fs.readFileSync(headersPath, 'utf8').split(/\n\s*\n/, 1)[0].trim();
fs.writeFileSync(headersPath, `${securityBlock}

/
  Cache-Control: no-store
/index.html
  Cache-Control: no-store
/privacy.html
  Cache-Control: no-cache, must-revalidate
/terms.html
  Cache-Control: no-cache, must-revalidate
/sw.js
  Cache-Control: no-store
/firebase-config.js
  Cache-Control: no-cache, must-revalidate
/manifest.json
  Cache-Control: no-cache, must-revalidate
/icons/*
  Cache-Control: no-cache, must-revalidate
/js/*
  Cache-Control: public, max-age=31536000, immutable
/css/*
  Cache-Control: public, max-age=31536000, immutable
`);

fs.writeFileSync(path.join(dist, 'BUILD_ID.txt'), `${buildId}\n`);

// Safety net: NOTHING private may ever reach dist/ (Firebase rules, tests, functions source, package
// manifests, changelogs). Fail the build loudly if it does.
const forbidden = /(^|\/)(tests?|netlify|node_modules|scripts|reports?|.*\.md|package(?:-lock)?\.json|VERSION\.txt|FIREBASE_|.*\.test\.mjs)/i;
const leaked = listFiles(dist).map(relative).filter(file => forbidden.test(file));
if (leaked.length) throw new Error(`Private files leaked into dist/: ${leaked.join(', ')}`);

console.log(`Built dist/ with Build ID ${buildId} (${listFiles(dist).length} public files)`);
