import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const project='demo-hnl-qltc-dev',web='http://127.0.0.1:4179';
assert.equal(process.env.DEV_AUTO_TEST_ENV,'isolated-emulator');
assert.equal(process.env.VITE_APP_ENV,'DEV');
assert.equal(process.env.VITE_USE_FIREBASE_EMULATORS,'true');
assert.equal(process.env.VITE_FIREBASE_EMULATOR_PROJECT_ID,project);
const env={...process.env,VITE_APP_ENV:'DEV',VITE_USE_FIREBASE_EMULATORS:'true',VITE_FIREBASE_EMULATOR_PROJECT_ID:project,VITE_FIREBASE_EMULATOR_HOST:'127.0.0.1',VITE_RUNTIME_BACKEND:'firebase-only'};
for(const key of Object.keys(env))if(/^VITE_(FIREBASE_API_KEY|FIREBASE_AUTH_DOMAIN|FIREBASE_APP_ID|R2_GATEWAY_URL|HNL_AI_GATEWAY_URL)$/.test(key))delete env[key];
const dir='runtime-evidence/dev-warehouse-transfer';fs.mkdirSync(dir,{recursive:true});
const rpt={project,checks:[],status:'PENDING'};
const fx={a:'golden-project-A',b:'golden-project-B',id:'XK-TEST-10'};
const pages={};let browser,server;
async function exec(role,op,args={}){return pages[role].page.evaluate(async payload=>{
 const {execute}=await import('/scripts/dev-warehouse-transfer-emulator-harness.ts');
 try{return {ok:true,data:await execute(payload.op,payload.args)};}
 catch(e){return {ok:false,error:String(e?.code||e?.message||e)}};
},{op,args:{...fx,...args}})}
async function yes(role,op,args={}){const r=await exec(role,op,args);assert(r.ok,role+'.'+op+': '+r.error);return r.data;}
function pass(name,got,want){assert.deepEqual(got,want,name);rpt.checks.push(name);console.log('PASS',name)}
async function no(name,role,op,args,pattern){const r=await exec(role,op,args);assert(!r.ok,'Unsafe allowed: '+name);assert.match(r.error,new RegExp(pattern,'i'));rpt.checks.push(name)}
const state=(id='XK-TEST-10',unit='tấm')=>yes('ADMIN','state',{id,unit});
try{
 assert((await fetch('http://127.0.0.1:9099/')).status<500);
 server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4179','--strictPort'],{env,stdio:'ignore'});
 let up=false;for(let n=0;n<100;n++){try{if((await fetch(web)).ok){up=true;break}}catch{}await new Promise(r=>setTimeout(r,250))}
 assert(up,'Vite startup failed');browser=await chromium.launch();
 for(const [role,viewport] of [['ADMIN',{width:1440,height:900}],['EDITOR',{width:1280,height:800}],['VIEWER',{width:393,height:852}]]){
  const context=await browser.newContext({viewport});
  await context.route('**/*',route=>{try{const host=new URL(route.request().url()).hostname;return host==='127.0.0.1'||host==='localhost'?route.continue():route.abort()}catch{return route.continue()}});
  const page=await context.newPage();pages[role]={page,context};
  await page.goto(web);await page.locator('[data-hnl-dev-test-role="'+role+'"]').waitFor();
  await page.locator('[data-hnl-dev-test-role="'+role+'"]').click();
  await page.locator('[data-hnl-auth-gate="signed-out"]').waitFor({state:'hidden'});
  pass('Auth '+role,(await yes(role,'identity')).email,role.toLowerCase()+'@hnl.test');
  await page.screenshot({path:dir+'/'+role.toLowerCase()+'.png'});
 }
 await yes('ADMIN','seed');pass('Initial stock A and B',[(await state()).sourceOnHand,(await state()).targetOnHand],[10,0]);
 await no('VIEWER OUT denied','VIEWER','out',{},'permission|unauthorized');
 await no('EDITOR OUT A denied','EDITOR','out',{},'permission|unauthorized');
 pass('Denied without stock mutation',(await state()).sourceOnHand,10);
 await pages.ADMIN.context.setOffline(true);await no('Offline OUT blocked','ADMIN','out',{},'TRANSFER_OFFLINE_BLOCKED');
 await pages.ADMIN.context.setOffline(false);pass('Reconnect unchanged',(await state()).sourceOnHand,10);
 await yes('VIEWER','watch');
 pass('Create OUT',(await yes('ADMIN','out')).duplicate,false);
 pass('Atomic A -10 B pending',[(await state()).sourceOnHand,(await state()).targetOnHand,(await state()).incoming?.status],[0,0,'pending']);
 pass('Same ID exact retry',(await yes('ADMIN','out')).duplicate,true);
 await no('Changed quantity conflict','ADMIN','out',{quantity:9},'TRANSFER_RETRY_CONFLICT');
 await no('Wrong unit denied','EDITOR','in',{mappedUnit:'thùng'},'TRANSFER_UNIT_MISMATCH');
 await no('VIEWER IN denied','VIEWER','in',{},'permission|unauthorized');
 await pages.EDITOR.context.setOffline(true);await no('Offline IN blocked','EDITOR','in',{},'TRANSFER_OFFLINE_BLOCKED');
 await pages.EDITOR.context.setOffline(false);
 pass('Pending remains',(await state()).incoming?.status,'pending');
 const editorReceive=await exec('EDITOR','in');
 if(!editorReceive.ok){
   try {
     const url='http://127.0.0.1:8080/emulator/v1/projects/demo-hnl-qltc-dev:ruleCoverage';
     const response=await fetch(url,{signal:AbortSignal.timeout(4000)});
     if(response.ok)fs.writeFileSync(dir+'/firestore-rule-coverage.json',await response.text());
   } catch(e){console.log('RULE_COVERAGE_UNAVAILABLE',String(e));}
   const adminReceive=await exec('ADMIN','in');
   throw new Error('RECEIVE_DIAG: EDITOR='+editorReceive.error+'; ADMIN='+JSON.stringify(adminReceive));
 }
 pass('Receive FULL',editorReceive.data.duplicate,false);
 pass('B stock +10 once',[(await state()).targetOnHand,(await state()).incoming?.status,(await state()).receipt?.quantity],[10,'received',10]);
 pass('EDITOR preserves existing target unit label',[(await state()).targetUnit,(await state()).receipt?.unit],['tấm','tấm']);
 pass('Duplicate IN ignored',(await yes('EDITOR','in')).duplicate,true);
 pass('No double credit',(await state()).targetOnHand,10);
 const events=await yes('VIEWER','updates');pass('Realtime pending and received',events.includes('pending')&&events.includes('received'),true);
 await yes('VIEWER','stopWatch');await no('Insufficient stock','ADMIN','out',{id:'XK-NO-STOCK',quantity:1},'INSUFFICIENT_STOCK');
 pass('Unit m2 source transfer',(await yes('ADMIN','out',{id:'XK-M2',unit:'m2',quantity:2})).duplicate,false);
 const u=await state('XK-M2','m2');pass('m2 parity',[u.sourceOnHand,u.outgoing?.unit,u.incoming?.unit],[1,'m2','m2']);
 rpt.status='PASS';
}catch(e){rpt.status='FAIL';rpt.error=String(e?.stack||e);process.exitCode=1;console.error(e)}
finally{fs.writeFileSync(dir+'/report.json',JSON.stringify(rpt,null,2));for(const {context} of Object.values(pages))await context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});if(server&&server.exitCode===null)server.kill('SIGTERM')}
