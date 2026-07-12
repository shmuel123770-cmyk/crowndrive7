import fs from 'node:fs';import path from 'node:path';
const root=new URL('..',import.meta.url).pathname;const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
if(!html.includes('js/app.js'))throw Error('app module missing');
const files=fs.readdirSync(path.join(root,'js')).filter(x=>x.endsWith('.js'));
for(const f of files){const s=fs.readFileSync(path.join(root,'js',f),'utf8');if(/RT_REF\.set|crowndrive-live\/state[^/]/.test(s))throw Error(`unsafe legacy full-state write in ${f}`)}
const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(x=>x[1]);const dup=ids.filter((x,i)=>ids.indexOf(x)!==i);if(dup.length)throw Error(`duplicate ids: ${dup.join(',')}`);
console.log(`Static check passed: ${files.length} modules, ${ids.length} ids`);

const appJs=fs.readFileSync(path.join(root,'js/app.js'),'utf8');
if(!appJs.includes('unhandledrejection'))throw Error('global promise error handling missing');
const views=fs.readFileSync(path.join(root,'js/views.js'),'utf8');
for(const route of ['home','cars','auth','dashboard'])if(!views.includes(`data-route=\"${route}\"`)&&!appJs.includes(`${route}:`))throw Error(`route coverage missing: ${route}`);
if(!views.includes("app().querySelectorAll('[data-car]')"))throw Error('home car buttons are not bound');
if(!views.includes('withBusy'))throw Error('busy-state protection missing');
