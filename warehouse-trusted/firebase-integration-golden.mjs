/**
 * P21.3 — REAL Firestore transaction tests on disposable local Emulator only.
 * Does NOT call Cloud Functions, deploy Rules, or access live DEV / PROD data.
 * Fail CLOSED if run outside the explicitly pinned loopback Firebase Emulator.
 */
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { executeVoucher, warehouseKey } from './engine.mjs';
import { migrateDevCopiedRoom } from './room-migrate.mjs';

const envProject = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
if (!/^demo-[a-z0-9-]+$/.test(envProject || '') ||
    process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
  throw new Error('P21_FIRESTORE_REAL_TRANSACTION_TEST_EMULATOR_ONLY');
}
const app = initializeApp({ projectId: envProject }, `p21-real-tx-${process.pid}`);
const db = getFirestore(app);
const projectId = `p21-int-${Date.now()}-${process.pid}`;
const root = `projects/${projectId}`;
const admin = { uid: 'admin-p21', email: 'admin-p21@example.test', emailVerified: true };
const editor = { uid: 'editor-p21', email: 'editor-p21@example.test', emailVerified: true };
const viewer = { uid: 'viewer-p21', email: 'viewer-p21@example.test', emailVerified: true };
const v = (id, type, quantity) => ({
  id, type, quantity, itemKind: 'material', materialId: 'drywall-m8',
  materialName: 'Test M8', unit: 'cai', location: 'Demo kho',
  handler: 'Tester', date: '2026-10-27', sourceType: 'manual',
});
const balanceId = warehouseKey(v('any', 'in', 1));
const balanceRef = db.doc(`${root}/inventory_balances/${balanceId}`);
const voucherRef = id => db.doc(`${root}/inventory/${id}`);
const action = (actor, name, id, extra = {}) => executeVoucher({
  db, actor, projectId, action: name, transactionId: id, ...extra,
});
let passes = 0;
const check = async (label, fn) => {
  await fn(); passes++;
  console.log('PASS', label);
};
const failWith = async (fn, code) => assert.rejects(fn, new RegExp(code));
try {
  await db.doc(root).set({
    id: projectId, ownerUid: admin.uid, ownerEmail: admin.email,
    migrationSandbox: true, migrationSource: 'DEV_COPY',
  });
  await Promise.all([
    db.doc(`${root}/members/${editor.email}`).set({ role: 'EDITOR', active: true }),
    db.doc(`${root}/members/${viewer.email}`).set({ role: 'VIEWER', active: true }),
  ]);
  await check('unverified editor rejected before any writes', async () => {
    await failWith(() => action({ ...editor, emailVerified: false }, 'create', 'bad-auth', { item: v('bad-auth','in',20) }), 'WAREHOUSE_AUTH_OR_PROJECT_INACTIVE');
    assert.equal((await voucherRef('bad-auth').get()).exists, false);
  });
  await check('viewer write rejected by server membership', async () => {
    await failWith(() => action(viewer, 'create', 'bad-role', { item: v('bad-role','in',20) }), 'WAREHOUSE_ROLE_DENIED');
    assert.equal((await voucherRef('bad-role').get()).exists, false);
  });
  await check('inventory IN writes voucher and balance atomically', async () => {
    const ret = await action(editor, 'create', 'supply', { item: v('supply','in',10) });
    assert.equal(ret.onHand, 10);
    assert.equal((await balanceRef.get()).data().onHand, 10);
    assert.equal((await voucherRef('supply').get()).data().revision, 1);
  });
  await check('same ID create retry is idempotent', async () => {
    const ret = await action(editor, 'create', 'supply', { item: v('supply','in',10) });
    assert.equal(ret.duplicate, true);
    assert.equal((await balanceRef.get()).data().onHand, 10);
  });
  await check('same voucher ID with different quantity is rejected', async () => {
    await failWith(() => action(editor, 'create', 'supply', { item: v('supply','in',999) }), 'WAREHOUSE_ID_COLLISION');
    assert.equal((await balanceRef.get()).data().onHand, 10);
  });
  await check('concurrent OUT 7+7 from stock 10: exactly one succeeds', async () => {
    const result = await Promise.allSettled([
      action(editor, 'create', 'out-A', { item: v('out-A','out',7) }),
      action(editor, 'create', 'out-B', { item: v('out-B','out',7) }),
    ]);
    assert.equal(result.filter(x => x.status === 'fulfilled').length, 1, JSON.stringify(result));
    assert.equal(result.filter(x => x.status === 'rejected').length, 1);
    assert.match(String(result.find(x => x.status === 'rejected').reason), /WAREHOUSE_INSUFFICIENT_STOCK/);
    assert.equal((await balanceRef.get()).data().onHand, 3);
    assert.equal(Number((await voucherRef('out-A').get()).exists) + Number((await voucherRef('out-B').get()).exists), 1);
  });
  const issuedId = (await voucherRef('out-A').get()).exists ? 'out-A' : 'out-B';
  const blockedId = issuedId === 'out-A' ? 'out-B' : 'out-A';
  await check('failed OUT cannot create a phantom voucher', async () => {
    assert.equal((await voucherRef(blockedId).get()).exists, false);
  });
  await check('negative reversal of supply is denied without partial writes', async () => {
    await failWith(() => action(admin, 'softDelete', 'supply'), 'WAREHOUSE_INSUFFICIENT_STOCK');
    assert.equal((await voucherRef('supply').get()).data().deleted, false);
    assert.equal((await balanceRef.get()).data().onHand, 3);
  });
  await check('update and lost-response retry do not double-apply delta', async () => {
    const next = v(issuedId, 'out', 6);
    const first = await action(editor, 'update', issuedId, { item: next, expectedRevision: 1 });
    const retry = await action(editor, 'update', issuedId, { item: next, expectedRevision: 1 });
    assert.equal(first.onHand, 4);
    assert.equal(retry.duplicate, true);
    assert.equal((await balanceRef.get()).data().onHand, 4);
    assert.equal((await voucherRef(issuedId).get()).data().revision, 2);
  });
  await check('stale conflicting update is denied, unchanged stock', async () => {
    await failWith(() => action(editor, 'update', issuedId, { item: v(issuedId,'out',5), expectedRevision: 1 }), 'WAREHOUSE_REVISION_CONFLICT');
    assert.equal((await balanceRef.get()).data().onHand, 4);
  });
  await check('room migration rejects non-sandbox project', async () => {
    await db.doc(root).update({migrationSandbox: false});
    const room = { id: 'R1', projectId, revision: 1, updatedAt: Date.now(), subItems: [{id:'S1',name:'Trần',status:'Chưa làm',workVolume:4}] };
    await db.doc(`${root}/rooms/R1`).set(room);
    await failWith(() => migrateDevCopiedRoom({db,actor:admin,projectId,roomId:'R1',approval:'MIGRATE-VERIFIED-DEV-COPY'}), 'ROOM_MIGRATION_NOT_ISOLATED_DEV_COPY');
    assert.equal((await db.doc(`${root}/rooms/R1/subitem_definitions/S1`).get()).exists, false);
    assert.equal((await db.doc(`${root}/rooms/R1`).get()).data().subItemProgressMigrated, undefined);
    await db.doc(root).update({migrationSandbox: true});
  });
  await check('room migration atomically creates sidecars + marker, preserving legacy IDs', async () => {
    const roomRef = db.doc(`${root}/rooms/R1`);
    const before = (await roomRef.get()).data();
    const out = await migrateDevCopiedRoom({db,actor:admin,projectId,roomId:'R1',approval:'MIGRATE-VERIFIED-DEV-COPY'});
    const after = (await roomRef.get()).data();
    const def = (await db.doc(`${root}/rooms/R1/subitem_definitions/S1`).get()).data();
    const prog = (await db.doc(`${root}/rooms/R1/subitem_progress/S1`).get()).data();
    assert.equal(out.definitions, 1);
    assert.deepEqual(after.subItems, before.subItems);
    assert.equal(after.subItemProgressMigrated, true);
    assert.equal(after.revision, 2);
    assert.equal(def.id, 'S1');
    assert.equal(def.workVolume, 4);
    assert.equal(prog.status, 'Chưa làm');
  });
  await check('repeated migration fails closed, no duplicate sidecars', async () => {
    await failWith(() => migrateDevCopiedRoom({db,actor:admin,projectId,roomId:'R1',approval:'MIGRATE-VERIFIED-DEV-COPY'}), 'ROOM_MIGRATION_ALREADY_DONE');
    assert.equal((await db.collection(`${root}/rooms/R1/subitem_progress`).get()).size, 1);
    assert.equal((await db.collection(`${root}/rooms/R1/subitem_definitions`).get()).size, 1);
  });
  await check('migration requires ADMIN (editor cannot seed another room)', async () => {
    await db.doc(`${root}/rooms/R2`).set({id:'R2',projectId,revision:1,updatedAt:Date.now(),subItems:[{id:'S2',name:'Vách',status:'Chưa làm',workVolume:2}]});
    await failWith(() => migrateDevCopiedRoom({db,actor:editor,projectId,roomId:'R2',approval:'MIGRATE-VERIFIED-DEV-COPY'}), 'WAREHOUSE_ROLE_DENIED');
    assert.equal((await db.collection(`${root}/rooms/R2/subitem_progress`).get()).empty, true);
  });
  console.log(`P21.3 REAL FIRESTORE EMULATOR TRANSACTIONS ${passes}/${passes} PASS — DEMO ONLY; NOT LIVE DEV/PROD`);
} finally {
  await deleteApp(app);
}
