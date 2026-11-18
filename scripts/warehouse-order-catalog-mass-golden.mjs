import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { effectiveOrderMass, consistentCatalogMass } from '../src/utils/warehouseOrderCatalogMass.ts';

const catalog = { kgPerUnit: 0.65 };
const blank = { quantity: 200, kgPerUnit: null };
assert.equal(effectiveOrderMass(catalog, blank), 0.65, 'catalog must auto-fill blank order mass');
assert.equal(blank.quantity * effectiveOrderMass(catalog, blank), 130, 'derived shipment weight must be correct');
assert.equal(effectiveOrderMass(catalog, {quantity:200, kgPerUnit:0.75}), 0.75, 'manual order override wins');
assert.equal(effectiveOrderMass({kgPerUnit:null}, blank), null, 'missing catalog mass remains missing');
assert.equal(consistentCatalogMass([null,0.65,0.65,undefined]),0.65,'missing parallel norms do not erase valid mass');
assert.equal(consistentCatalogMass([0.65,0.75]),null,'conflicting material norms must fail closed');
assert.equal(consistentCatalogMass([]),null,'empty norms must not invent weight');
assert.equal(effectiveOrderMass({kgPerUnit:0}, blank),null,'zero mass must never auto-fill');
// A quick-edit caller that omits kgPerUnit must not clear it on a metadata-only save.
const equipment = readFileSync(new URL('../src/lib/equipmentCatalog.ts', import.meta.url),'utf8');
assert.match(equipment,/Object\.prototype\.hasOwnProperty\.call\(entry, 'kgPerUnit'\)/);
assert.match(equipment,/kgPerUnit: entry\.kgPerUnit \?\? null/);
const rules = readFileSync(new URL('../firestore.rules', import.meta.url),'utf8');
assert.match(rules,/equipment_catalog[\s\S]{0,2100}kgPerUnit/);
assert.match(rules,/kgPerUnit is number && request\.resource\.data\.kgPerUnit > 0/);
const order = readFileSync(new URL('../src/components/WarehouseOrderSheet.tsx', import.meta.url),'utf8');
assert.match(order,/effectiveOrderMass\(row,draft\[row\.key\]\)/);
assert.match(order,/Tự lấy từ danh mục/);
console.log('WAREHOUSE CATALOG MASS LINK GOLDEN PASS: 12 assertions');
