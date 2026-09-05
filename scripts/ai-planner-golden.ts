import assert from 'node:assert/strict';
import type { TeamInfo } from '../src/types';
import type { AiQueryContext, AiToolResult } from '../src/ai/core/contracts';
import { planHnlAiQuestion } from '../src/ai/planning/queryPlanner';
import { HnlAiToolValidationError, validateHnlAiToolCall } from '../src/ai/tools/toolValidation';
import {
  AiNarrativeValidationError,
  buildAiNarrativeContext,
  validateAiNarrativeResponse,
} from '../src/ai/evidence/narrativeContext';

const projectId = 'project-ai-planner';
const context: AiQueryContext = {
  projectId,
  role: 'ADMIN',
  accessVerified: true,
  timeZone: 'Asia/Ho_Chi_Minh',
};
const referenceDate = '2026-09-05';
const teams: TeamInfo[] = [
  { id: 'team-nguyen', name: 'Đội Nguyên', leader: 'Nguyên', defaultCount: 10 },
  { id: 'team-nguyen-2', name: 'Đội Nguyên 2', leader: 'N2', defaultCount: 8 },
  { id: 'team-an', name: 'Đội An', leader: 'An', defaultCount: 8 },
];

const summary = planHnlAiQuestion({
  question: 'Tổng hợp đội Nguyên từ 1/8 tới 15/8.',
  context,
  teams,
  referenceDate,
});
assert.equal(summary.status, 'ready');
assert.equal(summary.intent, 'TEAM_SUMMARY');
assert.equal(summary.resolvedTeam?.id, 'team-nguyen');
assert.deepEqual(summary.dateRange, { from: '2026-08-01', to: '2026-08-15' });
assert.deepEqual(summary.toolCall, {
  name: 'getTeamSummary',
  args: { teamRef: 'team-nguyen', dateRange: { from: '2026-08-01', to: '2026-08-15' } },
});

const previousWeek = planHnlAiQuestion({
  question: 'Tổng hợp Đội Nguyên tuần trước',
  context,
  teams,
  referenceDate,
});
assert.equal(previousWeek.status, 'ready');
assert.deepEqual(previousWeek.dateRange, { from: '2026-08-24', to: '2026-08-30' });

const currentTeam = planHnlAiQuestion({
  question: 'Đội Nguyên đang làm gì hiện tại?',
  context,
  teams,
  referenceDate,
});
assert.equal(currentTeam.status, 'ready');
assert.deepEqual(currentTeam.toolCall, { name: 'getCurrentTeamProgress', args: { teamRef: 'team-nguyen' } });

const projectAudit = planHnlAiQuestion({
  question: 'Kiểm tra toàn bộ logic dữ liệu dự án có bất thường không.',
  context,
  teams,
  referenceDate,
});
assert.deepEqual(projectAudit.toolCall, { name: 'auditProjectIntegrity', args: {} });
assert.deepEqual(
  planHnlAiQuestion({ question: 'Kiểm tra Defect', context, teams, referenceDate }).toolCall,
  { name: 'auditDefectLinks', args: {} },
);
assert.deepEqual(
  planHnlAiQuestion({ question: 'Kiểm tra quân số', context, teams, referenceDate }).toolCall,
  { name: 'auditCrewData', args: {} },
);
assert.deepEqual(
  planHnlAiQuestion({ question: 'Kiểm tra khối lượng', context, teams, referenceDate }).toolCall,
  { name: 'auditQuantityData', args: {} },
);

const ambiguous = planHnlAiQuestion({
  question: 'Tổng hợp đội Nguyên từ 1/8 đến 15/8',
  context,
  teams: [
    { id: 'nguyen-1', name: 'Đội Nguyên 1', leader: 'N1', defaultCount: 5 },
    { id: 'nguyen-2', name: 'Đội Nguyên 2', leader: 'N2', defaultCount: 5 },
  ],
  referenceDate,
});
assert.equal(ambiguous.status, 'needs-clarification');
assert.equal(ambiguous.intent, 'TEAM_SUMMARY');
assert.equal(ambiguous.toolCall, undefined, 'ambiguous team must never become a tool call');

const noDate = planHnlAiQuestion({
  question: 'Tổng hợp Đội Nguyên',
  context,
  teams,
  referenceDate,
});
assert.equal(noDate.status, 'needs-clarification');
assert.equal(noDate.toolCall, undefined);

const compareTeams = planHnlAiQuestion({
  question: 'Đội nào năng suất cao nhất tháng này?',
  context,
  teams,
  referenceDate,
});
assert.equal(compareTeams.status, 'unsupported', 'unsupported compareTeams must not be routed to a made-up tool');
assert.equal(compareTeams.toolCall, undefined);

// Provider/tool-calling boundary: strict schema, exact keys, canonical dates only.
assert.deepEqual(validateHnlAiToolCall({ name: 'auditProjectIntegrity', args: {} }), { name: 'auditProjectIntegrity', args: {} });
assert.deepEqual(
  validateHnlAiToolCall({ name: 'getTeamSummary', args: { teamRef: 'team-nguyen', dateRange: { from: '2026-08-01', to: '2026-08-15' } } }),
  { name: 'getTeamSummary', args: { teamRef: 'team-nguyen', dateRange: { from: '2026-08-01', to: '2026-08-15' } } },
);
assert.throws(
  () => validateHnlAiToolCall({ name: 'db.collection', args: { path: 'projects' } }),
  (error: unknown) => error instanceof HnlAiToolValidationError && error.code === 'TOOL_NOT_ALLOWED',
);
assert.throws(
  () => validateHnlAiToolCall({ name: 'auditCrewData', args: { projectId: 'other-project' } }),
  (error: unknown) => error instanceof HnlAiToolValidationError && error.code === 'INVALID_TOOL_ARGS',
);
assert.throws(
  () => validateHnlAiToolCall({ name: 'getTeamSummary', args: { teamRef: 'team-nguyen', dateRange: { from: '01/08/2026', to: '15/08/2026' } } }),
  HnlAiToolValidationError,
);

// Narrative context must exclude raw result.data; only deterministic facts/audit issues/source labels survive.
const deterministicResult: AiToolResult<any> = {
  status: 'ok',
  data: { internal: { unitPrice: 250000, secretLikeRawField: 'must-not-enter-model-context' } },
  facts: [
    { id: 'fact:1', kind: 'CALCULATED', label: 'Khối lượng nghiệm thu', value: 100, unit: 'm²', evidenceIds: ['rooms:r1'] },
  ],
  evidence: [
    { id: 'rooms:r1', collection: 'rooms', recordId: 'r1', label: 'Căn A' },
  ],
  metadata: {
    projectId,
    tool: 'fixture',
    sourceCollections: ['rooms'],
    recordsScanned: 1,
    recordsUsed: 1,
    asOf: 1,
    freshness: 'fixture',
    permissionRole: 'ADMIN',
  },
  warnings: [],
  assumptions: [],
};
const narrativeContext = buildAiNarrativeContext(deterministicResult);
const serializedNarrativeContext = JSON.stringify(narrativeContext);
assert.equal(serializedNarrativeContext.includes('250000'), false);
assert.equal(serializedNarrativeContext.includes('must-not-enter-model-context'), false);
assert.equal(narrativeContext.facts[0].value, 100);

const validNarrative = validateAiNarrativeResponse({
  statements: [
    { kind: 'INFERENCE', text: 'Khối lượng nghiệm thu hiện có nguồn xác định.', supportingFactIds: ['fact:1'] },
    { kind: 'RECOMMENDATION', text: 'Tiếp tục theo dõi xu hướng.', supportingFactIds: ['fact:1'] },
  ],
}, narrativeContext);
assert.equal(validNarrative.statements.length, 2);
assert.throws(
  () => validateAiNarrativeResponse({ statements: [{ kind: 'FACT', text: 'Model tự tạo fact', supportingFactIds: ['fact:1'] }] }, narrativeContext),
  AiNarrativeValidationError,
);
assert.throws(
  () => validateAiNarrativeResponse({ statements: [{ kind: 'INFERENCE', text: 'Không có nguồn', supportingFactIds: ['fact:made-up'] }] }, narrativeContext),
  AiNarrativeValidationError,
);

console.log('HNL AI Query Planner / Tool Validation / Narrative Contract Golden: PASS');
