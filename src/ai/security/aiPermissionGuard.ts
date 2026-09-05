import type { UserRole } from '../../utils/securityUtils';
import { canViewFinancialData } from '../../utils/securityUtils';

export interface AiPermissionScope {
  projectId: string;
  role: UserRole;
  accessVerified: boolean;
}

const FINANCIAL_FIELD_NAMES = new Set([
  'unitprice',
  'price',
  'amount',
  'contractvalue',
  'totalvalue',
  'cost',
  'costvalue',
  'subtotal',
  'grandtotal',
]);

export function createAiPermissionScope(
  projectId: string,
  role: UserRole,
  accessVerified: boolean,
): AiPermissionScope {
  return {
    projectId: String(projectId || '').trim(),
    role,
    accessVerified: accessVerified === true,
  };
}

export function assertAiProjectAccess(scope: AiPermissionScope, projectId: string): void {
  const requestedProjectId = String(projectId || '').trim();
  if (!scope.accessVerified || !scope.projectId || scope.projectId !== requestedProjectId) {
    throw new Error('AI_FORBIDDEN_PROJECT_SCOPE: Quyền truy cập dự án chưa được xác minh.');
  }
}

export function canAiReadFinancialData(scope: AiPermissionScope): boolean {
  return scope.accessVerified && canViewFinancialData(scope.role);
}

function sanitizeValue(value: unknown, allowFinancials: boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, allowFinancials));
  if (!value || typeof value !== 'object') return value;

  const output: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!allowFinancials && FINANCIAL_FIELD_NAMES.has(normalized)) return;
    output[key] = sanitizeValue(child, allowFinancials);
  });
  return output;
}

/**
 * Defense-in-depth sanitizer for AI payloads. Firestore/UI RBAC remains authoritative;
 * this layer prevents hidden financial fields from leaking into model prompts or cache.
 */
export function sanitizeRecordForAi<T>(record: T, scope: AiPermissionScope): T {
  return sanitizeValue(record, canAiReadFinancialData(scope)) as T;
}
