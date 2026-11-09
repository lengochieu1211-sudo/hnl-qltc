import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  computeTeamEquipmentIssues,
  computeUnassignedTeamEquipmentIssues,
  eligibleTeamEquipmentVoucher,
} from '../src/utils/teamEquipmentIssues.ts';

const voucher = (id, props = {}) => ({
  id, type:'out', itemKind:'equipment', sourceTeamId:'team-1',
  issuePurpose:'project-work', materialName:'Máy laser', unit:'cái',
  quantity:1, date:'2026-11-08', handler:'Người giao', location:'Kho chính', ...props,
});
const items = [
  voucher('a1',{quantity:2, sourceStructureGroupId:'block-1', sourceFloorId:'floor-x', sourceRoomId:'room-1'}),
  voucher('a2',{quantity:3, materialName:' máy LASER ', date:'2026-11-09'}),
  voucher('a3',{quantity:7,unit:'bộ'}),
  voucher('b1',{sourceTeamId:'team-2',quantity:4}),
  voucher('material',{itemKind:'material',quantity:22}),
  voucher('in',{type:'in',quantity:99}),
  voucher('deleted',{deletedAt:1722211111111, quantity:8}),
  voucher('legacyDeleted',{deleted:true,quantity:13}),
  voucher('transferred',{issuePurpose:'project-transfer',quantity:10}),
  voucher('external',{issuePurpose:'external-project',quantity:11}),
  voucher('other',{issuePurpose:'other',quantity:12}),
  voucher('transferId',{warehouseTransferId:'XPROJ-1',quantity:15}),
  voucher('zero',{quantity:0}),
  voucher('invalid',{quantity:Number.NaN}),
  voucher('noTeam',{sourceTeamId:undefined,quantity:5}),
  voucher('staleTeam',{sourceTeamId:'team-removed',quantity:6}),
  voucher('legacy-allowed',{issuePurpose:undefined,quantity:2}),
];
const lines=computeTeamEquipmentIssues('team-1',items);
assert.equal(lines.length,2,'same name with differing units must never mix');
assert.equal(lines.find(x=>x.unit==='cái').issuedQty,7,'2+3+legacy 2 only; no deleted/cross-project/other team');
assert.equal(lines.find(x=>x.unit==='cái').voucherCount,3);
assert.deepEqual(lines.find(x=>x.unit==='cái').vouchers.map(x=>x.id),['a2','a1','legacy-allowed']);
assert.equal(lines.find(x=>x.unit==='bộ').issuedQty,7);
assert.equal(computeTeamEquipmentIssues('team-2',items)[0].issuedQty,4,'must match exact durable team id');
assert.equal(computeTeamEquipmentIssues('team-not-present',items).length,0,'never match by names');
assert.equal(computeTeamEquipmentIssues('',items).length,0,'unresolved team cannot receive vouchers');
const unassigned=computeUnassignedTeamEquipmentIssues(items,['team-1','team-2']);
assert.equal(unassigned.length,1);
assert.equal(unassigned[0].issuedQty,11,'missing or orphan team ids remain in all-team unassigned bucket');
assert.ok(!eligibleTeamEquipmentVoucher(voucher('deleted',{deletedAt:0})), 'soft-deleted at epoch must not count');
assert.ok(eligibleTeamEquipmentVoucher(voucher('legacy',{issuePurpose:undefined})), 'existing team-linked legacy OUT is valid');

const ui = fs.readFileSync('src/components/CrewTabBase.tsx','utf8');
const excel = fs.readFileSync('src/utils/excelExport.ts','utf8');
for(const marker of [
  "useState<'rooms' | 'materials' | 'equipment' | 'defects' | 'logs'>('rooms')",
  "['rooms', 'materials', 'equipment', 'defects', 'logs'].includes(saved.tab)",
  'data-hnl-crew-equipment-tab="true"',
  'data-hnl-team-equipment-report="project-wide"',
  'Thiết bị đã cấp ({selectedTeamEquipmentIssues.length})',
  'computeTeamEquipmentIssues(selectedTeamForDetail.id, inventory)',
  'equipmentInventory: inventory,',
  'inventory: structureScopedInventory,',
  'không phải số thiết bị đội đang giữ',
]) assert.ok(ui.includes(marker), `Team Statistics UI lost safety/route marker: ${marker}`);
for(const marker of [
  'computeTeamEquipmentIssues(team.id, inventory)',
  'computeUnassignedTeamEquipmentIssues(inventory, teams.map((team) => team.id))',
  'appendTeamEquipmentExcelSheets(wb, [team], params.equipmentInventory || params.inventory || [], false);',
  'appendTeamEquipmentExcelSheets(wb, activeTeams, params.equipmentInventory || params.inventory || [], true);',
  "'07-Thiết bị đã cấp'", "'08-Lịch sử cấp thiết bị'",
  "'Mã Phiếu': voucher.id", "'Người Giao / Nhận': voucher.handler",
]) assert.ok(excel.includes(marker),`Team statistics Excel marker lost: ${marker}`);
assert.equal(excel.match(/appendTeamEquipmentExcelSheets\(wb,/g)?.length,2, 'both single and all team exports require equipment sheets');
console.log('TEAM EQUIPMENT STATISTICS GOLDEN PASS: exact team ID, full-project scope, 2 Excel views, legacy/duplicate/unit/safety cases');