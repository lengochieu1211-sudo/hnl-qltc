#!/usr/bin/env node
// P21.70: synthetic identity pair on loopback ONLY. NEVER targets live Firebase.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, serverTimestamp, increment } from 'firebase/firestore';

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
if (!/^demo-[a-z0-9-]+$/.test(projectId || '') ||
    !/^(127\.0\.0\.1|localhost):8080$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):9099$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
  throw Error('FAIL_CLOSED: demo project and loopback Auth+Firestore emulators REQUIRED');
}
const runId = Date.now().toString(36);
const pid = 'qa-unread-' + runId;
const password = 'Offline-Test-123456!';
const apps = [];
async function user(label) {
  const email = label + '-' + runId + '@example.test';
  const app = initializeApp({
    apiKey: 'demo-key', projectId, authDomain: projectId+'.firebaseapp.com',
  }, 'p2170-'+label+'-'+runId);
  apps.push(app);
  const auth=getAuth(app), db=getFirestore(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings:true});
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const cred=await createUserWithEmailAndPassword(auth,email,password);
  return {email, uid:cred.user.uid, db};
}
const stamp=()=>serverTimestamp();
const within=(client,...path)=>doc(client.db,'projects',pid,...path);
const isDenied=async promise=>{
  try{await promise;return false;}catch(e){if(String(e.code||e.message).toLowerCase().includes('permission'))return true;throw e;}
};
let outcome={mode:'ISOLATED_FIREBASE_EMULATOR',syntheticAccounts:true,liveLogin:false,prodChanged:false,devChanged:false};
try{
  const owner=await user('owner'), editor=await user('editor'), viewer=await user('viewer'), outsider=await user('outsider');
  await setDoc(within(owner),{id:pid,name:'P21.70 synthetic unread',ownerUid:owner.uid,ownerEmail:owner.email,createdAt:Date.now(),updatedAt:Date.now()});
  await setDoc(within(owner,'members',editor.email),{email:editor.email,role:'EDITOR',active:true,assignedAt:Date.now()});
  await setDoc(within(owner,'members',viewer.email),{email:viewer.email,role:'VIEWER',active:true,assignedAt:Date.now()});
  assert.equal(await isDenied(getDoc(within(outsider,'conversations','general'))),true,'outsider must not read chat');
  const msg=(client,id)=>({
    id, projectId:pid,conversationId:'general', senderUid:client.uid,senderEmail:client.email,
    senderName:'synthetic',text:'Emulator message '+id,createdAt:stamp(),clientMessageId:id,mentions:[]
  });
  const summary=(client,update)=>({
    id:'general',projectId:pid,lastSenderUid:client.uid,lastMessageAt:stamp(),
    lastMessageText:'test only',messageCount:update,updatedAt:stamp()
  });
  await setDoc(within(owner,'conversations','general','messages','m1'),msg(owner,'m1'));
  await setDoc(within(owner,'conversations','general'),summary(owner,1));
  let first=await getDoc(within(editor,'conversations','general'));
  assert.equal(first.data().messageCount,1);
  await setDoc(within(editor,'conversations','general','members',editor.uid),
    {uid:editor.uid,projectId:pid,conversationId:'general',lastReadAt:stamp(),lastReadMessageCount:1});
  await setDoc(within(owner,'conversations','general','messages','m2'),msg(owner,'m2'));
  await setDoc(within(owner,'conversations','general'),summary(owner,increment(1)),{merge:true});
  let now=await getDoc(within(editor,'conversations','general'));
  assert.equal(now.data().messageCount,2);
  await setDoc(within(editor,'conversations','general','members',editor.uid),
    {uid:editor.uid,projectId:pid,conversationId:'general',lastReadAt:stamp(),lastReadMessageCount:2},{merge:true});
  // Represents a delayed write from a stale second device. Rules currently allow it.
  const before=(await getDoc(within(editor,'conversations','general','members',editor.uid))).data().lastReadMessageCount;
  const rollbackDenied=await isDenied(setDoc(within(editor,'conversations','general','members',editor.uid),
    {uid:editor.uid,projectId:pid,conversationId:'general',lastReadAt:stamp(),lastReadMessageCount:1},{merge:true}));
  const after=(await getDoc(within(editor,'conversations','general','members',editor.uid))).data().lastReadMessageCount;
  const watermarkRegression=!rollbackDenied && before===2 && after===1;
  assert.equal(watermarkRegression,true,'expected source risk: stale write can regress read marker');
  // A message can be committed even when the separately attempted summary increment is rejected.
  await setDoc(within(editor,'conversations','general','messages','m3'),msg(editor,'m3'));
  const deniedSummary=await isDenied(setDoc(within(editor,'conversations','general'),summary(editor,increment(2)),{merge:true}));
  const messageStillExists=(await getDoc(within(viewer,'conversations','general','messages','m3'))).exists();
  const unchangedCount=(await getDoc(within(viewer,'conversations','general'))).data().messageCount;
  assert.equal(deniedSummary,true);
  assert.equal(messageStillExists,true);
  assert.equal(unchangedCount,2);
  const viewerMsg=(await getDoc(within(viewer,'conversations','general','messages','m2'))).exists();
  assert.equal(viewerMsg,true);
  outcome={...outcome,status:'P2170_EMULATOR_RISKS_REPRODUCED_NOT_RUNTIME_GOLDEN',rulesAuthenticatedTwoSyntheticAccounts:true,
    reviewerRoleRead:true,nonmemberDenied:true,sourceMessageCount:2,visibleMessages:3,
    summaryWriteRejectedMessagePersisted:deniedSummary&&messageStillExists&&unchangedCount===2,
    readWatermarkRollbackAllowed:watermarkRegression,watermarkBefore:before,watermarkAfter:after,
    genuineGoogleUsersTested:false,offlineReconnectTested:false};
  fs.mkdirSync('evidence',{recursive:true});
  fs.writeFileSync('evidence/p2170-unread-emulator.json',JSON.stringify(outcome,null,2)+'\n');
  console.log('P21.70 EVIDENCE '+JSON.stringify(outcome));
}finally{await Promise.all(apps.map(app=>deleteApp(app).catch(()=>{})));}
