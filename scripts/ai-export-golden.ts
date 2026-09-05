import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import type { HnlAiOrchestratorResult } from '../src/ai/orchestrator/aiOrchestrator';
import {
  buildHnlAiExcelWorkbook,
  buildHnlAiHtmlReport,
  buildHnlAiReportFileStem,
} from '../src/ai/export/aiReportExport';

const result: HnlAiOrchestratorResult = {
  plan: {
    status: 'ready',
    intent: 'audit-project',
    normalizedQuestion: 'Audit toàn dự án',
    clarifications: [],
    warnings: [],
    toolCall: { name: 'auditProjectIntegrity', args: {} },
  } as any,
  cloudStatus: 'ok',
  provider: 'mock',
  model: 'mock-safe',
  warnings: ['Cảnh báo orchestrator'],
  toolResult: {
    status: 'ok',
    data: {
      issues: [
        {
          ruleId: 'DEFECT_ROOM_LINK',
          severity: 'WARNING',
          entityType: 'defect',
          entityId: 'd-1',
          message: 'Defect cần kiểm tra liên kết phòng.',
          evidenceIds: ['defects:d-1'],
        },
      ],
      errorCount: 0,
      warningCount: 1,
      reviewCount: 0,
    },
    facts: [
      {
        id: 'fact-1',
        kind: 'CALCULATED',
        label: 'Defect đang mở',
        value: 3,
        unit: 'Defect',
        evidenceIds: ['defects:d-1'],
      },
    ],
    evidence: [
      { id: 'defects:d-1', collection: 'defects', recordId: 'd-1', label: 'Defect 1', fieldPaths: ['roomId', 'teamId'] },
    ],
    metadata: {
      projectId: 'project-ai-export',
      tool: 'auditProjectIntegrity',
      sourceCollections: ['defects', 'rooms', 'teams'],
      recordsScanned: 12,
      recordsUsed: 4,
      asOf: 1788588000000,
      freshness: 'fixture',
      permissionRole: 'ADMIN',
      dataVersion: 'hnl-ai-tools-v1',
    },
    warnings: ['Tool warning'],
    assumptions: ['Không tự sửa dữ liệu'],
  },
  narrative: {
    statements: [
      {
        kind: 'RECOMMENDATION',
        text: 'Ưu tiên rà lại Defect có cảnh báo liên kết.',
        supportingFactIds: ['fact-1'],
        supportingIssueIds: ['issue:1:DEFECT_ROOM_LINK:d-1'],
      },
    ],
  },
};

const input = {
  projectId: 'project-ai-export',
  projectName: 'Sân bay <script>alert(1)</script>',
  question: 'Audit toàn dự án & kiểm tra <b>liên kết</b>',
  mode: 'audit',
  result,
  generatedAt: 1788588000000,
};

const wb = buildHnlAiExcelWorkbook(input);
assert.deepEqual(wb.SheetNames, ['Tong quan', 'Facts', 'Audit', 'Evidence', 'AI nhan xet', 'Canh bao']);
const summary = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Tong quan'], { header: 1 });
assert.ok(summary.some((row) => row[0] === 'Công trình' && String(row[1]).includes('Sân bay')));
assert.ok(summary.some((row) => row[0] === 'Giới hạn' && String(row[1]).includes('READ + ANALYZE + EXPORT ONLY')));
const facts = XLSX.utils.sheet_to_json<any[]>(wb.Sheets.Facts, { header: 1 });
assert.ok(facts.some((row) => row.includes('Defect đang mở')));
const audit = XLSX.utils.sheet_to_json<any[]>(wb.Sheets.Audit, { header: 1 });
assert.ok(audit.some((row) => row.includes('DEFECT_ROOM_LINK')));

const html = buildHnlAiHtmlReport(input);
assert.ok(html.includes('HNL AI READ + ANALYZE + EXPORT ONLY'));
assert.ok(html.includes('Sân bay &lt;script&gt;alert(1)&lt;/script&gt;'));
assert.ok(!html.includes('<script>alert(1)</script>'));
assert.ok(html.includes('DEFECT_ROOM_LINK'));
assert.ok(html.includes('Ưu tiên rà lại Defect'));

const stem = buildHnlAiReportFileStem(input);
assert.ok(stem.startsWith('HNL_AI_San_bay_script_alert_1_script_'));
assert.equal(/[\\/:*?"<>|]/.test(stem), false);

console.log('HNL AI Report Export Golden: PASS');
