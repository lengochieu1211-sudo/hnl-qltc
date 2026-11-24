/** QA-only actual App UI with isolated Auth + Firestore; no mocked save callbacks. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,createUserWithEmailAndPassword} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,setDoc,updateDoc,getDocFromServer,getDocsFromServer,collection,terminate} from 'firebase/firestore';
const project='demo-hnl-qltc-pr492';
assert.equal(process.env.QA_PR492_RUNTIME_EMULATOR_ONLY,'true');
assert.equal(process.env.GCLOUD_PROJECT,project);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8080');
for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','FIREBASE_SERVICE_ACCOUNT','CLOUDFLARE_API_TOKEN'])assert(!process.env[k]);
const origin='http://127.0.0.1:4178',pid='qa-pr492-stage4',fid='FP-QA',rid='ROOM-AREA',lid='ROOM-LINE';
// Keep live evidence outside Vite's watched project. Writing report.json inside it caused full page reloads mid-test.
const out=fs.mkdtempSync(path.join(os.tmpdir(),'pr492-stage4-'));
const artifactOut='runtime-evidence/pr492-stage4-app';
const report={head:process.env.GITHUB_SHA,project,scope:'Full App UI + actual App persistence on local Emulator; no live OAuth/native device',status:'RUNNING',checks:[],blockedExternal:[],backendAttempts:[],errors:[]};
const persist=()=>fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));
const step=async(name,fn)=>{report.currentStep=name;persist();console.log('RUN',name);try{await fn();report.checks.push({name,status:'PASS'});console.log('PASS',name)}catch(e){report.checks.push({name,status:'FAIL',error:String(e?.stack||e)});throw e}finally{persist()}};
const wait=async(fn,label,timeout=30000)=>{const end=Date.now()+timeout;let last;while(Date.now()<end){try{last=await fn();if(last)return last}catch(e){last=e.message}await new Promise(r=>setTimeout(r,400))}throw Error(label+' timed out; last='+JSON.stringify(last))};
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500" viewBox="0 0 1000 500"><rect width="1000" height="500" fill="#e6e9ee"/><path d="M100 100H900V400H100Z M200 100V400 M300 100V400" fill="none" stroke="#333" stroke-width="3"/></svg>';
const img=origin+'/qa-stage4-floor.svg',replacement=origin+'/qa-stage5-floor-v2.svg',stamp=Date.now();
const life={revision:1,createdAt:stamp,updatedAt:stamp,deleted:false,deletedAt:null};
let server,browser,logs='';const clients=[];const pages=[];
const account=async(role)=>{const app=initializeApp({projectId:project,apiKey:'demo-key',authDomain:project+'.firebaseapp.com'},'seed-'+role),auth=getAuth(app),db=getFirestore(app);clients.push({app,db});connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8080);const email=role.toLowerCase()+'@hnl.test';const {user}=await createUserWithEmailAndPassword(auth,email,'HNL-Emulator-123!');return {db,uid:user.uid,email}};
const ref=(a,c,id)=>doc(a.db,'projects',pid,c,id);
const read=async(a,c,id)=>(await getDocFromServer(ref(a,c,id))).data();
const expectVolume=async(a,id,cat,value)=>wait(async()=>{const d=await read(a,'rooms',id);return d?.categoryVolumes?.[cat]===value&&d.id===id?d:false},'server volume '+id+'='+value);
const blocked=/com-example-qlct-61329|hnlqltc\.web\.app|hnl-qltc-dev\.web\.app|hnl-qltc-r2-gateway|firebaseio\.com|firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|firebasestorage\.googleapis\.com/i;
try{
 let admin,editor,viewer;
 await step('Seed disposable project with three real emulator identities and two room records',async()=>{
  admin=await account('ADMIN');editor=await account('EDITOR');viewer=await account('VIEWER');
  await setDoc(doc(admin.db,'projects',pid),{id:pid,name:'PR492 Stage4 QA',ownerUid:admin.uid,ownerEmail:admin.email,createdAt:stamp,updatedAt:stamp});
  for(const [a,role] of [[editor,'EDITOR'],[viewer,'VIEWER']])await setDoc(ref(admin,'members',a.email),{email:a.email,role,active:true,assignedAt:stamp});
  await setDoc(ref(admin,'floor_plans',fid),{id:fid,floorName:'Tầng QA',imageUrl:img,imageAssetId:'qa-asset',imageRevision:1,imageCloudRevision:1,uploadedAt:'2026-11-24',...life});
  for(const [id,title,unit] of [['cat-area','Trần QA','m²'],['cat-line','Tuyến QA','m']])await setDoc(ref(admin,'work_volumes',id),{id,title,workCategoryId:id,unit,quantity:0,...life});
  const room={id:rid,floorId:fid,floorName:'Tầng QA',roomName:'Căn QA',workCategory:'Trần QA',workVolume:7,volumeUnit:'m²',categoryVolumes:{'Trần QA':7},categoryVolumeUnits:{'Trần QA':'m²'},x:10,y:20,width:10,height:20,frameStatus:'Chưa làm',boardStatus:'Chưa làm',inspectionStatus:'Chưa nghiệm thu',subItems:[{id:'stage-qa',name:'Thi công khung',category:'Trần QA',status:'Chưa làm',inspectionStatus:'Chưa nghiệm thu'}],...life};
  await setDoc(ref(admin,'rooms',rid),room);
  await setDoc(ref(admin,'rooms',lid),{...room,id:lid,roomName:'Tuyến phòng QA',workCategory:'Tuyến QA',volumeUnit:'m',categoryVolumes:{'Tuyến QA':7},categoryVolumeUnits:{'Tuyến QA':'m'},subItems:[{id:'stage-line',name:'Thi công khung',category:'Tuyến QA',status:'Chưa làm',inspectionStatus:'Chưa nghiệm thu'}],isPolyline:true,points:[{x:40,y:50},{x:50,y:50}],x:40,y:50,width:10,height:0});
  assert.equal((await read(viewer,'rooms',rid)).workVolume,7);
 });
 const env={...process.env,VITE_APP_ENV:'DEV',VITE_USE_FIREBASE_EMULATORS:'true',VITE_FIREBASE_EMULATOR_PROJECT_ID:project,VITE_BINARY_STORAGE_PROVIDER:'firebase-storage',VITE_HNL_AI_ENABLED:'false',VITE_ENABLE_LEGACY_DRIVE_WRITE:'false',VITE_ENABLE_LEGACY_LOCAL_BUSINESS_CACHE_WRITE:'false',VITE_R2_GATEWAY_URL:''};
 for(const k of Object.keys(env))if(/^VITE_FIREBASE_(API_KEY|AUTH_DOMAIN|APP_ID|STORAGE_BUCKET|MESSAGING_SENDER_ID|PROJECT_ID)$/.test(k))delete env[k];
 server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4178','--strictPort'],{env,stdio:['ignore','pipe','pipe']});server.stdout.on('data',c=>logs+=String(c));server.stderr.on('data',c=>logs+=String(c));
 await wait(async()=> (await fetch(origin)).ok,'Vite ready',45000);
 browser=await chromium.launch({headless:true,...(process.env.QA_CHROME_EXECUTABLE?{executablePath:process.env.QA_CHROME_EXECUTABLE}:{})});
 const open=async(role,mobile=false)=>{
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},locale:'vi-VN',hasTouch:mobile,isMobile:mobile,serviceWorkers:'block'});
  await context.route('**/*',async route=>{const url=route.request().url();if(url===img||url===replacement){await route.fulfill({contentType:'image/svg+xml',body:url===img?svg:svg.replace('#e6e9ee','#cbd5e1')});return}const u=new URL(url);if(['127.0.0.1','localhost'].includes(u.hostname)&&['4178','8080','9099','9199'].includes(u.port)){await route.continue();return}if(blocked.test(url))report.backendAttempts.push(url.split('?')[0]);report.blockedExternal.push(u.origin);await route.abort()});
  await context.addInitScript(({pid})=>{sessionStorage.setItem('active_project_id',pid);sessionStorage.setItem('qlct_active_tab_v1','floorplan')},{pid});
  const page=await context.newPage();pages.push(page);page.on('pageerror',e=>report.errors.push(role+': '+String(e)));await page.goto(origin,{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('[data-hnl-auth-gate="signed-out"]').waitFor({timeout:40000});
  await page.evaluate(async(role)=>{const m=await import('/src/lib/firebaseBase.ts');if(!m.FIREBASE_EMULATOR_ENABLED)throw Error('emulator guard');await m.signInWithEmulatorTestAccount(role)},role);
  await page.locator('[data-hnl-workspace-module="floorplan"]').waitFor({timeout:60000});
  await page.getByAltText('Tầng QA',{exact:true}).first().waitFor({timeout:45000});
  await page.screenshot({path:out+'/'+role.toLowerCase()+'-floor.png'});
  return {page,context};
 };
 let A,V;
 await step('Actual App authenticated ADMIN PC and VIEWER phone, project floor loaded',async()=>{A=await open('ADMIN');V=await open('VIEWER',true);assert.equal(await V.page.locator('[data-hnl-prod-metric-toolbar]').count(),0)});
 const modal=async(page,id)=>{await page.evaluate(({pid,id,fid})=>window.dispatchEvent(new CustomEvent('qlct-diagnostic-open-entity',{detail:{entityType:'room',projectId:pid,entityId:id,floorId:fid}})),{pid,id,fid});await page.locator('[data-hnl-pc-v32-window="room-editor"]').waitFor({timeout:15000})};
 const dismiss=async(page)=>{page.once('dialog',d=>d.dismiss())};
 const accept=async(page)=>{page.once('dialog',d=>d.accept())};
 await step('Actual two-point calibration: cancel does not write; Save persists to server',async()=>{
  const p=A.page;const toolbar=p.locator('[data-hnl-prod-metric-toolbar]');const group=toolbar.locator('xpath=ancestor::details[1]');await group.waitFor();await p.getByAltText('Tầng QA',{exact:true}).first().evaluate(async img=>{await img.decode()});await wait(async()=>{if(await toolbar.isVisible())return true;if(!await group.evaluate(e=>e.open))await group.locator('xpath=./summary').click({timeout:5000});return await toolbar.isVisible()},'drawing toolbar visible',20000);await toolbar.click();const canvas=p.locator('[data-hnl-prod-metric-canvas]');await canvas.waitFor();await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();assert(box&&box.width>100);
  await p.getByLabel('Chiều dài chuẩn mét').fill('10');
  // Use bottom half away from the calibration card overlay.
  await canvas.click({position:{x:box.width*.5,y:box.height*.8}});await canvas.click({position:{x:box.width*.6,y:box.height*.8}});
  await p.getByText('Điểm đã chọn: 2/2',{exact:false}).waitFor();
  const save=p.getByRole('button',{name:'Lưu tỷ lệ',exact:true});await dismiss(p);await save.click();assert(!(await read(viewer,'floor_plans',fid)).highlightMetricCalibration);
  await accept(p);await save.click();const f=await wait(async()=>{const d=await read(viewer,'floor_plans',fid);return d?.highlightMetricCalibration||false},'calibration persisted');
  assert(Math.abs(f.metresPerPixel-.1)<.005,'unexpected scale '+f.metresPerPixel);report.calibration=f;
 });
 const draft=metric=>metric.evaluate(b=>Number(String(b.parentElement.querySelector('input').value).replace(/\s/g,'').replace(',','.')));
 await step('Actual ADMIN area Cancel and draft leave server unchanged; explicit form Save writes',async()=>{
  const p=A.page;await modal(p,rid);const metric=p.locator('[data-hnl-prod-take-metric-volume]').first();await metric.waitFor();assert.equal(await draft(metric),7);assert(!(await metric.isDisabled()));
  await dismiss(p);await metric.click();assert.equal(await draft(metric),7);
  await accept(p);await metric.click();const value=await draft(metric);assert(Math.abs(value-100)<3,'area '+value);assert.equal((await read(viewer,'rooms',rid)).categoryVolumes['Trần QA'],7);
  await p.screenshot({path:out+'/area-draft.png'});await p.getByRole('button',{name:/Lưu thay đổi nghiệm thu/}).click();await expectVolume(viewer,rid,'Trần QA',value);report.area=value;
  await modal(V.page,rid);const preview=V.page.locator('[data-hnl-prod-highlight-metric-preview]').first();await preview.waitFor();assert.equal(await V.page.locator('[data-hnl-prod-take-metric-volume]').count(),0);await wait(async()=>await draft(preview)===value,'VIEWER App receives saved area');await V.page.screenshot({path:out+'/viewer-area.png'});
 });
 await step('Reload App and verify persisted ADMIN quantity, no duplicate rooms',async()=>{
  await A.page.reload({waitUntil:'domcontentloaded'});await A.page.getByAltText('Tầng QA',{exact:true}).first().waitFor({timeout:45000});await modal(A.page,rid);const metric=A.page.locator('[data-hnl-prod-take-metric-volume]').first();await metric.waitFor();assert.equal(await draft(metric),report.area);const docs=await getDocsFromServer(collection(viewer.db,'projects',pid,'rooms'));assert.deepEqual(docs.docs.map(d=>d.id).sort(),[rid,lid].sort());
 });
 await step('Actual mobile ADMIN line: offline Save stays local and reconnect persists once',async()=>{
  const M=await open('ADMIN',true),p=M.page;await modal(p,lid);const metric=p.locator('[data-hnl-prod-take-metric-volume]').first();await metric.waitFor();assert.equal(await metric.innerText(),'Lấy chiều dài');assert.equal(await draft(metric),7);
  const rect=await p.locator('[data-hnl-pc-v32-window="room-editor"] .hnl-ios-safe-dialog').boundingBox();assert(rect&&rect.x>=-1&&rect.x+rect.width<=391,'mobile dialog overflows');
  await M.context.setOffline(true);await p.waitForFunction(()=>!navigator.onLine);await wait(async()=>await metric.isEnabled(),'verified offline role');
  await accept(p);await metric.click();const value=await draft(metric);assert(Math.abs(value-10)<.25,'length '+value);assert.equal((await read(viewer,'rooms',lid)).categoryVolumes['Tuyến QA'],7);
  await p.screenshot({path:out+'/mobile-line-offline-draft.png'});await p.getByRole('button',{name:/Lưu thay đổi nghiệm thu/}).click();await new Promise(r=>setTimeout(r,1200));assert.equal((await read(viewer,'rooms',lid)).categoryVolumes['Tuyến QA'],7,'offline server changed');
  await M.context.setOffline(false);await p.waitForFunction(()=>navigator.onLine);await expectVolume(viewer,lid,'Tuyến QA',value);
  const docs=await getDocsFromServer(collection(viewer.db,'projects',pid,'rooms'));assert.deepEqual(docs.docs.map(d=>d.id).sort(),[rid,lid].sort());report.length=value;await p.screenshot({path:out+'/mobile-line-reconnected.png'});
 });
 await step('Offline saved progress survives page close and online restart without changing quantity',async()=>{
  const M=await open('ADMIN',true),p=M.page;
  await modal(p,lid);const before=await read(viewer,'rooms',lid);
  const progress=p.locator('[data-hnl-pc-v36-room-status="item"]').getByRole('button',{name:/Đang làm/}).first();
  await M.context.setOffline(true);await p.waitForFunction(()=>!navigator.onLine);
  await progress.click();await p.getByRole('button',{name:/Lưu thay đổi nghiệm thu/}).click();
  await p.locator('[data-hnl-pc-v32-window="room-editor"]').waitFor({state:'hidden'});
  await new Promise(r=>setTimeout(r,1800));
  assert.equal((await read(viewer,'rooms',lid)).frameStatus,before.frameStatus);
  await p.close();await M.context.setOffline(false);
  const restarted=await M.context.newPage();pages.push(restarted);restarted.on('pageerror',e=>report.errors.push('restart: '+String(e)));
  await restarted.goto(origin,{waitUntil:'domcontentloaded',timeout:45000});await restarted.getByAltText('Tầng QA',{exact:true}).first().waitFor({timeout:45000});
  const after=await wait(async()=>{const d=await read(viewer,'rooms',lid);return d?.subItems?.some(i=>i.id==='stage-line'&&i.status==='Đang làm')?d:false},'pending saved progress survives page restart',45000);
  for(const k of ['id','floorId','categoryVolumes','categoryVolumeUnits','x','y','width','height','points'])assert.deepEqual(after[k],before[k]);
  report.restartProgress=after.subItems.find(i=>i.id==='stage-line').status;
  await restarted.screenshot({path:out+'/offline-restart-synced.png'});
 });
 await step('Actual EDITOR updates progress without changing official volume, geometry or IDs',async()=>{
  const E=await open('EDITOR',true),p=E.page;
  assert.equal(await p.locator('[data-hnl-prod-metric-toolbar]').count(),0);
  await modal(p,rid);await p.getByText(/Kỹ sư chỉ cập nhật tiến độ/).waitFor();
  assert.equal(await p.locator('[data-hnl-prod-take-metric-volume]').count(),0);
  const preview=p.locator('[data-hnl-prod-highlight-metric-preview]').first();await preview.waitFor();
  assert.equal(await draft(preview),report.area);
  assert(await preview.evaluate(b=>b.parentElement.querySelector('input').disabled));
  const before=await read(viewer,'rooms',rid);
  const progress=p.locator('[data-hnl-pc-v36-room-status="item"]').getByRole('button',{name:/Đang làm/}).first();
  await progress.click();await p.screenshot({path:out+'/editor-progress-draft.png'});
  assert.equal((await read(viewer,'rooms',rid)).frameStatus,before.frameStatus);
  await p.getByRole('button',{name:/Lưu thay đổi nghiệm thu/}).click();
  const after=await wait(async()=>{const d=await read(viewer,'rooms',rid);return d?.subItems?.some(i=>i.id==='stage-qa'&&i.status==='Đang làm')?d:false},'EDITOR progress saved');
  for(const k of ['id','floorId','roomName','workVolume','categoryVolumes','categoryVolumeUnits','x','y','width','height','points','isPolyline'])assert.deepEqual(after[k],before[k],k+' changed by EDITOR');
  report.editorProgress=after.subItems.find(i=>i.id==='stage-qa').status;
 });
 let staleSession;
 await step('Prepare a different valid metric draft while official quantity stays unchanged',async()=>{
  const before=await read(admin,'floor_plans',fid);
  const c=before.highlightMetricCalibration;assert(c);
  await updateDoc(ref(admin,'floor_plans',fid),{highlightMetricCalibration:{...c,actualMetres:c.actualMetres*2,metresPerPixel:c.metresPerPixel*2,updatedAt:Date.now()},revision:before.revision+1,updatedAt:Date.now()});
  staleSession=await open('ADMIN');const p=staleSession.page;await modal(p,rid);
  const metric=p.locator('[data-hnl-prod-take-metric-volume]').first();
  await metric.waitFor();await accept(p);await metric.click();
  assert(Math.abs(await draft(metric)-report.area*4)<.01,'draft must differ from official quantity');
  assert.equal((await read(viewer,'rooms',rid)).categoryVolumes['Trần QA'],report.area);
 });
 await step('Concurrent replacement of source image resets two selected points and preserves saved official quantities',async()=>{
  const S=await open('ADMIN'),p=S.page;
  const toolbar=p.locator('[data-hnl-prod-metric-toolbar]'),group=toolbar.locator('xpath=ancestor::details[1]');
  await p.getByAltText('Tầng QA',{exact:true}).first().evaluate(async el=>{await el.decode()});
  await wait(async()=>{if(await toolbar.isVisible())return true;if(!await group.evaluate(e=>e.open))await group.locator('xpath=./summary').click({timeout:5000});return await toolbar.isVisible()},'drawing toolbar visible',20000);
  await toolbar.click();
  const canvas=p.locator('[data-hnl-prod-metric-canvas]'),save=p.getByRole('button',{name:'Lưu tỷ lệ',exact:true});
  await canvas.waitFor();await canvas.scrollIntoViewIfNeeded();let box=await canvas.boundingBox();assert(box&&box.width>100);
  await p.getByLabel('Chiều dài chuẩn mét').fill('20');
  await canvas.click({position:{x:box.width*.5,y:box.height*.8}});await canvas.click({position:{x:box.width*.6,y:box.height*.8}});
  await p.getByText('Điểm đã chọn: 2/2',{exact:false}).waitFor();assert(await save.isEnabled());
  const before=await read(admin,'floor_plans',fid);
  await updateDoc(ref(admin,'floor_plans',fid),{imageUrl:replacement,imageAssetId:'qa-replacement-asset',imageRevision:2,imageCloudRevision:2,revision:before.revision+1,updatedAt:Date.now()});
  await p.locator('img[src="'+replacement+'"]').first().waitFor({timeout:45000});
  await p.getByText('Điểm đã chọn: 0/2',{exact:false}).waitFor({timeout:20000});assert(await save.isDisabled());
  await p.screenshot({path:out+'/replacement-clears-points.png'});
  const replaced=await read(viewer,'floor_plans',fid);assert.equal(replaced.imageAssetId,'qa-replacement-asset');assert.deepEqual(replaced.highlightMetricCalibration,before.highlightMetricCalibration);
  assert.equal((await read(viewer,'rooms',rid)).categoryVolumes['Trần QA'],report.area);
  assert.equal((await read(viewer,'rooms',lid)).categoryVolumes['Tuyến QA'],report.length);
  await p.getByRole('button',{name:'Đóng đo tỷ lệ'}).click();await modal(p,rid);
  const preview=p.locator('[data-hnl-prod-highlight-metric-preview]').first();await preview.waitFor();assert.match(await preview.innerText(),/Chưa gán tỷ lệ/);assert(await p.locator('[data-hnl-prod-take-metric-volume]').first().isDisabled());
  await p.screenshot({path:out+'/replacement-invalid-metric.png'});
  report.replacement={sourceAsset:replaced.imageAssetId,clearedPoints:true,oldCalibrationPreservedButInvalid:true};
 });
 await step('Stale measured draft must not be committed after image replacement',async()=>{
  const p=staleSession.page,preview=p.locator('[data-hnl-prod-highlight-metric-preview]').first();
  await wait(async()=>/Chưa gán tỷ lệ/.test(await preview.innerText()),'stale session sees replacement');
  assert(await p.locator('[data-hnl-prod-take-metric-volume]').first().isDisabled());
  const dialogs=[];const handle=async d=>{dialogs.push(d.message());await d.dismiss()};p.on('dialog',handle);
  try{await p.getByRole('button',{name:/Lưu thay đổi nghiệm thu/}).click();await new Promise(r=>setTimeout(r,2500));}finally{p.off('dialog',handle)}
  const after=await read(viewer,'rooms',rid);report.staleDraft={before:report.area,after:after.categoryVolumes['Trần QA'],dialogs};
  await p.screenshot({path:out+'/stale-draft-save.png'});
  assert.equal(after.categoryVolumes['Trần QA'],report.area,'stale draft overwrote official quantity');
  assert(await p.locator('[data-hnl-pc-v32-window="room-editor"]').isVisible(),'stale save must not close modal');
  assert(dialogs.some(m=>/tỷ lệ|số đo|mặt bằng/i.test(m)),'explain why saving is blocked');
  await p.locator('[data-hnl-prod-metric-stale-draft]').waitFor();
  // Discard explicitly; ordinary manual quantity remains available in a fresh form.
  await accept(p);await p.locator('[data-hnl-pc-v32-window="room-editor"]').getByTitle('Đóng',{exact:true}).click();
  await p.locator('[data-hnl-pc-v32-window="room-editor"]').waitFor({state:'hidden'});
  await modal(p,rid);const fresh=p.locator('[data-hnl-prod-highlight-metric-preview]').first();await fresh.waitFor();
  assert.equal(await draft(fresh),report.area);assert.equal(await p.locator('[data-hnl-prod-metric-stale-draft]').count(),0);
  const input=fresh.locator('xpath=..').locator('input');await input.fill(String(report.area+1));await input.blur();
  await p.getByRole('button',{name:/Lưu thay đổi nghiệm thu/}).click();await expectVolume(viewer,rid,'Trần QA',report.area+1);
  report.manualAfterDiscard=report.area+1;
 });
 await step('No attempted real backend and no uncaught browser errors',async()=>{assert.deepEqual(report.backendAttempts,[]);assert.deepEqual(report.errors,[])});
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=String(e?.stack||e);console.error(e);for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:out+'/failure-'+i+'.png',timeout:5000}).catch(()=>{});}
finally{persist();fs.writeFileSync(out+'/vite.log',logs);await browser?.close().catch(()=>{});if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>{server.once('exit',resolve);setTimeout(resolve,2000)})}fs.mkdirSync(artifactOut,{recursive:true});fs.cpSync(out,artifactOut,{recursive:true});for(const c of clients){await terminate(c.db).catch(()=>{});await deleteApp(c.app).catch(()=>{})}console.log('FINAL APP QA',report.status,report.checks.length);process.exitCode=report.status==='PASS'?0:1;setTimeout(()=>process.exit(process.exitCode),1000).unref()}
