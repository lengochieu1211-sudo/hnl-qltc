import type {
  AiAuditIssue,
  AiAuditSummary,
  AiEvidenceRef,
  AiFact,
  AiQueryContext,
  AiSourceCollection,
  AiToolResult,
} from '../core/contracts';
import type { HnlAiProjectSnapshot } from '../data/projectSnapshot';
import { buildHealthCenterReport, type HealthCenterIssue } from '../../healthCenter/healthCenterEngine';

const SOURCE_COLLECTIONS: AiSourceCollection[] = [
  'rooms',
  'defects',
  'crew_records',
  'teams',
  'floor_plans',
  'work_volumes',
  'inventory',
  'material_norms',
  'checklist',
];

const COLLECTION_BY_PREFIX: Record<string, AiSourceCollection> = {
  rooms: 'rooms',
  defects: 'defects',
  crew_records: 'crew_records',
  teams: 'teams',
  floor_plans: 'floor_plans',
  work_volumes: 'work_volumes',
  inventory: 'inventory',
  material_norms: 'material_norms',
  checklist: 'checklist',
};

function toAiEntityType(issue: HealthCenterIssue): AiAuditIssue['entityType'] {
  if (issue.entityType === 'defect') return 'defect';
  if (issue.entityType === 'room') return 'room';
  if (issue.entityType === 'team') return 'team';
  if (issue.entityType === 'floor') return 'floor';
  if (issue.entityType === 'crew' || issue.entityType === 'crewRecord') return 'crew';
  if (issue.entityType === 'quantity' || issue.entityType === 'workVolume') return 'quantity';
  return 'project';
}

function toAiIssue(issue: HealthCenterIssue): AiAuditIssue {
  return {
    ruleId: issue.ruleId,
    severity: issue.severity === 'SUGGESTION' ? 'REVIEW' : issue.severity,
    entityType: toAiEntityType(issue),
    entityId: issue.entityId,
    message: issue.message,
    evidenceIds: [...issue.evidenceIds],
    details: {
      ...(issue.details || {}),
      healthCenterIssueId: issue.id,
      healthCenterModule: issue.module,
      healthCenterActionClass: issue.actionClass,
      healthCenterSeverity: issue.severity,
      sourceEntityType: issue.entityType,
      location: issue.location,
    },
  };
}

function evidenceFromIssues(issues: readonly HealthCenterIssue[]): AiEvidenceRef[] {
  const refs = new Map<string, AiEvidenceRef>();
  issues.forEach((issue) => {
    issue.evidenceIds.forEach((id) => {
      if (refs.has(id)) return;
      const separator = id.indexOf(':');
      if (separator <= 0) return;
      const prefix = id.slice(0, separator);
      const recordId = id.slice(separator + 1);
      const collection = COLLECTION_BY_PREFIX[prefix];
      if (!collection || !recordId) return;
      refs.set(id, {
        id,
        collection,
        recordId,
        label: issue.message,
      });
    });
  });
  return Array.from(refs.values());
}

export interface AuditProjectViaHealthCenterParams {
  context: AiQueryContext;
  snapshot: HnlAiProjectSnapshot;
}

/**
 * AI compatibility adapter for the canonical Health Center audit.
 * Health Center remains the single business-audit source. This adapter only converts
 * its deterministic report into the legacy AiAuditSummary shape consumed by the
 * existing AI narrative/export pipeline. It has no write capability.
 */
export function auditProjectViaHealthCenter(
  params: AuditProjectViaHealthCenterParams,
): AiToolResult<AiAuditSummary> {
  const { context, snapshot } = params;
  const report = buildHealthCenterReport({ context, snapshot });
  const issues = report.issues.map(toAiIssue);
  const evidence = evidenceFromIssues(report.issues);

  const data: AiAuditSummary = {
    issues,
    errorCount: report.errorCount,
    warningCount: report.warningCount,
    reviewCount: report.reviewCount + report.suggestionCount,
  };

  const facts: AiFact[] = [
    { id: 'health-center:audit-snapshot-id', kind: 'FACT', label: 'Health Center Audit Snapshot ID', value: report.auditSnapshotId },
    { id: 'health-center:errors', kind: 'CALCULATED', label: 'Lỗi toàn dự án', value: report.errorCount, unit: 'issue' },
    { id: 'health-center:warnings', kind: 'CALCULATED', label: 'Cảnh báo toàn dự án', value: report.warningCount, unit: 'issue' },
    { id: 'health-center:review', kind: 'CALCULATED', label: 'Mục cần xác nhận/rà soát', value: report.reviewCount + report.suggestionCount, unit: 'issue' },
    { id: 'health-center:safe-repair', kind: 'CALCULATED', label: 'Ứng viên sửa an toàn', value: report.safeRepairCount, unit: 'issue' },
    { id: 'health-center:manual-repair', kind: 'CALCULATED', label: 'Mục cần sửa thủ công', value: report.manualRepairCount, unit: 'issue' },
  ];

  return {
    status: 'ok',
    data,
    facts,
    evidence,
    metadata: {
      projectId: context.projectId,
      tool: 'auditProjectIntegrity',
      sourceCollections: SOURCE_COLLECTIONS,
      recordsScanned: report.recordsScanned,
      recordsUsed: evidence.length,
      asOf: snapshot.asOf,
      freshness: snapshot.freshness,
      permissionRole: context.role,
      dataVersion: `health-center:${report.auditSnapshotId}`,
    },
    warnings: [
      ...(snapshot.freshness === 'cache' ? ['Health Center đang audit snapshot cache; nên đồng bộ lại trước khi dùng làm kết luận cuối.'] : []),
      ...(report.suggestionCount > 0 ? [`${report.suggestionCount} đề xuất Health Center được ánh xạ sang REVIEW trong lớp AI tương thích.`] : []),
    ],
    assumptions: [
      'AI Audit chỉ phân tích kết quả deterministic từ Health Center và không có quyền tự sửa/xóa dữ liệu dự án.',
    ],
  };
}
