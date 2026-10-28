/**
 * P21 — isolated, disposable Firebase Auth/Firestore emulator ALLOW/DENY suite.
 * NEVER run on a live project. This tests post-migration client Rules only;
 * it does NOT attest Functions, data migration, R2, or restore readiness.
 */
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDoc, deleteDoc } from 'firebase/firestore';

const project = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!/^demo-[a-z0-9-]+$/.test(project || '') || firestoreHost !== '127.0.0.1:8080' || authHost !== '127.0.0.1:9099') {
  throw new Error('P21_EMULATOR_ONLY: requires demo-* project and localhost Auth/Firestore emulators');
}
const app = initializeApp({ apiKey:'demo-key',authDomain:`${project}.firebaseapp.com`,projectId:project },'p21-'+Date.now());
const auth = getAuth(app);
const db = getFirestore(app);
connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
connectFirestoreEmulator(db,'127.0.0.1',8080);
const nonce=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const pid=`project-p21-${nonce}`;
const ownerEmail=`owner-p21-${nonce}@example.test`;
const editorEmail=`editor-p21-${nonce}@example.test`;
const viewerEmail=`viewer-p21-${nonce}@example.test`;
const password='RuleP21-Test-123456!';
let passes=0;
async function allow(name,run){
  try {await run();passes++;console.log('PASS ALLOW',name);}
  catch(err){throw new Error(`P21_UNEXPECTED_DENY_${name}: ${err?.code||err?.message||err}`);}
}
async function deny(name,run){
  try{await run();}
  catch(err){
    if(String(err?.code||'').includes('permission-denied')){passes++;console.log('PASS DENY',name);return;}
    throw new Error(`P21_UNEXPECTED_ERROR_${name}: ${err?.code||err?.message||err}`);
  }
  throw new Error(`P21_UNSAFE_ALLOW_${name}`);
}
async function signIn(email){await signOut(auth);return signInWithEmailAndPassword(auth,email,password);}
const p=(...segments)=>doc(db,'projects',pid,...segments);

// Emulator-only trusted fixture seed to exercise UPDATE/DELETE against existing
// inventory and balance docs. REST request cannot reach live Firebase by design.
async function seedEmulatorOnly(path,data){
  const fields=Object.fromEntries(Object.entries(data).map(([k,v])=>[k,
    typeof v==='string'?{stringValue:v}:typeof v==='number'?{doubleValue:v}:
      typeof v==='boolean'?{booleanValue:v}:{nullValue:null}
  ]));
  const url=`http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents/${path}`;
  const res=await fetch(url,{method:'PATCH',headers:{'Authorization':'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({fields})});
  assert.equal(res.ok,true,`P21_EMULATOR_SEED_FAILED_${res.status}`);
}
try {
  const ownerUid=(await createUserWithEmailAndPassword(auth,ownerEmail,password)).user.uid;
  await allow('ADMIN creates DEV test project',()=>setDoc(p(),{
    id:pid,ownerUid,ownerEmail,name:'P21 disposable fixture',createdAt:Date.now(),updatedAt:Date.now(),
  }));
  const editorUid=(await createUserWithEmailAndPassword(auth,editorEmail,password)).user.uid;
  await createUserWithEmailAndPassword(auth,viewerEmail,password);
  await signIn(ownerEmail);
  await allow('ADMIN registers EDITOR',()=>setDoc(p('members',editorEmail),{email:editorEmail,role:'EDITOR',active:true,assignedAt:Date.now()}));
  await allow('ADMIN registers VIEWER',()=>setDoc(p('members',viewerEmail),{email:viewerEmail,role:'VIEWER',active:true,assignedAt:Date.now()}));
  const now=Date.now();
  const legacy={id:'ROOM-LEGACY-P21',floorId:'F1',roomName:'Room Legacy',x:1,y:1,width:10,height:10,
    frameStatus:'Chưa làm',boardStatus:'Chưa làm',inspectionStatus:'Chưa nghiệm thu',
    subItems:[{id:'S1',name:'Khung',workVolume:10,status:'Chưa làm'}],
    revision:1,createdAt:now,updatedAt:now,deleted:false,deletedAt:null};
  await allow('ADMIN creates legacy room',()=>setDoc(p('rooms','ROOM-LEGACY-P21'),legacy));
  await allow('ADMIN creates room for migrated sidecars',()=>setDoc(p('rooms','ROOM-MIGRATED-P21'),{...legacy,id:'ROOM-MIGRATED-P21'}));
  const definition=p('rooms','ROOM-MIGRATED-P21','subitem_definitions','S1');
  const progress=p('rooms','ROOM-MIGRATED-P21','subitem_progress','S1');
  await allow('ADMIN creates immutable definition',()=>setDoc(definition,{id:'S1',projectId:pid,roomId:'ROOM-MIGRATED-P21',name:'Khung',order:0}));
  await allow('ADMIN seeds progress',()=>setDoc(progress,{id:'S1',projectId:pid,roomId:'ROOM-MIGRATED-P21',status:'Chưa làm',revision:1,updatedAt:now,updatedByUid:ownerUid}));
  await allow('ADMIN marks migrated room',()=>updateDoc(p('rooms','ROOM-MIGRATED-P21'),{subItemProgressMigrated:true,revision:2,updatedAt:now+1}));
  await allow('ADMIN reads migrated sidecar',()=>getDoc(progress));
  await signIn(editorEmail);
  await deny('EDITOR cannot rewrite legacy room subItems',()=>updateDoc(p('rooms','ROOM-LEGACY-P21'),{
    subItems:[{id:'FORGED',name:'Injected',workVolume:999,status:'Đã hoàn thành'}],revision:2,updatedAt:now+10,
  }));
  await deny('EDITOR cannot rewrite migrated room subItems',()=>updateDoc(p('rooms','ROOM-MIGRATED-P21'),{
    subItems:[{id:'FORGED',name:'Injected',workVolume:999,status:'Đã hoàn thành'}],revision:3,updatedAt:now+10,
  }));
  await allow('EDITOR may update top-level room field',()=>updateDoc(p('rooms','ROOM-MIGRATED-P21'),{
    frameStatus:'Đã hoàn thành',revision:3,updatedAt:now+10,
  }));
  await deny('EDITOR cannot forge definition',()=>updateDoc(definition,{name:'Fake'}));
  await deny('EDITOR cannot create unauthorized progress',()=>setDoc(p('rooms','ROOM-MIGRATED-P21','subitem_progress','FAKE'),{
    id:'FAKE',projectId:pid,roomId:'ROOM-MIGRATED-P21',status:'Đã hoàn thành',revision:1,updatedAt:now+10,updatedByUid:editorUid,
  }));
  await allow('EDITOR updates authorized progress only',()=>updateDoc(progress,{status:'Đang làm',revision:2,updatedAt:now+10,updatedByUid:editorUid}));
  await deny('EDITOR cannot change progress identity',()=>updateDoc(progress,{roomId:'OTHER',revision:3,updatedAt:now+20,updatedByUid:editorUid}));
  await deny('EDITOR cannot jump progress revision',()=>updateDoc(progress,{revision:100,updatedAt:now+20,updatedByUid:editorUid}));
  const voucher=p('inventory','P21-VOUCHER');
  const balance=p('inventory_balances','P21-MATERIAL');
  await deny('EDITOR cannot create standalone balance',()=>setDoc(balance,{id:'P21-MATERIAL',projectId:pid,onHand:100,revision:1,updatedAt:now,updatedByUid:editorUid}));
  await deny('EDITOR cannot create direct voucher',()=>setDoc(voucher,{id:'P21-VOUCHER',projectId:pid,type:'in',quantity:100,revision:1,createdAt:now,updatedAt:now,deleted:false,deletedAt:null}));
  await seedEmulatorOnly(`projects/${pid}/inventory_balances/P21-MATERIAL`,{id:'P21-MATERIAL',projectId:pid,onHand:5,revision:1,updatedAt:now,updatedByUid:ownerUid});
  await seedEmulatorOnly(`projects/${pid}/inventory/P21-VOUCHER`,{id:'P21-VOUCHER',projectId:pid,type:'in',quantity:5,revision:1,createdAt:now,updatedAt:now,deleted:false});
  await allow('EDITOR can read trusted balance',()=>getDoc(balance));
  await deny('EDITOR cannot adjust existing balance',()=>updateDoc(balance,{onHand:999,revision:2,updatedAt:now+10,updatedByUid:editorUid}));
  await deny('EDITOR cannot edit existing voucher',()=>updateDoc(voucher,{quantity:999,revision:2,updatedAt:now+10}));
  await deny('EDITOR cannot delete existing voucher',()=>deleteDoc(voucher));
  await signIn(ownerEmail);
  await deny('ADMIN client also cannot forge balance',()=>updateDoc(balance,{onHand:999,revision:2,updatedAt:now+10,updatedByUid:ownerUid}));
  await deny('ADMIN client cannot delete voucher',()=>deleteDoc(voucher));
  await signIn(viewerEmail);
  await allow('VIEWER can read migrated progress',()=>getDoc(progress));
  await deny('VIEWER cannot update sidecar',()=>updateDoc(progress,{status:'Đã hoàn thành',revision:3,updatedAt:now+20}));
  await deny('VIEWER cannot update top-level room',()=>updateDoc(p('rooms','ROOM-MIGRATED-P21'),{frameStatus:'Chưa làm',revision:4,updatedAt:now+20}));
  await deny('VIEWER cannot create balance',()=>setDoc(p('inventory_balances','FAKE-VIEWER'),{id:'FAKE-VIEWER',projectId:pid,onHand:1,revision:1}));
  console.log(`P21 CUTOVER RULES EMULATOR ${passes}/${passes} PASS — DEV CANDIDATE ONLY; NOT PROD CERTIFIED`);
} finally {await signOut(auth).catch(()=>{});await deleteApp(app);}
