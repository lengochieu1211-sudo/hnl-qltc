import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const file = 'src/utils/warehouseIssueScope.ts';
const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file,
  reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
assert.equal(result.diagnostics?.filter(x => x.category === ts.DiagnosticCategory.Error).length || 0, 0, 'Issue scope helper parses');
const module = { exports: {} };
new Function('module', 'exports', 'require', result.outputText)(module, module.exports, require);
const { buildWarehouseIssueScope } = module.exports;
const links = {
  sourceStructureGroupId: 'BLOCK-1', sourceFloorId: 'FLOOR-1', sourceRoomId: 'ROOM-1',
  sourceTeamId: 'TEAM-1', sourceWorkCategoryId: 'CATEGORY-1',
};
assert.deepEqual(buildWarehouseIssueScope('equipment', 'project-work', links),
  { sourceTeamId: 'TEAM-1' }, 'new equipment OUT must be project-wide and may record receiving team');
assert.deepEqual(buildWarehouseIssueScope('equipment', 'project-work', { ...links, sourceTeamId: '' }),
  {}, 'equipment is project-level even without a team');
assert.deepEqual(buildWarehouseIssueScope('equipment', 'project-transfer', links),
  {}, 'cross-project transfer must not leak room or team provenance');
assert.deepEqual(buildWarehouseIssueScope('equipment', 'other', links), {}, 'external equipment never inherits room/team');
assert.deepEqual(buildWarehouseIssueScope('material', 'project-work', links), links,
  'material room/floor/team/category linkage must remain intact');
assert.deepEqual(buildWarehouseIssueScope('material', 'project-work', { sourceTeamId: 'TEAM-1' }),
  { sourceTeamId: 'TEAM-1' }, 'optional material linkage remains optional');
assert.deepEqual(buildWarehouseIssueScope('material', 'external-project', links), {}, 'external material scope remains empty');

const ui = fs.readFileSync('src/components/WarehouseTab.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const room = fs.readFileSync('src/components/RoomHighlightModal.tsx', 'utf8');
for (const token of [
  '...buildWarehouseIssueScope(itemKind, issuePurpose, {',
  "{itemKind === 'material' && normalizedStructureConfig.enabled && (",
  "{itemKind === 'material' && (<label className=\"space-y-1\">",
  "'Đội nhận thiết bị' : 'Đội thi công'",
  'data-hnl-equipment-project-wide="true"',
  "warehouseCatalogTab === 'material' ? 8 : 6",
  "catalogStockFormulas:warehouseCatalogTab === 'material'",
  "'Thiết bị toàn dự án'",
]) assert.ok(ui.includes(token), `equipment project-wide UI marker missing: ${token}`);
assert.ok(!ui.includes('Thiết bị có thể ghi nhận Khu/Khối, Tầng, Căn / Phòng'), 'obsolete room allocation instruction removed');
assert.ok(app.includes('prepareInventoryLedgerItem({ ...current, ...item, id })'), 'legacy linked room/floor metadata preserved on edit, no migration');
assert.ok(!room.includes('RoomEquipmentReconciliationPanel'), 'abandoned room-level equipment patch must not reach DEV');
for (const sourcePath of ['src/components/WarehouseTab.tsx', 'src/components/RoomHighlightModal.tsx']) {
  const emitted = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    fileName: sourcePath, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  });
  assert.equal(emitted.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length || 0, 0, `${sourcePath} JSX syntax`);
}
console.log('EQUIPMENT PROJECT-WIDE GOLDEN PASS: equipment has optional team only; material scopes unchanged; historical vouchers preserved; room patch excluded');