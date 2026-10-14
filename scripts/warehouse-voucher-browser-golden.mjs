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
async function assertEventuallyEnabled(locator) {
  await locator.waitFor({state:'visible',timeout:30000});
  for(let i=0;i<100;i++){
    if(await locator.isEnabled())return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Prepared download action stayed disabled');
}
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
  // The first single-entry view must still download valid PNG/PDF.
  for(const format of ['png','pdf']){
    await sheet.locator('[data-hnl-voucher-format="'+format+'"]').click();
    const action=sheet.locator('[data-hnl-voucher-action="'+format+'-download"]');
    await action.waitFor({state:'visible'});
    await assertEventuallyEnabled(action);
    const promise=page.waitForEvent('download',{timeout:30000});
    await action.click();
    const download=await promise;
    const filepath=await download.path();
    assert(filepath,'download not saved');
    const bytes=fs.readFileSync(filepath);
    assert(bytes.length>3000,format+' export was empty/tiny: '+bytes.length);
    if(format==='png')assert.equal(bytes.subarray(1,4).toString(),'PNG','PNG header');
    else assert.equal(bytes.subarray(0,4).toString(),'%PDF','PDF header');
    assert(!download.suggestedFilename().includes('HNL'),'Printed voucher must be unbranded');
    results.push({viewport:tag,format,mode:'single',bytes:bytes.length,file:download.suggestedFilename()});
  }
  // Two original receipt IDs on the same day/by the same handler must share
  // one A4 print table and one PNG/PDF file rather than per-material exports.
  await sheet.getByRole('button',{name:'Tất cả'}).click();
  await sheet.getByRole('button',{name:'Nhập kho'}).click();
  await sheet.getByRole('button',{name:'Vật tư',exact:true}).click();
  assert.match(await sheet.innerText(),/2 dòng vật tư\/thiết bị → 1 trang A4/,'Expected two material lines on one A4');
  for(const format of ['png','pdf']){
    await sheet.locator('[data-hnl-voucher-format="'+format+'"]').click();
    const action=sheet.locator('[data-hnl-voucher-action="'+format+'-download"]');
    await assertEventuallyEnabled(action);
    const promise=page.waitForEvent('download',{timeout:30000});
    await action.click();
    const download=await promise;
    const bytes=fs.readFileSync(await download.path());
    assert(bytes.length>3000,format+' grouped voucher empty');
    if(format==='pdf'){
      const pageObjects=bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)||[];
      assert.equal(pageObjects.length,1,'Two receipt lines should produce one PDF A4 page');
    }
    results.push({viewport:tag,format,mode:'multirow',bytes:bytes.length,file:download.suggestedFilename()});
  }
  await page.screenshot({path:'runtime-evidence/voucher-export-'+tag+'.png'});
  assert.deepEqual(errors,[],'React errors: '+errors.join(', '));
  await context.close();
 }
 assert.equal(results.length,8);
 fs.writeFileSync('runtime-evidence/voucher-export-report.json',JSON.stringify({status:'PASS',results},null,2));
 console.log('WAREHOUSE VOUCHER PNG/PDF REAL DOWNLOAD PASS',JSON.stringify(results));
} finally {await browser?.close();vite.kill('SIGTERM');}
