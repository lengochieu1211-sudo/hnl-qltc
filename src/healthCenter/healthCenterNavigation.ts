import type { HealthCenterIssue } from './healthCenterEngine';

export type DiagnosticEntityType = 'crewRecord' | 'room' | 'defect' | 'chat' | string;

export interface DiagnosticNavigationRequest {
  projectId: string;
  entityType: DiagnosticEntityType;
  entityId: string;
  floorId?: string;
  roomId?: string;
  roomName?: string;
  teamId?: string;
  subItemId?: string;
  ruleId?: string;
  createdAt: number;
}

const text = (value: unknown): string => String(value || '').trim();

function evidenceEntityId(issue: HealthCenterIssue, prefix: string): string {
  const marker = `${prefix}:`;
  const evidence = (issue.evidenceIds || []).find((value) => String(value || '').startsWith(marker));
  return evidence ? String(evidence).slice(marker.length) : '';
}

export function canonicalDiagnosticEntityType(issue: HealthCenterIssue): DiagnosticEntityType {
  const raw = text(issue.entityType);
  if (raw === 'crew' || raw === 'crewRecord') return 'crewRecord';
  return raw;
}

export function canonicalDiagnosticEntityId(issue: HealthCenterIssue): string {
  const type = canonicalDiagnosticEntityType(issue);
  const details = (issue.details || {}) as Record<string, unknown>;
  if (type === 'crewRecord') {
    return text(details.recordId) || evidenceEntityId(issue, 'crew_records') || text(issue.entityId).split(':')[0];
  }
  if (type === 'room') {
    return text(details.roomId) || text(issue.location?.roomId) || evidenceEntityId(issue, 'rooms') || text(issue.entityId).split(':')[0];
  }
  if (type === 'defect') {
    return text(details.defectId) || evidenceEntityId(issue, 'defects') || text(issue.entityId).split(':')[0];
  }
  return text(issue.entityId).split(':')[0];
}

export function buildHealthCenterNavigationRequest(projectId: string, issue: HealthCenterIssue): DiagnosticNavigationRequest {
  const details = (issue.details || {}) as Record<string, unknown>;
  const entityType = canonicalDiagnosticEntityType(issue);
  const entityId = canonicalDiagnosticEntityId(issue);
  return {
    projectId,
    entityType,
    entityId,
    floorId: text(issue.location?.floorId),
    roomId: text(issue.location?.roomId) || (entityType === 'room' ? entityId : ''),
    roomName: text(issue.location?.roomName),
    teamId: text(issue.location?.teamId),
    subItemId: text(details.subItemId),
    ruleId: text(issue.ruleId),
    createdAt: Date.now(),
  };
}

export function navigationSuccessMessage(request: DiagnosticNavigationRequest): string {
  if (request.entityType === 'crewRecord') return 'Đang mở đúng bản ghi Quân số liên quan…';
  if (request.entityType === 'room') return 'Đang mở đúng tầng/căn liên quan…';
  if (request.entityType === 'defect') return 'Đang mở đúng Defect liên quan…';
  return 'Đang mở bản ghi liên quan…';
}
