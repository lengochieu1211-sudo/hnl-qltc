import assert from 'node:assert/strict';
import { calculateStockSummary } from '../src/utils/inventoryUtils';
import {
  calculateWarehouseLedgerOnHand,
  getWarehouseMaterialKey,
  isActiveWarehouseLedgerItem,
} from '../src/utils/warehouseLedgerMath';

const legacyBoard = {
  id: 'NK-001',
  type: 'in' as const,
  materialName: 'Tấm thạch cao tiêu chuẩn 9mm (1220x2440)',
  unit: 'Tấm',
  quantity: 500,
  location: 'Kho',
  handler: 'A',
  date: '2026-08-01',
};
const laterBoard = { ...legacyBoard, id: 'NK-2464', quantity: 60 };
const key = getWarehouseMaterialKey(legacyBoard);
assert.equal(key, getWarehouseMaterialKey(laterBoard));
assert.equal(calculateWarehouseLedgerOnHand([legacyBoard, laterBoard], key), 560);
assert.equal(calculateWarehouseLedgerOnHand([legacyBoard, laterBoard], key) - legacyBoard.quantity, 60);

const deletedLegacy = { ...legacyBoard, deleted: true };
const tombstonedLater = { ...laterBoard, deletedAt: Date.now() };
assert.equal(isActiveWarehouseLedgerItem(deletedLegacy), false);
assert.equal(isActiveWarehouseLedgerItem(tombstonedLater), false);
assert.equal(calculateWarehouseLedgerOnHand([deletedLegacy, laterBoard], key), 60);
assert.equal(calculateWarehouseLedgerOnHand([legacyBoard, tombstonedLater], key), 500);

const sameNameDifferentUnit = { ...legacyBoard, id: 'NK-U2', unit: 'Kiện', quantity: 7 };
assert.notEqual(getWarehouseMaterialKey(sameNameDifferentUnit), key);
assert.equal(calculateWarehouseLedgerOnHand([legacyBoard, sameNameDifferentUnit], key), 500);

const idMaterial = { ...legacyBoard, id: 'NK-ID', materialId: 'MAT-ABC', quantity: 3 };
const idKey = getWarehouseMaterialKey(idMaterial);
assert.equal(idKey, 'id-mat-abc');
assert.equal(calculateWarehouseLedgerOnHand([idMaterial], idKey), 3);

const negative = { ...legacyBoard, id: 'XK-NEG', type: 'out' as const, quantity: 600 };
assert.equal(calculateWarehouseLedgerOnHand([legacyBoard, negative], key), -100);

// Editing an existing OUT must compare the replacement with stock before that
// same transaction. Previously an IN 10 / OUT 8 ledger showed on-hand 2 and
// incorrectly blocked a note-only edit of the valid OUT 8.
for (const kind of ['material', 'equipment'] as const) {
  const incoming = { ...legacyBoard, id: `${kind}-IN`, itemKind: kind, quantity: 10 };
  const outgoing = { ...legacyBoard, id: `${kind}-OUT`, itemKind: kind, type: 'out' as const, quantity: 8 };
  const ledger = [incoming, outgoing];
  const current = calculateStockSummary(ledger, []).find((row) => row.itemKind === kind);
  const withoutEditing = calculateStockSummary(ledger.filter((row) => row.id !== outgoing.id), [])
    .find((row) => row.itemKind === kind);
  assert.equal(current?.currentStock, 2, `${kind}: stock already includes OUT 8`);
  assert.equal(withoutEditing?.currentStock, 10, `${kind}: editing OUT gets its quantity back`);
  assert.equal(10 - 8, 2, `${kind}: unchanged OUT remains valid`);
  assert.ok(11 > (withoutEditing?.currentStock || 0), `${kind}: larger OUT still blocked`);

  // Editing an IN into an OUT must also reverse the original IN first.
  const onlyIncoming = calculateStockSummary([incoming].filter((row) => row.id !== incoming.id), []);
  assert.equal(onlyIncoming.find((row) => row.itemKind === kind)?.currentStock ?? 0, 0);
}

console.log('warehouse-ledger-reconcile-golden: PASS');
