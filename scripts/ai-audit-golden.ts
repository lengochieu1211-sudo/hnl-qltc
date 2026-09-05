import assert from 'node:assert/strict';
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
import type { AiQueryContext } from '../src/ai/core/contracts';
import { auditQuantityData } from '../src/ai/audit/quantityAudit';
import { auditCrewData } from '../src/ai/audit/crewAudit';
import { auditProjectIntegrity } from '../src/ai/audit/projectAudit';
import { createHnlAiProjectSnapshot } from '../src/ai/data/projectSnapshot';

const projectId = 'project-ai-audit';
const context: AiQueryContext = {
  projectId,
  role: 'ADMIN',
  accessVerified: true,
  timeZone: 'Asia/Ho_Chi_Minh',
};

const teams: TeamInfo[] = [
  { id: 'team-nguyen', name: 'Đội Nguyên', leader: 'Nguyên', defaultCount: 10 },
  { id: 'team-an', name: 'Đội An', leader: 'An', defaultCount: 8 },
];
const floors: FloorPlan[] = [
  { id: 'f1', floorName: 'Tầng 1', imageUrl: '', uploadedAt: '2026-09-05' },
  { id: 'f2', floorName: 'Tầng 2', imageUrl: '', uploadedAt: '2026-09-05' },
];

const workVolumes: WorkVolume[] = [
  {
    id: 'wv-tran-f1', workCategoryId: 'wc-tran', title: 'Trần thạch cao', floor: 'Tầng 1', floorId: 'f1',
    category: 'Trần', unit: 'm2', planned: 100, actual: 120, unitPrice: 0, status: 'Đang thi công',
  },
  {
    id: 'wv-vach-f1', workCategoryId: 'wc-vach', title: 'Vách thạch cao', floor: 'Tầng 1', floorId: 'f1',
    category: 'Vách', unit: 'm2', planned: 80, actual: 40, unitPrice: 0, status: 'Đang thi công',
  },
];

const rooms: RoomProgressItem[] = [
  {
    id: 'room-a', floorId: 'f1', floorName: 'Tầng 1', roomName: 'Căn A',
    workCategory: 'Trần thạch cao', workCategoryId: 'wc-tran', workVolume: 60, volumeUnit: 'm²',
    x: 0, y: 0, width: 40, height: 40,
    frameStatus: 'Đã hoàn thành', boardStatus: 'Đang làm', inspectionStatus: 'Đạt nghiệm thu',
    assignedTeam: 'Đội Nguyên', teamId: 'team-nguyen', updatedAt: 1,
    subItems: [
      { id: 'sub-a1', name: 'Thi công khung', category: 'Trần thạch cao', workCategoryId: 'wc-tran', status: 'Đã hoàn thành', inspectionStatus: 'Đạt nghiệm thu', teamId: 'team-nguyen', assignedTeam: 'Đội Nguyên', workVolume: 60, volumeUnit: 'm²' },
      { id: 'sub-a2', name: 'Thi công tấm', category: 'Trần thạch cao', workCategoryId: 'wc-tran', status: 'Đang làm', inspectionStatus: 'Đạt nghiệm thu', teamId: 'team-nguyen', assignedTeam: 'Đội Nguyên', workVolume: 60, volumeUnit: 'm²' },
    ],
  },
  {
    id: 'room-b', floorId: 'f1', floorName: 'Tầng 1', roomName: 'Căn B',
    workCategory: 'Trần thạch cao', workCategoryId: 'wc-tran', workVolume: 60, volumeUnit: 'm²',
    x: 50, y: 0, width: 40, height: 40,
    frameStatus: 'Đang làm', boardStatus: 'Chưa làm', inspectionStatus: 'Chưa nghiệm thu',
    assignedTeam: 'Đội Nguyên', teamId: 'team-nguyen', updatedAt: 1,
  },
  {
    id: 'room-mixed-unit', floorId: 'f2', floorName: 'Tầng 2', roomName: 'Căn C',
    workCategory: 'Trần thạch cao', workCategoryId: 'wc-tran', workVolume: 5, volumeUnit: 'm',
    x: 0, y: 0, width: 30, height: 30,
    frameStatus: 'Chưa làm', boardStatus: 'Chưa làm', inspectionStatus: 'Chưa nghiệm thu',
    assignedTeam: 'Đội An', teamId: 'team-an', updatedAt: 1,
  },
  {
    id: 'room-orphan-floor', floorId: 'floor-missing', floorName: 'Tầng mất', roomName: 'Căn Orphan',
    x: 0, y: 50, width: 20, height: 20,
    frameStatus: 'Chưa làm', boardStatus: 'Chưa làm', inspectionStatus: 'Chưa nghiệm thu',
    teamId: 'team-missing', assignedTeam: 'Đội Mất', updatedAt: 1,
  },
];

const quantityAudit = auditQuantityData({ context, workVolumes, rooms, freshness: 'fixture', asOf: 1 });
const quantityRules = new Set(quantityAudit.data?.issues.map((issue) => issue.ruleId) || []);
assert.ok(quantityRules.has('ACTUAL_GT_CONTRACT'), 'actual > planned must be detected');
assert.ok(quantityRules.has('PROGRESS_GT_100'), 'actual/planned > 100% must be an ERROR');
assert.ok(quantityRules.has('INSPECTED_WITH_UNFINISHED_WORK'), 'subitem cannot pass inspection while unfinished');
assert.ok(quantityRules.has('ROOM_DONE_WITH_UNFINISHED_SUBITEM'), 'room pass with unfinished subitem must be detected');
assert.ok(quantityRules.has('MIXED_UNIT_SAME_WORK_ITEM'), 'same work item with m² and m must not be silently combined');
assert.ok(quantityRules.has('FLOOR_ROOM_SUM_MISMATCH'), 'room sum 120 vs planned 100 must be reviewed');
assert.ok(quantityRules.has('ROOM_ASSIGNED_GT_CONTRACT'), 'room assigned quantity over contract must be warned');

const crewRecords: CrewRecord[] = [
  {
    id: 'crew-1a', teamId: 'team-nguyen', date: '2026-09-05', teamName: 'Đội Nguyên', leaderName: 'Nguyên',
    workerCount: 10, morningCount: 10, afternoonCount: 10, eveningCount: 0, floorId: 'f1', floorName: 'Tầng 1', taskDescription: 'Trần',
  },
  {
    id: 'crew-1b', teamId: 'team-nguyen', date: '2026-09-05', teamName: 'Đội Nguyên', leaderName: 'Nguyên',
    workerCount: 8, morningCount: 8, afternoonCount: 8, eveningCount: 0, floorId: 'f2', floorName: 'Tầng 2', taskDescription: 'Trần',
  },
  {
    id: 'crew-duplicate', teamId: 'team-nguyen', date: '2026-09-05', teamName: 'Đội Nguyên', leaderName: 'Nguyên',
    workerCount: 10, morningCount: 10, afternoonCount: 10, eveningCount: 0, floorId: 'f1', floorName: 'Tầng 1', taskDescription: 'Trần',
  },
  {
    id: 'crew-missing-team', teamId: 'team-does-not-exist', date: '2026-09-05', teamName: 'Đội Mất', leaderName: 'Mất',
    workerCount: 5, morningCount: 5, afternoonCount: 5, eveningCount: 0, floorId: 'floor-missing', floorName: 'Tầng mất', taskDescription: 'Vách',
  },
  {
    id: 'crew-bad-count', teamId: 'team-an', date: '05/09/2026', teamName: 'Đội An', leaderName: 'An',
    workerCount: -1, morningCount: -1, afternoonCount: 4, eveningCount: 0, taskDescription: 'Sai dữ liệu',
  },
];

const crewAudit = auditCrewData({ context, crewRecords, teams, floors, freshness: 'fixture', asOf: 1 });
const crewRules = new Set(crewAudit.data?.issues.map((issue) => issue.ruleId) || []);
assert.ok(crewRules.has('CREW_EXACT_DUPLICATE'), 'exact duplicate crew row must be detected');
assert.ok(crewRules.has('CREW_TEAM_DAY_SHIFT_CONFLICT'), 'same team/day conflicting shift headcount must be REVIEW');
assert.ok(crewRules.has('CREW_TEAM_NOT_FOUND'), 'orphan teamId must be detected');
assert.ok(crewRules.has('CREW_FLOOR_NOT_FOUND'), 'orphan floorId must be detected');
assert.ok(crewRules.has('CREW_DATE_INVALID'), 'non-canonical crew date must be detected');
assert.ok(crewRules.has('CREW_COUNT_INVALID'), 'negative headcount must be detected');

const defects: DefectItem[] = [
  {
    id: 'd1', floorId: 'f1', floorName: 'Tầng 1', roomId: 'room-a', teamId: 'team-missing', x: 10, y: 10,
    category: 'Tấm thạch cao', description: 'Orphan team', severity: 'Trung bình', assignedTo: 'Đội Mất',
    status: 'Mới phát hiện', createdAt: '2026-09-05T00:00:00.000Z',
  },
];
const materialNorms: MaterialNorm[] = [
  {
    id: 'norm-1', category: 'Tấm', workCategoryId: 'wc-does-not-exist', materialName: 'Tấm 12.5', unit: 'Tấm', quotaQuantity: 100,
  },
];
const checklist: ChecklistItem[] = [
  {
    id: 'check-1', floorId: 'f1', floorName: 'Tầng 1', roomId: 'room-orphan', teamId: 'team-missing',
    category: 'Trần', title: 'Checklist orphan', status: 'pending',
  },
];
const inventory: InventoryItem[] = [
  {
    id: 'inv-1', type: 'out', materialName: 'Tấm', unit: 'Tấm', quantity: 1, location: 'Kho', handler: 'A', date: '2026-09-05',
    sourceRoomId: 'room-missing', sourceFloorId: 'floor-missing', sourceNormId: 'norm-missing',
  },
];
const snapshot = createHnlAiProjectSnapshot({
  projectId,
  projectName: 'AI Audit Golden',
  rooms,
  defects,
  crewRecords,
  teams,
  floors,
  workVolumes,
  inventory,
  materialNorms,
  checklist,
  asOf: 1,
  freshness: 'fixture',
});

const projectAudit = auditProjectIntegrity({ context, snapshot });
const projectRules = new Set(projectAudit.data?.issues.map((issue) => issue.ruleId) || []);
assert.ok(projectRules.has('ROOM_FLOOR_NOT_FOUND'), 'room orphan floor must be detected');
assert.ok(projectRules.has('ROOM_TEAM_NOT_FOUND'), 'room orphan team must be detected');
assert.ok(projectRules.has('DEFECT_TEAM_NOT_FOUND'), 'defect orphan team must flow into project audit');
assert.ok(projectRules.has('MATERIAL_NORM_WORK_CATEGORY_NOT_FOUND'), 'material norm orphan category must be detected');
assert.ok(projectRules.has('CHECKLIST_ROOM_NOT_FOUND'), 'checklist orphan room must be detected');
assert.ok(projectRules.has('CHECKLIST_TEAM_NOT_FOUND'), 'checklist orphan team must be detected');
assert.ok(projectRules.has('INVENTORY_SOURCE_ROOM_NOT_FOUND'), 'inventory source room orphan must be detected');
assert.ok(projectRules.has('INVENTORY_SOURCE_FLOOR_NOT_FOUND'), 'inventory source floor orphan must be detected');
assert.ok(projectRules.has('INVENTORY_SOURCE_NORM_NOT_FOUND'), 'inventory source norm orphan must be detected');
assert.equal(projectAudit.metadata.projectId, projectId);
assert.equal(projectAudit.metadata.freshness, 'fixture');

// All audits are read-only.
assert.equal(workVolumes[0].actual, 120);
assert.equal(rooms[0].subItems?.[1].status, 'Đang làm');
assert.equal(crewRecords[0].morningCount, 10);
assert.equal(defects[0].teamId, 'team-missing');

console.log('HNL AI Audit Golden Phase 2: PASS');
