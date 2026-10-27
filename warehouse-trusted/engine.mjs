import { assertWarehouseRole } from './security.mjs';
import { assertManualProvenance } from './manual-provenance.mjs';
/**
 * HNL QLTC — trusted warehouse writer, isolated DEV candidate.
 * Firebase Admin Firestore is injected by the HTTP entrypoint; never run in browsers.
 * IMPORTANT: not activated until DEV deployment, complete migration of ALL writers,
 * verified copied-ledger parity, Rules direct-write DENY and emulator Golden.
 */
const EPS = 1e-8;
const fail = (code) => { throw new Error(code); };
const active = (data) => data && data.deleted !== true && data.deletedAt == null;
const cleanEmail = (email) => String(email || '').trim().toLowerCase();
const validId = (x) => typeof x === 'string' && x.length > 0 && x.length <= 300 && x.trim() === x
  && x !== '.' && x !== '..' && !x.includes('/') && !x.startsWith('__');
const validProjectId = validId;
const numeric = (v, code) => typeof v === 'number' && Number.isFinite(v) ? v : fail(code);
const round = (v) => Math.abs(v) < EPS ? 0 : v;
const normalize = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
export const warehouseKey = (item) => item.itemKind === 'equipment'
  ? `equipment-${normalize(item.materialName) || 'unknown'}--${normalize(item.unit) || 'unit'}`
  : normalize(item.materialId) ? `id-${normalize(item.materialId)}`
    : `legacy-${normalize(item.materialName) || 'unknown'}--${normalize(item.unit) || 'unit'}`;
const delta = (item) => {
  if (!['in', 'out'].includes(item.type)) fail('WAREHOUSE_INVALID_TYPE');
  const qty = numeric(item.quantity, 'WAREHOUSE_INVALID_QUANTITY');
  if (qty <= 0 || qty > 1e12) fail('WAREHOUSE_INVALID_QUANTITY');
  return item.type === 'in' ? qty : -qty;
};
const CLIENT_FIELDS = new Set([
  'id','type','itemKind','materialId','materialName','unit','quantity',
  'inputExpressions','location','handler','date','notes','sourceType','issuePurpose',
  'sourceStructureGroupId','sourceRoomId','sourceFloorId','sourceTeamId',
  'sourceWorkCategoryId','sourceNormId','sourceIssueKey',
]);
export function validatedVoucher(input, transactionId) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !validId(transactionId)) fail('WAREHOUSE_INVALID_REQUEST');
  if (Object.keys(input).some((k) => !CLIENT_FIELDS.has(k))) fail('WAREHOUSE_FORBIDDEN_VOUCHER_FIELD');
  if (input.id !== transactionId) fail('WAREHOUSE_VOUCHER_ID_MISMATCH');
  if (!['in', 'out'].includes(input.type)) fail('WAREHOUSE_INVALID_TYPE');
  if (input.itemKind !== undefined && !['material','equipment'].includes(input.itemKind)) fail('WAREHOUSE_INVALID_KIND');
  // This callable authenticates a human voucher, never automated room consumption.
  // Arbitrary sourceType strings (especially room-auto) would let a client forge a
  // server-managed voucher origin. Automation needs a separate trusted server flow
  // that verifies room/source references and idempotency before it can be enabled.
  if (input.sourceType !== undefined && input.sourceType !== 'manual')
    fail('WAREHOUSE_SYSTEM_SOURCE_REQUIRES_TRUSTED_AUTOMATION');
  if (input.sourceIssueKey !== undefined) fail('WAREHOUSE_PROVENANCE_SYSTEM_KEY_FORBIDDEN');
  // The legacy room UI recognizes deterministic AUTO-XK IDs and a reserved
  // notes prefix as receipts, even if sourceType was stripped by a client.
  if (transactionId.startsWith('AUTO-XK-') ||
      (typeof input.notes === 'string' && input.notes.startsWith('Tự động xuất kho dự toán tổng hợp cho [')))
    fail('WAREHOUSE_PROVENANCE_SYSTEM_RECEIPT_FORBIDDEN');
  for (const key of ['materialName','unit','location','handler','date']) {
    if (typeof input[key] !== 'string' || input[key].length > 500) fail('WAREHOUSE_INVALID_FIELD_'+key);
  }
  if (!input.materialName.trim() || !input.unit.trim()) fail('WAREHOUSE_INVALID_IDENTITY');
  if (input.materialId !== undefined && (typeof input.materialId !== 'string' || input.materialId.length > 300)) fail('WAREHOUSE_INVALID_MATERIAL_ID');
  for (const field of ['notes','sourceType','issuePurpose','sourceStructureGroupId','sourceRoomId','sourceFloorId',
    'sourceTeamId','sourceWorkCategoryId','sourceNormId','sourceIssueKey']) {
    if (input[field] !== undefined && typeof input[field] !== 'string') fail('WAREHOUSE_INVALID_FIELD_'+field);
  }
  if (input.issuePurpose !== undefined && !['project-work','external-project','other'].includes(input.issuePurpose))
    fail('WAREHOUSE_INVALID_ISSUE_PURPOSE');
  for (const [key,value] of Object.entries(input)) {
    if (value === undefined || value === null) fail('WAREHOUSE_UNDEFINED_FIELD_'+key);
    if (typeof value === 'number' && !Number.isFinite(value)) fail('WAREHOUSE_NONFINITE_FIELD_'+key);
    if (typeof value === 'string' && value.length > 4000) fail('WAREHOUSE_FIELD_TOO_LONG_'+key);
  }
  if (input.inputExpressions !== undefined && (
    !input.inputExpressions || typeof input.inputExpressions !== 'object' || Array.isArray(input.inputExpressions)
    || Object.entries(input.inputExpressions).some(([k,v]) => !validId(k) || typeof v !== 'string' || v.length > 200)
  )) fail('WAREHOUSE_INVALID_EXPRESSION');
  delta(input);
  return structuredClone(input);
}
function balanceValue(snap) {
  if (!snap.exists) return 0;
  const value = numeric(snap.data.onHand, 'WAREHOUSE_BALANCE_CORRUPT');
  if (value < -EPS || value > 1e15 || !Number.isSafeInteger(snap.data.revision) || snap.data.revision < 1) fail('WAREHOUSE_BALANCE_CORRUPT');
  if (snap.data.renamedTo) fail('WAREHOUSE_UNIT_RENAMED');
  return value;
}
function assertUnit(balance, item) {
  if (balance.exists && balance.data.unit && normalize(balance.data.unit) !== normalize(item.unit)) fail('WAREHOUSE_UNIT_NOT_CANONICAL');
}
function balanceRecord(snapshot, projectId, key, item, next, uid, time) {
  return {
    ...snapshot.data, id:key, projectId,
    itemKind:item.itemKind === 'equipment'?'equipment':'material',
    materialId:item.materialId || null, materialName:item.materialName, unit:item.unit,
    onHand:round(next),revision:Math.max(1,Number(snapshot.data?.revision || 0)+1),
    updatedAt:time,updatedByUid:uid,
  };
}
const docRef = (db, ...p) => db.doc(p.join('/'));
const readTx = async (tx, ref) => {
  const snapshot = await tx.get(ref);
  return {exists:snapshot.exists, data:snapshot.exists ? snapshot.data() : null};
};
/** Server-owned atomic operation. All auth, project role, voucher, and balance reads
 * are INSIDE ONE Firestore transaction so revocation/races retry consistently.
 */
export async function executeVoucher({db,actor,projectId,action,transactionId,item,expectedRevision,trashSettings}) {
  if (!db || !actor || !validProjectId(projectId) || !validId(transactionId)
      || !['create','update','softDelete','restore','discard'].includes(action)) fail('WAREHOUSE_INVALID_REQUEST');
  const proposed = (action==='create'||action==='update') ? validatedVoucher(item,transactionId) : null;
  if (action==='update' && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) fail('WAREHOUSE_EXPECTED_REVISION_REQUIRED');
  const email=cleanEmail(actor.email);
  if (!email || !actor.uid) fail('WAREHOUSE_AUTH_REQUIRED');
  const root = `projects/${projectId}`;
  return db.runTransaction(async tx => {
    const [projectSnap,emailMemberSnap,uidMemberSnap,voucherSnap] = await Promise.all([
      readTx(tx,docRef(db,root)),
      readTx(tx,docRef(db,root,'members',email)),
      readTx(tx,docRef(db,root,'members',actor.uid)),
      readTx(tx,docRef(db,root,'inventory',transactionId)),
    ]);
    if (!projectSnap.exists) fail('WAREHOUSE_PROJECT_NOT_FOUND');
    assertWarehouseRole({ project:projectSnap.data, emailMembership:emailMemberSnap.exists?emailMemberSnap.data:null,
      uidMembership:uidMemberSnap.exists?uidMemberSnap.data:null, actor,
      permission:['restore','softDelete','discard'].includes(action)?'ADMIN':'EDITOR' });
    // Verify each claimed source against server documents while still in the same
    // transaction as stock/voucher writes. Do not trust the client UI check.
    if (proposed) await assertManualProvenance({db,tx,root,item:proposed});
    const prior=voucherSnap.exists?voucherSnap.data:null;
    // A forged/stale materialKey could debit a different item's balance. Never
    // use an unverified legacy key in a privileged server transaction.
    if (prior?.materialKey && prior.materialKey !== warehouseKey(prior))
      fail('WAREHOUSE_VOUCHER_KEY_MISMATCH_RECONCILE_FIRST');
    if (action==='create' && prior && !active(prior)) fail('WAREHOUSE_DELETED_ID_REUSE_BLOCKED');
    if (action!=='create' && !prior) fail('WAREHOUSE_VOUCHER_NOT_FOUND');
    if (action==='update' && !active(prior)) fail('WAREHOUSE_VOUCHER_DELETED');
    // Historic automation receipts must not be rewritten as manually authored
    // receipts, even if the new payload claims sourceType=manual or omits it.
    if (action==='update' && prior?.sourceType && prior.sourceType !== 'manual')
      fail('WAREHOUSE_SYSTEM_SOURCE_REQUIRES_TRUSTED_AUTOMATION');
    // A callable may commit successfully while its HTTP response is lost. The
    // exact same update with the previous expectedRevision is a read-only retry;
    // anything different remains a hard conflict, never a second stock delta.
    const updateReplay = action==='update'
      && Number.isSafeInteger(prior.revision)
      && prior.revision===expectedRevision+1
      && Object.entries(proposed).every(([key,value]) =>
        JSON.stringify(prior[key]??null)===JSON.stringify(value));
    if (action==='update' && Number(prior.revision || 0)!==expectedRevision && !updateReplay)
      fail('WAREHOUSE_REVISION_CONFLICT');
    if (action==='discard' && prior?.deleted !== true) fail('WAREHOUSE_TRASH_NOT_DELETED');
    if (action==='discard' && (prior.trashRecoverable===false || Number(prior.trashDiscardedAt||0)>0))
      return {transactionId,duplicate:true,materialKey:prior.materialKey||warehouseKey(prior)};
    if (action==='restore' && prior.deleted!==true) {
      const key=prior.materialKey||warehouseKey(prior);
      const balance=await readTx(tx,docRef(db,root,'inventory_balances',key));
      if(!balance.exists) fail('WAREHOUSE_LEGACY_BALANCE_MISSING_RECONCILE_FIRST');
      return {transactionId,duplicate:true,materialKey:key,onHand:round(balanceValue(balance))};
    }
    if (action==='softDelete' && !active(prior)) return {transactionId,duplicate:true,materialKey:prior.materialKey||warehouseKey(prior)};
    // Retain deleted tombstones even after expiry. Only restore a still-recoverable one.
    if (action==='restore') {
      const deadline=prior.trashExpiresAt ?? (Number(prior.deletedAt||0)+7*24*3600*1000);
      if (prior.trashRecoverable===false || Number(prior.trashDiscardedAt||0)>0 || !Number.isFinite(deadline) || deadline<=Date.now()) fail('WAREHOUSE_TRASH_EXPIRED');
    }
    if (action==='discard') {
      const now=Math.max(Date.now(),Number(prior.updatedAt||0)+1);
      tx.update(docRef(db,root,'inventory',transactionId),{
        trashRecoverable:false,trashDiscardedAt:now,updatedAt:now,
        updatedByUid:actor.uid,revision:Number(prior.revision||0)+1,
      });
      return {transactionId,duplicate:false,materialKey:prior.materialKey||warehouseKey(prior)};
    }
    // Check an identical create replay, but return only AFTER reading the
    // authoritative balance. A successful retry must return onHand and refuse
    // legacy/missing/corrupt derived balances rather than reporting success.
    let createReplay = false;
    if (action==='create' && prior) {
      for(const [key,value] of Object.entries(proposed)) {
        if (JSON.stringify(prior[key]??null)!==JSON.stringify(value)) fail('WAREHOUSE_ID_COLLISION');
      }
      createReplay = true;
    }
    const oldKey=prior ? (prior.materialKey || warehouseKey(prior)) : null;
    const newKey=proposed ? warehouseKey(proposed):oldKey;
    const keys=[...new Set([oldKey,newKey].filter(Boolean))];
    const refs=keys.map(key=>docRef(db,root,'inventory_balances',key));
    const snapshots=await Promise.all(refs.map(ref=>readTx(tx,ref)));
    const balances=new Map(keys.map((key,i)=>[key,{...snapshots[i],ref:refs[i]}]));
    for (const record of balances.values()) balanceValue(record);
    if (prior && !balances.get(oldKey)?.exists) fail('WAREHOUSE_LEGACY_BALANCE_MISSING_RECONCILE_FIRST');
    if (proposed) assertUnit(balances.get(newKey),proposed);
    if (createReplay || updateReplay) return {transactionId,duplicate:true,materialKey:newKey,
      onHand:round(balanceValue(balances.get(newKey)))};
    const updates=new Map(keys.map(key=>[key,balanceValue(balances.get(key))]));
    if (prior && active(prior)) updates.set(oldKey, updates.get(oldKey)-delta(prior));
    if (proposed || action==='restore') {
      const next = proposed || prior;
      updates.set(newKey,updates.get(newKey)+delta(next));
    }
    // On new write, no other voucher is allowed to create artificial stock.
    for (const value of updates.values()) {
      if (!Number.isFinite(value) || value > 1e15) fail('WAREHOUSE_BALANCE_RANGE_EXCEEDED');
      if (value < -EPS) fail('WAREHOUSE_INSUFFICIENT_STOCK');
    }
    const now=Math.max(Date.now(),Number(prior?.updatedAt||0)+1,
      ...[...balances.values()].map(record=>Number(record.data?.updatedAt||0)+1));
    for (const [key,value] of updates) {
      const record=balances.get(key);
      const source=key===newKey?(proposed||prior):prior;
      tx.set(record.ref,balanceRecord(record,projectId,key,source,value,actor.uid,now));
    }
    const voucherRef=docRef(db,root,'inventory',transactionId);
    if (action==='create') tx.set(voucherRef,{
      ...proposed,materialKey:newKey,revision:1,createdAt:now,createdByUid:actor.uid,
      updatedAt:now,updatedByUid:actor.uid,deleted:false,deletedAt:null,deletedBy:null,deletedByUid:null,
    });
    if (action==='update') tx.set(voucherRef,{
      ...prior,...proposed,materialKey:newKey,revision:expectedRevision+1,
      updatedAt:now,updatedByUid:actor.uid,
    });
    if (action==='softDelete') {
      const days=[3,7,15,30,60,90].includes(trashSettings?.retentionDays) ? trashSettings.retentionDays : 7;
      const enabled=trashSettings?.enabled!==false;
      tx.update(voucherRef,{
        deleted:true,deletedAt:now,deletedByUid:actor.uid,deletedBy:email,
        trashRetentionDays:days,trashExpiresAt:enabled?now+days*86400000:now,
        trashRecoverable:enabled,trashDiscardedAt:enabled?null:now,
        updatedAt:now,updatedByUid:actor.uid,revision:Number(prior.revision||0)+1,
      });
    }
    if (action==='restore') tx.update(voucherRef,{
      deleted:false,deletedAt:null,deletedByUid:null,deletedBy:null,
      trashRetentionDays:null,trashExpiresAt:null,trashRecoverable:null,trashDiscardedAt:null,
      updatedAt:now,updatedByUid:actor.uid,revision:Number(prior.revision||0)+1,
    });
    return {transactionId,duplicate:false,materialKey:newKey,onHand:round(updates.get(newKey))};
  }, {maxAttempts:5});
}
