import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const views=fs.readFileSync(new URL('../js/views.js',import.meta.url),'utf8');const css=fs.readFileSync(new URL('../css/app.css',import.meta.url),'utf8');const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
test('all dashboard roles expose unique navigation',()=>{for(const label of ['שוכר','בעל רכב','מנהל'])assert.ok(views.includes(`layout('${label}'`))});
test('modal and dashboard size stability guards exist',()=>{assert.match(css,/\.dashboard\{min-height:/);assert.match(css,/\.panel\{min-width:0;min-height:/);assert.match(css,/body\.modal-open/)});
test('global runtime failures are handled',()=>{assert.match(app,/unhandledrejection/);assert.match(app,/window\.addEventListener\('error'/)});
test('no placeholder href dead ends',()=>{assert.ok(!/href=["']#["']/.test(views))});
