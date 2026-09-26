import assert from 'node:assert/strict';
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

console.log('warehouse-ledger-reconcile-golden: PASS');
