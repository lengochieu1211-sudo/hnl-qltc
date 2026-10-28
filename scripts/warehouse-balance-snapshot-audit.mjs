/**
 * HNL QLTC read-only warehouse snapshot audit. Never connects to Firebase, R2,
 * mutates Firestore, or adjusts a balance. Use a consistent same-instant DEV
 * export of projects/{pid}/inventory and projects/{pid}/inventory_balances.
 *
 * node --experimental-strip-types scripts/warehouse-balance-snapshot-audit.mjs \
 *   --ledger /private/dev-inventory.json --balances /private/dev-balances.json
 *
 * Exit: 0 = no identified inconsistencies; 2 = inconsistent or missing evidence;
 * 1 = malformed invocation. Neither exit code certifies Firestore Rules security.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getWarehouseMaterialKey, isActiveWarehouseLedgerItem, getWarehouseSignedDelta } from '../src/utils/warehouseLedgerMath.ts';

export const STOCK_EPSILON = 1e-6;

function asRows(source, label) {
  if (Array.isArray(source)) return source;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    if (Array.isArray(source.documents)) return source.documents;
    if (Array.isArray(source[label])) return source[label];
    // Keyed map of Firestore document IDs -> document data.
    if (Object.values(source).every(value => value && typeof value === 'object' && !Array.isArray(value))) {
      return Object.entries(source).map(([id, value]) => ({ ...value, id: value.id ?? id }));
    }
  }
  throw new Error(`INVALID_${label.toUpperCase()}_SNAPSHOT: expected array or keyed document map`);
}

export function auditWarehouseSnapshots(ledgerInput, balancesInput, { epsilon = STOCK_EPSILON } = {}) {
  const ledger = asRows(ledgerInput, 'inventory');
  const balances = asRows(balancesInput, 'inventory_balances');
  const errors = [], warnings = [];
  const observedVoucherIds = new Set(), observedBalanceIds = new Set();
  const totals = new Map(), activeCount = new Map(), allKeys = new Set(), projectIds = new Set();
  const trackProject = row => {
    if (typeof row.projectId === 'string' && row.projectId.trim()) projectIds.add(row.projectId.trim());
  };
  const add = (severity, code, key, info = '') => (severity === 'error' ? errors : warnings).push({ code, key, ...(info ? { info } : {}) });

  for (const [i, row] of ledger.entries()) {
    const keyRef = `inventory[${i}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      add('error', 'INVALID_VOUCHER', keyRef); continue;
    }
    trackProject(row);
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!id) add('error', 'MISSING_VOUCHER_ID', keyRef);
    else if (observedVoucherIds.has(id)) add('error', 'DUPLICATE_VOUCHER_ID', id);
    else observedVoucherIds.add(id);
    let key;
    try {
      key = row.materialKey || getWarehouseMaterialKey(row);
      if (typeof key !== 'string' || !key.trim()) throw Error('empty materialKey');
      allKeys.add(key);
    } catch {
      add('error', 'INVALID_MATERIAL_KEY', id || keyRef); continue;
    }
    if (!isActiveWarehouseLedgerItem(row)) continue;
    if (row.type !== 'in' && row.type !== 'out') {
      add('error', 'INVALID_VOUCHER_TYPE', id || keyRef); continue;
    }
    let delta;
    try {
      delta = getWarehouseSignedDelta(row);
      if (!Number.isFinite(delta)) throw Error('nonfinite delta');
    } catch {
      add('error', 'INVALID_VOUCHER_QUANTITY', id || keyRef); continue;
    }
    const sum = (totals.get(key) || 0) + delta;
    if (!Number.isFinite(sum)) {
      add('error', 'NONFINITE_LEDGER_TOTAL', key); continue;
    }
    totals.set(key, sum);
    activeCount.set(key, (activeCount.get(key) || 0) + 1);
  }

  const balancesByKey = new Map();
  for (const [i, row] of balances.entries()) {
    const keyRef = `inventory_balances[${i}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      add('error', 'INVALID_BALANCE_ROW', keyRef); continue;
    }
    trackProject(row);
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!id) { add('error', 'MISSING_BALANCE_ID', keyRef); continue; }
    if (observedBalanceIds.has(id)) { add('error', 'DUPLICATE_BALANCE_ID', id); continue; }
    observedBalanceIds.add(id);
    const stock = row.onHand;
    if (typeof stock !== 'number' || !Number.isFinite(stock)) {
      add('error', 'INVALID_BALANCE_NUMBER', id); continue;
    }
    if (stock < -epsilon) add('error', 'NEGATIVE_BALANCE', id);
    balancesByKey.set(id, row);
  }

  if (projectIds.size > 1) add('error', 'MIXED_PROJECT_SNAPSHOT', [...projectIds].sort().join(','));
  if (ledger.length === 0 && balances.length === 0) add('warning', 'EMPTY_SNAPSHOT', 'inventory/inventory_balances');

  for (const [key, ledgerStock] of totals.entries()) {
    if (ledgerStock < -epsilon) add('error', 'NEGATIVE_LEDGER_TOTAL', key);
    const balance = balancesByKey.get(key);
    if (!balance) {
      add('error', 'MISSING_BALANCE', key);
      continue;
    }
    if (typeof balance.onHand === 'number' && Number.isFinite(balance.onHand)
      && Math.abs(balance.onHand - ledgerStock) > epsilon) {
      add('error', 'BALANCE_LEDGER_MISMATCH', key, `delta=${(balance.onHand - ledgerStock).toPrecision(9)}`);
    }
  }
  for (const [key, balance] of balancesByKey.entries()) {
    if (totals.has(key)) continue;
    if (Math.abs(balance.onHand) > epsilon) {
      add('error', 'ORPHAN_NONZERO_BALANCE', key);
    } else {
      // Historical zero/tombstone balances may legitimately remain after soft-delete/rename.
      add('warning', 'ZERO_BALANCE_WITHOUT_ACTIVE_LEDGER', key);
    }
  }
  return {
    status: errors.length ? 'BLOCKED' : 'NO_DISCREPANCY_DETECTED',
    note: 'READ-ONLY snapshot consistency audit; not proof of no forgery, data completeness, live transaction isolation or Rules security.',
    counts: {
      ledgerRows: ledger.length,
      activeLedgerRows: [...activeCount.values()].reduce((a, b) => a + b, 0),
      balanceRows: balances.length,
      ledgerKeys: totals.size,
      errors: errors.length,
      warnings: warnings.length,
    },
    errors, warnings,
  };
}

function readLocalJson(file) {
  if (!file || file.startsWith('http:') || file.startsWith('https:')) throw Error('Only local JSON files are accepted');
  return JSON.parse(readFileSync(resolve(file), 'utf8'));
}
function cli() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--ledger' || args[2] !== '--balances') {
    console.error('Usage: node --experimental-strip-types scripts/warehouse-balance-snapshot-audit.mjs --ledger path.json --balances path.json');
    return 1;
  }
  try {
    const report = auditWarehouseSnapshots(readLocalJson(args[1]), readLocalJson(args[3]));
    console.log(JSON.stringify(report, null, 2));
    return report.status === 'BLOCKED' ? 2 : 0;
  } catch (error) {
    console.error('AUDIT INPUT ERROR:', error instanceof Error ? error.message : String(error));
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = cli();
}
