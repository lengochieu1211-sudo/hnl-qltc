/** Browser QA for a synthetic DEV-only emulator. No PROD/DEV live endpoints or writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const project='demo-hnl-qltc-pr492';
assert.equal(process.env.VITE_APP_ENV,'DEV');
assert.equal(process.env.VITE_USE_FIREBASE_EMULATORS,'true');
assert.equal(process.env.VITE_FIREBASE_EMULATOR_PROJECT_ID,project);
assert.equal(process.env.QA_PR492_RUNTIME_EMULATOR_ONLY,'true');
const out='runtime-evidence/pr492-simple-emulator';fs.mkdirSync(out,{recursive:true});
const report={head:process.env.GITHUB_SHA,project,host:'127.0.0.1:4178',scenarios:[],forbiddenRequests:[],status:'IN_PROGRESS'};
const forbidden=/com-example-qlct-61329|hnlqltc\.web\.app|hnl-qltc-dev\.web\.app|hnl-qltc-r2-gateway\.|firebaseio\.com|googleapis\.com\/identitytoolkit/i;
const serverEnv={...process.env,VITE_APP_ENV:'DEV',VITE_USE_FIREBASE_EMULATORS:'true',VITE_FIREBASE_EMULATOR_PROJECT_ID:project,
 VITE_BINARY_STORAGE_PROVIDER:'firebase-storage',VITE_HNL_AI_ENABLED:'false',VITE_ENABLE_LEGACY_DRIVE_WRITE:'false',VITE_ENABLE_LEGACY_LOCAL_BUSINESS_CACHE_WRITE:'false',VITE_R2_GATEWAY_URL:''};
for(const key of Object.keys(serverEnv))if(/^VITE_FIREBASE_(API_KEY|AUTH_DOMAIN|APP_ID|STORAGE_BUCKET|MESSAGING_SENDER_ID|PROJECT_ID)$/.test(key))delete serverEnv[key];
let server,browser,logs='';
try{
 const p=await fetch('http://127.0.0.1:9099/',{signal:AbortSignal.timeout(4000)});assert(p.status<500,'Auth Emulator is unavailable');
 server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4178','--strictPort'],{env:serverEnv,stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',c=>logs+=String(c));server.stderr.on('data',c=>logs+=String(c));
 let up=false;for(let i=0;i<140;i++){try{if((await fetch('http://127.0.0.1:4178/')).ok){up=true;break}}catch{}await new Promise(r=>setTimeout(r,300))}
 assert(up,'Vite failed: '+logs.slice(-1500));
 browser=await chromium.launch({headless:true,...(process.env.QA_CHROME_EXECUTABLE?{executablePath:process.env.QA_CHROME_EXECUTABLE}:{})});
 const make=async(viewport)=>{
   const context=await browser.newContext({viewport,locale:'vi-VN'});const page=await context.newPage();
   page.on('request',r=>{if(forbidden.test(r.url()))report.forbiddenRequests.push(r.url().replace(/\?.*$/,''));});
   return {context,page};
 };
 for(const [role,viewport] of [['ADMIN',{width:1440,height:900}],['EDITOR',{width:1280,height:800}],['VIEWER',{width:390,height:844}]]){
   const {context,page}=await make(viewport);
   try{
     const errors=[];page.on('pageerror',e=>errors.push(String(e)));
     await page.goto('http://127.0.0.1:4178/',{waitUntil:'domcontentloaded',timeout:35000});
     await page.locator('[data-hnl-pr492-emulator-auth="true"]').waitFor({timeout:25000});
     assert.equal(await page.locator('[data-hnl-pr492-test-login]').count(),3);
     const resp=page.waitForResponse(r=>r.status()===200 && /accounts:(signUp|signInWithPassword)/.test(r.url()),{timeout:30000});
     await page.locator(`[data-hnl-pr492-test-login="${role}"]`).click();
     const identity=await(await resp).json();assert.equal(identity.email,`${role.toLowerCase()}@hnl.test`);
     await page.locator('[data-hnl-auth-gate="signed-out"]').waitFor({state:'hidden',timeout:40000});
     assert.equal(errors.length,0,`${role} page errors: `+errors.join(';'));
     assert.equal(report.forbiddenRequests.length,0,'Emulator app contacted live backend');
     await page.screenshot({path:`${out}/${role.toLowerCase()}-login.png`,fullPage:false});
     report.scenarios.push({scenario:`emulator-login-${role}`,result:'PASS',realGoogle:false});
   }finally{await context.close()}
 }
 const scenarios=['area','line','noScale','locked','accepted','readonly','wall','legacy'];
 for(const scenario of scenarios){
   const {context,page}=await make(scenario==='line'?{width:390,height:844}:{width:1440,height:900});
   try{
     const errors=[];page.on('pageerror',e=>errors.push(String(e)));
     await page.goto(`http://127.0.0.1:4178/qa-pr492-metric-harness.html?scenario=${scenario}`,{waitUntil:'domcontentloaded',timeout:35000});
     await page.locator('[data-hnl-qa-ready="true"]').waitFor({timeout:25000});
     const metric=page.locator('[data-hnl-prod-take-metric-volume]');
     let measured=null;
     if(scenario==='readonly')assert.equal(await metric.count(),0,'Readonly must have NO take button');
     else{
       await metric.first().waitFor({timeout:20000});
       const disabled=await metric.first().isDisabled();
       if(['noScale','locked','accepted','wall','legacy'].includes(scenario))assert(disabled,`${scenario} must block take metric`);
       else{
         assert(!disabled,`${scenario} needs enabled take button`);
         const label=(await metric.first().innerText()).trim();
         if(scenario==='area')assert.equal(label,'Lấy diện tích');
         if(scenario==='line')assert.equal(label,'Lấy chiều dài');
         const readDraft=()=>metric.first().evaluate(btn=>btn.parentElement?.querySelector('input')?.value ?? null);
         const normalizeDraft=value=>Number(String(value).replace(/\s/g,'').replace(',','.'));
         assert.equal(normalizeDraft(await readDraft()),7,'Original manual quantity must remain 7');
         await page.screenshot({path:`${out}/metric-${scenario}-before.png`,fullPage:false});
         // A negative confirmation leaves official quantity and in-memory draft unchanged.
         page.once('dialog',dialog=>dialog.dismiss());await metric.first().click();
         assert.equal(normalizeDraft(await readDraft()),7,'Cancel must retain original quantity');
         assert.equal(await page.evaluate(()=>window.__qa.savedRooms.length),0);
         page.once('dialog',dialog=>dialog.accept());await metric.first().click();
         const expected=scenario==='area'?100:10;
         const current=normalizeDraft(await readDraft());
         assert.equal(current,expected,'Explicit take must copy exact measured area/length into DRAFT');
         assert.equal(await page.evaluate(()=>window.__qa.savedRooms.length),0,'Take metric alone wrote official data');
         await page.screenshot({path:`${out}/metric-${scenario}-draft.png`,fullPage:false});
         // Actual form Save invokes the existing onSaveRoom callback.
         const save=page.getByRole('button',{name:/Lưu thay đổi nghiệm thu/});await save.click();
         await page.waitForFunction(()=>window.__qa.savedRooms.length===1,null,{timeout:25000});
         const data=await page.evaluate(()=>({saved:window.__qa.savedRooms[0],base:window.__qa.baseRoom}));
         assert.equal(data.saved.id,'qa-room','Room ID must persist');
         assert.equal(data.saved.categoryVolumes['Trần QA'],expected,'Measured value must be written only through Save');
         assert.equal(data.base.categoryVolumes['Trần QA'],7,'Original room fixture mutated');
         measured={old:7,draft:current,saved:expected,unit:scenario==='area'?'m²':'m'};
       }
     }
     assert.equal(errors.length,0,`${scenario} page errors: `+errors.join(';'));
     assert.equal(report.forbiddenRequests.length,0,'Fixture contacted live backend');
     await page.screenshot({path:`${out}/metric-${scenario}.png`,fullPage:false});
     report.scenarios.push({scenario:`metric-${scenario}`,result:'PASS',mode:'in-memory-UI-only',...(measured?{measured}:{})});
   }finally{await context.close()}
 }
 report.status='PASS';console.log('PASS: '+report.scenarios.length+' QA scenarios; no live Firebase/PROD requests');
}catch(e){report.status='FAIL';report.error=String(e?.stack||e);console.error(e);process.exitCode=1}
finally{fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));if(browser)await browser.close().catch(()=>{});if(server&&server.exitCode===null)server.kill('SIGTERM')}
