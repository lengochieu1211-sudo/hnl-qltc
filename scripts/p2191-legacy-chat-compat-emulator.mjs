#!/usr/bin/env node
// P21.91 AUDIT ONLY: reproduce legacy PROD Chat compatibility failure against
// candidate Firestore Rules in localhost Auth+Firestore emulators. NO DEPLOY.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore, connectFirestoreEmulator, doc, collection, setDoc, getDoc, getDocs,
  writeBatch, increment, serverTimestamp
} from 'firebase/firestore';

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
if (!/^demo-[a-z0-9-]+$/.test(projectId || '') ||
    !/^(127\.0\.0\.1|localhost):8080$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):9099$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
  throw new Error('P2191_LOOPBACK_DEMO_EMULATORS_ONLY');
}
const oldHead = 'b2557860fbb3b128b5f2c9863e99d0f8b1f78686';
const oldSource = execFileSync('git', ['show', oldHead + ':src/lib/chatService.ts'], { encoding: 'utf8' });
assert.match(oldSource, /await setDoc\(msgRef,/, 'legacy message is written separately');
assert.match(oldSource, /await removeChatOutbox\(messageId\)/, 'legacy outbox removed after message');
assert.match(oldSource, /await setDoc\(conversationRef\(/, 'legacy summary is a second write');
assert.doesNotMatch(oldSource, /lastMessageId:\s*messageId/, 'legacy summary has no lastMessageId');
const candidateRules = fs.readFileSync('firestore.rules', 'utf8');
assert.match(candidateRules, /function chatSummaryNewMessageIsAtomic/, 'candidate atomic guard required');
assert.match(candidateRules, /existsAfter\(/, 'candidate same-batch guard required');

const nonce = Date.now().toString(36);
const pid = 'p2191-legacy-' + nonce;
const apps = [];
async function account(label) {
  const email = label + '-' + nonce + '@example.test';
  const app = initializeApp({ apiKey:'demo-key', authDomain:projectId+'.firebaseapp.com', projectId }, 'p2191-'+label+'-'+nonce);
  apps.push(app);
  const auth = getAuth(app), db = getFirestore(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings:true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const user = (await createUserWithEmailAndPassword(auth,email,'QA-P2191-Test-123456!')).user;
  return { db, uid:user.uid, email };
}
const ref = (a,...parts) => doc(a.db,'projects',pid,...parts);
const summaryRef = a => ref(a,'conversations','general');
const messageRef = (a,id) => ref(a,'conversations','general','messages',id);
const messagesCol = a => collection(a.db,'projects',pid,'conversations','general','messages');
const message = (a,id) => ({
  id, projectId:pid, conversationId:'general', senderUid:a.uid,
  senderEmail:a.email, senderName:'P21.91 synthetic', clientMessageId:id,
  createdAt:serverTimestamp(), text:'P21.91 localhost only '+id,
  attachments:[], mentions:[], editedAt:null, deletedAt:null
});
const summary = (a,id,includeLastId) => ({
  id:'general', projectId:pid, lastSenderUid:a.uid,
  lastSenderName:'P21.91 synthetic', lastMessageAt:serverTimestamp(),
  lastMessageText:'P21.91 localhost only', messageCount:increment(1),
  updatedAt:serverTimestamp(),
  ...(includeLastId ? {lastMessageId:id} : {})
});
async function denied(fn) {
  try { await fn(); return false; }
  catch(e) {
    if (String(e.code || e.message || '').toLowerCase().includes('permission')) return true;
    throw e;
  }
}
const evidence = {
  test:'P21.91 legacy PROD client vs candidate Rules', scope:'AUTH_FIRESTORE_EMULATOR_ONLY',
  sourceMain:oldHead, candidateBase:'ce6f4e586b70f76a6c94ab8ae4a966b8e841e2e0',
  syntheticAccounts:2, realGoogleAccounts:false, prodModified:false, noCloudCredentials:true,
  oldClientOfflineRecoveryTested:false, physicalDeviceGolden:false
};
try {
  const owner = await account('owner'), sender = await account('editor');
  await setDoc(ref(owner), {id:pid,name:'P21.91 QA',ownerUid:owner.uid,ownerEmail:owner.email,createdAt:Date.now(),updatedAt:Date.now()});
  await setDoc(ref(owner,'members',sender.email), {email:sender.email,role:'EDITOR',active:true,assignedAt:Date.now()});

  // First-ever conversation: old client can persist a message but cannot create summary.
  const legacyFirst = sender.uid + '_legacy-first';
  await setDoc(messageRef(sender,legacyFirst), message(sender,legacyFirst));
  const firstSummaryDenied = await denied(() => setDoc(summaryRef(sender),summary(sender,legacyFirst,false),{merge:true}));
  const firstMessageExists = (await getDoc(messageRef(sender,legacyFirst))).exists();
  const firstSummaryMissing = !(await getDoc(summaryRef(sender))).exists();
  assert.equal(firstMessageExists,true,'old standalone message was committed');
  assert.equal(firstSummaryDenied,true,'new Rules reject old summary without lastMessageId');
  assert.equal(firstSummaryMissing,true,'conversation summary absent after old-client first message');

  // New client atomic send creates a summary; old client then silently undercounts.
  const newId = sender.uid + '_new-batch';
  const batch = writeBatch(sender.db);
  batch.set(messageRef(sender,newId),message(sender,newId));
  batch.set(summaryRef(sender),summary(sender,newId,true),{merge:true});
  await batch.commit();
  const legacySecond = sender.uid + '_legacy-second';
  await setDoc(messageRef(sender,legacySecond),message(sender,legacySecond));
  const secondSummaryDenied = await denied(() => setDoc(summaryRef(sender),summary(sender,legacySecond,false),{merge:true}));
  const summaryCount = (await getDoc(summaryRef(sender))).data().messageCount;
  const actualMessages = (await getDocs(messagesCol(sender))).size;
  assert.equal(secondSummaryDenied,true,'old summary update rejected');
  assert.equal(summaryCount,1,'only new atomic message counted');
  assert.equal(actualMessages,3,'both legacy messages persisted without summary increments');

  Object.assign(evidence,{
    firstMessageExists, firstSummaryDenied, firstSummaryMissing,
    secondSummaryDenied, actualMessages, summaryCount,
    missingSummaryCount:actualMessages-summaryCount,
    status:'BLOCKED_LEGACY_CLIENT_COMPATIBILITY',
    releaseGatePass:false
  });
  fs.mkdirSync('evidence',{recursive:true});
  fs.writeFileSync('evidence/P2191-LEGACY-CHAT-COMPAT.json',JSON.stringify(evidence,null,2)+'\n');
  console.error('P21.91 COMPATIBILITY GATE BLOCKED: '+JSON.stringify(evidence));
  // Intentional nonzero exit: a reproduced old-client break must never certify PROD.
  process.exitCode=1;
} finally {
  await Promise.all(apps.map(app=>deleteApp(app).catch(()=>{})));
}
