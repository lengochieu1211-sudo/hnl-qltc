import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:['ignore','pipe','pipe'],env:{...process.env,VITE_APP_ENV:'DEV',VITE_RUNTIME_BACKEND:'firebase-only',VITE_USE_FIREBASE_EMULATORS:'true',VITE_FIREBASE_EMULATOR_PROJECT_ID:'demo-hnl-qltc-rules'}});
const url='http://127.0.0.1:'+port+'/scripts/fixtures/crew-auto-team/index.html';
let logs='',browser;for(const s of [server.stdout,server.stderr])s.on('data',d=>logs+=String(d));
const evidence='runtime-evidence/crew-auto-team';fs.mkdirSync(evidence,{recursive:true});const results=[];
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert(ready,logs.slice(-2000));
 browser=await chromium.launch({headless:true});
 for(const width of [1280,393]){
  const ctx=await browser.newContext({viewport:{width,height:852},isMobile:width<500,hasTouch:width<500,locale:'vi-VN'});
  const page=await ctx.newPage();const errors=[],alerts=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{alerts.push(d.message());await d.dismiss();});
  await page.goto(url+'?profile='+width,{waitUntil:'domcontentloaded'});
  await page.locator('[data-hnl-primary-action="crew-record-create"]').click({timeout:35000});
  const form=page.locator('[data-hnl-pc-v3-form="crew-log"]');
  await form.locator('select').filter({has:page.locator('option[value=""]')}).first().selectOption('');
  const name=form.getByPlaceholder('Nhập tên đội thi công tùy chỉnh...');
  await name.fill('Đội tự tạo '+width);
  await form.getByPlaceholder('Ví dụ: Đội trưởng Hùng, Anh Cường...').fill('Trưởng đội thử');
  const counts=form.getByPlaceholder('0',{exact:true});
  await counts.nth(0).fill('7');await counts.nth(1).fill('12');await counts.nth(2).fill('3');
  await page.locator('[data-fixture-failure]').evaluate(el=>el.click());
  await form.locator('button[value="continue"]').click();
  await page.waitForFunction(()=>document.querySelector('[aria-busy="false"][data-hnl-pc-v3-form="crew-log"]'));
  assert.equal(await name.inputValue(),'Đội tự tạo '+width,'failed save preserves draft');
  assert.equal(await page.locator('[data-fixture-ack]').textContent(),'0');
  await page.locator('[data-fixture-failure]').evaluate(el=>el.click());
  await form.locator('button[value="continue"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-fixture-ack]')?.textContent==='1',{timeout:30000});
  const snapshot=await page.evaluate(()=>window.__fixtureCloud);
  const newTeam=snapshot.teams.find(t=>t.name==='Đội tự tạo '+width);
  assert(newTeam?.id?.startsWith('team-auto-v1-'));assert.equal(newTeam.defaultCount,12);
  assert.equal(snapshot.records.length,1);assert.equal(snapshot.records[0].teamId,newTeam.id);assert.equal(snapshot.records[0].workerCount,12);
  assert.equal(await name.inputValue(),'','save & continue clears form');
  assert.equal(await form.locator('option[value="'+newTeam.id+'"]').count(),1,'new team in selector');
  assert.equal(await form.locator('option[value="T-EXIST"]').count(),1,'existing team preserved');
  await page.screenshot({path:evidence+'/'+width+'.png'});
  assert.deepEqual(errors,[]);
  results.push({width,cloudPair:'PASS',countMax:'PASS',failureRetainsDraft:'PASS',saveContinue:'PASS',existingPreserved:'PASS',alerts});
  await ctx.close();
 }
 console.log('CREW AUTO TEAM BROWSER GOLDEN PASS',JSON.stringify(results));
}finally{fs.writeFileSync(evidence+'/result.json',JSON.stringify(results,null,2));await browser?.close();server.kill();}
