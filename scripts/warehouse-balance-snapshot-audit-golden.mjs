import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditWarehouseSnapshots } from './warehouse-balance-snapshot-audit.mjs';
import { getWarehouseMaterialKey } from '../src/utils/warehouseLedgerMath.ts';

const seed = { id: 'V1', itemKind: 'material', materialName: 'Tấm thạch cao', unit: 'Tấm', type: 'in', quantity: 10 };
const out = { ...seed, id: 'V2', type: 'out', quantity: 3 };
const key = getWarehouseMaterialKey(seed);
const b = { id: key, onHand: 7, revision: 2, updatedAt: 1 };
const report = (rows, balances) => auditWarehouseSnapshots(rows, balances);
const has = (result, code) => result.errors.some(e => e.code === code);
assert.equal(report([seed, out], [b]).status, 'NO_DISCREPANCY_DETECTED');
assert.equal(report([], []).warnings[0].code, 'EMPTY_SNAPSHOT');
assert.equal(has(report([{ ...seed, projectId: 'DEV-A' }], [{ ...b, projectId: 'DEV-B', onHand: 10 }]), 'MIXED_PROJECT_SNAPSHOT'), true);
assert.equal(report({ V1: seed, V2: out }, { [key]: b }).status, 'NO_DISCREPANCY_DETECTED', 'keyed snapshot must be accepted');
assert.equal(report([seed, out, { ...seed, id: 'TOMBSTONE', quantity: 99, deleted: true }], [b]).status, 'NO_DISCREPANCY_DETECTED');
assert.equal(report([seed, out, { ...seed, id: 'TOMBSTONE', quantity: 99, deletedAt: 123 }], [b]).status, 'NO_DISCREPANCY_DETECTED');
assert.equal(report([seed, out], [{ ...b, onHand: 7 + 0.0000001 }]).status, 'NO_DISCREPANCY_DETECTED', 'rounding tolerance');
assert.equal(has(report([seed, out], [{ ...b, onHand: 9 }]), 'BALANCE_LEDGER_MISMATCH'), true);
assert.equal(has(report([seed, out], []), 'MISSING_BALANCE'), true);
assert.equal(has(report([seed, { ...out, quantity: 20 }], [{ ...b, onHand: -10 }]), 'NEGATIVE_LEDGER_TOTAL'), true);
assert.equal(has(report([seed, out, { ...seed }], [b]), 'DUPLICATE_VOUCHER_ID'), true);
assert.equal(has(report([seed, { ...out, quantity: 0 }], [b]), 'INVALID_VOUCHER_QUANTITY'), true);
assert.equal(has(report([seed, { ...out, type: 'IMPORT' }], [b]), 'INVALID_VOUCHER_TYPE'), true);
assert.equal(has(report([seed, { ...out, quantity: 'NaN' }], [b]), 'INVALID_VOUCHER_QUANTITY'), true);
assert.equal(has(report([], [{ ...b, onHand: 42 }]), 'ORPHAN_NONZERO_BALANCE'), true);
assert.equal(report([], [{ ...b, onHand: 0 }]).warnings[0].code, 'ZERO_BALANCE_WITHOUT_ACTIVE_LEDGER');
assert.equal(has(report([seed], [{ ...b, onHand: Infinity }]), 'INVALID_BALANCE_NUMBER'), true);
assert.equal(has(report([seed], [b, b]), 'DUPLICATE_BALANCE_ID'), true);
assert.throws(() => report({ bogus: ['bad'] }, []), /INVALID_INVENTORY_SNAPSHOT/);
// Do not normalize away the canonical materialId difference.
const keyed = { ...seed, materialId: 'MAT-123', id: 'ID-001' };
assert.equal(getWarehouseMaterialKey(keyed), 'id-mat-123');
assert.equal(report([keyed], [{ id: 'id-mat-123', onHand: 10 }]).status, 'NO_DISCREPANCY_DETECTED');
assert.equal(has(report([keyed], [b]), 'MISSING_BALANCE'), true);

// CLI reads local files only, emits JSON, and returns nonzero for actual mismatches.
const directory = mkdtempSync(join(tmpdir(), 'hnl-warehouse-audit-'));
try {
  const ledgerFile = join(directory, 'inventory.json');
  const balanceFile = join(directory, 'inventory_balances.json');
  writeFileSync(ledgerFile, JSON.stringify([seed, out]));
  writeFileSync(balanceFile, JSON.stringify([b]));
  const args = ['--experimental-strip-types', 'scripts/warehouse-balance-snapshot-audit.mjs', '--ledger', ledgerFile, '--balances', balanceFile];
  const good = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).status, 'NO_DISCREPANCY_DETECTED');
  writeFileSync(balanceFile, JSON.stringify([{ ...b, onHand: 20 }]));
  const bad = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(bad.status, 2, bad.stderr);
  assert.equal(JSON.parse(bad.stdout).status, 'BLOCKED');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log('warehouse-balance-snapshot-audit-golden: PASS');
