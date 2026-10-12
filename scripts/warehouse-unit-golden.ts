import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { InventoryItem, MaterialNorm } from '../src/types';
import { getWarehouseMaterialKey, getWarehouseSignedDelta } from '../src/utils/warehouseLedgerMath';
import { calculateStockSummary, resolveNormMaterialId } from '../src/utils/inventoryUtils';

const ledger = (type: 'in' | 'out', id: string, name: string, unit: string, qty: number, kind: 'material' | 'equipment', materialId?: string): InventoryItem => ({
  id, type, itemKind: kind, materialId, materialName: name, unit,
  quantity: qty, date: '2026-10-12', location: 'Kho chính', handler: 'QA',
});
const beforeNorm: MaterialNorm = {
  id: 'N-1', materialId: 'MAT-PANEL-1', category: 'Khung xương',
  materialName: 'Thanh xương', unit: 'Thanh', quotaQuantity: 80,
} as MaterialNorm;
const input = [
  ledger('in', 'I-1', 'Thanh xương', 'Thanh', 100, 'material', 'MAT-PANEL-1'),
  ledger('out', 'O-1', 'Thanh xương', 'Thanh', 40, 'material', 'MAT-PANEL-1'),
];
const before = calculateStockSummary(input, [beforeNorm]);
assert.equal(before.length, 1);
assert.equal(before[0].currentStock, 60);

const afterNorm = { ...beforeNorm, unit: 'Cây' };
const after = input.map((item) => ({ ...item, unit: 'Cây' }));
assert.deepEqual(after.map((item) => item.id), input.map((item) => item.id));
assert.deepEqual(after.map((item) => item.quantity), input.map((item) => item.quantity));
assert.equal(getWarehouseMaterialKey(input[0]), getWarehouseMaterialKey(after[0]));
assert.equal(resolveNormMaterialId(beforeNorm), resolveNormMaterialId(afterNorm));
assert.equal(calculateStockSummary(after, [afterNorm])[0].currentStock, 60);
assert.equal(after.reduce((n, item) => n + getWarehouseSignedDelta(item), 0), 60);

const device = [
  ledger('in', 'D-I1', 'Máy cắt', 'Cái', 8, 'equipment'),
  ledger('out', 'D-O1', 'Máy cắt', 'Cái', 3, 'equipment'),
];
const deviceAfter = device.map((item) => ({ ...item, unit: 'Bộ' }));
assert.notEqual(getWarehouseMaterialKey(device[0]), getWarehouseMaterialKey(deviceAfter[0]));
assert.equal(calculateStockSummary(deviceAfter, [])[0].currentStock, 5);
assert.equal(deviceAfter.reduce((n, item) => n + getWarehouseSignedDelta(item), 0), 5);

const migration = readFileSync('src/lib/warehouseUnitMigration.ts', 'utf8');
const warehouse = readFileSync('src/components/WarehouseTab.tsx', 'utf8');
const norms = readFileSync('src/components/MaterialNormModal.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
for (const expected of [
  'getDocsFromServer(inventoryCollection)', 'getDocsFromServer(normCollection)',
  'runTransaction(db, async (tx)', 'balanceBefore', 'currentLedger',
  'currentNorms', 'initialBalances', 'MAX_ATOMIC_ROWS', 'tx.update(ref',
  'nextOnHand', 'onHand: isTarget ? nextOnHand : 0', 'retiredTo: isTarget ? null : targetMaterialKey',
  'Tên vật tư và ĐVT liên quan đến nhiều materialId',
]) assert.ok(migration.includes(expected), 'Missing unit rename guard: ' + expected);
assert.match(warehouse, /onRenameWarehouseUnit\?\:/);
assert.match(warehouse, /readOnly=\{itemKind === 'equipment'/);
assert.match(warehouse, /quickEditMode === 'norms'/);
assert.match(warehouse, /!key\.endsWith\('::unit'\)/);
assert.match(norms, /await onRenameWarehouseUnit/);
assert.match(app, /await renameWarehouseUnitAtomic/);
assert.match(app, /ĐVT phiếu không khớp Định mức/);
console.log('Warehouse unit rename / material+equipment golden: PASS');
