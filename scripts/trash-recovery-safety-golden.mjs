import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isGenericTrashRecoverableCollection, planTrashRestore, TRASH_RECOVERY_CLOUD_COLLECTIONS, TRASH_RELATED_LINK_FIELDS } from '../src/utils/trashRestorePolicy.ts';
const read = (path) => readFileSync(path, 'utf8');
const now = 50000000000;
const makeOp = (items = [{collection: 'defects', entityId: 'D-1'}]) => ({
  projectId: 'DEV-123', deletedAt: now - 10000, expiresAt: now + 86400000,
  deletedItems: items, relatedBefore: {},
});
assert.deepEqual(Object.keys(TRASH_RECOVERY_CLOUD_COLLECTIONS).sort(), [
  'materialNorms','workVolumes','floorPlans','defects','roomProgressList','checklist','crewRecords','teams',
].sort());
for (const name of Object.keys(TRASH_RECOVERY_CLOUD_COLLECTIONS)) assert.equal(isGenericTrashRecoverableCollection(name), true);
assert.equal(isGenericTrashRecoverableCollection('inventory'), false, 'stock vouchers require specialized atomic ledger recovery');
assert.equal(isGenericTrashRecoverableCollection('chat'), false);
const good = planTrashRestore(makeOp(), 'DEV-123', now);
assert.deepEqual(good.targets, [{collection:'defects', entityId:'D-1'}]);
const related = makeOp([{collection:'roomProgressList', entityId:'R-1'}]);
related.relatedBefore = { defects: [{id:'D-1',roomId:'R-1'}], checklist:[{id:'C-1',roomId:'R-1'}] };
assert.equal(planTrashRestore(related,'DEV-123',now).related.length,2);
for (const [collection, fields] of Object.entries(TRASH_RELATED_LINK_FIELDS)) {
  assert.ok(fields.length >= 1, collection);
  assert.ok(!fields.includes('id') && !fields.includes('unitPrice') && !fields.includes('quantity'), 'related reconnect must not overwrite identities/stock/financials');
}
const invalid = (op, pattern, project='DEV-123') => assert.throws(()=>planTrashRestore(op,project,now),pattern);
invalid(makeOp([{collection:'inventory',entityId:'NK-1'}]),/WAREHOUSE_REQUIRES_ATOMIC_LEDGER/);
invalid(makeOp([{collection:'futureModule',entityId:'A-1'}]),/UNSUPPORTED_COLLECTION/);
invalid({...makeOp(),projectId:'OTHER'},/PROJECT_MISMATCH/);
invalid({...makeOp(),expiresAt:now},/EXPIRED/);
invalid({...makeOp(),deletedItems:[]},/EMPTY_OPERATION/);
invalid(makeOp([{collection:'defects',entityId:'../../other'}]),/INVALID_ID/);
invalid(makeOp([{collection:'defects',entityId:'D-1'},{collection:'defects',entityId:'D-1'}]),/DUPLICATE_ID/);
invalid(makeOp(Array.from({length:151},(_,i)=>({collection:'defects',entityId:`D-${i}`}))),/TOO_MANY_RECORDS/);
const service=read('src/lib/trashRestore.ts');
const app=read('src/App.tsx');
const crew=read('src/components/CrewTabBase.tsx');
const config=read('src/components/GoogleConfigTab.tsx');
const warehouse=read('src/lib/warehouseTransactions.ts');
const purge=read('src/lib/cloudBinaryPurge.ts');
const rules=read('firestore.rules');
assert.match(service,/fetchProjectUserRoleFromCloud\(projectId, user\)/);
assert.match(service,/role\.role !== 'ADMIN'/);
assert.match(service,/transaction\.get\(operationRef\)/);
assert.match(service,/for \(const ref of restoreRefs\) restoreSnaps\.push\(await transaction\.get\(ref\)\)/);
assert.match(service,/TRASH_RECOVERY_TOMBSTONE_MISSING/);
assert.match(service,/TRASH_RECOVERY_TARGET_ALREADY_ACTIVE/);
assert.match(service,/transaction\.delete\(operationRef\)/);
assert.match(service,/Number\(row\.data\(\)\?\.updatedAt \|\| 0\) > Number\(operation\.deletedAt \|\| 0\)/);
assert.doesNotMatch(service,/deleteDoc\(|deleteEntityPhotos\(|purgeBinaryObject\(/);
assert.match(app,/await restoreProjectTrashAtomic\(activeProjectIdRef\.current, operationId\)/);
assert.match(app,/if \(!isOnline\) \{/);
assert.match(app,/if \(FIREBASE_ONLY_RUNTIME\) \{/);
assert.doesNotMatch(app,/deleteFloorPlanImageFromCloud\(/);
assert.doesNotMatch(app,/deleteEntityPhotos\(/);
assert.match(crew,/await deleteEntityPhotos\(projectId, 'crewRecord', activeLogEntityId\)/, 'unsaved new crew draft cleanup preserved');
assert.doesNotMatch(crew,/deleteEntityPhotos\(projectId, 'crewRecord', deletingRecordTarget\.id\)/, 'saved record photos preserved');
assert.match(config,/Thùng rác chung lưu 8 nhóm/);
assert.match(config,/Phiếu Nhập\/Xuất đã xóa được khôi phục bên dưới/);
assert.match(read('src/components/WarehouseDeletedVoucherRecovery.tsx'),/restoreWarehouseTransactionAtomic\(/);
assert.match(purge,/PHOTO_PURGE_ENTITY_NOT_TOMBSTONED/);
assert.match(purge,/await assertTrashTargetsDeletedOnServer\(operation\)/, 'all nine deleted targets must be server-confirmed before Trash metadata cleanup');
assert.match(purge,/TRASH_PURGE_TARGET_NOT_TOMBSTONED/);
assert.match(rules,/isCoreBusinessCollection\(collectionName\)/);
console.log('TRASH RECOVERY SAFETY GOLDEN PASS — 8 core classes, stock split, atomic and retained media');
