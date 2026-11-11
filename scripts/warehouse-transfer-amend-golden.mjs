import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Pure/offline guard. This is NOT a substitute for Firestore Emulator behavior.
const read = (p) => readFileSync(p, 'utf8');
const service = read('src/lib/warehouseProjectTransfer.ts');
const ledger = read('src/lib/warehouseTransactions.ts');
const tab = read('src/components/WarehouseTab.tsx');
const rules = read('firestore.rules');
const behavior = read('scripts/firebase-rules-behavior.mjs');
const contains = (s, tokens, label) => tokens.forEach(t => assert(s.includes(t), `${label}: missing ${t}`));

contains(service, [
  'amendWarehouseProjectTransferAtomic(',
  'TRANSFER_STALE:',
  'TRANSFER_LINK_INCONSISTENT:',
  'TRANSFER_SOURCE_INSUFFICIENT:',
  'TRANSFER_RECEIVER_INSUFFICIENT:',
  'TRANSFER_REASON_REQUIRED:',
  "source.sourceType !== 'project-transfer-out'",
  "receipt.sourceType !== 'project-transfer-in'",
  'const nextSourceOnHand = sourceOnHand + incoming.quantity - change.quantity;',
  'const nextReceiptOnHand = receiptOnHand + change.quantity - incoming.quantity;',
  "[String(prior || '').trim(), extra.trim(), evidence].filter(Boolean)",
  "tx.update(sourceRef, {",
  "tx.update(inboxRef, {",
  "tx.update(receiptRef, {",
  'notes: appended(receipt.notes)',
], 'atomic correction service');
assert.equal(service.includes('export async function correctWarehouseProjectTransferQuantityAtomic('), false,
  'the correction service must expose one authoritative entry point');
for (const [source, receiver, prior, next, expectedSource, expectedReceiver] of [
  [10, 5, 2, 5, 7, 8],
  [10, 5, 5, 2, 13, 2],
  [0, 0, 1, 2, -1, 1],
  [4, 0, 5, 2, 7, -3],
]) {
  const nextSource=source+prior-next;
  const nextReceiver=receiver+next-prior;
  assert.equal(nextSource,expectedSource);
  assert.equal(nextReceiver,expectedReceiver);
}
contains(ledger,[
  'TRANSFER_LINKED_EDIT_BLOCKED:',
  'TRANSFER_LINKED_DELETE_BLOCKED:',
], 'normal single-project ledger safeguards');
contains(tab,[
  'transferProjectName(row.fromProjectId)',
  'readableWarehouseTransferNotes(item.notes)',
  "item.warehouseTransferId ? 'Điều chỉnh' : 'Sửa'",
  'hasDeleteAccess && !item.warehouseTransferId',
  'amendWarehouseProjectTransferAtomic(toProjectId, transferEditItem.warehouseTransferId',
  'availableProjects.some(p => p.id === otherProjectId && p.role === \'ADMIN\')',
  'Điều chỉnh phiếu chờ nhận',
  'Lý do điều chỉnh (bắt buộc)',
], 'mobile/desktop UI and ADMIN role');
contains(rules, [
  'function warehouseTransferSourceCorrectionSafe(',
  'function warehouseTransferReceiptCorrectionSafe(',
  'function warehouseTransferInboxCorrectionSafe(',
  'canAdminOperate(projectId) && canAdminOperate(toPid)',
  'canAdminOperate(projectId) && canAdminOperate(old.transferFromProjectId)',
  'canAdminOperate(projectId) && canAdminOperate(old.fromProjectId)',
  'balanceAfter.onHand == balanceBefore.onHand + old.quantity - row.quantity',
  'balanceAfter.onHand == balanceBefore.onHand + row.quantity - old.quantity',
  "old.status in ['pending','received']",
  "resource.data.get('sourceType', '') == 'project-transfer-in'",
  "(collectionName != 'inventory' || !('warehouseTransferId' in resource.data))",
], 'Rules limited and paired writes');
contains(behavior, [
  'ADMIN corrects pending transfer 2 to 3 with exact source balance',
  'linked pending correction without source balance update is forbidden',
  'linked received correction without receiver balance is forbidden',
  'ADMIN adjusts received transfer 2 to 3 with two balances and 3 linked docs',
], 'emulator regression scenarios');
assert.equal(tab.includes('Từ dự án {row.fromProjectId}'), false, 'raw project ID should not be default UI label');
console.log('warehouse-transfer-amend-golden: PASS (source + arithmetic; emulator and runtime still required)');
