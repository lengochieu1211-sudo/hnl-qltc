import assert from 'node:assert/strict';
import type { DefectItem, FloorPlan, RoomProgressItem, TeamInfo } from '../src/types';
import type { AiQueryContext } from '../src/ai/core/contracts';
import { createHnlAiProjectSnapshot } from '../src/ai/data/projectSnapshot';
import { runHnlAiQuestion } from '../src/ai/orchestrator/aiOrchestrator';
import { MockAiProvider } from '../src/ai/providers/mockProvider';

const projectId = 'project-ai-provider';
const context: AiQueryContext = {
  projectId,
  role: 'ADMIN',
  accessVerified: true,
  timeZone: 'Asia/Ho_Chi_Minh',
};
const teams: TeamInfo[] = [
  { id: 'team-nguyen', name: 'Đội Nguyên', leader: 'Nguyên', defaultCount: 10 },
];
const floors: FloorPlan[] = [
  { id: 'f1', floorName: 'Tầng 1', imageUrl: '', uploadedAt: '2026-09-05' },
];
const rooms: RoomProgressItem[] = [
  {
    id: 'r1', floorId: 'f1', floorName: 'Tầng 1', roomName: 'Căn A',
    workCategory: 'Trần', workCategoryId: 'wc-tran', workVolume: 100, volumeUnit: 'm2',
    x: 0, y: 0, width: 40, height: 40,
    frameStatus: 'Đã hoàn thành', boardStatus: 'Đã hoàn thành', inspectionStatus: 'Đạt nghiệm thu',
    teamId: 'team-nguyen', assignedTeam: 'Đội Nguyên', updatedAt: 1,
  },
];
const defects: DefectItem[] = [
  {
    id: 'd1', floorId: 'f1', floorName: 'Tầng 1', roomId: 'r1', teamId: 'team-nguyen', x: 10, y: 10,
    category: 'Tấm thạch cao', description: 'Lỗi tấm', severity: 'Thấp', assignedTo: 'Đội Nguyên',
    status: 'Mới phát hiện', createdAt: '2026-09-05T00:00:00.000Z',
  },
];
const snapshot = createHnlAiProjectSnapshot({
  projectId,
  projectName: 'AI Provider Golden',
  rooms,
  defects,
  crewRecords: [],
  teams,
  floors,
  workVolumes: [],
  inventory: [],
  materialNorms: [],
  checklist: [],
  asOf: 1,
  freshness: 'fixture',
});
const runtime = { context, snapshot };

// Deterministic data works without any AI provider.
const noProvider = await runHnlAiQuestion({
  question: 'Đội Nguyên đang làm gì hiện tại?',
  runtime,
  referenceDate: '2026-09-05',
  requestNarrative: false,
});
assert.equal(noProvider.plan.status, 'ready');
assert.equal(noProvider.cloudStatus, 'not-requested');
assert.equal((noProvider.toolResult?.data as any)?.assignedRooms, 1);
assert.equal((noProvider.toolResult?.data as any)?.inspectedVolumeByUnit['m²'], 100);

// A valid provider narrative may only add inference/recommendation linked to deterministic facts.
const goodProvider = new MockAiProvider({
  structuredOutput: {
    statements: [
      {
        kind: 'INFERENCE',
        text: 'Đội hiện có một căn/phòng được giao và đã nghiệm thu.',
        supportingFactIds: ['current-progress:assigned-rooms', 'current-progress:completed-rooms'],
      },
      {
        kind: 'RECOMMENDATION',
        text: 'Ưu tiên xử lý Defect đang mở trước khi bàn giao.',
        supportingFactIds: ['current-progress:open-defects'],
      },
    ],
  },
});
const withNarrative = await runHnlAiQuestion({
  question: 'Đội Nguyên đang làm gì hiện tại?',
  runtime,
  referenceDate: '2026-09-05',
  requestNarrative: true,
  cloudAvailable: true,
  provider: goodProvider,
  model: 'mock-structured',
});
assert.equal(withNarrative.cloudStatus, 'ok');
assert.equal(withNarrative.narrative?.statements.length, 2);
assert.equal((withNarrative.toolResult?.data as any)?.assignedRooms, 1);

// Provider outage must not break HNL QLTC deterministic answer.
const outageProvider = new MockAiProvider({ failChat: true });
const outage = await runHnlAiQuestion({
  question: 'Đội Nguyên đang làm gì hiện tại?',
  runtime,
  referenceDate: '2026-09-05',
  requestNarrative: true,
  cloudAvailable: true,
  provider: outageProvider,
  model: 'mock-structured',
});
assert.equal(outage.cloudStatus, 'unavailable');
assert.equal((outage.toolResult?.data as any)?.assignedRooms, 1);
assert.equal((outage.toolResult?.data as any)?.inspectedVolumeByUnit['m²'], 100);
assert.ok(outage.warnings.some((warning) => warning.includes('Kết quả deterministic vẫn giữ nguyên')));

// Offline: do not call cloud at all; deterministic engine remains available.
const offline = await runHnlAiQuestion({
  question: 'Đội Nguyên đang làm gì hiện tại?',
  runtime,
  referenceDate: '2026-09-05',
  requestNarrative: true,
  cloudAvailable: false,
  provider: outageProvider,
  model: 'mock-structured',
});
assert.equal(offline.cloudStatus, 'offline');
assert.equal((offline.toolResult?.data as any)?.assignedRooms, 1);

// Hallucinated/model-created FACT is rejected; deterministic result is preserved.
const hallucinatingProvider = new MockAiProvider({
  structuredOutput: {
    statements: [
      { kind: 'FACT', text: 'Tự tạo số liệu 999 m²', supportingFactIds: ['current-progress:assigned-rooms'] },
    ],
  },
});
const hallucinated = await runHnlAiQuestion({
  question: 'Đội Nguyên đang làm gì hiện tại?',
  runtime,
  referenceDate: '2026-09-05',
  requestNarrative: true,
  cloudAvailable: true,
  provider: hallucinatingProvider,
  model: 'mock-structured',
});
assert.equal(hallucinated.cloudStatus, 'invalid-response');
assert.equal(hallucinated.narrative, undefined);
assert.equal((hallucinated.toolResult?.data as any)?.inspectedVolumeByUnit['m²'], 100);

// Unsupported question must not be passed to provider or generate an arbitrary tool.
const unsupported = await runHnlAiQuestion({
  question: 'Đội nào năng suất cao nhất tháng này?',
  runtime,
  referenceDate: '2026-09-05',
  requestNarrative: true,
  cloudAvailable: true,
  provider: goodProvider,
  model: 'mock-structured',
});
assert.equal(unsupported.plan.status, 'unsupported');
assert.equal(unsupported.toolResult, undefined);
assert.equal(unsupported.cloudStatus, 'not-requested');

console.log('HNL AI Provider/Orchestrator Golden Phase 3A: PASS');
