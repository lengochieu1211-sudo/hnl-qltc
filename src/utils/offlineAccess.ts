import type { UserRole } from './securityUtils';

export interface OfflineAuthIdentity {
  uid: string;
  email: string;
  displayName?: string;
  rememberedAt: number;
}

export interface VerifiedProjectRoleCache {
  version: 1;
  projectId: string;
  uid: string;
  email: string;
  role: UserRole;
  allowed: boolean;
  verifiedAt: number;
}

const OFFLINE_AUTH_IDENTITY_KEY = 'construction_offline_verified_auth_v1';
const VERIFIED_PROJECT_ROLE_PREFIX = 'construction_verified_project_role_v1_';

const normalizeEmail = (value?: string | null): string => (value || '').trim().toLowerCase();

const safeEncode = (value: string): string => {
  try { return encodeURIComponent(value); } catch (_) { return value.replace(/[^A-Za-z0-9_.-]/g, '_'); }
};

const roleCacheKey = (projectId: string, identity: Pick<OfflineAuthIdentity, 'uid' | 'email'>): string => {
  const principal = String(identity.uid || '').trim() || normalizeEmail(identity.email);
  return `${VERIFIED_PROJECT_ROLE_PREFIX}${safeEncode(principal)}__${safeEncode(String(projectId || '').trim())}`;
};

export function rememberVerifiedAuthIdentity(identity: { uid?: string | null; email?: string | null; displayName?: string | null }): OfflineAuthIdentity | null {
  const uid = String(identity.uid || '').trim();
  const email = normalizeEmail(identity.email);
  if (!uid || !email || typeof localStorage === 'undefined') return null;
  const record: OfflineAuthIdentity = {
    uid,
    email,
    displayName: String(identity.displayName || '').trim() || undefined,
    rememberedAt: Date.now(),
  };
  try { localStorage.setItem(OFFLINE_AUTH_IDENTITY_KEY, JSON.stringify(record)); } catch (_) {}
  return record;
}

export function getRememberedVerifiedAuthIdentity(): OfflineAuthIdentity | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(OFFLINE_AUTH_IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflineAuthIdentity>;
    const uid = String(parsed.uid || '').trim();
    const email = normalizeEmail(parsed.email);
    if (!uid || !email) return null;
    return {
      uid,
      email,
      displayName: parsed.displayName ? String(parsed.displayName) : undefined,
      rememberedAt: Number(parsed.rememberedAt || 0),
    };
  } catch (_) {
    return null;
  }
}

export function clearRememberedVerifiedAuthIdentity(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(OFFLINE_AUTH_IDENTITY_KEY); } catch (_) {}
}

export function cacheVerifiedProjectRole(
  projectId: string,
  identity: { uid?: string | null; email?: string | null },
  role: UserRole,
  allowed: boolean,
): VerifiedProjectRoleCache | null {
  const normalizedProjectId = String(projectId || '').trim();
  const uid = String(identity.uid || '').trim();
  const email = normalizeEmail(identity.email);
  if (!normalizedProjectId || !uid || !email || typeof localStorage === 'undefined') return null;
  const record: VerifiedProjectRoleCache = {
    version: 1,
    projectId: normalizedProjectId,
    uid,
    email,
    role,
    allowed,
    verifiedAt: Date.now(),
  };
  try { localStorage.setItem(roleCacheKey(normalizedProjectId, { uid, email }), JSON.stringify(record)); } catch (_) {}
  return record;
}

export function getCachedVerifiedProjectRole(
  projectId: string,
  identity: { uid?: string | null; email?: string | null },
): VerifiedProjectRoleCache | null {
  const normalizedProjectId = String(projectId || '').trim();
  const uid = String(identity.uid || '').trim();
  const email = normalizeEmail(identity.email);
  if (!normalizedProjectId || !uid || !email || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(roleCacheKey(normalizedProjectId, { uid, email }));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VerifiedProjectRoleCache>;
    const rawRole = String((parsed as any).role || 'VIEWER').toUpperCase();
    const role: UserRole = rawRole === 'ENGINEER' ? 'EDITOR' : (rawRole as UserRole);
    if (parsed.version !== 1 || String(parsed.projectId || '') !== normalizedProjectId) return null;
    if (String(parsed.uid || '') !== uid || normalizeEmail(parsed.email) !== email) return null;
    if (role !== 'ADMIN' && role !== 'EDITOR' && role !== 'VIEWER') return null;
    return {
      version: 1,
      projectId: normalizedProjectId,
      uid,
      email,
      role,
      allowed: parsed.allowed === true,
      verifiedAt: Number(parsed.verifiedAt || 0),
    };
  } catch (_) {
    return null;
  }
}

export function clearCachedProjectRolesForIdentity(identity: { uid?: string | null; email?: string | null }): void {
  if (typeof localStorage === 'undefined') return;
  const uid = String(identity.uid || '').trim();
  const email = normalizeEmail(identity.email);
  const principal = uid || email;
  if (!principal) return;
  const prefix = `${VERIFIED_PROJECT_ROLE_PREFIX}${safeEncode(principal)}__`;
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch (_) {}
}
