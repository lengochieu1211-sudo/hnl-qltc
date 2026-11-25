import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const url='http://127.0.0.1:4187/scripts/fixtures/highlight-pr507/index.html';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4187','--strictPort'],{env:{...process.env,VITE_APP_ENV:'DEV',VITE_RUNTIME_BACKEND:'firebase-only',VITE_USE_FIREBASE_EMULATORS:'true',VITE_FIREBASE_EMULATOR_PROJECT_ID:'demo-hnl-qltc-dev'},stdio:['ignore','pipe','pipe']});
let log='';for(const s of [server.stdout,server.stderr])s.on('data',d=>log+=String(d));let browser;
const report={source:'1be2366d3c2d215e943c45a4c128eb1d28ea600f',scope:'real component browser, synthetic data, no live Firebase or R2',checks:[]};
fs.mkdirSync('runtime-evidence/pr507-highlight',{recursive:true});
try {
 let ready=false;for(let i=0;i<120;i++){try{if((await fetch(url)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,250));}assert(ready,log.slice(-2000));
 browser=await chromium.launch({headless:true});
 for(const [width,height,dark] of [[1280,800,false],[393,852,false],[360,640,true]]){
  const ctx=await browser.newContext({viewport:{width,height},isMobile:width<500,hasTouch:width<500,locale:'vi-VN',colorScheme:dark?'dark':'light'});
  await ctx.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(url+'?unit=md'+(dark?'&dark':''),{waitUntil:'domcontentloaded'});
  const main=page.getByRole('textbox',{name:'Khối lượng hạng mục chính Len QA',exact:true});
  const measure=page.locator('[data-hnl-basic-room-quantity="Len QA"]');
  await measure.waitFor({state:'visible'});assert.equal((await measure.innerText()).trim(),'Tính chu vi');
  await measure.click();await page.waitForTimeout(100);assert.equal(await main.inputValue(),'30');
  const mainHelp=page.getByRole('button',{name:'Hướng dẫn công thức hạng mục chính Len QA',exact:true});await mainHelp.click();
  assert.equal(await page.locator('[data-hnl-quantity-calculator="hạng mục chính Len QA"] [role=note]').innerText(),'S: Diện tích · L: Chu vi/chiều dài');
  await main.fill('L*2');await main.blur();assert.equal(await main.inputValue(),'60');
  const sub=page.getByRole('textbox',{name:'Khối lượng hạng mục con Len con QA',exact:true});await sub.fill('KL*0,5');await sub.blur();assert.equal(await sub.inputValue(),'30');
  await page.getByRole('button',{name:'Hướng dẫn công thức hạng mục con Len con QA',exact:true}).click();
  assert.match(await page.locator('[data-hnl-quantity-calculator="hạng mục con Len con QA"] [role=note]').innerText(),/KL: Khối lượng hạng mục chính/);
  const select=page.getByRole('combobox',{name:'Đơn vị hạng mục con Len con QA',exact:true});
  assert.deepEqual(await select.locator('option').evaluateAll(els=>els.map(e=>e.value)),['__main__','m²','m','md','m³','Cái','Thanh']);
  const legacy=page.getByRole('combobox',{name:'Đơn vị hạng mục con Đơn vị cũ QA',exact:true});assert.equal(await legacy.inputValue(),'__custom__');assert.match(await legacy.locator('option:checked').innerText(),/Bộ/);
  assert.equal(await page.evaluate(()=>window.qaSaves.length),0,'draft must not write on measure/formula');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'runtime-evidence/pr507-highlight/'+width+(dark?'-dark':'')+'.png'});
  report.checks.push({width,height,dark,status:'PASS',measure:'30 md',formula:'60',sub:'30',legacy:'Bộ'});
  await page.goto(url+'?unit=md&readonly',{waitUntil:'domcontentloaded'});
  await page.getByRole('textbox',{name:'Khối lượng hạng mục chính Len QA',exact:true}).waitFor({state:'visible'});
  assert(await page.getByRole('textbox',{name:'Khối lượng hạng mục chính Len QA',exact:true}).isDisabled());
  assert.equal(await page.locator('[data-hnl-basic-room-quantity]').count(),0);
  assert.equal(await page.locator('[data-hnl-sub-count-unit]').count(),0);
  assert.equal(await page.evaluate(()=>window.qaSaves.length),0);
  report.checks.push({width,role:'read-only fixture',status:'PASS'});
  await ctx.close();
 }
 report.status='PASS';console.log(JSON.stringify(report));
}catch(e){report.status='FAIL';report.error=String(e.stack||e);console.error(report.error);process.exitCode=1}
finally{fs.writeFileSync('runtime-evidence/pr507-highlight/report.json',JSON.stringify(report,null,2));await browser?.close();server.kill('SIGTERM');}