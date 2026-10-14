import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const port=await new Promise((resolve,reject)=>{
  const server=net.createServer();server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});
});
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],
 {stdio:['ignore','pipe','pipe'],env:{...process.env,VITE_APP_ENV:'DEV',VITE_RUNTIME_BACKEND:'firebase-only',
 VITE_USE_FIREBASE_EMULATORS:'true',VITE_FIREBASE_EMULATOR_PROJECT_ID:'demo-hnl-qltc-dev'}});
let serverLog='';for(const stream of [vite.stdout,vite.stderr])stream.on('data',s=>serverLog+=String(s));
fs.mkdirSync('runtime-evidence',{recursive:true});const results=[];let browser;
try {
 const url='http://127.0.0.1:'+port+'/scripts/fixtures/warehouse-catalog/index.html';
 let ready=false;
 for(let i=0;i<140;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,250));}
 assert(ready,'Fixture Vite not ready: '+serverLog.slice(-500));
 browser=await chromium.launch({headless:true});
 for(const viewport of [{width:1280,height:800},{width:393,height:852}]){
  const tag=viewport.width+'x'+viewport.height;
  const context=await browser.newContext({viewport,acceptDownloads:true,isMobile:viewport.width<500,hasTouch:viewport.width<500});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  const open=page.locator('[data-hnl-voucher-share-id="P0-IN-20261013-001"]');
  await open.waitFor({state:'visible',timeout:15000});await open.click();
  const sheet=page.locator('[data-hnl-settings-sheet="warehouse-voucher-share"]');
  await sheet.waitFor({state:'visible'});
  assert.match(await sheet.innerText(),/P0-IN-20261013-001/,'Single voucher ID missing');
  for(const format of ['png','pdf']){
    const promise=page.waitForEvent('download',{timeout:30000});
    await sheet.locator('[data-hnl-voucher-action="'+format+'-download"]').click();
    const download=await promise;
    const filepath=await download.path();
    assert(filepath,'download not saved');
    const bytes=fs.readFileSync(filepath);
    assert(bytes.length>3000,format+' export was empty/tiny: '+bytes.length);
    if(format==='png')assert.equal(bytes.subarray(1,4).toString(),'PNG','PNG header');
    else assert.equal(bytes.subarray(0,4).toString(),'%PDF','PDF header');
    results.push({viewport:tag,format,bytes:bytes.length,file:download.suggestedFilename()});
  }
  await page.screenshot({path:'runtime-evidence/voucher-export-'+tag+'.png'});
  assert.deepEqual(errors,[],'React errors: '+errors.join(', '));
  await context.close();
 }
 assert.equal(results.length,4);
 fs.writeFileSync('runtime-evidence/voucher-export-report.json',JSON.stringify({status:'PASS',results},null,2));
 console.log('WAREHOUSE VOUCHER PNG/PDF REAL DOWNLOAD PASS',JSON.stringify(results));
} finally {await browser?.close();vite.kill('SIGTERM');}
