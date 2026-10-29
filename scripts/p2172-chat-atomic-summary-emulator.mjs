#!/usr/bin/env node
// P21.72: Firebase Auth + Firestore emulator only; synthetic users, no live writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initializeApp, deleteApp} from 'firebase/app';
import {getAuth, connectAuthEmulator, createUserWithEmailAndPassword} from 'firebase/auth';
import {
  getFirestore,connectFirestoreEmulator,doc,setDoc,getDoc,getDocFromServer,
  writeBatch,increment,serverTimestamp,disableNetwork,enableNetwork
} from 'firebase/firestore';
const projectId=process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
if(!/^demo-[a-z0-9-]+$/.test(projectId||'')||
  !/^(127\.0\.0\.1|localhost):8080$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||
  !/^(127\.0\.0\.1|localhost):9099$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST||'')){
  throw Error('P2172_REQUIRE_LOOPBACK_EMULATORS_ONLY');
}
const source=fs.readFileSync('src/lib/chatService.ts','utf8');
const start=source.indexOf('async function commitProjectMessage(');
const end=source.indexOf('function isPermanentChatSendError(',start);
const body=source.slice(start,end);
assert.ok(start>=0&&end>start,'commit source present');
assert.match(body,/const batch = writeBatch\(db\)/,'message + summary atomic Firestore batch required');
assert.match(body,/batch\.set\(msgRef,/,'message must be in batch');
assert.match(body,/batch\.set\(conversationRef\(/,'summary must be in same batch');
assert.match(body,/await batch\.commit\(\);\s*await removeChatOutbox/,'outbox cannot be discarded until whole batch confirmed');
assert.match(source,/await getDocFromServer\(msgRef\)/,'pending local snapshot must never delete outbox');
assert.doesNotMatch(body,/await setDoc\(msgRef,/,'separate message write forbidden');
const nonce=Date.now().toString(36);
const pid='p2172-atomic-'+nonce,password='QA-P2172-Test-123456!';
const apps=[];
async function account(label){
  const email=label+'-'+nonce+'@example.test';
  const app=initializeApp({apiKey:'demo-key',authDomain:projectId+'.firebaseapp.com',projectId},'qa-'+label+'-'+nonce);
  apps.push(app);
  const auth=getAuth(app),db=getFirestore(app);
  connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
  connectFirestoreEmulator(db,'127.0.0.1',8080);
  const user=(await createUserWithEmailAndPassword(auth,email,password)).user;
  return {db,uid:user.uid,email};
}
const within=(a,...parts)=>doc(a.db,'projects',pid,...parts);
const clock=()=>serverTimestamp();
function message(a,id){return {
  id,projectId:pid,conversationId:'general',
  senderUid:a.uid,senderEmail:a.email,senderName:'QA P2172',
  clientMessageId:id,createdAt:clock(),text:'Emulator only: '+id,
  attachments:[],mentions:[]
};}
function summary(a,count){return {
  id:'general',projectId:pid,lastSenderUid:a.uid,lastMessageAt:clock(),
  lastMessageText:'Emulator only',messageCount:count,updatedAt:clock()
};}
const refs=a=>({msg:id=>within(a,'conversations','general','messages',id),sum:within(a,'conversations','general')});
function commitBatch(a,id,count=increment(1)){
  const b=writeBatch(a.db),r=refs(a);
  b.set(r.msg(id),message(a,id));
  b.set(r.sum,summary(a,count),{merge:true});
  return b.commit();
}
async function deny(fn){try{await fn();return false;}catch(e){
  if(String(e.code||e.message||'').toLowerCase().includes('permission'))return true;
  throw e;
}}
const status={projectId:'demo-*',liveFirebase:false,prodWrites:false,realGoogleAccounts:false};
try{
  const owner=await account('owner'),sender=await account('sender'),viewer=await account('viewer'),outsider=await account('outsider');
  await setDoc(within(owner),{id:pid,name:'Atomic Chat QA',ownerUid:owner.uid,ownerEmail:owner.email,createdAt:Date.now(),updatedAt:Date.now()});
  await setDoc(within(owner,'members',sender.email),{email:sender.email,role:'EDITOR',active:true,assignedAt:Date.now()});
  await setDoc(within(owner,'members',viewer.email),{email:viewer.email,role:'VIEWER',active:true,assignedAt:Date.now()});
  assert.equal(await deny(()=>getDoc(refs(outsider).sum)),true,'nonmember cannot read');
  console.log('P2172_PHASE first-batch');
  await commitBatch(sender,'stable-1');
  let count=(await getDoc(refs(viewer).sum)).data().messageCount;
  assert.equal(count,1);
  assert.equal((await getDoc(refs(viewer).msg('stable-1'))).exists(),true);
  // Same deterministic document ID cannot be replayed and increment twice.
  console.log('P2172_PHASE duplicate-id');
  const retryDenied=await deny(()=>commitBatch(sender,'stable-1'));
  assert.equal(retryDenied,true,'duplicate batch must be rejected by existing-message immutable createdAt rule');
  count=(await getDoc(refs(viewer).sum)).data().messageCount;
  assert.equal(count,1,'retry must never double count');
  // Deliberately reject summary (increment by 2); entire batch, incl. message, must fail.
  console.log('P2172_PHASE reject-invalid-summary');
  const invalidSummaryDenied=await deny(()=>commitBatch(sender,'bad-summary',increment(2)));
  assert.equal(invalidSummaryDenied,true);
  assert.equal((await getDoc(refs(viewer).msg('bad-summary'))).exists(),false,'failed summary cannot leave ghost message');
  count=(await getDoc(refs(viewer).sum)).data().messageCount;
  assert.equal(count,1);
  // Offline batch remains queued and locally pending, while local read never
  // authorizes deletion of the durable outbox (must use getDocFromServer).
  console.log('P2172_PHASE disconnect');
  await disableNetwork(sender.db);
  let committed=false;
  const queued=commitBatch(sender,'offline-2').then(()=>{committed=true;});
  await new Promise(r=>setTimeout(r,220));
  assert.equal(committed,false,'offline must not be acknowledged as sent');
  const local=await getDoc(refs(sender).msg('offline-2'));
  assert.equal(local.exists(),true,'offline message should be locally queued');
  assert.equal(local.metadata.hasPendingWrites,true,'offline message must be pending');
  await assert.rejects(()=>getDocFromServer(refs(sender).msg('offline-2')),'no server acknowledgment offline');
  console.log('P2172_PHASE reconnect');
  await enableNetwork(sender.db);
  await Promise.race([queued,new Promise((_,reject)=>setTimeout(()=>reject(Error('RECONNECT_TIMEOUT')),15000))]);
  assert.equal(committed,true);
  assert.equal((await getDoc(refs(viewer).msg('offline-2'))).exists(),true);
  assert.equal((await getDoc(refs(viewer).sum)).data().messageCount,2,'offline reconnect exactly one increment');
  console.log('P2172_PHASE legacy-summary');
  const legacySummary=within(owner,'conversations','old');
  await setDoc(legacySummary,{id:'old',projectId:pid,messageCount:0,lastSenderUid:owner.uid,lastMessageAt:clock(),lastMessageText:'legacy'});
  const output={
    status:'P2172_ATOMIC_CHAT_EMULATOR_PASS',syntheticUsers:4,authAndFirestoreEmulators:true,
    firstMessageCount:1,duplicateRejected:retryDenied,duplicateCountStable:true,
    badSummaryDenied:invalidSummaryDenied,badSummaryMessageAbsent:true,
    offlineLocallyPending:true,reconnectCount:2,realGoogleUserRuntimeGolden:false,
    legacyHistoricalMissingCountRepaired:false,prodChanged:false
  };
  fs.mkdirSync('evidence',{recursive:true});
  fs.writeFileSync('evidence/P2172-CHAT-ATOMIC-RESULT.json',JSON.stringify(output,null,2)+'\n');
  console.log('P21.72 EMULATOR EVIDENCE '+JSON.stringify(output));
}finally{await Promise.all(apps.map(a=>deleteApp(a).catch(()=>{})));}
