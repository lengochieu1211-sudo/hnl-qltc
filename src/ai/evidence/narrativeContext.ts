import type {
  AiAuditIssue,
  AiAuditSummary,
  AiFact,
  AiFactKind,
  AiToolMetadata,
  AiToolResult,
} from '../core/contracts';

export interface AiNarrativeFact {
  id: string;
  kind: 'FACT' | 'CALCULATED';
  label: string;
  value: string | number | boolean | null;
  unit?: string;
  method?: string;
  evidenceIds: string[];
}

export interface AiNarrativeAuditIssue {
  id: string;
  ruleId: string;
  severity: 'ERROR' | 'WARNING' | 'REVIEW';
  entityType: AiAuditIssue['entityType'];
  entityId: string;
  message: string;
  evidenceIds: string[];
}

export interface AiNarrativeSource {
  id: string;
  collection: string;
  recordId: string;
  label?: string;
}

export interface AiNarrativeContext {
  version: 1;
  facts: AiNarrativeFact[];
  auditIssues: AiNarrativeAuditIssue[];
  sources: AiNarrativeSource[];
  metadata: Pick<AiToolMetadata, 'projectId' | 'tool' | 'timeRange' | 'sourceCollections' | 'recordsScanned' | 'recordsUsed' | 'asOf' | 'freshness' | 'permissionRole' | 'dataVersion'>;
  warnings: string[];
  assumptions: string[];
}

function isAuditSummary(value: unknown): value is AiAuditSummary {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AiAuditSummary>;
  return Array.isArray(candidate.issues)
    && typeof candidate.errorCount === 'number'
    && typeof candidate.warningCount === 'number'
    && typeof candidate.reviewCount === 'number';
}

/**
 * Build the only context shape that a future narrative model needs for HNL Data/Audit.
 * Raw business records and arbitrary result.data are deliberately excluded. Numeric facts
 * are rendered by the app from the deterministic tool result; the model only receives the
 * same fact IDs/values for explanation and must cite them in its narrative response.
 */
export function buildAiNarrativeContext(result: AiToolResult<unknown>): AiNarrativeContext {
  const facts: AiNarrativeFact[] = result.facts.map((fact: AiFact) => ({
    id: fact.id,
    kind: fact.kind,
    label: fact.label,
    value: fact.value,
    unit: fact.unit,
    method: fact.method,
    evidenceIds: [...(fact.evidenceIds || [])],
  }));

  const auditIssues: AiNarrativeAuditIssue[] = isAuditSummary(result.data)
    ? result.data.issues.map((issue, index) => ({
        id: `issue:${index + 1}:${issue.ruleId}:${issue.entityId}`,
        ruleId: issue.ruleId,
        severity: issue.severity,
        entityType: issue.entityType,
        entityId: issue.entityId,
        message: issue.message,
        evidenceIds: [...issue.evidenceIds],
      }))
    : [];

  const sources: AiNarrativeSource[] = result.evidence.map((item) => ({
    id: item.id,
    collection: item.collection,
    recordId: item.recordId,
    label: item.label,
  }));

  return Object.freeze({
    version: 1 as const,
    facts,
    auditIssues,
    sources,
    metadata: { ...result.metadata },
    warnings: [...result.warnings],
    assumptions: [...result.assumptions],
  });
}

export interface AiNarrativeStatement {
  kind: Extract<AiFactKind, 'INFERENCE' | 'RECOMMENDATION'>;
  text: string;
  supportingFactIds: string[];
  supportingIssueIds?: string[];
}

export interface AiNarrativeResponse {
  statements: AiNarrativeStatement[];
}

export class AiNarrativeValidationError extends Error {
  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'AiNarrativeValidationError';
  }
}

/**
 * Validate future model output against the deterministic context. The model is never
 * allowed to create FACT/CALCULATED rows; it may only return inference/recommendation
 * statements referencing fact/issue IDs that actually exist in the tool result.
 */
export function validateAiNarrativeResponse(input: unknown, context: AiNarrativeContext): AiNarrativeResponse {
  if (!input || typeof input !== 'object' || !Array.isArray((input as any).statements)) {
    throw new AiNarrativeValidationError('Narrative response phải chứa statements[].');
  }
  const factIds = new Set(context.facts.map((fact) => fact.id));
  const issueIds = new Set(context.auditIssues.map((issue) => issue.id));

  const statements = (input as any).statements.map((raw: any, index: number): AiNarrativeStatement => {
    if (!raw || typeof raw !== 'object') throw new AiNarrativeValidationError('Statement không hợp lệ.', { index });
    if (raw.kind !== 'INFERENCE' && raw.kind !== 'RECOMMENDATION') {
      throw new AiNarrativeValidationError('Model chỉ được tạo INFERENCE hoặc RECOMMENDATION.', { index, kind: raw.kind });
    }
    const text = String(raw.text || '').trim();
    if (!text || text.length > 3000) throw new AiNarrativeValidationError('Statement text trống hoặc quá dài.', { index, length: text.length });
    if (!Array.isArray(raw.supportingFactIds)) {
      throw new AiNarrativeValidationError('Statement phải có supportingFactIds[].', { index });
    }
    const supportingFactIds = raw.supportingFactIds.map((value: unknown) => String(value));
    const unknownFacts = supportingFactIds.filter((id: string) => !factIds.has(id));
    if (unknownFacts.length > 0) {
      throw new AiNarrativeValidationError('Model tham chiếu Fact ID không tồn tại.', { index, unknownFacts });
    }
    const supportingIssueIds = raw.supportingIssueIds === undefined
      ? undefined
      : Array.isArray(raw.supportingIssueIds)
        ? raw.supportingIssueIds.map((value: unknown) => String(value))
        : (() => { throw new AiNarrativeValidationError('supportingIssueIds phải là array.', { index }); })();
    const unknownIssues = (supportingIssueIds || []).filter((id: string) => !issueIds.has(id));
    if (unknownIssues.length > 0) {
      throw new AiNarrativeValidationError('Model tham chiếu Audit Issue ID không tồn tại.', { index, unknownIssues });
    }
    if (raw.kind === 'INFERENCE' && supportingFactIds.length === 0 && (supportingIssueIds || []).length === 0) {
      throw new AiNarrativeValidationError('INFERENCE phải có ít nhất một nguồn deterministic.', { index });
    }
    return { kind: raw.kind, text, supportingFactIds, supportingIssueIds };
  });

  return { statements };
}
