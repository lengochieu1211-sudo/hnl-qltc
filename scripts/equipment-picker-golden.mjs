import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// The source compiler ships with this application's normal dependency set.
// Golden uses transpileModule so pure catalog logic can be checked without Firebase access.
const require = createRequire(import.meta.url);
const ts = require('typescript');
const compile = (file, mockImports = {}) => {
  const source = fs.readFileSync(file, 'utf8');
  const emitted = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const errors = (emitted.diagnostics || []).filter(row => row.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${file}: source syntax is valid`);
  const module = { exports: {} };
  new Function('module', 'exports', 'require', emitted.outputText)(module, module.exports, (path) => {
    if (path in mockImports) return mockImports[path];
    throw new Error(`Unexpected runtime import: ${path}`);
  });
  return module.exports;
};
const units = compile('src/utils/unitUtils.ts');
const { buildEquipmentTemplateSourceItems } = compile('src/utils/equipmentTemplateSource.ts', { './unitUtils': units });

const master = [
  { id: 'EQ-MAYHAN', name: 'Máy hàn', displayName: 'Máy hàn 220V', unit: 'Cái', category: 'Máy điện' },
  { id: 'EQ-DELETED', name: 'Máy khoan', unit: 'Cái', deletedAt: 1 },
];
const vouchers = [
  { id: 'voucher-1', itemKind: 'equipment', materialName: 'Máy hàn', unit: 'cái' },
  { id: 'voucher-2', itemKind: 'equipment', materialName: 'Máy cắt', unit: 'Cái' },
  { id: 'voucher-3', itemKind: 'equipment', materialName: 'MÁY CẮT', unit: 'Bộ' },
  { id: 'voucher-4', itemKind: 'equipment', materialName: 'Máy khoan', unit: 'Cái' },
  { id: 'voucher-5', itemKind: 'equipment', materialName: 'Giàn giáo', unit: 'Bộ', deletedAt: Date.now() },
  { id: 'voucher-6', itemKind: 'equipment', materialName: 'Thiết bị xóa cũ', unit: 'Cái', deleted: true },
  { id: 'voucher-7', itemKind: 'material', materialName: 'Tấm thạch cao', unit: 'Tấm' },
  { id: 'voucher-8', itemKind: 'equipment', materialName: 'Không ĐVT', unit: '' },
];
const rows = buildEquipmentTemplateSourceItems(master, vouchers);
assert.equal(rows.length, 3, 'active master + legacy equipment grouped by name and unit');
const weld = rows.find(row => row.name === 'Máy hàn');
assert.equal(weld?.sourceOrigin, 'catalog', 'active master wins for same name+unit');
assert.equal(weld?.displayName, 'Máy hàn 220V', 'keep Cloud display label');
assert.equal(weld?.hasLegacyVoucher, true, 'master records overlapping legacy vouchers');
const cutter = rows.filter(row => row.name.toLocaleLowerCase('vi-VN') === 'máy cắt');
assert.equal(cutter.length, 2, 'distinct unit identities must never be silently merged');
assert.ok(cutter.every(row => row.unitConflict), 'warn about multiple units for same name');
assert.ok(cutter.every(row => row.sourceOrigin === 'voucher'), 'include legacy-only equipment');
assert.ok(cutter.every(row => row.id.startsWith('legacy:')), 'legacy picker IDs are temporary');
assert.equal(buildEquipmentTemplateSourceItems(master, []).length, 1, 'soft-deleted Cloud rows are not offered');
assert.equal(buildEquipmentTemplateSourceItems([], []).length, 0, 'empty inputs are safe');

const warehouse = fs.readFileSync('src/components/WarehouseTab.tsx', 'utf8');
const picker = fs.readFileSync('src/components/CatalogTemplatePickerModal.tsx', 'utf8');
const panel = fs.readFileSync('src/components/EquipmentCatalogPanel.tsx', 'utf8');
assert.ok(warehouse.includes('data-hnl-equipment-voucher-search-results="true"'), 'equipment has a live suggestion dropdown');
assert.ok(warehouse.includes('filteredEquipmentCatalog.slice(0, 20).map'), 'equipment suggestions are bounded on mobile');
assert.ok(warehouse.includes("setMaterialName(item.name); setUnit(item.unit);"), 'suggestions set canonical name AND selected unit');
assert.ok(picker.includes("getDocsFromServer(collection(db, 'projects', sourceProjectId, 'inventory'))"), 'template source reads historical Cloud vouchers');
assert.ok(picker.includes('buildEquipmentTemplateSourceItems('), 'source picker merges master and ledger');
assert.ok(panel.includes('const selectedUnitByName = new Map<string, string>();'), 'target rejects ambiguous unit selection');
assert.ok(panel.includes("...inventory.filter(item => item.itemKind === 'equipment')"), 'target prevents historical-equipment duplicates');
assert.ok(panel.includes('if (unique.length > 50)'), 'ADMIN transaction batch guard remains');
for (const file of ['src/components/WarehouseTab.tsx', 'src/components/CatalogTemplatePickerModal.tsx', 'src/components/EquipmentCatalogPanel.tsx']) {
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, { fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } });
  assert.equal((result.diagnostics || []).filter(row => row.category === ts.DiagnosticCategory.Error).length, 0, `${file}: TSX parses`);
}
console.log('Equipment source/warehouse picker Golden: PASS (legacy, unit conflicts, soft delete, suggestion selection, source syntax)');
