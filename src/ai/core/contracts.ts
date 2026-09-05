import type { UserRole } from '../../utils/securityUtils';

export type AiFactKind = 'FACT' | 'CALCULATED' | 'INFERENCE' | 'RECOMMENDATION';
export type AiResultStatus = 'ok' | 'partial' | 'insufficient-data' | 'forbidden' | 'error';
export type AiQuantityBasis = 'contract' | 'assigned' | 'completed' | 'inspected';

export type AiSourceCollection =
  | 'projects'
  | 'rooms'
  | 'inventory'
  | 'defects'
  | 'work_volumes'
  | 'floor_plans'
  | 'checklist'
  | 'crew_records'
  | 'teams'
  | 'material_norms'
  | 'activityLogs'
  | 'inventory_balances';

export interface AiDateRange {
  from: string; // canonical YYYY-MM-DD, inclusive
  to: string;   // canonical YYYY-MM-DD, inclusive
}

export interface AiQueryContext {
  projectId: string;
  role: UserRole;
  accessVerified: boolean;
  userUid?: string;
  userEmail?: string;
  floorId?: string;
  roomId?: string;
  screen?: string;
  timeZone?: string;
}

export interface AiEvidenceRef {
  id: string;
  collection: AiSourceCollection;
  recordId: string;
  label?: string;
  fieldPaths?: string[];
}

export interface AiFact {
  id: string;
  kind: Extract<AiFactKind, 'FACT' | 'CALCULATED'>;
  label: string;
  value: string | number | boolean | null;
  unit?: string;
  method?: string;
  evidenceIds?: string[];
}

export interface AiToolMetadata {
  projectId: string;
  tool: string;
  timeRange?: AiDateRange;
  sourceCollections: AiSourceCollection[];
  recordsScanned: number;
  recordsUsed: number;
  asOf: number;
  freshness: 'live' | 'cache' | 'fixture';
  permissionRole: UserRole;
  dataVersion?: string;
}

export interface AiToolResult<T> {
  status: AiResultStatus;
  data: T | null;
  facts: AiFact[];
  evidence: AiEvidenceRef[];
  metadata: AiToolMetadata;
  warnings: string[];
  assumptions: string[];
}

/**
 * Canonical deterministic quantity observation consumed by the AI calculation layer.
 * This is NOT a new Firestore schema. Data adapters may derive these observations from
 * existing HNL records, activity history, imports, or future history sources.
 */
export interface AiQuantityObservation {
  recordId: string;
  date: string; // canonical YYYY-MM-DD
  teamId: string;
  workItemId?: string;
  workItem: string;
  unit: string;
  quantity: number;
  basis: AiQuantityBasis;
  floorId?: string;
  roomId?: string;
}

export interface AiQuantityGroup {
  workItemId?: string;
  workItem: string;
  unit: string;
  quantity: number;
  recordCount: number;
  evidenceIds: string[];
}

export interface AiProductivityMetric {
  unit: string;
  quantity: number;
  manDays: number;
  quantityPerManDay: number | null;
  method: 'same-unit quantity / team-period man-day';
}

export interface AiTeamSummaryData {
  teamId: string;
  teamName: string;
  dateRange: AiDateRange;
  workDays: number;
  totalManDays: number;
  quantityBasis: AiQuantityBasis;
  quantities: AiQuantityGroup[];
  productivityByUnit: AiProductivityMetric[];
  crewRecordCount: number;
  quantityRecordCount: number;
}

export type AiAuditSeverity = 'ERROR' | 'WARNING' | 'REVIEW';

export interface AiAuditIssue {
  ruleId: string;
  severity: AiAuditSeverity;
  entityType: 'defect' | 'room' | 'team' | 'floor' | 'crew' | 'quantity' | 'project';
  entityId: string;
  message: string;
  evidenceIds: string[];
  details?: Record<string, unknown>;
}

export interface AiAuditSummary {
  issues: AiAuditIssue[];
  errorCount: number;
  warningCount: number;
  reviewCount: number;
}
