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

console.log('Health Center orphan-link golden regression PASS', {
  auditSnapshotId: report.auditSnapshotId,
  requiredRules: requiredRules.length,
  totalIssues: report.issues.length,
});
