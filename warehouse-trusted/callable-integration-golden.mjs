/** P21.5 REAL Auth + Firestore + Functions Emulator callable integration.
 * Disposable demo-* project and loopback only. No live Firebase or R2 ever.
 */
import assert from 'node:assert/strict';
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore as getAdminDb } from 'firebase-admin/firestore';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { initializeApp as initializeClient, deleteApp as deleteClient } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator, doc, setDoc } from 'firebase/firestore';
const environment = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
if(!/^demo-[a-z0-9-]+$/.test(environment||'') ||
   process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080' ||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099' ||
   process.env.FUNCTIONS_EMULATOR!=='true') {
  throw Error('P21_CALLABLE_REQUIRE_LOCAL_DISPOSABLE_EMULATORS');
}
const appAdmin=initializeAdmin({projectId:environment},'p21-callable-admin');
const db=getAdminDb(appAdmin), adminAuth=getAdminAuth(appAdmin);
const appClient=initializeClient({apiKey:'test-demo-key',authDomain:environment+'.firebaseapp.com',projectId:environment,appId:'1:100000000000:web:demo'},'p21-callable-client');
const auth=getAuth(appClient);
connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
const functions=getFunctions(appClient,'asia-southeast1');
connectFunctionsEmulator(functions,'127.0.0.1',5001);
const fs=getFirestore(appClient);connectFirestoreEmulator(fs,'127.0.0.1',8080);
const callable=httpsCallable(functions,'hnlWarehouseVoucherV1',{timeout:25000});
const projectId='p21-callable-test-'+process.pid,root=`projects/${projectId}`;
const uid='p21-callable-editor', email='p21-editor@example.test';
const payload=(id,type,quantity)=>({id,type,quantity,itemKind:'material',materialId:'m8',materialName:'M8',unit:'cai',location:'DEMO',handler:'Tester',date:'2026-10-27',sourceType:'manual'});
const invoke=(action,id,item,extra={})=>callable({projectId,action,transactionId:id,...(item?{item}:{}),...extra});
let passed=0;
const check=async(label,fn)=>{await fn();passed++;console.log('PASS',label)};
const denied=async(op)=>assert.rejects(op,/permission|denied|role|unauthenticated|WAREHOUSE_/i);
try{
 await adminAuth.createUser({uid,email,emailVerified:true,password:'TestP21-emulator-only!2'});
 await db.doc(root).set({id:projectId,ownerUid:'p21-owner',ownerEmail:'owner@example.test',migrationSandbox:true,migrationSource:'DEV_COPY'});
 await db.doc(`${root}/members/${email}`).set({role:'EDITOR',active:true});
 await check('missing Auth denies callable',async()=>denied(()=>invoke('create','no-auth',payload('no-auth','in',10))));
 await signInWithEmailAndPassword(auth,email,'TestP21-emulator-only!2');
 await check('verified EDITOR authenticates through Auth Emulator',async()=>{assert.equal(auth.currentUser?.uid,uid)});
 await check('trusted callable IN atomically creates voucher+balance',async()=>{
   const r=(await invoke('create','supply',payload('supply','in',10))).data;
   assert.equal(r.onHand,10);assert.equal(r.duplicate,false);
   assert.equal((await db.doc(`${root}/inventory/supply`).get()).data().revision,1);
 });
 await check('replayed callable create returns duplicate',async()=>{
   const r=(await invoke('create','supply',payload('supply','in',10))).data;
   assert.equal(r.duplicate,true);assert.equal(r.onHand,10);
 });
 await check('client SDK cannot forge voucher despite being EDITOR',async()=>{
   await denied(()=>setDoc(doc(fs,'projects',projectId,'inventory','forged'),payload('forged','in',777)));
   assert.equal((await db.doc(`${root}/inventory/forged`).get()).exists,false);
 });
 await check('two concurrent OUTs 7+7 from balance 10 allow exactly one',async()=>{
   const all=await Promise.allSettled([invoke('create','out-A',payload('out-A','out',7)),invoke('create','out-B',payload('out-B','out',7))]);
   assert.equal(all.filter(x=>x.status==='fulfilled').length,1);
   assert.equal(all.filter(x=>x.status==='rejected').length,1);
   const docs=await Promise.all(['out-A','out-B'].map(id=>db.doc(`${root}/inventory/${id}`).get()));
   assert.equal(docs.filter(x=>x.exists).length,1);
 });
 await check('offline or stale client cannot fake existing revision',async()=>{
   await denied(()=>invoke('update','supply',payload('supply','in',9),{expectedRevision:0}));
   const snap=await db.doc(`${root}/inventory/supply`).get();assert.equal(snap.data().quantity,10);
 });
 await check('EDITOR client cannot delete voucher directly',async()=>{
   await denied(()=>import('firebase/firestore').then(({deleteDoc})=>deleteDoc(doc(fs,'projects',projectId,'inventory','supply'))));
 });
 console.log(`P21.5 AUTH+FIRESTORE+FUNCTIONS EMULATOR CALLABLE ${passed}/${passed} PASS — DEMO ONLY`);
}finally{
 try{await signOut(auth)}catch{}
 await deleteClient(appClient); await deleteAdmin(appAdmin);
}
