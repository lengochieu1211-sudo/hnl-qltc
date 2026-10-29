#!/usr/bin/env node
// P21.97: AUDIT ONLY. Synthetic Auth+Firestore emulators on localhost, no cloud writes.
// Negative gates: reject standalone message and 2-message/1-summary batch.
// Never relax Rules or change candidate/main/DEV to make this test pass.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, writeBatch, increment, serverTimestamp } from 'firebase/firestore';

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
if (!/^demo-[a-z0-9-]+$/.test(projectId || '') ||
    !/^(127\.0\.0\.1|localhost):8080$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):9099$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
  throw Error('P2197_REQUIRE_LOOPBACK_EMULATORS_ONLY');
}
const nonce = Date.now().toString(36);
const pid = 'p2197-message-only-' + nonce;
const apps = [];
async function account(label) {
  const email = label + '-' + nonce + '@example.test';
  const app = initializeApp({ apiKey: 'demo-key', authDomain: projectId + '.firebaseapp.com', projectId }, 'p2197-' + label + '-' + nonce);
  apps.push(app);
  const auth = getAuth(app), db = getFirestore(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const user = (await createUserWithEmailAndPassword(auth, email, 'QA-P2197-Test-123456!')).user;
  return { db, uid: user.uid, email };
}
const path = (a, ...parts) => doc(a.db, 'projects', pid, ...parts);
const refs = a => ({
  sum: path(a, 'conversations', 'general'),
  msg: id => path(a, 'conversations', 'general', 'messages', id),
});
const message = (a, id) => ({
  id, projectId: pid, conversationId: 'general',
  senderUid: a.uid, senderEmail: a.email, senderName: 'P2197 synthetic',
  clientMessageId: id, createdAt: serverTimestamp(), text: 'Synthetic: ' + id,
  attachments: [], mentions: []
});
const summary = (a, id, count) => ({
  id: 'general', projectId: pid, lastSenderUid: a.uid,
  lastMessageAt: serverTimestamp(), lastMessageId: id,
  lastMessageText: 'Synthetic', messageCount: count,
  updatedAt: serverTimestamp()
});
async function denied(fn) {
  try { await fn(); return false; }
  catch (e) {
    if (String(e?.code || e?.message || '').toLowerCase().includes('permission')) return true;
    throw e;
  }
}
const evidence = {
  gate: 'P2197_MESSAGE_CREATE_MUST_HAVE_ATOMIC_SUMMARY',
  testScope: 'Auth+Firestore localhost demo only',
  prodWrites: false, realAccounts: false,
  candidateSource: 'ce6f4e586b70f76a6c94ab8ae4a966b8e841e2e0'
};
try {
  const owner = await account('owner'), sender = await account('sender');
  await setDoc(path(owner), { id: pid, name: 'P2197 synthetic', ownerUid: owner.uid, ownerEmail: owner.email, createdAt: Date.now(), updatedAt: Date.now() });
  await setDoc(path(owner, 'members', sender.email), { email: sender.email, role: 'EDITOR', active: true, assignedAt: Date.now() });
  const r = refs(sender);
  console.log('P2197_PHASE valid-one-message-one-summary');
  const valid = writeBatch(sender.db);
  valid.set(r.msg('control-1'), message(sender, 'control-1'));
  valid.set(r.sum, summary(sender, 'control-1', increment(1)), { merge: true });
  await valid.commit();
  assert.equal((await getDoc(r.sum)).data().messageCount, 1, 'valid atomic control should count 1');
  evidence.validAtomicControl = true;

  console.log('P2197_PHASE reject-standalone-message');
  evidence.messageOnlyDenied = await denied(() => setDoc(r.msg('orphan-only'), message(sender, 'orphan-only')));
  evidence.orphanExists = (await getDoc(r.msg('orphan-only'))).exists();

  console.log('P2197_PHASE reject-two-messages-one-summary');
  const double = writeBatch(sender.db);
  double.set(r.msg('double-a'), message(sender, 'double-a'));
  double.set(r.msg('double-b'), message(sender, 'double-b'));
  double.set(r.sum, summary(sender, 'double-a', increment(1)), { merge: true });
  evidence.twoMessagesOneSummaryDenied = await denied(() => double.commit());
  evidence.doubleAExists = (await getDoc(r.msg('double-a'))).exists();
  evidence.doubleBExists = (await getDoc(r.msg('double-b'))).exists();
  evidence.finalSummaryCount = (await getDoc(r.sum)).data().messageCount;

  fs.mkdirSync('evidence', { recursive: true });
  fs.writeFileSync('evidence/P2197-MESSAGE-ONLY-SECURITY.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log('P2197_EVIDENCE ' + JSON.stringify(evidence));
  assert.equal(evidence.messageOnlyDenied, true, 'SECURITY_GATE: standalone message must be denied');
  assert.equal(evidence.orphanExists, false, 'SECURITY_GATE: no orphan message');
  assert.equal(evidence.twoMessagesOneSummaryDenied, true, 'SECURITY_GATE: 2 messages / 1 summary must be denied');
  assert.equal(evidence.doubleAExists, false, 'SECURITY_GATE: no uncounted first extra message');
  assert.equal(evidence.doubleBExists, false, 'SECURITY_GATE: no uncounted second extra message');
  assert.equal(evidence.finalSummaryCount, 1, 'SECURITY_GATE: summary count unchanged after invalid probes');
  console.log('P2197_SECURITY_GATE_PASS');
} finally {
  await Promise.all(apps.map(app => deleteApp(app).catch(() => {})));
}
