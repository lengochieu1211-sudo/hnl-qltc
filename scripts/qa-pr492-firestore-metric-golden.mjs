/** QA-only SDK/Rules integration test; no Hosting, R2, or real project access.
 * Run via Firebase emulators:exec with disposable demo project (see report).
 * Not an App/Google OAuth/physical-device end-to-end certification.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createFloorMetricCalibration, measureRoomHighlightAreaM2, measureRoomHighlightLengthM, getValidFloorMetricCalibration } from '../src/utils/floorMetricGeometry.ts';
const projectId='demo-hnl-qltc-pr492';
assert.equal(process.env.QA_PR492_RUNTIME_EMULATOR_ONLY,'true','explicit QA flag required');
assert.equal(process.env.GCLOUD_PROJECT,projectId,'must run under emulators:exec --project '+projectId);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8080');
for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','FIREBASE_SERVICE_ACCOUNT']) assert(!process.env[key],`Refusing cloud credentials (${key})`);
const dir='runtime-evidence/pr492-firestore-metric'; mkdirSync(dir,{recursive:true});
const report={projectId,scope:'Firebase SDK + real local emulator Rules only; no App UI or live Google OAuth',status:'RUNNING',checks:[]};
const deadline=setTimeout(()=>{report.status='FAIL';report.error='Global timeout';writeFileSync(dir+'/report.json',JSON.stringify(report,null,2));process.exit(1)},120000);
const apps=[]; let disableNetwork,enableNetwork,deleteApp,terminate;
const persist=()=>writeFileSync(dir+'/report.json',JSON.stringify(report,null,2)+'\n');
const step=async(name,fn)=>{report.currentStep=name;persist();console.log('RUN',name);try{await fn();report.checks.push({name,status:'PASS'});console.log('PASS',name)}catch(e){report.checks.push({name,status:'FAIL',error:String(e?.code||e?.message||e)});throw e}finally{delete report.currentStep;persist()}};
const deny=async(fn)=>{await assert.rejects(fn,e=>e?.code==='permission-denied'||e?.code==='firestore/permission-denied')};
try{
  // Refuse an absent local emulator before SDK initialization.
  for(const port of [9099,8080]) await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(3000)});
  const appSdk=await import('firebase/app');deleteApp=appSdk.deleteApp;
  const authSdk=await import('firebase/auth');const fsSdk=await import('firebase/firestore');
  const {getAuth,connectAuthEmulator,createUserWithEmailAndPassword}=authSdk;
  const {getFirestore,connectFirestoreEmulator,doc,setDoc,updateDoc,getDocFromServer,getDocFromCache,getDocsFromServer,collection,onSnapshot}=fsSdk;
  ({disableNetwork,enableNetwork,terminate}=fsSdk);
  const nonce=randomUUID(),pid='pr492-qa-'+nonce,stamp=Date.now();
  const cfg={projectId,apiKey:'demo-key',authDomain:projectId+'.firebaseapp.com'};
  const account=async(role)=>{
    const app=appSdk.initializeApp(cfg,role+'-'+nonce),auth=getAuth(app),db=getFirestore(app);apps.push({app,db});
    connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8080);
    const email=role.toLowerCase()+'-'+nonce+'@example.test';
    const {user}=await createUserWithEmailAndPassword(auth,email,'Pr492-'+nonce);
    return {db,email,uid:user.uid};
  };
  let admin,editor,viewer;
  await step('Three distinct authenticated emulator identities',async()=>{admin=await account('ADMIN');editor=await account('EDITOR');viewer=await account('VIEWER');assert.equal(new Set([admin.uid,editor.uid,viewer.uid]).size,3)});
  const ref=(a,col,id)=>doc(a.db,'projects',pid,col,id);
  const floorId='FP-METRIC',roomId='ROOM-METRIC',lineId='ROOM-LINE';
  const life={revision:1,updatedAt:stamp,deleted:false,deletedAt:null};
  const floor={id:floorId,floorName:'Tầng QA',imageUrl:'https://example.invalid/test.png',imageAssetId:'qa-asset',imageRevision:1,uploadedAt:'2026-11-24',...life};
  const room={id:roomId,floorId,floorName:'Tầng QA',roomName:'Căn QA',workCategory:'Trần QA',workVolume:7,volumeUnit:'m²',categoryVolumes:{'Trần QA':7,'Hạng mục khác':9},categoryVolumeUnits:{'Trần QA':'m²','Hạng mục khác':'m²'},x:10,y:20,width:10,height:20,frameStatus:'Chưa làm',boardStatus:'Chưa làm',inspectionStatus:'Chưa nghiệm thu',...life};
  const line={...room,id:lineId,roomName:'Tuyến QA',volumeUnit:'m',categoryVolumeUnits:{'Trần QA':'m'},categoryVolumes:{'Trần QA':7},isPolyline:true,points:[{x:10,y:20},{x:20,y:20}],width:10,height:0};
  const image={width:1000,height:500};const calibration=createFloorMetricCalibration(floor,image,{x:0,y:0},{x:10,y:0},10,stamp);assert(calibration);
  const read=async(a,col,id)=>(await getDocFromServer(ref(a,col,id))).data();
  const patch=(revision,extra)=>({...extra,revision,updatedAt:stamp+revision*1000});
  const watch=(a,col,id,predicate)=>{let stop;const promise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{stop?.();reject(Error('snapshot timeout'))},15000);stop=onSnapshot(ref(a,col,id),{includeMetadataChanges:true},s=>{if(s.exists()&&!s.metadata.fromCache&&!s.metadata.hasPendingWrites&&predicate(s.data())){clearTimeout(timer);stop?.();resolve(s.data())}},e=>{clearTimeout(timer);stop?.();reject(e)})});return promise};
  await step('Create disposable project and seed original records',async()=>{
    await setDoc(doc(admin.db,'projects',pid),{id:pid,name:'PR492 disposable QA',ownerUid:admin.uid,ownerEmail:admin.email,createdAt:stamp,updatedAt:stamp});
    for(const [a,role] of [[editor,'EDITOR'],[viewer,'VIEWER']])await setDoc(ref(admin,'members',a.email),{email:a.email,role,active:true,assignedAt:stamp});
    await setDoc(ref(admin,'floor_plans',floorId),floor);await setDoc(ref(admin,'rooms',roomId),room);await setDoc(ref(admin,'rooms',lineId),line);
    assert.equal((await read(viewer,'rooms',roomId)).workVolume,7);
  });
  await step('ADMIN saves calibration; EDITOR and VIEWER receive same server fields',async()=>{
    const observed=watch(viewer,'floor_plans',floorId,d=>d.highlightMetricCalibration?.sourceKey===calibration.sourceKey);
    await Promise.all([observed,updateDoc(ref(admin,'floor_plans',floorId),patch(2,{highlightMetricCalibration:calibration}))]);
    assert.deepEqual((await read(editor,'floor_plans',floorId)).highlightMetricCalibration,calibration);
  });
  const measuredArea=measureRoomHighlightAreaM2({...floor,highlightMetricCalibration:calibration},room,image);
  const measuredLine=measureRoomHighlightLengthM({...floor,highlightMetricCalibration:calibration},line,image);
  assert(measuredArea.valid&&measuredLine.valid);const area=Math.round(measuredArea.value*1000)/1000,length=Math.round(measuredLine.value*1000)/1000;assert.equal(area,100);assert.equal(length,10);
  await step('Pure measurement leaves original server quantities unchanged (no UI claim)',async()=>{assert.equal((await read(viewer,'rooms',roomId)).workVolume,7);assert.equal((await read(viewer,'rooms',lineId)).workVolume,7)});
  await step('ADMIN explicitly writes measured area; VIEWER receives realtime server snapshot',async()=>{
    const observed=watch(viewer,'rooms',roomId,d=>d.workVolume===area);
    await Promise.all([observed,updateDoc(ref(admin,'rooms',roomId),patch(2,{workVolume:area,'categoryVolumes.Trần QA':area}))]);
    const d=await read(editor,'rooms',roomId);assert.equal(d.id,roomId);assert.equal(d.floorId,floorId);assert.equal(d.categoryVolumes['Trần QA'],100);assert.equal(d.categoryVolumes['Hạng mục khác'],9);assert.equal(d.volumeUnit,'m²');
  });
  await step('EDITOR and VIEWER cannot change room quantity or calibration',async()=>{
    for(const a of [editor,viewer]){
      await deny(()=>updateDoc(ref(a,'rooms',roomId),patch(3,{workVolume:999,'categoryVolumes.Trần QA':999})));
      await deny(()=>updateDoc(ref(a,'floor_plans',floorId),patch(3,{highlightMetricCalibration:{...calibration,actualMetres:999}})));
    }
    assert.equal((await read(admin,'rooms',roomId)).workVolume,100);
  });
  await step('EDITOR operational progress remains writable without changing quantity',async()=>{
    await updateDoc(ref(editor,'rooms',roomId),patch(3,{frameStatus:'Đang làm'}));const d=await read(viewer,'rooms',roomId);assert.equal(d.frameStatus,'Đang làm');assert.equal(d.workVolume,100);
  });
  await step('Offline ADMIN line write stays pending, then reconnect broadcasts once',async()=>{
    await read(admin,'rooms',lineId);await disableNetwork(admin.db);
    let committed=false;
    const pending=updateDoc(ref(admin,'rooms',lineId),patch(2,{workVolume:length,'categoryVolumes.Trần QA':length})).then(()=>{committed=true});
    pending.catch(()=>{});
    try{
      let local;for(let i=0;i<30;i++){local=await getDocFromCache(ref(admin,'rooms',lineId));if(local.metadata.hasPendingWrites&&local.data()?.workVolume===10)break;await new Promise(r=>setTimeout(r,100));}
      assert(local.metadata.hasPendingWrites);assert.equal(local.data().workVolume,10);assert.equal(committed,false);assert.equal((await read(viewer,'rooms',lineId)).workVolume,7);
      const observed=watch(viewer,'rooms',lineId,d=>d.workVolume===10&&!d.deleted);
      await enableNetwork(admin.db);await Promise.all([pending,observed]);
    }finally{await enableNetwork(admin.db)}
    const d=await read(editor,'rooms',lineId);assert.equal(d.id,lineId);assert.equal(d.volumeUnit,'m');assert.equal(d.categoryVolumes['Trần QA'],10);
  });
  await step('Stale revision denied; record identity and count unchanged',async()=>{
    await deny(()=>updateDoc(ref(admin,'rooms',lineId),patch(2,{workVolume:999})));
    await deny(()=>updateDoc(ref(admin,'rooms',lineId),patch(3,{id:'WRONG'})));
    const docs=await getDocsFromServer(collection(viewer.db,'projects',pid,'rooms'));
    assert.deepEqual(docs.docs.map(d=>d.id).sort(),[lineId,roomId].sort());assert.equal((await read(viewer,'rooms',lineId)).workVolume,10);
  });
  await step('Replaced image invalidates calibration; official saved quantity preserved',async()=>{
    await updateDoc(ref(admin,'floor_plans',floorId),patch(3,{imageAssetId:'qa-new-asset',imageRevision:2}));
    const d=await read(viewer,'floor_plans',floorId);assert.equal(getValidFloorMetricCalibration(d,image).valid,false);assert.equal((await read(viewer,'rooms',roomId)).workVolume,100);
  });
  report.status='PASS';
}catch(e){report.status='FAIL';report.error=String(e?.stack||e);process.exitCode=1;console.error(e)}
finally{for(const {app,db} of apps){try{await enableNetwork?.(db);await terminate?.(db);await deleteApp?.(app)}catch(e){report.status='FAIL';report.cleanupError=String(e);process.exitCode=1}}clearTimeout(deadline);persist();}
// Only after all assertions and awaited cleanup finish: release lingering SDK handles.
const finalExitCode=report.status==='PASS' ? 0 : 1;
process.exitCode=finalExitCode;
console.log('FINAL SDK REPORT', report.status, report.checks.length);
setTimeout(()=>process.exit(finalExitCode),1000).unref();
