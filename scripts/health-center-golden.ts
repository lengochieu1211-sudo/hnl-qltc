import assert from 'node:assert/strict';
import type { AiQueryContext } from '../src/ai/core/contracts';
import { createHnlAiProjectSnapshot } from '../src/ai/data/projectSnapshot';
import { buildHealthCenterReport, serializeHealthCenterReportJson } from '../src/healthCenter/healthCenterEngine';
import type { ChecklistItem, CrewRecord, DefectItem, FloorPlan, InventoryItem, MaterialNorm, RoomProgressItem, TeamInfo, WorkVolume } from '../src/types';

const projectId = 'health-center-golden';
const context: AiQueryContext = { projectId, role: 'ADMIN', accessVerified: true, timeZone: 'Asia/Ho_Chi_Minh' };
const teams: TeamInfo[] = [{ id: 'team-nguyen', name: 'Đội Nguyên', leader: 'Nguyên', defaultCount: 8 }];
const floors: FloorPlan[] = [
  { id: 'f1', floorName: 'Tầng 1', imageUrl: '', uploadedAt: '2026-09-06' },
  { id: 'f3', floorName: 'Tầng 3', imageUrl: '', uploadedAt: '2026-09-06' },
];
const rooms: RoomProgressItem[] = [{
  id: 'r1', floorId: 'f1', floorName: 'Tầng 1', roomName: 'A101', x: 0, y: 0, width: 20, height: 20,
  frameStatus: 'Đã hoàn thành', boardStatus: 'Đang làm', inspectionStatus: 'Chưa nghiệm thu', updatedAt: 1,
  assignedTeam: 'Đội Nguyên', teamId: 'team-nguyen',
  subItems: [
    { id: 'sub-dup', name: 'Khung', status: 'Đã hoàn thành' },
    { id: 'sub-dup', name: 'Tấm', status: 'Đang làm' },
  ],
}];
const defects: DefectItem[] = [
  { id: 'd-open', floorId: 'f1', floorName: 'Tầng 1', roomId: 'r1', teamId: 'team-nguyen', x: 10, y: 10, category: 'Tấm thạch cao', description: 'Mới nhưng có ngày xong', severity: 'Trung bình', assignedTo: 'Đội Nguyên', status: 'Mới phát hiện', createdAt: '2026-09-05', completedAt: '2026-09-06' },
  { id: 'd-closed', floorId: 'f1', floorName: 'Tầng 1', roomId: 'r1', teamId: 'team-nguyen', x: 10, y: 10, category: 'Tấm thạch cao', description: 'Đã khắc phục thiếu ngày xong', severity: 'Trung bình', assignedTo: 'Đội Nguyên', status: 'Đã khắc phục', createdAt: '2026-09-05' },
  { id: 'd-date', floorId: 'f1', floorName: 'Tầng 1', roomId: 'r1', teamId: 'team-nguyen', x: 10, y: 10, category: 'Tấm thạch cao', description: 'Ngày hoàn thành trước ngày tạo', severity: 'Trung bình', assignedTo: 'Đội Nguyên', status: 'Đã nghiệm thu', createdAt: '2026-09-06', completedAt: '2026-09-05' },
  { id: 'd-vn-date', floorId: 'f1', floorName: 'Tầng 1', roomId: 'r1', teamId: 'team-nguyen', x: 10, y: 10, category: 'Khác', description: 'Ngày Việt Nam có tiền tố giờ', severity: 'Trung bình', assignedTo: 'Đội Nguyên', status: 'Đã nghiệm thu', createdAt: '15:22:15 11/8/2026', completedAt: '2026-08-15', dueDate: '15/08/2026' },
];
const crewRecords: CrewRecord[] = [
  { id: 'c-empty-detail', teamId: 'team-nguyen', date: '2026-09-06', teamName: 'Đội Nguyên', leaderName: 'Nguyên', workerCount: 8, floorId: 'f1', floorName: 'Tầng 1', taskDescription: '[Tầng 1]: Thi công trần C04 ()' },
  { id: 'c-floorwork', teamId: 'team-nguyen', date: '2026-09-06', teamName: 'Đội Nguyên', leaderName: 'Nguyên', workerCount: 8, taskDescription: 'Thi công', floorWorks: [{ floorId: 'missing-floor', floorName: 'Tầng mất', categories: [{ categoryName: '', subItems: [] }] }] },
  {
    id: 'c-multi-floor', teamId: 'team-nguyen', date: '2026-08-11', teamName: 'Đội Nguyên', leaderName: 'Nguyên', workerCount: 8,
    floorId: 'f1', floorName: 'Tầng 1, Tầng 3', taskDescription: '[Tầng 1]: Thi công vách | [Tầng 3]: Thi công trần',
    floorWorks: [
      { floorId: 'f1', floorName: 'Tầng 1', categories: [{ categoryName: 'Vách', subItems: [] }] },
      { floorId: 'f3', floorName: 'Tầng 3', categories: [{ categoryName: 'Trần', subItems: [] }] },
    ],
  },
];
const workVolumes: WorkVolume[] = [];
const inventory: InventoryItem[] = [{ id: 'inv-zero', type: 'out', materialName: 'Tấm', unit: 'Tấm', quantity: 0, location: 'Kho', handler: 'A', date: '2026-09-06' }];
const materialNorms: MaterialNorm[] = [{ id: 'norm-neg', category: 'Tấm', materialName: 'Tấm 12.5', unit: 'Tấm', quotaQuantity: -1 }];
const checklist: ChecklistItem[] = [{ id: 'check-pass', floorId: 'f1', floorName: 'Tầng 1', roomId: 'r1', teamId: 'team-nguyen', category: 'Trần', title: 'Nghiệm thu khung', status: 'passed' }];

const snapshot = createHnlAiProjectSnapshot({ projectId, projectName: 'Health Center Golden', rooms, defects, crewRecords, teams, floors, workVolumes, inventory, materialNorms, checklist, asOf: 1788684000000, freshness: 'fixture' });
const report = buildHealthCenterReport({ context, snapshot, runtimeLog: [
  { at: 1788684000000, level: 'warn', area: 'r2-photo-sync', message: 'R2 retry queue has pending item', projectId, code: 'R2_RETRY_PENDING' },
] });
const rules = new Set(report.issues.map((issue) => issue.ruleId));

assert.ok(rules.has('DEFECT_OPEN_WITH_COMPLETED_AT'), 'core defect lifecycle contradiction must remain visible');
assert.ok(rules.has('DEFECT_CLOSED_WITHOUT_COMPLETED_AT'), 'closed defect without completedAt must be detected');
assert.ok(rules.has('DEFECT_COMPLETED_BEFORE_CREATED'), 'completedAt before createdAt must be detected');
assert.ok(rules.has('CREW_TASK_EMPTY_DETAIL'), 'legacy empty () detail must be detected');
assert.ok(rules.has('CREW_FLOOR_WORK_FLOOR_NOT_FOUND'), 'floorWorks orphan floor must be detected');
assert.ok(rules.has('CREW_FLOOR_WORK_CATEGORY_EMPTY'), 'floorWorks empty category must be detected');
assert.ok(rules.has('ROOM_SUBITEM_DUPLICATE_ID'), 'duplicate room subitem id must be detected');
assert.ok(rules.has('INVENTORY_QUANTITY_NON_POSITIVE'), 'non-positive inventory quantity must be detected');
assert.ok(rules.has('MATERIAL_NORM_NEGATIVE_OR_INVALID'), 'negative material norm must be detected');
assert.ok(rules.has('CHECKLIST_PASSED_WITHOUT_INSPECTED_AT'), 'passed checklist without inspectedAt must be review');
assert.ok(rules.has('R2_RETRY_PENDING'), 'runtime diagnostics must feed the same Health Center report');

const vnDateFalsePositive = report.issues.find((issue) =>
  issue.entityId === 'd-vn-date' && (issue.ruleId === 'DEFECT_COMPLETED_BEFORE_CREATED' || issue.ruleId === 'DEFECT_DUE_BEFORE_CREATED')
);
assert.equal(vnDateFalsePositive, undefined, 'Vietnamese DMY with time prefix must not be parsed as MM/DD');

const multiFloorFalsePositive = report.issues.find((issue) =>
  issue.entityId === 'c-multi-floor' && issue.ruleId === 'CREW_FLOOR_ID_NAME_MISMATCH'
);
assert.equal(multiFloorFalsePositive, undefined, 'multi-floor summary floorName must not be auto-repair mismatch');

const crewIssue = report.issues.find((x) => x.ruleId === 'CREW_TASK_EMPTY_DETAIL');
assert.equal(crewIssue?.location.date, '2026-09-06');
assert.equal(crewIssue?.location.teamName, 'Đội Nguyên');
assert.equal(crewIssue?.location.floorName, 'Tầng 1');
assert.ok(report.auditSnapshotId.startsWith(`hc-${projectId}-`));
assert.ok(report.errorCount > 0);
assert.ok(report.businessIssueCount > 0);
assert.ok(report.technicalIssueCount > 0);

const json = serializeHealthCenterReportJson(report);
assert.ok(json.includes('HNL-QLTC-HEALTH-CENTER'));
assert.ok(json.includes(report.auditSnapshotId));
assert.ok(json.includes('CREW_TASK_EMPTY_DETAIL'));

// Read-only guarantee.
assert.equal(defects[0].status, 'Mới phát hiện');
assert.equal(crewRecords[0].taskDescription, '[Tầng 1]: Thi công trần C04 ()');
assert.equal(materialNorms[0].quotaQuantity, -1);

console.log('Health Center golden regression PASS', {
  auditSnapshotId: report.auditSnapshotId,
  errors: report.errorCount,
  warnings: report.warningCount,
  review: report.reviewCount,
  technical: report.technicalIssueCount,
  business: report.businessIssueCount,
});