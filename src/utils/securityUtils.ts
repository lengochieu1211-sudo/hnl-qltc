/**
 * Security & Access Control Module (RBAC, Member Whitelist, Audit Log, PIN Lock).
 * Works 100% offline with zero cost, and seamlessly syncs with cloud projects.
 */

import { PinLockConfig, hashPin, verifyPin } from './cryptoUtils';
import { FIREBASE_ONLY_RUNTIME, LEGACY_LOCAL_IMPORT_ENABLED } from '../config/runtimeArchitecture';

export type UserRole = 'ADMIN' | 'EDITOR' | 'VIEWER';

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  allowedProjectIds?: string[]; // Empty or undefined = all projects (for admin)
  createdAt: number;
  lastLoginAt?: number;
}

export interface ProjectMember {
  email: string;
  role: UserRole;
  assignedAt: number;
  uid?: string;
  displayName?: string;
  active?: boolean;
  updatedAt?: number;
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  actorEmail: string;
  actorRole: UserRole;
  action: 'PROJECT_DELETE' | 'PROJECT_CREATE' | 'PROJECT_RECOVER_LOCAL' | 'FULL_RESTORE' | 'FULL_RESTORE_REPLACE' | 'ORPHAN_CLEANUP' | 'ROLE_CHANGE' | 'CATEGORY_DELETE' | 'BACKUP_EXPORT' | 'BACKUP_IMPORT_FIREBASE_ONLY' | 'SECURITY_CONFIG_CHANGE' | 'DATA_CHANGE' | 'PHOTO_CHANGE';
  details: string;
  projectId?: string;
  actorUid?: string;
  actorName?: string;
  deviceId?: string;
  deviceName?: string;
}

const PIN_LOCK_STORAGE_KEY = 'construction_pin_lock_config';
const AUDIT_LOG_STORAGE_KEY = 'construction_audit_logs';
const CURRENT_USER_ROLE_KEY = 'construction_user_role';
const PROJECT_MEMBERS_PREFIX = 'construction_project_members_';

export function getStoredPinLockConfig(): PinLockConfig {
  try {
    const raw = localStorage.getItem(PIN_LOCK_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (_) {}
  return {
    enabled: false,
    autoLockMinutes: 5,
    lockOnBackground: true
  };
}

export function savePinLockConfig(config: PinLockConfig): void {
  localStorage.setItem(PIN_LOCK_STORAGE_KEY, JSON.stringify(config));
}

/**
 * UI compatibility cache only. In Firebase-only runtime this value MUST NEVER grant
 * project access. App.tsx resolves authorization from Firebase Auth + a project-scoped
 * verified role lease before rendering business data or enabling mutations.
 */
export function getCurrentUserRole(): UserRole {
  if (FIREBASE_ONLY_RUNTIME) return 'VIEWER';
  try {
    const role = localStorage.getItem(CURRENT_USER_ROLE_KEY) as UserRole;
    if (role === 'ADMIN' || role === 'EDITOR' || role === 'VIEWER') return role;
  } catch (_) {}
  return 'VIEWER';
}

export function setCurrentUserRole(role: UserRole): void {
  // Retained only for legacy wrappers/components during migration. No Firebase-only
  // permission decision is allowed to read this global, cross-project cache.
  if (!FIREBASE_ONLY_RUNTIME) localStorage.setItem(CURRENT_USER_ROLE_KEY, role);
}

export function canEditFinancials(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function canEditFinancialData(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function canViewFinancials(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function canViewFinancialData(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function canManageProjects(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function canCreateProject(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function canDeleteProject(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function canManageMembers(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function canManageSecurity(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function canImportData(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function canRestoreData(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function canEditProjectData(role: UserRole): boolean {
  return role === 'ADMIN' || role === 'EDITOR';
}

// RC2.2.4.1: keep the WorkVolume structural permission as a shared, explicit RBAC helper.
// Work-volume master data defines project structure (title/floor/category/unit/planned/price).
// Only ADMIN may create/import/rename/delete those definitions. EDITOR updates field progress
// through room/floor-plan workflows; computed work-volume actual/status then follow automatically.
export function canManageWorkVolumeStructure(role: UserRole): boolean {
  return role === 'ADMIN';
}

// RC2.2.5: floor-plan/room geometry is project structure. Only ADMIN may create,
// rename, replace drawings, duplicate/reorder floors, or create/delete/move/resize rooms.
// EDITOR remains allowed to update field progress/inspection/assignment on existing rooms.
export function canManageFloorPlanStructure(role: UserRole): boolean {
  return role === 'ADMIN';
}

// RC2.2.5 MASTER RBAC: these collections define reusable project structure or
// perform broad/destructive operations. Keep their policy explicit so every UI,
// handler and Firebase rule can use the same ADMIN-only boundary.
export function canManageMaterialNorms(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function canManageTeams(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function canManageChecklistStructure(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function canDeleteBusinessData(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function canManageBackups(role: UserRole): boolean {
  return role === 'ADMIN';
}

// Undo/Redo stores whole AppData snapshots. Restrict it to ADMIN until it is
// replaced by operation-scoped undo, otherwise a role switch could replay an old
// structural snapshot through an EDITOR session.
export function canUseGlobalUndoRedo(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function canDeleteCategory(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function canEditDefectData(role: UserRole): boolean {
  return role === 'ADMIN' || role === 'EDITOR';
}

export function canEditChecklistData(role: UserRole): boolean {
  return role === 'ADMIN' || role === 'EDITOR';
}

export function canEditCrewData(role: UserRole): boolean {
  return role === 'ADMIN' || role === 'EDITOR';
}

export function canEditWarehouseData(role: UserRole): boolean {
  return role === 'ADMIN' || role === 'EDITOR';
}

// Project Members Whitelist
export function getProjectMembers(projectId: string): ProjectMember[] {
  // Legacy migration reader only. Firestore /projects/{projectId}/members is authoritative.
  if (FIREBASE_ONLY_RUNTIME && !LEGACY_LOCAL_IMPORT_ENABLED) return [];
  if (!projectId) return [];
  try {
    const raw = localStorage.getItem(`${PROJECT_MEMBERS_PREFIX}${projectId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  return [];
}

export function saveProjectMembers(projectId: string, members: ProjectMember[]): void {
  // Never create a second permission database in Firebase-only runtime.
  if (FIREBASE_ONLY_RUNTIME || !projectId) return;
  localStorage.setItem(`${PROJECT_MEMBERS_PREFIX}${projectId}`, JSON.stringify(members));
}

export function addProjectMember(projectId: string, member: ProjectMember): void {
  if (!projectId || !member.email) return;
  const existing = getProjectMembers(projectId);
  const normalizedEmail = member.email.trim().toLowerCase();
  const filtered = existing.filter(m => m.email.toLowerCase() !== normalizedEmail);
  filtered.push({ ...member, email: normalizedEmail });
  saveProjectMembers(projectId, filtered);
}

export function removeProjectMember(projectId: string, email: string): void {
  if (!projectId || !email) return;
  const existing = getProjectMembers(projectId);
  const normalizedEmail = email.trim().toLowerCase();
  const filtered = existing.filter(m => m.email.toLowerCase() !== normalizedEmail);
  saveProjectMembers(projectId, filtered);
}

export function checkUserProjectAccess(
  projectId: string,
  userEmail?: string,
  globalRole: UserRole = getCurrentUserRole()
): { allowed: boolean; role: UserRole } {
  // Firebase-only authorization must be resolved by firebase.ts/offlineAccess.ts.
  if (FIREBASE_ONLY_RUNTIME) return { allowed: false, role: 'VIEWER' };
  // Global admin always has full access
  if (globalRole === 'ADMIN') {
    return { allowed: true, role: 'ADMIN' };
  }

  const members = getProjectMembers(projectId);
  // If no members are configured for project, fall back to global role safely
  if (members.length === 0) {
    return { allowed: true, role: globalRole || 'VIEWER' };
  }

  if (!userEmail) {
    // If members whitelist is configured but user is not logged in, enforce VIEWER
    return { allowed: false, role: 'VIEWER' };
  }

  const normalizedEmail = userEmail.trim().toLowerCase();
  const matched = members.find(m => m.email.toLowerCase() === normalizedEmail);
  if (matched) {
    return { allowed: true, role: matched.role };
  }

  // Strict Fail-Secure: default to VIEWER (no write access)
  return { allowed: false, role: 'VIEWER' };
}

// Audit Logs
export function getAuditLogs(): AuditLogEntry[] {
  try {
    const raw = localStorage.getItem(AUDIT_LOG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.sort((a, b) => b.timestamp - a.timestamp);
      }
    }
  } catch (_) {}
  return [];
}

export function logAuditAction(
  action: AuditLogEntry['action'],
  details: string,
  projectId?: string,
  actorEmail: string = 'local_user@offline',
  actorRole: UserRole = getCurrentUserRole()
): void {
  try {
    const logs = getAuditLogs();
    const newEntry: AuditLogEntry = {
      id: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      timestamp: Date.now(),
      actorEmail,
      actorRole,
      action,
      details,
      projectId
    };
    logs.unshift(newEntry);
    // Keep max 200 log entries
    const trimmed = logs.slice(0, 200);
    localStorage.setItem(AUDIT_LOG_STORAGE_KEY, JSON.stringify(trimmed));

    // Best-effort Cloud append. Firestore rules bind the actor identity to real Google Auth,
    // so the local actorEmail argument can never impersonate another account in Cloud.
    if (projectId) {
      import('../lib/firebase').then(({ saveProjectAuditLog }) => {
        saveProjectAuditLog(projectId, {
          timestamp: newEntry.timestamp,
          action,
          details,
          description: details,
          actorRole,
          module: action.startsWith('ROLE_') || action === 'SECURITY_CONFIG_CHANGE' ? 'security' : 'app',
          syncStatus: 'PENDING',
        }).catch(() => {});
      }).catch(() => {});
    }
  } catch (_) {}
}

export function clearAuditLogs(): void {
  localStorage.removeItem(AUDIT_LOG_STORAGE_KEY);
}
