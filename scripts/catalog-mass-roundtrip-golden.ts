import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readCatalogMassFromExcel, assertConsistentMaterialCatalogMass } from '../src/utils/catalogMassRoundTrip';
import { consistentCatalogMass, effectiveOrderMass } from '../src/utils/warehouseOrderCatalogMass';

assert.equal(readCatalogMassFromExcel('0,65', null, 2), 0.65);
assert.equal(readCatalogMassFromExcel('0.030', undefined, 2), 0.03);
assert.equal(readCatalogMassFromExcel(undefined, 0.4, 3), 0.4, 'legacy file missing kg column preserves current value');
assert.equal(readCatalogMassFromExcel('', 0.4, 3), 0.4, 'blank Excel cells preserve current value');
assert.equal(readCatalogMassFromExcel('', undefined, 3), null, 'no data means unknown, never zero mass');
for(const invalid of ['0','-1','abc','1/0']) {
  assert.throws(() => readCatalogMassFromExcel(invalid,null,4),/KL\/đơn vị/);
}
const base = [
  {materialName:'Ty M8',unit:'Thanh',kgPerUnit:0.65},
  {materialName:'Ty M8',unit:'Thanh',kgPerUnit:0.65},
  {materialName:'Ty M8',unit:'Bộ',kgPerUnit:0.85},
];
assert.doesNotThrow(() => assertConsistentMaterialCatalogMass(base));
assert.throws(() => assertConsistentMaterialCatalogMass([...base,{materialName:'ty m8',unit:'Thanh',kgPerUnit:0.75}]),/không thống nhất/);
assert.doesNotThrow(() => assertConsistentMaterialCatalogMass([...base,{materialName:'Ty M8',unit:'Thanh',kgPerUnit:null}]));
assert.equal(consistentCatalogMass([0.65,0.65,null]),0.65);
assert.equal(effectiveOrderMass({kgPerUnit:0.65},{quantity:50,kgPerUnit:0.75}),0.75,'manual order override retained');
const read=(p:string)=>readFileSync(p,'utf8');
const warehouse=read('src/components/WarehouseTab.tsx');
const norm=read('src/components/MaterialNormModal.tsx');
const equipment=read('src/components/EquipmentCatalogPanel.tsx');
const excel=read('src/utils/excelExport.ts');
const report=read('src/utils/warehouseCatalogReport.ts');
const app=read('src/App.tsx');
assert.match(warehouse,/syncGroupColumns=\{quickEditMode === 'norms' \? \[.*'kgPerUnit'/);
assert.match(warehouse,/kgPerUnit:\s*\(\(\) =>/,'quick equipment save must persist edited mass');
assert.match(warehouse,/kgPerUnit:\s*norm\.kgPerUnit \?\? ''/);
assert.match(warehouse,/totalKg:/,'quick stock must show derived mass');
assert.match(warehouse,/kgConflict: activeMasses\.size > 1/,'catalog retains conflict detection for orders');
assert.doesNotMatch(warehouse,/<th scope="col" className="px-2 py-0 text-right">KL\/đơn vị \(kg\)<\/th>/,'catalog list should not show auxiliary kg column');
assert.match(warehouse,/assertConsistentMaterialCatalogMass\(newNorms\)/,'Excel import checks duplicates');
assert.match(norm,/readCatalogMassFromExcel/);
assert.match(norm,/assertConsistentMaterialCatalogMass\(newNorms\)/);
assert.match(equipment,/KL\/đơn vị/);
assert.match(excel,/Danh Mục Thiết Bị/);
assert.match(excel,/KL\/đơn vị \(kg\)/);
assert.match(excel,/KL tồn \(kg\)/);
assert.match(report,/const col=\(label:string\)=>report\.columns\.findIndex/,'report formula must be label-based, not fixed Excel letters');
assert.doesNotMatch(report,/if\(cols!==9\)/,'catalog formula must survive inserted mass column');
assert.match(app,/onCreateMaterialCatalog=\{\(\{ materialName, unit, category, kgPerUnit \}\)/);
assert.doesNotMatch(warehouse,/onImportInventory\(equipmentChanges/,'equipment metadata cannot create inventory vouchers');
console.log('CATALOG MASS ROUNDTRIP GOLDEN PASS: legacy Excel, duplicate conflict, quick-edit, stock, reports, no ledger change');
