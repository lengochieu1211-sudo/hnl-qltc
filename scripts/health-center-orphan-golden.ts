import assert from 'node:assert/strict';
import type { AiQueryContext } from '../src/ai/core/contracts';
import { createHnlAiProjectSnapshot } from '../src/ai/data/projectSnapshot';
import { buildHealthCenterReport } from '../src/healthCenter/healthCenterEngine';
import type {
  ChecklistItem,
  CrewRecord,
  DefectItem,
  FloorPlan,
  InventoryItem,
  MaterialNorm,
  RoomProgressItem,
  TeamInfo,
  WorkVolume,
} from '../src/types';

const projectId = 'health-center-orphan-golden';
const context: AiQueryContext = {
  projectId,
  role: 'ADMIN',
  accessVerified: true,
  timeZone: 'Asia/Ho_Chi_Minh',
};

const teams: TeamInfo[] = [
  { id: 'team-ok', name: 'Đội hợp lệ', leader: 'A', defaultCount: 5 },
];
const floors: FloorPlan[] = [
  { id: 'floor-ok', floorName: 'Tầng hợp lệ', imageUrl: '', uploadedAt: '2026-09-06' },
  { id: 'floor-other', floorName: 'Tầng khác', imageUrl: '', uploadedAt: '2026-09-06', structureGroupId: 'building-missing' },
];

const rooms: RoomProgressItem[] = [
  {
    id: 'room-ok', floorId: 'floor-ok', floorName: 'Tầng hợp lệ', roomName: 'A101',
    x: 0, y: 0, width: 20, height: 20,
    frameStatus: 'Chưa làm', boardStatus: 'Chưa làm', inspectionStatus: 'Chưa nghiệm thu', updatedAt: 1,
    teamId: 'team-ok', assignedTeam: 'Đội hợp lệ',
  },
  {
    id: 'room-orphan-floor', floorId: 'floor-missing', floorName: 'Tầng đã mất', roomName: 'A102',
    x: 25, y: 0, width: 20, height: 20,
    frameStatus: 'Chưa làm', boardStatus: 'Chưa làm', inspectionStatus: 'Chưa nghiệm thu', updatedAt: 1,
  },
  {
    id: 'room-orphan-team', floorId: 'floor-ok', floorName: 'Tầng hợp lệ', roomName: 'A103',
    x: 50, y: 0, width: 20, height: 20,
    frameStatus: 'Chưa làm', boardStatus: 'Chưa làm', inspectionStatus: 'Chưa nghiệm thu', updatedAt: 1,
    teamId: 'team-missing', assignedTeam: 'Đội đã mất',
    subItems: [{ id: 'sub-orphan-team', name: 'Khung', status: 'Chưa làm', teamId: 'team-missing-2', assignedTeam: 'Đội đã mất 2' }],
  },
  {
    id: 'room-orphan-work-title', floorId: 'floor-ok', floorName: 'Tầng hợp lệ', roomName: 'A104',
    x: 75, y: 0, width: 20, height: 20,
    frameStatus: 'Chưa làm', boardStatus: 'Chưa làm', inspectionStatus: 'Chưa nghiệm thu', updatedAt: 1,
    categoryVolumes: { 'Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn': 25 },
    categoryVolumeUnits: { 'Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn': 'm²' },
  },
  {
    id: 'room-scope-drift', floorId: 'floor-ok', floorName: 'Tầng hợp lệ', roomName: 'A105',
    x: 80, y: 25, width: 20, height: 20,
    frameStatus: 'Đã hoàn thành', boardStatus: 'Đã hoàn thành', inspectionStatus: 'Đạt nghiệm thu', updatedAt: 1,
    workCategoryId: 'wv-scope-drift', workCategory: 'Vách W13', workVolume: 25, volumeUnit: 'm²',
    categoryVolumes: { 'Vách W13': 25 }, categoryVolumeUnits: { 'Vách W13': 'm²' },
    subItems: [{ id: 'scope-sub', name: 'Thi công', category: 'Vách W13', workCategoryId: 'wv-scope-drift', status: 'Đã hoàn thành' }],
  },
];

const defects: DefectItem[] = [
  {
    id: 'defect-orphan', floorId: 'floor-missing', floorName: 'Tầng đã mất', roomId: 'room-missing', teamId: 'team-missing',
    x: 90, y: 90, category: 'Khác', description: 'Defect mồ côi', severity: 'Trung bình', assignedTo: 'Đội đã mất',
    status: 'Mới phát hiện', createdAt: '2026-09-06',
  },
];

const crewRecords: CrewRecord[] = [
  {
    id: 'crew-orphan', teamId: 'team-missing', date: '2026-09-06', teamName: 'Đội đã mất', leaderName: 'X', workerCount: 3,
    floorId: 'floor-missing', floorName: 'Tầng đã mất', taskDescription: 'Thi công',
  },
];

const workVolumes: WorkVolume[] = [
  {
    id: 'wv-orphan-floor', title: 'Trần C04', floor: 'Tầng đã mất', floorId: 'floor-missing', category: 'Trần', unit: 'm²',
    planned: 100, actual: 10, unitPrice: 1000, status: 'Đang thi công',
  },
  {
    id: 'wv-scope-drift', workCategoryId: 'wv-scope-drift', title: 'Vách W13', floor: 'Tầng khác', floorId: 'floor-other', floorIds: ['floor-other'], category: 'Vách', unit: 'm²',
    planned: 25, actual: 0, unitPrice: 1000, status: 'Chưa thi công',
  },
];

const materialNorms: MaterialNorm[] = [
  {
    id: 'norm-orphan-work', category: 'Tấm', materialName: 'Tấm 12.5', unit: 'Tấm', quotaQuantity: 10,
    workCategoryId: 'work-category-missing',
  },
];

const checklist: ChecklistItem[] = [
  {
    id: 'check-orphan', floorId: 'floor-missing', floorName: 'Tầng đã mất', roomId: 'room-missing', teamId: 'team-missing',
    category: 'Trần', title: 'Checklist mồ côi', status: 'pending',
  },
];

const inventory: InventoryItem[] = [
  {
    id: 'inv-orphan', type: 'out', materialName: 'Tấm 12.5', unit: 'Tấm', quantity: 1, location: 'Kho', handler: 'A', date: '2026-09-06',
    sourceRoomId: 'room-missing', sourceFloorId: 'floor-missing', sourceNormId: 'norm-missing',
  },
];

const snapshot = createHnlAiProjectSnapshot({
  projectId,
  projectName: 'Orphan Golden',
  rooms,
  defects,
  crewRecords,
  teams,
  floors,
  workVolumes,
  inventory,
  materialNorms,
  checklist,
  asOf: 1788684000000,
  freshness: 'fixture',
});

const report = buildHealthCenterReport({ context, snapshot });
const rules = new Set(report.issues.map((issue) => issue.ruleId));

const requiredRules = [
  'ROOM_FLOOR_NOT_FOUND',
  'ROOM_TEAM_NOT_FOUND',
  'ROOM_SUBITEM_TEAM_NOT_FOUND',
  'DEFECT_FLOOR_NOT_FOUND',
  'DEFECT_ROOM_NOT_FOUND',
  'DEFECT_TEAM_NOT_FOUND',
  'CREW_TEAM_NOT_FOUND',
  'CREW_FLOOR_NOT_FOUND',
  'WORK_VOLUME_FLOOR_NOT_FOUND',
  'MATERIAL_NORM_WORK_CATEGORY_NOT_FOUND',
  'ROOM_ORPHAN_WORK_CATEGORY_REFERENCE',
  'CHECKLIST_FLOOR_NOT_FOUND',
  'CHECKLIST_ROOM_NOT_FOUND',
  'CHECKLIST_TEAM_NOT_FOUND',
  'INVENTORY_SOURCE_ROOM_NOT_FOUND',
  'INVENTORY_SOURCE_FLOOR_NOT_FOUND',
  'INVENTORY_SOURCE_NORM_NOT_FOUND',
] as const;

for (const ruleId of requiredRules) {
  assert.ok(rules.has(ruleId), `Health Center phải phát hiện orphan rule ${ruleId}`);
}

for (const issue of report.issues.filter((item) => requiredRules.includes(item.ruleId as typeof requiredRules[number]))) {
  assert.notEqual(issue.actionClass, 'SAFE_REPAIR_CANDIDATE', `${issue.ruleId} không được tự sửa vì reference đích đã mất`);
}

assert.equal(rooms[1].floorId, 'floor-missing');
assert.equal(defects[0].roomId, 'room-missing');
assert.equal(crewRecords[0].teamId, 'team-missing');
assert.equal(inventory[0].sourceNormId, 'norm-missing');
const orphanWorkIssue = report.issues.find((issue) => issue.ruleId === 'ROOM_ORPHAN_WORK_CATEGORY_REFERENCE' && issue.entityId === 'room-orphan-work-title');
assert.ok(orphanWorkIssue, 'Health Center must surface title-only deleted work-category references');
assert.match(orphanWorkIssue!.message, /Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn/);
assert.equal(orphanWorkIssue!.actionClass, 'NEEDS_CONFIRMATION', 'Deleted work-category refs must never auto-repair/relink');

assert.equal(
  report.issues.some((issue) => issue.ruleId === 'ROOM_ORPHAN_WORK_CATEGORY_REFERENCE' && issue.entityId === 'room-scope-drift'),
  false,
  'A valid durable workCategoryId must not be mislabeled as orphan only because the WorkVolume floor scope drifted',
);
const scopeDriftIssue = report.issues.find((issue) => issue.ruleId === 'ROOM_WORK_CATEGORY_SCOPE_MISMATCH' && issue.entityId === 'room-scope-drift');
assert.ok(scopeDriftIssue, 'Health Center must surface floor-scope drift as a separate review issue');
assert.equal(scopeDriftIssue?.severity, 'REVIEW');

console.log('Health Center orphan-link golden regression PASS', {
  auditSnapshotId: report.auditSnapshotId,
  requiredRules: requiredRules.length,
  totalIssues: report.issues.length,
});

// Integrated Health Center must include additional read-only relationship scans
// without creating a second UI workflow or reporting a new floor as orphaned.
const orphanStructureReport = buildHealthCenterReport({
  context,
  snapshot,
  structureConfig: {
    enabled: true,
    label: 'Khu / Khối',
    defaultGroupId: 'building-a',
    groups: [{ id: 'building-a', name: 'Khu A' }],
  },
  photoDiagnostics: {
    totalMetadata: 5,
    truncated: false,
    photos: [
      { id: 'photo-orphan', entityType: 'defect', entityId: 'defect-missing', deleted: false },
      { id: 'photo-valid', entityType: 'defect', entityId: 'defect-orphan', deleted: false },
      { id: 'photo-chat-unknown', entityType: 'chat', entityId: 'chat-id', deleted: false },
      { id: 'photo-deleted', entityType: 'defect', entityId: 'defect-missing', deleted: true },
      { id: 'photo-parent-in-trash', entityType: 'inventory', entityId: 'inv-deleted', deleted: false },
    ],
  },
});
const orphanPhoto = orphanStructureReport.issues.find((item) => item.ruleId === 'ORPHAN_PHOTO_PARENT_NOT_FOUND');
assert.equal(orphanPhoto?.entityId, 'photo-orphan', 'missing parent must show a read-only photo finding');
assert.equal(orphanPhoto?.actionClass, 'READ_ONLY', 'never offer automatic photo deletion');
assert.ok(orphanStructureReport.issues.some((item) => item.ruleId === 'ORPHAN_FLOOR_GROUP_NOT_FOUND' && item.entityId === 'floor-other'));
assert.equal(orphanStructureReport.issues.some((item) => item.ruleId === 'ORPHAN_FLOOR_IMAGE_UNLINKED'), false,
  'blank images on new floors are valid and must not be marked orphaned');
assert.equal(orphanStructureReport.issues.some((item) => item.entityId === 'photo-chat-unknown'), false,
  'chat photos cannot be verified without a chat-message snapshot');
assert.equal(orphanStructureReport.issues.some((item) => item.entityId === 'photo-deleted'), false,
  'deleted photo metadata must not be reported as active orphaned photo');

const deletedInventorySnapshot = createHnlAiProjectSnapshot({
  ...snapshot,
  inventory: [...inventory, {
    id: 'inv-deleted', type: 'in' as const, materialName: 'Tấm', unit: 'Tấm', quantity: 1,
    location: 'Kho', handler: 'A', date: '2026-09-06', deletedAt: 1788684000000,
  }],
});
const trashPhotoReport = buildHealthCenterReport({
  context,
  snapshot: deletedInventorySnapshot,
  photoDiagnostics: { photos: [{ id: 'photo-parent-in-trash', entityType: 'inventory', entityId: 'inv-deleted' }] },
});
assert.equal(trashPhotoReport.issues.some((item) => item.entityId === 'photo-parent-in-trash'), false,
  'photos of restorable Trash items are not orphans');
console.log('Health Center integrated links/structure/photo checks PASS');
