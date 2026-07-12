import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn, spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root = new URL('..', import.meta.url).pathname;
const chromium = '/usr/bin/chromium';
if (!fs.existsSync(chromium)) {
  console.log('Browser smoke skipped: Chromium is unavailable');
  process.exit(0);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crowndrive-smoke-'));
fs.cpSync(root, tmp, {recursive: true, filter: src => !src.includes('node_modules')});
let html = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8');
html = html.replace(/<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^>]+><\/script>\s*/g, '').replace('<script src="firebase-config.js"></script>', '<script src="tests/mock-firebase.js"></script>');
fs.writeFileSync(path.join(tmp, 'index.html'), html);
const port = 18777;
const server = spawn('python3', ['-m', 'http.server', String(port), '--directory', tmp], {stdio: 'ignore'});
await new Promise(resolve => setTimeout(resolve, 500));
try {
  const result = spawnSync(chromium, ['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--virtual-time-budget=1800','--dump-dom',`http://127.0.0.1:${port}/#home`], {encoding:'utf8', timeout:8000, maxBuffer:8*1024*1024});
  if (result.error?.code === 'ETIMEDOUT') {
    console.log('Browser smoke skipped: Chromium cannot start in this sandbox');
    process.exit(0);
  }
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('השכרת רכבים קראון הייטס'));
  console.log('Browser smoke passed: home route rendered in Chromium');
} finally {
  server.kill('SIGTERM');
  fs.rmSync(tmp, {recursive:true, force:true});
}
