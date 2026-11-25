/** Actual QA Android package, loopback Auth/Firestore/Storage only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {_android as android} from 'playwright';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,createUserWithEmailAndPassword} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,setDoc,getDocFromServer,getDocsFromServer,collection,terminate} from 'firebase/firestore';
const project='demo-hnl-qltc-pr492',pkg='com.qlct.app.qa.pr492',origin='http://127.0.0.1:4178';
const pid='qa-pr492-stage12-native',fid='FP-QA-NATIVE',lid='ROOM-LINE-NATIVE',stamp=Date.now();
assert.equal(process.env.QA_PR492_ANDROID_RUNTIME,'true');
assert.equal(process.env.QA_PR492_RUNTIME_EMULATOR_ONLY,'true');
assert.equal(process.env.GITHUB_REF,'refs/heads/qa/pr492-stage3-isolated-20261124');
assert.equal(process.env.GCLOUD_PROJECT,project);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8080');
for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','FIREBASE_SERVICE_ACCOUNT','CLOUDFLARE_API_TOKEN'])assert(!process.env[k]);
const out=fs.mkdtempSync(path.join(os.tmpdir(),'pr492-android-')),artifact='runtime-evidence/pr492-android';
const report={head:process.env.GITHUB_SHA,package:pkg,project,scope:'Actual isolated Android WebView; emulator Auth/Firestore; offline UI and process force-stop, not physical device or real OAuth',status:'RUNNING',checks:[],backendAttempts:[],errors:[],warnings:[]};
const persist=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const step=async(name,fn)=>{report.currentStep=name;persist();console.log('RUN',name);try{await fn();report.checks.push({name,status:'PASS'});console.log('PASS',name)}catch(e){report.checks.push({name,status:'FAIL',error:String(e?.stack||e)});throw e}finally{persist()}};
const wait=async(fn,label,timeout=45000)=>{const end=Date.now()+timeout;let last;while(Date.now()<end){try{const v=await fn();if(v)return v}catch(e){last=String(e)}await new Promise(r=>setTimeout(r,500))}throw Error(label+' timed out; last='+last)};
const adb=(...args)=>execFileSync('adb',args,{encoding:'utf8',timeout:30000});
const clients=[];let server,device,page,logs='';
const fixture=path.resolve('public/qa-stage12-native-floor.svg');
const account=async(role)=>{const app=initializeApp({projectId:project,apiKey:'demo-key',authDomain:project+'.firebaseapp.com'},'seed-'+role),auth=getAuth(app),db=getFirestore(app);clients.push({app,db});connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8080);const email=role.toLowerCase()+'@hnl.test';const {user}=await createUserWithEmailAndPassword(auth,email,'HNL-Emulator-123!');return {db,uid:user.uid,email}};
const ref=(a,c,id)=>doc(a.db,'projects',pid,c,id);
const read=async(a,c,id)=>(await getDocFromServer(ref(a,c,id))).data();
const blocked=/com-example-qlct-61329|hnlqltc\.web\.app|hnl-qltc-dev\.web\.app|hnl-qltc-r2-gateway|firebaseio\.com|firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|firebasestorage\.googleapis\.com/i;
const attach=async()=>{
  const view=await device.webView({pkg});
  const p=await view.page();
  p.on('pageerror',e=>report.errors.push(String(e)));
  p.on('console',m=>{if(['warning','error'].includes(m.type()))report.warnings.push(m.text().slice(0,1200))});
  p.on('request',r=>{if(blocked.test(r.url()))report.backendAttempts.push(r.url().split('?')[0])});
  await p.waitForFunction(()=>location.origin==='http://127.0.0.1:4178',{},{timeout:60000});
  return p;
};
const cache=p=>p.evaluate(async({pid,lid,project})=>{
  const m=await import('/src/lib/firebaseBase.ts');
  if(!m.FIREBASE_EMULATOR_ENABLED||m.FIREBASE_EMULATOR_PROJECT_ID!==project||!window.AndroidStartup)throw Error('native emulator boundary');
  const url=performance.getEntriesByType('resource').map(e=>e.name).find(n=>n.includes('/.vite/deps/firebase_firestore.js?'));
  if(!url)throw Error('SDK module missing');
  const sdk=await import(url),d=await sdk.getDocFromCache(sdk.doc(m.db,'projects',pid,'rooms',lid));
  return {uid:m.auth.currentUser?.uid,pending:d.metadata.hasPendingWrites,data:d.data(),native:!!window.AndroidStartup};
},{pid,lid,project});
const selectFixture=async(p)=>{
  await p.evaluate(({pid})=>{sessionStorage.setItem('active_project_id',pid);sessionStorage.setItem('qlct_active_tab_v1','floorplan');localStorage.setItem('active_project_id',pid)},{pid});
  await p.reload({waitUntil:'domcontentloaded',timeout:60000});
};
const floor=async(p)=>{
  const gate=p.locator('[data-hnl-cache-startup-blocked="true"]'),f=p.getByAltText('Tầng QA Native',{exact:true}).first();
  await wait(async()=>await gate.isVisible()||await f.isVisible(),'native floor or blocked cache',60000);
  if(await gate.isVisible()){
    report.cacheGateRetries=(report.cacheGateRetries||0)+1;persist();
    await new Promise(r=>setTimeout(r,10000));await p.getByRole('button',{name:'Thử lại bộ nhớ offline'}).click();
  }
  await f.waitFor({timeout:60000});
};
try{
 let admin,viewer;
 await step('Seed isolated identities and one native room',async()=>{
  admin=await account('ADMIN');viewer=await account('VIEWER');
  await setDoc(doc(admin.db,'projects',pid),{id:pid,name:'PR492 Native QA',ownerUid:admin.uid,ownerEmail:admin.email,createdAt:stamp,updatedAt:stamp});
  await setDoc(ref(admin,'members',viewer.email),{email:viewer.email,role:'VIEWER',active:true,assignedAt:stamp});
  const life={revision:1,createdAt:stamp,updatedAt:stamp,deleted:false,deletedAt:null};
  await setDoc(ref(admin,'floor_plans',fid),{id:fid,floorName:'Tầng QA Native',imageUrl:origin+'/qa-stage12-native-floor.svg',imageAssetId:'qa-native-asset',imageRevision:1,imageCloudRevision:1,uploadedAt:'2026-11-25',...life});
  await setDoc(ref(admin,'work_volumes','cat-line'),{id:'cat-line',title:'Tuyến QA',workCategoryId:'cat-line',unit:'m',quantity:0,...life});
  await setDoc(ref(admin,'rooms',lid),{id:lid,floorId:fid,floorName:'Tầng QA Native',roomName:'Tuyến phòng QA Native',workCategory:'Tuyến QA',workVolume:7,volumeUnit:'m',categoryVolumes:{'Tuyến QA':7},categoryVolumeUnits:{'Tuyến QA':'m'},x:10,y:20,width:10,height:0,frameStatus:'Chưa làm',boardStatus:'Chưa làm',inspectionStatus:'Chưa nghiệm thu',subItems:[{id:'stage-line',name:'Thi công khung',category:'Tuyến QA',status:'Chưa làm',inspectionStatus:'Chưa nghiệm thu'}],isPolyline:true,points:[{x:10,y:20},{x:20,y:20}],...life});
  assert.equal((await read(viewer,'rooms',lid)).workVolume,7);
 });
 await step('Start isolated Vite and actual installed QA Android package',async()=>{
  assert(!fs.existsSync(fixture),'fixture must not overwrite tracked content');
  fs.writeFileSync(fixture,'<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500"><rect width="1000" height="500" fill="#e6e9ee"/><path d="M100 100H900V400H100Z" fill="none" stroke="#333"/></svg>');
  const env={...process.env,VITE_APP_ENV:'DEV',VITE_USE_FIREBASE_EMULATORS:'true',VITE_FIREBASE_EMULATOR_PROJECT_ID:project,VITE_FIREBASE_EMULATOR_HOST:'127.0.0.1',VITE_FIREBASE_DATABASE_URL:'',VITE_BINARY_STORAGE_PROVIDER:'firebase-storage',VITE_HNL_AI_ENABLED:'false',VITE_ENABLE_LEGACY_DRIVE_WRITE:'false',VITE_ENABLE_LEGACY_LOCAL_BUSINESS_CACHE_WRITE:'false',VITE_R2_GATEWAY_URL:''};
  for(const k of Object.keys(env))if(/^VITE_FIREBASE_(API_KEY|AUTH_DOMAIN|APP_ID|STORAGE_BUCKET|MESSAGING_SENDER_ID|PROJECT_ID)$/.test(k))delete env[k];
  server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4178','--strictPort'],{env,stdio:['ignore','pipe','pipe']});server.stdout.on('data',c=>logs+=String(c));server.stderr.on('data',c=>logs+=String(c));
  await wait(async()=>(await fetch(origin)).ok,'Vite ready');
  const devices=await android.devices();assert.equal(devices.length,1,'exactly one disposable Android device');device=devices[0];
  assert(adb('shell','pm','path',pkg).includes('package:'));adb('shell','am','start','-W','-n',pkg+'/.MainActivity');
  page=await attach();
  await page.locator('[data-hnl-auth-gate="signed-out"]').waitFor({timeout:60000});
  await selectFixture(page);
  await page.locator('[data-hnl-auth-gate="signed-out"]').waitFor({timeout:60000});
  await page.evaluate(async({project})=>{const m=await import('/src/lib/firebaseBase.ts');if(!m.FIREBASE_EMULATOR_ENABLED||m.FIREBASE_EMULATOR_PROJECT_ID!==project||!window.AndroidStartup)throw Error('not isolated native');await m.signInWithEmulatorTestAccount('ADMIN')},{project});
  await floor(page);
  const d=await cache(page);assert(d.native);assert.equal(d.uid,admin.uid);
  await page.screenshot({path:out+'/android-admin-floor.png'});
 });
 await step('Android offline UI save is pending, then force-stop and recover without clearing app data',async()=>{
  const before=await read(viewer,'rooms',lid);
  await wait(async()=>{const d=await cache(page);return !d.pending&&d.data?.revision===before.revision},'exact native cache');
  await page.evaluate(({pid,lid,fid})=>window.dispatchEvent(new CustomEvent('qlct-diagnostic-open-entity',{detail:{entityType:'room',projectId:pid,entityId:lid,floorId:fid}})),{pid,lid,fid});
  await page.locator('[data-hnl-pc-v32-window="room-editor"]').waitFor({timeout:30000});
  await page.context().setOffline(true);await page.waitForFunction(()=>!navigator.onLine);
  await page.locator('[data-hnl-pc-v36-room-status="item"]').getByRole('button',{name:/Đang làm/}).first().click();
  await page.getByRole('button',{name:/Lưu thay đổi nghiệm thu/}).click();
  const pending=await wait(async()=>{const d=await cache(page);return d.pending&&d.data?.revision===before.revision+1&&d.data?.subItems?.some(i=>i.id==='stage-line'&&i.status==='Đang làm')?d:false},'native offline pending');
  assert.equal((await read(viewer,'rooms',lid)).revision,before.revision);
  report.offline={beforeRevision:before.revision,pendingRevision:pending.data.revision};persist();
  await page.screenshot({path:out+'/android-pending.png'});
  // Stop only the QA package. No uninstall, pm clear, storage deletion, or force-own.
  adb('shell','am','force-stop',pkg);await new Promise(r=>setTimeout(r,10000));
  adb('shell','am','start','-W','-n',pkg+'/.MainActivity');page=await attach();
  await page.waitForFunction(()=>navigator.onLine,{},{timeout:30000});
  // The pending write must reach the server on actual process restart, not a browser-only reload.
  const after=await wait(async()=>{const d=await read(viewer,'rooms',lid);return d?.revision===before.revision+1&&d.subItems?.some(i=>i.id==='stage-line'&&i.status==='Đang làm')?d:false},'native process restart commit',90000);
  for(const k of ['id','floorId','workVolume','categoryVolumes','categoryVolumeUnits','x','y','width','height','points'])assert.deepEqual(after[k],before[k]);
  assert.equal((await getDocsFromServer(collection(viewer.db,'projects',pid,'rooms'))).size,1);
  report.offline.afterRevision=after.revision;persist();
  await selectFixture(page);await floor(page);
  await page.screenshot({path:out+'/android-restored.png'});
 });
 await step('Android same profile VIEWER role is read-only',async()=>{
  await page.evaluate(async()=>{const m=await import('/src/lib/firebaseBase.ts');if(!m.FIREBASE_EMULATOR_ENABLED)throw Error('not emulator');await m.signInWithEmulatorTestAccount('VIEWER')});
  await floor(page);
  await page.evaluate(({pid,lid,fid})=>window.dispatchEvent(new CustomEvent('qlct-diagnostic-open-entity',{detail:{entityType:'room',projectId:pid,entityId:lid,floorId:fid}})),{pid,lid,fid});
  await page.locator('[data-hnl-pc-v32-window="room-editor"]').waitFor({timeout:30000});
  await wait(async()=>await page.locator('[data-hnl-prod-highlight-metric-preview]').count()>0&&await page.locator('[data-hnl-prod-take-metric-volume]').count()===0,'viewer read-only');
  assert.equal(await page.locator('[data-hnl-prod-metric-toolbar]').count(),0);assert.equal((await read(viewer,'rooms',lid)).revision,report.offline.afterRevision);
  await page.screenshot({path:out+'/android-viewer.png'});
 });
 await step('No observed real backend attempts or uncaught page errors',async()=>{assert.deepEqual(report.backendAttempts,[]);assert.deepEqual(report.errors,[])});
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=String(e?.stack||e);console.error(e);await page?.screenshot({path:out+'/failure.png',timeout:5000}).catch(()=>{});}
finally{
 persist();fs.writeFileSync(out+'/vite.log',logs);fs.mkdirSync(artifact,{recursive:true});fs.cpSync(out,artifact,{recursive:true});
 await device?.close().catch(()=>{});if(server&&server.exitCode===null)server.kill('SIGTERM');
 for(const c of clients){await terminate(c.db).catch(()=>{});await deleteApp(c.app).catch(()=>{})}
 if(fs.existsSync(fixture))fs.unlinkSync(fixture);
 console.log('FINAL ANDROID QA',report.status,report.checks.length);process.exitCode=report.status==='PASS'?0:1;setTimeout(()=>process.exit(process.exitCode),1000).unref();
}
