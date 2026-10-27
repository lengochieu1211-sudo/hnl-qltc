import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=String(process.env.P2116_PREVIEW_URL||'').trim();
const commit=String(process.env.P2116_EXPECTED_SHA||'').trim();
assert.match(commit,/^[a-f0-9]{40}$/,'Exact 40-char candidate HEAD');
const u=new URL(url);
assert.equal(u.protocol,'https:');
assert.match(u.hostname,/^hnl-qltc-dev--[a-z0-9-]+\.web\.app$/,'DEV preview only');
const base=u.origin;
fs.mkdirSync('runtime-evidence',{recursive:true});
const report={stage:'P2116_DEV_HOSTING_PREVIEW',commit,origin:base,checks:[],screenshots:[]};
const pass=(n,v)=>{report.checks.push({name:n,status:'PASS',value:v});console.log('PASS '+n+' '+JSON.stringify(v||''));};
const get=async path=>fetch(base+path,{redirect:'follow',signal:AbortSignal.timeout(30000)});
const index=await get('/index.html');
if(index.status!==200){
 const body=(await index.text()).slice(0,1200);
 const headers=Object.fromEntries(['content-type','server','cache-control','x-cache','via','retry-after'].map(k=>[k,index.headers.get(k)]).filter(([,v])=>v!==null));
 const diagnostic={stage:report.stage,commit,origin:base,path:'/index.html',status:index.status,statusText:index.statusText,headers,bodyExcerpt:body,quotaHint:index.status===509||/quota|bandwidth exceeded/i.test(body),checkedAt:new Date().toISOString()};
 fs.writeFileSync('runtime-evidence/P2116-PREVIEW-HTTP-FAILURE.json',JSON.stringify(diagnostic,null,2));
 console.error('DEV Preview HTTP diagnostic: '+JSON.stringify(diagnostic));
 throw new Error('DEV Hosting preview returned HTTP '+index.status+' (expected 200); runtime NOT certified. Check Firebase Hosting quota/API/status before retry.');
}
const html=await index.text();assert(html.includes('<html')&&html.includes('</html>'));pass('index.html HTTP 200');
const manifest=await get('/sw-assets.json');assert.equal(manifest.status,200);
const m=await manifest.json();assert(Array.isArray(m.assets)&&m.assets.length>=1,'Missing JS asset manifest');
for(const p of m.assets.slice(0,8)){
 assert.match(p,/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/);
 const r=await get(p);assert.equal(r.status,200,'Missing hashed asset '+p);
 assert(!(r.headers.get('content-type')||'').includes('text/html'),'Hashed asset rewritten as index');
 await r.arrayBuffer();
}
pass('hashed assets are served',m.assets.length);
assert.equal((await get('/assets/__hnl_p2116_nonexistent_0.js')).status,404,'Stale JS must return 404');
pass('stale asset 404');
const browser=await chromium.launch({headless:true});
try{
 for(const v of [{width:1440,height:900,name:'desktop'},{width:393,height:852,name:'mobile'},{width:360,height:640,name:'small-mobile'}]){
  const context=await browser.newContext({viewport:{width:v.width,height:v.height},locale:'vi-VN',isMobile:v.width<500,hasTouch:v.width<500});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e.message).slice(0,250)));
  const resp=await page.goto(base+'/?hnl-preview='+commit.slice(0,12),{waitUntil:'domcontentloaded',timeout:60000});
  assert.equal(resp?.status(),200,v.name+' initial render failed');
  await page.waitForTimeout(1500);
  const state=await page.evaluate(()=>({title:document.title,bodyChars:document.body?.innerText?.trim().length||0,scrollWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth}));
  assert(state.bodyChars>10,v.name+' blank UI');
  assert(!errors.length,v.name+' JS errors: '+errors.join('; '));
  assert(state.scrollWidth<=state.viewportWidth+80,v.name+' horizontal overflow '+state.scrollWidth+'/'+state.viewportWidth);
  const file='runtime-evidence/p2116-'+v.name+'-'+commit.slice(0,12)+'.png';
  await page.screenshot({path:file,fullPage:false});
  report.screenshots.push({name:v.name,file});
  pass(v.name+' browser rendered',state);
  await context.close();
 }
}finally{await browser.close();}
fs.writeFileSync('runtime-evidence/P2116-PREVIEW-BROWSER-EVIDENCE.json',JSON.stringify(report,null,2));
console.log('P21.16 unauthenticated DEV Preview browser passed; multi-user Golden NOT implied.');
