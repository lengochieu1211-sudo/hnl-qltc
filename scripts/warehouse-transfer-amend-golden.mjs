import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = (p) => readFileSync(p,'utf8');
const service=read('src/lib/warehouseProjectTransfer.ts');
const ledger=read('src/lib/warehouseTransactions.ts');
const tab=read('src/components/WarehouseTab.tsx');
const rules=read('firestore.rules');
function containsAll(source,parts,name){for(const p of parts)assert.ok(source.includes(p), `${name}: missing ${p}`);}
containsAll(service,[
  'amendWarehouseProjectTransferAtomic(',
  "!['pending','received'].includes(incoming.status)",
  'TRANSFER_STALE:',
  'source.deleted || source.type',
  "source.sourceType !== 'project-transfer-out'",
  "receipt.sourceType !== 'project-transfer-in'",
  'const delta = change.quantity - incoming.quantity;',
  'const nextSourceOnHand = sourceOnHand + incoming.quantity - change.quantity;',
  'const nextReceiptOnHand = receiptOnHand + change.quantity - incoming.quantity;',
  'TRANSFER_SOURCE_INSUFFICIENT:',
  'TRANSFER_RECEIVER_INSUFFICIENT:',
  'tx.update(sourceRef, {',
  'tx.update(inboxRef, {',
  'tx.update(receiptRef, {',
], 'amend service');
for(const [stock,delta,after] of [[10,5,5],[10,-4,14],[0,1,-1]]) {
  assert.equal(stock-delta,after);
}
for(const [receiver,delta,after] of [[8,-5,3],[2,-4,-2],[5,3,8]]) {
  assert.equal(receiver+delta,after);
}
containsAll(ledger,['TRANSFER_LINKED_EDIT_BLOCKED:', 'TRANSFER_LINKED_DELETE_BLOCKED:'],'generic ledger guards');
containsAll(tab,[
  'transferProjectName(row.fromProjectId)',
  "item.warehouseTransferId ? 'Điều chỉnh' : 'Sửa'",
  'hasDeleteAccess && !item.warehouseTransferId',
  'amendWarehouseProjectTransferAtomic(toProjectId, transferEditItem.warehouseTransferId',
  'availableProjects.some(p => p.id === otherProjectId && p.role === \'ADMIN\')',
], 'UI/ADMIN protection');
for(const f of ['warehouseTransferSourceCorrectionSafe','warehouseTransferReceiptCorrectionSafe','warehouseTransferInboxCorrectionSafe']){
  assert.ok(rules.includes('function '+f+'('), 'missing rules '+f);
}
containsAll(rules,[
  "canAdminOperate(toPid)",
  "canAdminOperate(old.transferFromProjectId)",
  "canAdminOperate(old.fromProjectId)",
  "old.status in ['pending','received']",
  "inboxBefore.status == 'received' && inboxAfter.status == 'received'",
  "['quantity','date','handler','notes','revision','updatedAt','updatedByUid']",
  "balanceAfter.onHand >= 0",
  "(collectionName != 'inventory' || !('warehouseTransferId' in resource.data))",
], 'Firestore fail-closed guards');
assert.equal(tab.includes('Từ dự án {row.fromProjectId}'), false,'raw project ID must not be primary UI label');
// PR: Android transfer correction should match compact Warehouse controls, without clipped button text.
containsAll(tab, [
  'max-h-[calc(100dvh-1.5rem)] w-full max-w-md',
  'space-y-3 overflow-y-auto overscroll-contain',
  'min-h-11 min-w-0 rounded-xl border border-slate-300 px-2 py-2 text-xs',
  'min-h-11 min-w-0 rounded-xl bg-blue-600 px-2 py-2 text-xs',
  'leading-4 whitespace-normal text-white',
], 'transfer correction mobile typography/viewport');
assert.ok(!tab.slice(tab.indexOf('aria-label="Điều chỉnh phiếu điều chuyển liên dự án"'), tab.indexOf('{/* Delete Inventory Confirmation Modal */}')).includes('sm:text-sm'), 'transfer modal buttons follow the Warehouse 12px button standard at every breakpoint');
console.log('warehouse-transfer-amend-golden: PASS (source/static; emulator remains mandatory)');
