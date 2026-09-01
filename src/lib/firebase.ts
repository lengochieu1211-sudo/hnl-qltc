import { initializeApp, getApps } from 'firebase/app';
import { 
  initializeFirestore, 
  persistentLocalCache,
  connectFirestoreEmulator,
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  getDocsFromServer,
  deleteDoc, 
  collection, 
  onSnapshot, 
  getDocFromServer,
  getDocFromCache,
  getDocsFromCache,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  serverTimestamp,
  runTransaction
} from 'firebase/firestore';
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  GoogleAuthProvider,
  signOut as fbSignOut,
  onAuthStateChanged,
  updateProfile,
  User,
} from 'firebase/auth';
import { getDeviceId, getDeviceName } from '../utils/deviceIdentity';
import { cleanupTransientLocalStorage, estimateLocalStorageBytes } from '../utils/storage';
import { isSuperAdminEmail } from '../config/superAdmin';
import { REALTIME_COLLECTIONS } from '../config/realtimeCollections';
import { formatDateTime } from '../utils/dateFormatter';
import { CURRENT_DATA_SCHEMA_VERSION, getPendingDataSchemaMigrations, readDataSchemaVersion } from '../config/dataSchema';
import { clearRememberedVerifiedAuthIdentity } from '../utils/offlineAccess';
const env = (import.meta as any).env || {};
export const APP_ENVIRONMENT: 'DEV' | 'PROD' = String(env.VITE_APP_ENV || (env.DEV || env.MODE === 'development' ? 'DEV' : 'PROD')).toUpperCase() === 'PROD' ? 'PROD' : 'DEV';
const isDev = APP_ENVIRONMENT === 'DEV';
const PROD_FIREBASE_PROJECT_ID = 'com-example-qlct-61329';
const emulatorRequested = String(env.VITE_USE_FIREBASE_EMULATORS || 'false').toLowerCase() === 'true';

if (emulatorRequested && APP_ENVIRONMENT === 'PROD') {
  throw new Error('REFUSING: Firebase Emulator mode may only run with VITE_APP_ENV=DEV.');
}

function normalizeEmulatorHost(value: unknown): string {
  const raw = String(value || 'auto').trim();
  if (!raw || raw.toLowerCase() === 'auto') {
    if (typeof window !== 'undefined' && window.location?.hostname) return window.location.hostname;
    return '127.0.0.1';
  }
  return raw.replace(/^https?:\/\//i, '').replace(/\/$/, '').split(':')[0] || '127.0.0.1';
}

function normalizeEmulatorPort(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

export const FIREBASE_EMULATOR_ENABLED = emulatorRequested && isDev;
export const FIREBASE_EMULATOR_HOST = normalizeEmulatorHost(env.VITE_FIREBASE_EMULATOR_HOST);
export const FIREBASE_AUTH_EMULATOR_PORT = normalizeEmulatorPort(env.VITE_FIREBASE_AUTH_EMULATOR_PORT, 9099);
export const FIRESTORE_EMULATOR_PORT = normalizeEmulatorPort(env.VITE_FIRESTORE_EMULATOR_PORT, 8080);
export const FIREBASE_STORAGE_EMULATOR_PORT = normalizeEmulatorPort(env.VITE_FIREBASE_STORAGE_EMULATOR_PORT, 9199);
export const FIREBASE_EMULATOR_PROJECT_ID = String(env.VITE_FIREBASE_EMULATOR_PROJECT_ID || 'demo-hnl-qltc-dev').trim();

if (FIREBASE_EMULATOR_ENABLED) {
  if (FIREBASE_EMULATOR_PROJECT_ID === PROD_FIREBASE_PROJECT_ID) {
    throw new Error('REFUSING: Firebase Emulator projectId must never equal the production projectId.');
  }
  if (!FIREBASE_EMULATOR_PROJECT_ID.startsWith('demo-')) {
    throw new Error('REFUSING: Local Emulator projectId must use the demo-* prefix so SDK fallbacks cannot reach live Firebase resources.');
  }
}

const hostedFirebaseConfig = {
  apiKey: 'AIzaSyAShhTKSnmLMOEm4dST--1_X7fjJUE4znY',
  authDomain: 'com-example-qlct-61329.firebaseapp.com',
  projectId: 'com-example-qlct-61329',
  storageBucket: 'com-example-qlct-61329.firebasestorage.app',
  messagingSenderId: '119152410850',
  appId: '1:119152410850:web:c2aee2135428af34ef5ebb',
  firestoreDatabaseId: '(default)'
};

const emulatorFirebaseConfig = {
  apiKey: 'demo-hnl-qltc-key',
  authDomain: `${FIREBASE_EMULATOR_PROJECT_ID}.firebaseapp.com`,
  projectId: FIREBASE_EMULATOR_PROJECT_ID,
  storageBucket: `${FIREBASE_EMULATOR_PROJECT_ID}.firebasestorage.app`,
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:hnlqltcemulatordev',
  firestoreDatabaseId: '(default)'
};

// PROD preserves the existing Firebase project as its compatibility fallback.
// DEV MUST be explicit and may never silently point at production data. Missing DEV
// configuration fails closed instead of using com-example-qlct-61329.
const blankFirebaseConfig = { apiKey: '', authDomain: '', projectId: '', storageBucket: '', messagingSenderId: '', appId: '', firestoreDatabaseId: '(default)' };
const defaultFirebaseConfig = FIREBASE_EMULATOR_ENABLED
  ? emulatorFirebaseConfig
  : APP_ENVIRONMENT === 'PROD'
    ? hostedFirebaseConfig
    : blankFirebaseConfig;

const sanitizeConfigValue = (val: string | undefined, fallback: string): string => {
  if (!val) return fallback;
  const trimmed = val.trim();
  if (
    trimmed === '' || 
    trimmed.startsWith('YOUR_') || 
    trimmed.includes('<YOUR_') || 
    trimmed.includes('YOUR_FIREBASE') ||
    trimmed.includes('YOUR_GOOGLE')
  ) {
    return fallback;
  }
  return trimmed;
};

const firebaseConfig = FIREBASE_EMULATOR_ENABLED
  ? emulatorFirebaseConfig
  : {
      apiKey: sanitizeConfigValue(env.VITE_FIREBASE_API_KEY, defaultFirebaseConfig.apiKey),
      authDomain: sanitizeConfigValue(env.VITE_FIREBASE_AUTH_DOMAIN, defaultFirebaseConfig.authDomain),
      projectId: sanitizeConfigValue(env.VITE_FIREBASE_PROJECT_ID, defaultFirebaseConfig.projectId),
      storageBucket: sanitizeConfigValue(env.VITE_FIREBASE_STORAGE_BUCKET, defaultFirebaseConfig.storageBucket),
      messagingSenderId: sanitizeConfigValue(env.VITE_FIREBASE_MESSAGING_SENDER_ID, defaultFirebaseConfig.messagingSenderId),
      appId: sanitizeConfigValue(env.VITE_FIREBASE_APP_ID, defaultFirebaseConfig.appId),
      firestoreDatabaseId: env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || env.VITE_FIRESTORE_DATABASE_ID || defaultFirebaseConfig.firestoreDatabaseId
    };

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  !firebaseConfig.apiKey.includes('YOUR_') &&
  !firebaseConfig.apiKey.includes('mock') &&
  firebaseConfig.projectId &&
  !firebaseConfig.projectId.includes('mock')
);

if (!isFirebaseConfigured) {
  console.error(`⚠️ THIẾU CẤU HÌNH FIREBASE ${APP_ENVIRONMENT}. DEV không bao giờ fallback sang Firebase PROD; hãy khai báo đúng VITE_FIREBASE_* trước khi test.`);
}

if (!isDev && !firebaseConfig.appId) {
  console.warn('⚠️ Firebase Web App ID (VITE_FIREBASE_APP_ID) đang trống. Auth/Firestore hiện có thể vẫn chạy, nhưng nên cấu hình App ID thật của đúng Web App trong Firebase Console.');
}

export const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];
const app = firebaseApp;
const dbId = firebaseConfig.firestoreDatabaseId;

// V6.2.9: Firestore multi-tab persistence uses localStorage coordination keys such as
// `firestore_mutations_*`. When the origin localStorage is close to its browser quota,
// Firestore 12.x can throw an INTERNAL ASSERTION FAILED / QuotaExceededError before the
// app has a chance to recover. Multi-device sync does NOT require multi-tab persistence.
// Use the default single-tab persistent IndexedDB cache instead, which keeps offline data
// but avoids the WebStorage mutation-coordination path that caused the crash in the video.
try {
  const localBytes = estimateLocalStorageBytes();
  if (localBytes > 3 * 1024 * 1024) {
    const cleaned = cleanupTransientLocalStorage();
    if (cleaned.removed > 0) {
      console.warn('[Storage pressure] Cleared transient cache before Firestore init:', cleaned);
    }
  }
} catch (_) {}

// V6.3.0 Firebase-only migration: Firestore's official persistent IndexedDB cache
// becomes the runtime offline database. The custom localforage business arrays remain
// read-only migration compatibility until Golden verification proves they can be
// removed. Using persistentLocalCache() avoids creating a second authoritative DB.
try {
  const cleaned = cleanupTransientLocalStorage();
  const remaining = estimateLocalStorageBytes();
  if (cleaned.removed > 0 || remaining > 2 * 1024 * 1024) {
    console.info('[Firestore storage preflight]', { ...cleaned, remainingBytesApprox: remaining });
  }
} catch (_) {}

let dbInstance: any;
try {
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache(),
    experimentalAutoDetectLongPolling: true,
  }, dbId);
} catch (e) {
  // A browser that cannot open IndexedDB must still start. This fallback is deliberately
  // memory-only and is surfaced in diagnostics; it must not silently re-enable the
  // custom business database as a second source of truth.
  console.warn('Firestore persistent cache initialization warning; falling back to memory cache:', e);
  dbInstance = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
  }, dbId);
}

export const db = dbInstance;

if (FIREBASE_EMULATOR_ENABLED) {
  connectFirestoreEmulator(db, FIREBASE_EMULATOR_HOST, FIRESTORE_EMULATOR_PORT);
  console.info('[Firebase DEV Emulator] Firestore connected', {
    host: FIREBASE_EMULATOR_HOST,
    port: FIRESTORE_EMULATOR_PORT,
    projectId: FIREBASE_EMULATOR_PROJECT_ID,
  });
}

export const auth = getAuth(app);

if (FIREBASE_EMULATOR_ENABLED) {
  const authHostForUrl = FIREBASE_EMULATOR_HOST.includes(':')
    ? `[${FIREBASE_EMULATOR_HOST}]`
    : FIREBASE_EMULATOR_HOST;
  connectAuthEmulator(auth, `http://${authHostForUrl}:${FIREBASE_AUTH_EMULATOR_PORT}`, { disableWarnings: true });
  console.info('[Firebase DEV Emulator] Auth connected', {
    host: FIREBASE_EMULATOR_HOST,
    port: FIREBASE_AUTH_EMULATOR_PORT,
  });
}

const authListeners: Array<(user: User | null) => void> = [];

function normalizeEmail(email?: string | null): string {
  return (email || '').trim().toLowerCase();
}

function getCurrentAppUser(): User | null {
  return auth.currentUser;
}


function getMemberDocIdsForUser(user: { uid?: string | null; email?: string | null }): string[] {
  // Canonical email MUST be checked first. A UID document is legacy compatibility only
  // and may never override an existing email role (including an inactive/revoked email row).
  const ids = new Set<string>();
  const email = normalizeEmail(user.email);
  if (email) ids.add(email);
  if (user.uid) ids.add(user.uid);
  return Array.from(ids);
}

export interface CloudProjectSummary {
  id: string;
  name: string;
  role?: string;
  createdAt?: number;
  updatedAt?: number;
  createdAtSource?: 'cloud' | 'migrating';
  /**
   * When this project has been safely merged into another Cloud project, this
   * points to the canonical projectId. The source project is kept as an archive.
   */
  canonicalProjectId?: string;
  /**
   * Project IDs that were merged into this canonical project and are hidden from
   * the normal project/chat list for the current account.
   */
  aliases?: string[];
}

function projectAccessDocId(projectId: string, email: string): string {
  return `${projectId}__${encodeURIComponent(normalizeEmail(email))}`;
}

/**
 * Local project IDs are discovery *candidates only*. They NEVER grant access.
 * This is important for legacy projects such as the original `default` project:
 * old builds may still have a valid projects/{id}/members/{email} document while
 * users/{uid}.projects / projectAccess were never created. We probe the candidate
 * against Firestore Rules; permission-denied means it is silently discarded.
 */
function readLocalProjectDiscoveryCandidates(): Record<string, { id: string; name?: string; updatedAt?: number }> {
  const result: Record<string, { id: string; name?: string; updatedAt?: number }> = {};
  if (typeof window === 'undefined') return result;
  try {
    const raw = localStorage.getItem('construction_projects_list');
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        list.forEach((item: any) => {
          const id = String(item?.id || '').trim();
          if (!id) return;
          result[id] = { id, name: String(item?.name || id), updatedAt: Number(item?.updatedAt || 0) };
        });
      }
    }
  } catch (_) {}
  const activeId = String(sessionStorage.getItem('active_project_id') || localStorage.getItem('active_project_id') || '').trim();
  if (activeId && !result[activeId]) {
    const legacyNameKey = activeId === 'default' ? 'construction_project_name' : `construction_project_name_${activeId}`;
    result[activeId] = { id: activeId, name: localStorage.getItem(legacyNameKey) || activeId, updatedAt: 0 };
  }
  // `default` is the historical project ID used by the first releases (for example
  // Mizuki). It may be missing from every modern discovery index even on a fresh
  // device. Probing this single well-known ID is safe because Firestore Rules still
  // decide whether the signed-in account may read it.
  if (!result.default) {
    result.default = { id: 'default', name: localStorage.getItem('construction_project_name') || 'default', updatedAt: 0 };
  }
  return result;
}

async function writeProjectAccessIndex(
  projectId: string,
  email: string,
  role: string,
  projectName = '',
  active = true
): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  if (!projectId || !normalizedEmail) return;
  await setDoc(doc(db, 'projectAccess', projectAccessDocId(projectId, normalizedEmail)), {
    projectId,
    email: normalizedEmail,
    role: String(role || 'VIEWER').toUpperCase(),
    projectName: projectName || projectId,
    active,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// Compatibility discovery row supported by the already-deployed V6.2.1 Rules.
// Keep this invitation until the invited account has written users/{uid}.projects.
// projectAccess is a newer optimization only; failure to write it must NEVER prevent
// VIEWER/EDITOR discovery on projects that were assigned while older Rules are live.
async function ensureProjectInvitationIndex(
  projectId: string,
  email: string,
  role: string,
  projectName = ''
): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  if (!projectId || !normalizedEmail) return;
  const currentUser = getCurrentRealFirebaseUser();
  const invId = `${projectId}_${normalizedEmail}`;
  await setDoc(doc(db, 'projectInvitations', invId), {
    projectId,
    projectName: projectName || projectId,
    email: normalizedEmail,
    invitedEmail: normalizedEmail,
    role: String(role || 'VIEWER').toUpperCase(),
    createdByUid: currentUser?.uid || null,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function repairProjectAccessIndexForProject(projectId: string, force = false): Promise<void> {
  if (!projectId || projectAccessRepairInFlight.has(projectId)) return;
  if (!force && projectAccessRepairCompleted.has(projectId)) return;
  projectAccessRepairInFlight.add(projectId);
  try {
    const user = getCurrentRealFirebaseUser();
    if (!user) return;
    const roleInfo = await fetchProjectUserRoleFromCloud(projectId, user);
    if (!roleInfo.allowed || roleInfo.role !== 'ADMIN') return;

    const projectSnap = await getDoc(doc(db, 'projects', projectId));
    const projectName = projectSnap.exists() ? String(projectSnap.data()?.name || projectId) : projectId;
    const members: Array<{ email: string; role: string }> = (await fetchProjectMembersFromCloud(projectId))
      .filter((member) => member?.email && member?.active !== false)
      .map((member) => ({
        email: normalizeEmail(member.email),
        role: String(member?.role || 'VIEWER').toUpperCase(),
      }));

    // Do not run the compatibility invitation and the newer projectAccess write in one
    // Promise.all. On projects still using older production Rules, projectAccess is
    // expected to fail. We want a deterministic guarantee that every active member gets
    // the backward-compatible invitation first.
    let invitationFailures = 0;
    for (const member of members) {
      try {
        await ensureProjectInvitationIndex(projectId, member.email, member.role, projectName);
      } catch (err) {
        invitationFailures++;
        console.warn(`Project invitation repair warning (${member.email}):`, err);
        continue;
      }
      await writeProjectAccessIndex(projectId, member.email, member.role, projectName, true).catch((err) => {
        // projectAccess is an optional newer index while older production Rules may
        // reject it. Invitation compatibility above is the required discovery path.
        console.warn(`projectAccess optional repair warning (${member.email}):`, err);
      });
    }
    // Only mark the project repaired for this page-session when every required
    // compatibility invitation succeeded. A temporary network/rules failure must be
    // allowed to retry on a later owner snapshot instead of being suppressed forever.
    if (invitationFailures === 0) projectAccessRepairCompleted.add(projectId);
  } finally {
    projectAccessRepairInFlight.delete(projectId);
  }
}

function cloudTimestampToMillis(value: any): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value?.toMillis === 'function') {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : 0;
  }
  if (typeof value?.seconds === 'number') {
    return Math.round(value.seconds * 1000 + Number(value.nanoseconds || 0) / 1_000_000);
  }
  return 0;
}

const projectMigrationInFlight = new Set<string>();
const projectAccessRepairInFlight = new Set<string>();
const projectAccessRepairCompleted = new Set<string>();
const userProjectIndexSignatureCache = new Map<string, string>();
const discoveryProjectCache = new Map<string, { at: number; summary: CloudProjectSummary | null }>();
const projectRootMetadataTouchAt = new Map<string, number>();

/**
 * Centralized, idempotent project-root migration runner.
 *
 * - Never changes projectId, name, ownerUid or ownerEmail.
 * - Adds legacy createdAt only once using Firestore server time.
 * - Advances dataSchemaVersion only forward to CURRENT_DATA_SCHEMA_VERSION.
 * - EDITOR/VIEWER may be denied by Rules; a later ADMIN/SUPER ADMIN open retries it.
 *
 * Business screens must not add new ad-hoc legacy project-root migrations. Add future
 * versions to dataSchema.ts and implement their non-destructive root migration here.
 */
export async function ensureProjectMigrationsInCloud(projectId: string): Promise<void> {
  if (!projectId || projectMigrationInFlight.has(projectId)) return;
  const user = getCurrentRealFirebaseUser();
  if (!user || !user.email) return;

  projectMigrationInFlight.add(projectId);
  try {
    const ref = doc(db, 'projects', projectId);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) return;
      const data = snap.data();
      const currentDataSchema = readDataSchemaVersion(data?.dataSchemaVersion);
      const pending = getPendingDataSchemaMigrations(currentDataSchema);
      const needsCreatedAt = !data?.createdAt;
      if (!needsCreatedAt && pending.length === 0) return;

      const patch: Record<string, any> = {};
      if (needsCreatedAt) {
        patch.createdAt = serverTimestamp();
        patch.createdAtMigrated = true;
        patch.createdAtMigrationVersion = 1;
        patch.createdAtMigrationAt = serverTimestamp();
      }
      if (pending.length > 0) {
        patch.dataSchemaVersion = CURRENT_DATA_SCHEMA_VERSION;
        patch.dataSchemaMigratedFrom = currentDataSchema;
        patch.dataSchemaMigrationAt = serverTimestamp();
        patch.dataSchemaMigrationNames = pending.map((step) => step.name);
      }
      transaction.update(ref, patch);
    });
  } catch (err) {
    // Permission errors are expected for non-admin roles. The migration stays pending
    // and is retried later; no local value is promoted as authoritative Cloud metadata.
    console.warn(`[Project migration] ${projectId}:`, err);
  } finally {
    projectMigrationInFlight.delete(projectId);
  }
}

/** Backward-compatible alias retained for older callers/tests. */
export async function ensureProjectCreatedAtInCloud(projectId: string): Promise<void> {
  return ensureProjectMigrationsInCloud(projectId);
}

function getUserProjectIndexSignature(projectId: string, projectName: string, role: string): string {
  return `${projectId}|${String(projectName || projectId).trim()}|${String(role || 'VIEWER').toUpperCase()}`;
}

function primeUserProjectIndexCache(uid: string, projects: Record<string, any>): void {
  if (!uid || !projects || typeof projects !== 'object') return;
  Object.entries(projects).forEach(([projectId, item]: [string, any]) => {
    if (!projectId || !item) return;
    userProjectIndexSignatureCache.set(
      `${uid}:${projectId}`,
      getUserProjectIndexSignature(projectId, String(item?.name || projectId), String(item?.role || 'VIEWER'))
    );
  });
}

async function registerProjectForCurrentUser(projectId: string, projectName: string, role = 'ADMIN'): Promise<void> {
  const user = getCurrentAppUser();
  if (!user || !user.uid || (user as any).isAnonymous || !projectId) return;

  const normalizedEmail = normalizeEmail(user.email);
  const normalizedRole = String(role || 'VIEWER').toUpperCase();
  const normalizedName = String(projectName || projectId).trim() || projectId;
  const cacheKey = `${user.uid}:${projectId}`;
  const signature = getUserProjectIndexSignature(projectId, normalizedName, normalizedRole);

  // Idempotent guard: discovery listeners can fire several times for the same project.
  // Do not rewrite users/{uid} merely to change Date.now(), otherwise that write itself
  // retriggers the users/{uid} listener and creates a read/write feedback loop.
  if (userProjectIndexSignatureCache.get(cacheKey) === signature) {
    console.debug('[user index write]', projectId, 'skipped');
    return;
  }

  const now = Date.now();
  await setDoc(doc(db, 'users', user.uid), {
    uid: user.uid,
    email: normalizedEmail,
    projects: {
      [projectId]: {
        id: projectId,
        name: normalizedName,
        role: normalizedRole,
        updatedAt: now,
      }
    },
    updatedAt: now,
  }, { merge: true });
  userProjectIndexSignatureCache.set(cacheKey, signature);
  console.debug('[user index write]', projectId, 'written');
}

export async function fetchCurrentUserProjectsFromCloud(): Promise<CloudProjectSummary[]> {
  try {
    await ensureAuth();
    const user = getCurrentAppUser();
    if (!user || !user.uid || (user as any).isAnonymous) return [];

    if (isSuperAdminEmail(user.email)) {
      const snap = await getDocs(collection(db, 'projects'));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as any))
        .filter((item: any) => item && item.id && item.deleted !== true)
        .map((item: any) => ({
          id: String(item.id),
          name: String(item.name || item.id),
          role: 'ADMIN',
          createdAt: cloudTimestampToMillis(item.createdAt),
          createdAtSource: cloudTimestampToMillis(item.createdAt) ? 'cloud' as const : 'migrating' as const,
          updatedAt: cloudTimestampToMillis(item.updatedAt),
          canonicalProjectId: String(item.canonicalProjectId || item.mergedIntoProjectId || '').trim() || undefined,
        }))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }

    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) return [];

    const data = snap.data();
    const projects = data?.projects;
    if (!projects || typeof projects !== 'object') return [];

    return Object.values(projects)
      .filter((item: any) => item && item.id)
      .map((item: any) => ({
        id: String(item.id),
        name: String(item.name || item.id),
        role: item.role,
        updatedAt: Number(item.updatedAt || 0),
      }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch (err) {
    console.warn('fetchCurrentUserProjectsFromCloud warning:', err);
    return [];
  }
}


/**
 * Proactively materialize the signed-in user's project index from pending invitations.
 *
 * Why this exists:
 * - Invitation listeners are realtime, but a modal can be opened before Firebase Auth has
 *   finished restoring the Google session.
 * - Older builds may have a valid projectInvitations row while users/{uid}.projects is empty.
 * - Production can temporarily run older Firestore Rules, so projectInvitations remains the
 *   compatibility discovery path.
 *
 * This function never grants access from the invitation alone: it verifies the actual
 * project/member permission first, then writes only the signed-in user's own users/{uid}
 * index (which existing Rules allow).
 */
export async function refreshCurrentUserProjectDiscovery(): Promise<number> {
  const user = getCurrentRealFirebaseUser();
  if (!user?.uid || !user.email) return 0;
  const email = normalizeEmail(user.email);
  // SUPER ADMIN discovers projects directly from the projects collection; invitation
  // materialization is unnecessary and would create a redundant per-user index for every project.
  if (isSuperAdminEmail(email)) return 0;
  const invitationQueries = [
    query(collection(db, 'projectInvitations'), where('invitedEmail', '==', email)),
    query(collection(db, 'projectInvitations'), where('email', '==', email)),
  ];
  const handled = new Set<string>();
  let repaired = 0;

  for (const invQuery of invitationQueries) {
    const invSnap = await getDocs(invQuery).catch((err) => {
      console.warn('Project discovery refresh invitation query warning:', err);
      return null;
    });
    if (!invSnap) continue;

    for (const invDoc of invSnap.docs) {
      if (handled.has(invDoc.id)) continue;
      handled.add(invDoc.id);
      const data = invDoc.data();
      const inviteEmail = normalizeEmail(data?.invitedEmail || data?.email);
      const projectId = String(data?.projectId || '').trim();
      if (!projectId || inviteEmail !== email) continue;

      const roleInfo = await fetchProjectUserRoleFromCloud(projectId, user).catch(() => ({
        allowed: false,
        role: 'VIEWER' as const,
        isCloudSynced: false,
      }));
      if (!roleInfo.allowed) continue;

      let projectName = String(data?.projectName || data?.name || projectId);
      try {
        const projectSnap = await getDocFromServer(doc(db, 'projects', projectId));
        if (projectSnap.exists() && !projectSnap.data()?.deleted) {
          projectName = String(projectSnap.data()?.name || projectName);
        }
      } catch (_) {
        // Permission was already proven above. Cached/offline name from the invitation is fine.
      }

      await registerProjectForCurrentUser(projectId, projectName, roleInfo.role).catch((err) => {
        console.warn('Project discovery refresh user-index warning:', err);
      });
      repaired += 1;
    }
  }
  return repaired;
}

export function subscribeCurrentUserProjectsRealtime(onUpdate: (projects: CloudProjectSummary[]) => void): () => void {
  const user = getCurrentRealFirebaseUser();
  if (!user || !user.uid || !user.email) { onUpdate([]); return () => {}; }
  const email = normalizeEmail(user.email);
  let userProjects: Record<string, any> = {};
  let invitationProjects: Record<string, any> = {};
  let legacyInvitationProjects: Record<string, any> = {};
  let accessProjects: Record<string, any> = {};
  let ownerUidProjects: Record<string, any> = {};
  let ownerEmailProjects: Record<string, any> = {};
  let localCandidateProjects: Record<string, any> = readLocalProjectDiscoveryCandidates();
  let cancelled = false;
  let refreshSeq = 0;
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingSources = new Set<string>();
  const cacheKeyFor = (projectId: string) => `${user.uid}:${projectId}`;
  const invalidateProject = (projectId: string) => discoveryProjectCache.delete(cacheKeyFor(projectId));

  const collapseCanonicalProjects = (result: CloudProjectSummary[]): CloudProjectSummary[] => {
    const byId = new Map(result.map((project) => [project.id, project]));
    const aliasesByTarget = new Map<string, string[]>();
    const resolveCanonical = (project: CloudProjectSummary): string | null => {
      let targetId = project.canonicalProjectId;
      const seen = new Set<string>([project.id]);
      while (targetId && !seen.has(targetId)) {
        const target = byId.get(targetId);
        if (!target) return null;
        seen.add(targetId);
        if (!target.canonicalProjectId || target.canonicalProjectId === target.id) return target.id;
        targetId = target.canonicalProjectId;
      }
      return targetId && byId.has(targetId) ? targetId : null;
    };
    result.forEach((project) => {
      const targetId = resolveCanonical(project);
      if (!targetId || targetId === project.id) return;
      aliasesByTarget.set(targetId, [...(aliasesByTarget.get(targetId) || []), project.id]);
    });
    return result
      .filter((project) => {
        const targetId = resolveCanonical(project);
        return !targetId || targetId === project.id;
      })
      .map((project) => ({ ...project, aliases: aliasesByTarget.get(project.id) || project.aliases }))
      .sort((a,b) => Number(b.updatedAt||0)-Number(a.updatedAt||0));
  };

  if (isSuperAdminEmail(email)) {
    // SUPER ADMIN gets one realtime collection listener instead of N owner/member/index
    // listeners plus N follow-up project reads. This keeps global project discovery fast
    // even when the company has many projects.
    const allProjectsQuery = collection(db, 'projects');
    const unsubscribe = onSnapshot(allProjectsQuery, (snap) => {
      const result: CloudProjectSummary[] = snap.docs
        .map((d) => {
          const data = d.data();
          const createdAt = cloudTimestampToMillis(data?.createdAt);
          const canonicalRaw = String(data?.canonicalProjectId || data?.mergedIntoProjectId || '').trim();
          return {
            id: d.id,
            name: String(data?.name || d.id),
            role: 'ADMIN',
            createdAt,
            createdAtSource: createdAt ? 'cloud' as const : 'migrating' as const,
            updatedAt: cloudTimestampToMillis(data?.updatedAt),
            canonicalProjectId: canonicalRaw && canonicalRaw !== d.id ? canonicalRaw : undefined,
            __deleted: data?.deleted === true,
          } as CloudProjectSummary & { __deleted?: boolean };
        })
        .filter((project) => !(project as any).__deleted)
        .map(({ __deleted, ...project }: any) => project);
      onUpdate(collapseCanonicalProjects(result));
    }, (err) => {
      console.warn('SUPER ADMIN all-projects realtime error:', err);
      // If production Rules have not been deployed yet, fail closed instead of showing
      // projects from stale local cache as if global access were active.
      onUpdate([]);
    });
    return unsubscribe;
  }

  const emit = async (source: string) => {
    const startedAt = Date.now();
    const seq = ++refreshSeq;
    const ids = new Set<string>([
      ...Object.keys(userProjects),
      ...Object.keys(invitationProjects),
      ...Object.keys(legacyInvitationProjects),
      ...Object.keys(accessProjects),
      ...Object.keys(ownerUidProjects),
      ...Object.keys(ownerEmailProjects),
      ...Object.keys(localCandidateProjects),
    ]);
    const result: CloudProjectSummary[] = [];

    for (const id of ids) {
      if (cancelled || seq !== refreshSeq) return;
      const durableHint = userProjects[id] || accessProjects[id] || invitationProjects[id] || legacyInvitationProjects[id] || ownerUidProjects[id] || ownerEmailProjects[id];
      const localHint = localCandidateProjects[id];
      const hint = durableHint || localHint || {};
      const isLocalProbeOnly = Boolean(localHint && !durableHint);
      const cacheKey = cacheKeyFor(id);
      const cached = discoveryProjectCache.get(cacheKey);
      const cacheFresh = Boolean(!isLocalProbeOnly && cached && (Date.now() - cached.at) < 8000);
      if (cacheFresh) {
        if (cached!.summary) result.push({ ...cached!.summary, role: String(hint.role || cached!.summary.role || '').toUpperCase() || cached!.summary.role });
        continue;
      }

      try {
        const projectRef = doc(db, 'projects', id);
        let snap;
        if (isLocalProbeOnly) {
          snap = await getDocFromServer(projectRef);
        } else {
          try { snap = await getDocFromServer(projectRef); }
          catch (_) { snap = await getDoc(projectRef); }
        }
        if (cancelled || seq !== refreshSeq) return;
        if (!snap.exists() || snap.data()?.deleted) {
          discoveryProjectCache.set(cacheKey, { at: Date.now(), summary: null });
          continue;
        }
        const data = snap.data();
        const createdAt = cloudTimestampToMillis(data?.createdAt);
        const updatedAt = cloudTimestampToMillis(data?.updatedAt) || Number(hint.updatedAt || 0);

        let effectiveRole = String(hint.role || '').toUpperCase();
        if (isLocalProbeOnly || !effectiveRole) {
          const roleInfo = await fetchProjectUserRoleFromCloud(id, user).catch(() => ({ allowed: false, role: 'VIEWER' as const }));
          if (cancelled || seq !== refreshSeq) return;
          if (!roleInfo.allowed) continue;
          effectiveRole = String(roleInfo.role || 'VIEWER').toUpperCase();
          registerProjectForCurrentUser(id, String(data?.name || hint.name || id), effectiveRole).catch(() => {});
        }
        if ((invitationProjects[id] || legacyInvitationProjects[id]) && effectiveRole) {
          registerProjectForCurrentUser(id, String(data?.name || hint.name || id), effectiveRole).catch(() => {});
        }
        if (!createdAt && (effectiveRole === 'ADMIN' || data?.ownerUid === user.uid || normalizeEmail(data?.ownerEmail) === email)) {
          ensureProjectMigrationsInCloud(id).catch(() => {});
        }
        const canonicalProjectIdRaw = String(data?.canonicalProjectId || data?.mergedIntoProjectId || '').trim();
        const canonicalProjectId = canonicalProjectIdRaw && canonicalProjectIdRaw !== id ? canonicalProjectIdRaw : undefined;
        const summary: CloudProjectSummary = {
          id,
          name: String(data?.name || hint.name || id),
          role: effectiveRole || hint.role,
          createdAt,
          createdAtSource: createdAt ? 'cloud' : 'migrating',
          updatedAt,
          canonicalProjectId,
        };
        discoveryProjectCache.set(cacheKey, { at: Date.now(), summary });
        result.push(summary);
      } catch (err: any) {
        if (cancelled || seq !== refreshSeq) return;
        const code = String(err?.code || '');
        if (code.includes('permission-denied') || isLocalProbeOnly) {
          discoveryProjectCache.delete(cacheKey);
          continue;
        }
        const fallback: CloudProjectSummary = {
          id,
          name: String(hint.name || id),
          role: hint.role,
          createdAt: 0,
          createdAtSource: 'migrating',
          updatedAt: Number(hint.updatedAt || 0),
        };
        result.push(fallback);
      }
    }

    if (!cancelled && seq === refreshSeq) {
      const collapsed = collapseCanonicalProjects(result);
      console.debug('[discovery emit]', source, 'ids=', ids.size, 'result=', collapsed.length, 'duration=', Date.now() - startedAt);
      onUpdate(collapsed);
    }
  };

  const scheduleEmit = (source: string) => {
    if (cancelled) return;
    pendingSources.add(source);
    // Invalidate any in-flight emit immediately. It will stop at the next await/loop
    // boundary instead of continuing to probe every project after a newer snapshot.
    refreshSeq++;
    if (emitTimer) clearTimeout(emitTimer);
    emitTimer = setTimeout(() => {
      emitTimer = null;
      const sources = Array.from(pendingSources).join(',');
      pendingSources.clear();
      void emit(sources || source);
    }, 160);
  };

  const applyQueryChanges = (
    snap: any,
    target: Record<string, any>,
    kind: 'invitation' | 'access' | 'owner',
    ownerRole = 'ADMIN'
  ) => {
    for (const change of snap.docChanges()) {
      const d = change.doc;
      const x = d.data();
      const projectId = kind === 'owner' ? d.id : String(x?.projectId || '');
      if (!projectId) continue;
      invalidateProject(projectId);
      if (change.type === 'removed' || x?.deleted || x?.active === false) {
        delete target[projectId];
        continue;
      }
      const name = String(x?.projectName || x?.name || projectId);
      const role = kind === 'owner' ? ownerRole : String(x?.role || 'VIEWER').toUpperCase();
      target[projectId] = {
        id: projectId,
        name,
        role,
        updatedAt: cloudTimestampToMillis(x?.updatedAt || x?.createdAt),
      };
      if (kind === 'access') registerProjectForCurrentUser(projectId, name, role).catch(() => {});
      if (kind === 'owner') {
        registerProjectForCurrentUser(projectId, name, 'ADMIN').catch(() => {});
        // completed-set makes this effectively once/session after success. If a required
        // invitation repair failed earlier (network/rules), a later owner doc change may
        // retry instead of leaving the project unrepaired for the whole session.
        repairProjectAccessIndexForProject(projectId).catch(() => {});
      }
    }
  };

  const unsubs: Array<() => void> = [];
  unsubs.push(onSnapshot(doc(db, 'users', user.uid), (snap) => {
    const data = snap.exists() ? snap.data() : {};
    const nextProjects = data?.projects && typeof data.projects === 'object' ? data.projects : {};
    const allIds = new Set([...Object.keys(userProjects), ...Object.keys(nextProjects)]);
    for (const id of allIds) {
      const a = userProjects[id];
      const b = nextProjects[id];
      if (JSON.stringify([a?.name, a?.role]) !== JSON.stringify([b?.name, b?.role])) invalidateProject(id);
    }
    userProjects = nextProjects;
    primeUserProjectIndexCache(user.uid, userProjects);
    scheduleEmit('user-index');
  }, (err) => console.warn('User project index realtime error:', err)));

  const invitationQ = query(collection(db, 'projectInvitations'), where('invitedEmail', '==', email));
  unsubs.push(onSnapshot(invitationQ, (snap) => {
    applyQueryChanges(snap, invitationProjects, 'invitation');
    scheduleEmit('invitation');
  }, (err) => console.warn('Project invitations realtime error:', err)));

  const legacyInvitationQ = query(collection(db, 'projectInvitations'), where('email', '==', email));
  unsubs.push(onSnapshot(legacyInvitationQ, (snap) => {
    applyQueryChanges(snap, legacyInvitationProjects, 'invitation');
    scheduleEmit('legacy-invitation');
  }, (err) => console.warn('Legacy project invitations realtime error:', err)));

  const accessQ = query(collection(db, 'projectAccess'), where('email', '==', email));
  unsubs.push(onSnapshot(accessQ, (snap) => {
    applyQueryChanges(snap, accessProjects, 'access');
    scheduleEmit('project-access');
  }, (err) => console.warn('Project access index realtime error:', err)));

  const ownerUidQ = query(collection(db, 'projects'), where('ownerUid', '==', user.uid));
  unsubs.push(onSnapshot(ownerUidQ, (snap) => {
    console.debug('[owner query] uid changes=', snap.docChanges().length);
    applyQueryChanges(snap, ownerUidProjects, 'owner');
    scheduleEmit('owner-uid');
  }, (err) => console.warn('Owner UID projects realtime recovery warning:', err)));

  const ownerEmailQ = query(collection(db, 'projects'), where('ownerEmail', '==', email));
  unsubs.push(onSnapshot(ownerEmailQ, (snap) => {
    console.debug('[owner query] email changes=', snap.docChanges().length);
    applyQueryChanges(snap, ownerEmailProjects, 'owner');
    scheduleEmit('owner-email');
  }, (err) => console.warn('Owner email projects realtime recovery warning:', err)));

  return () => {
    cancelled = true;
    refreshSeq++;
    if (emitTimer) clearTimeout(emitTimer);
    unsubs.forEach((u) => u());
  };
}

async function writeProjectMemberDocs(
  projectId: string,
  member: { uid?: string | null; email: string; role: string; active?: boolean; assignedAt?: number; displayName?: string }
): Promise<void> {
  const normalizedEmail = normalizeEmail(member.email);
  if (!projectId || !normalizedEmail) return;

  const payload = {
    ...(member.uid ? { uid: member.uid } : {}),
    ...(member.displayName ? { displayName: member.displayName } : {}),
    email: normalizedEmail,
    role: member.role,
    active: member.active !== false,
    assignedAt: member.assignedAt || Date.now(),
    updatedAt: Date.now()
  };

  const currentUser = getCurrentRealFirebaseUser();
  const isSelfMaterialization = Boolean(
    member.uid
    && currentUser?.uid === member.uid
    && normalizeEmail(currentUser?.email) === normalizedEmail
  );

  // An invited VIEWER/EDITOR is allowed by Firestore Rules to materialize only
  // their UID document from the already-authorized email document. Do not make them
  // rewrite the email document first, because that write is ADMIN-only.
  const ids = isSelfMaterialization
    ? new Set<string>([String(member.uid)])
    : new Set<string>([normalizedEmail, ...(member.uid ? [member.uid] : [])]);
  for (const id of ids) {
    await setDoc(doc(db, 'projects', projectId, 'members', id), payload, { merge: true });
  }
}

function notifyAuthListeners(user: User | null) {
  authListeners.forEach(cb => {
    try { cb(user); } catch (_) {}
  });
}

export async function ensureAuth(): Promise<void> {
  // Firestore sync is identity-bound. Never fabricate an offline user or anonymous identity.
  // Firestore's persistent cache remains available while signed out/offline, but Cloud writes wait for real Google Auth.
  return;
}

export type EmulatorTestAccountKind = 'ADMIN' | 'EDITOR' | 'VIEWER';

const emulatorTestAccounts: Record<EmulatorTestAccountKind, { email: string; password: string; displayName: string }> = {
  ADMIN: { email: 'admin@hnl.test', password: 'HNL-Emulator-123!', displayName: 'DEV Admin' },
  EDITOR: { email: 'editor@hnl.test', password: 'HNL-Emulator-123!', displayName: 'DEV Editor' },
  VIEWER: { email: 'viewer@hnl.test', password: 'HNL-Emulator-123!', displayName: 'DEV Viewer' },
};

/** DEV Emulator-only deterministic accounts. Never enabled against live Firebase. */
export async function signInWithEmulatorTestAccount(kind: EmulatorTestAccountKind): Promise<User> {
  if (!FIREBASE_EMULATOR_ENABLED || APP_ENVIRONMENT !== 'DEV') {
    throw new Error('DEV Emulator test accounts are disabled outside Firebase Emulator mode.');
  }
  const account = emulatorTestAccounts[kind];
  if (!account) throw new Error(`Unknown DEV Emulator test account: ${kind}`);

  await fbSignOut(auth).catch(() => {});
  let user: User;
  try {
    user = (await signInWithEmailAndPassword(auth, account.email, account.password)).user;
  } catch (err: any) {
    const code = String(err?.code || '');
    if (code !== 'auth/user-not-found' && code !== 'auth/invalid-credential') throw err;
    user = (await createUserWithEmailAndPassword(auth, account.email, account.password)).user;
  }
  if (user.displayName !== account.displayName) {
    await updateProfile(user, { displayName: account.displayName }).catch(() => {});
  }
  await saveUserProfileToCloud(user).catch((profileErr) => {
    console.warn('[Firebase DEV Emulator] Could not save test profile:', profileErr);
  });
  notifyAuthListeners(user);
  return user;
}

export async function signInWithGoogle(): Promise<User | null> {
  // Mobile browsers are less reliable with Firebase popup auth: the popup can open
  // and return focus without settling the original promise. Redirect is the stable
  // mobile path; desktop keeps popup for faster sign-in without page navigation.
  if (isFirebaseConfigured) {
    try {
      const provider = new GoogleAuthProvider();
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      const mobileLike = typeof navigator !== 'undefined' && (
        Boolean((navigator as any).userAgentData?.mobile) ||
        /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
      );
      if (mobileLike) {
        await signInWithRedirect(auth, provider);
        return null;
      }
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      await saveUserProfileToCloud(result.user).catch((profileErr) => {
        console.warn('Could not save Google profile after sign-in:', profileErr);
      });
      notifyAuthListeners(result.user);
      return result.user;
    } catch (err: any) {
      const code = err?.code || '';
      const msg = err?.message || '';
      // If error is invalid API key or configuration error, fall back to local mock authentication
      if (code.includes('api-key') || code.includes('invalid-api-key') || msg.includes('api-key-not-valid') || code.includes('configuration-not-found')) {
        console.warn('Firebase API Key is not valid or project is not configured in Google Cloud. Falling back to local offline user authentication:', err);
      } else {
        console.error('Google Sign-In Error:', err);
        throw err;
      }
    }
  }

  // Never impersonate a Google identity locally. Offline mode may use cached project data,
  // but Cloud permissions/sync resume only after a real Firebase Google login succeeds.
  throw new Error('Không thể đăng nhập Google/Firebase. Hãy kiểm tra cấu hình Firebase hoặc kết nối mạng.');
}

export async function signOutGoogle(): Promise<void> {
  try {
    if (isFirebaseConfigured) {
      await fbSignOut(auth).catch(() => {});
    }
  } catch (err: any) {
    console.warn('Google Sign-Out Error:', err);
  } finally {
    // Explicit sign-out revokes the local offline identity lease. Cached project-role
    // records may stay for future signed-in recovery, but they cannot be used without
    // a matching remembered/real Firebase identity.
    clearRememberedVerifiedAuthIdentity();
    notifyAuthListeners(null);
  }
}

function toFirebaseAuthStatus(user: User | null) {
  return {
    authenticated: Boolean(user && !user.isAnonymous && user.email),
    email: user?.email || undefined,
    name: user?.displayName || undefined,
    picture: user?.photoURL || undefined,
  };
}

export function getFirebaseAuthStatus() {
  return toFirebaseAuthStatus(getCurrentFirebaseUser());
}

export function subscribeToFirebaseAuthStatus(callback: (status: { authenticated: boolean; email?: string; name?: string; picture?: string }) => void) {
  return onAuthUserChanged((user) => callback(toFirebaseAuthStatus(user)));
}

export const signInWithGoogleAccount = signInWithGoogle;
export const signOutFirebaseAccount = signOutGoogle;

export function getCurrentFirebaseUser(): User | null {
  return getCurrentAppUser();
}

export function getCurrentRealFirebaseUser(): User | null {
  const user = auth.currentUser;
  if (!user || user.isAnonymous || !user.email) return null;
  if (FIREBASE_EMULATOR_ENABLED && APP_ENVIRONMENT === 'DEV') return user;
  const hasGoogleProvider = user.providerData?.some((provider) => provider.providerId === 'google.com');
  return hasGoogleProvider ? user : null;
}

export function onAuthUserChanged(callback: (user: User | null) => void): () => void {
  authListeners.push(callback);
  
  // Initial callback with current user
  const initial = getCurrentFirebaseUser();
  try {
    callback(initial);
  } catch (_) {}

  const fbUnsub = onAuthStateChanged(auth, (user) => {
    callback(user);
  });

  return () => {
    const idx = authListeners.indexOf(callback);
    if (idx !== -1) authListeners.splice(idx, 1);
    fbUnsub();
  };
}

export async function fetchProjectMembersFromCloud(projectId: string): Promise<any[]> {
  if (!projectId) return [];
  try {
    const colRef = collection(db, 'projects', projectId, 'members');
    const snapshot = await getDocs(colRef);
    const byEmail = new Map<string, any>();
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const email = normalizeEmail(data?.email || (docSnap.id.includes('@') ? docSnap.id : ''));
      if (!email) return;
      const candidate = { id: docSnap.id, ...data, email };
      const existing = byEmail.get(email);
      const candidateCanonical = docSnap.id.toLowerCase() === email;
      const existingCanonical = String(existing?.id || '').toLowerCase() === email;
      if (!existing || candidateCanonical || (!existingCanonical && Number(data?.updatedAt || 0) >= Number(existing?.updatedAt || 0))) {
        byEmail.set(email, candidate);
      }
    });
    return Array.from(byEmail.values());
  } catch (err) {
    console.warn('Error fetching cloud project members:', err);
    return [];
  }
}


function normalizeProjectRole(role?: string | null): 'ADMIN' | 'EDITOR' | 'VIEWER' {
  const value = String(role || 'VIEWER').toUpperCase();
  if (value === 'ADMIN') return 'ADMIN';
  if (value === 'EDITOR' || value === 'ENGINEER') return 'EDITOR';
  return 'VIEWER';
}

function strongerProjectRole(a?: string | null, b?: string | null): 'ADMIN' | 'EDITOR' | 'VIEWER' {
  const rank: Record<'ADMIN' | 'EDITOR' | 'VIEWER', number> = { VIEWER: 1, EDITOR: 2, ADMIN: 3 };
  const ra = normalizeProjectRole(a);
  const rb = normalizeProjectRole(b);
  return rank[ra] >= rank[rb] ? ra : rb;
}

export interface CanonicalMemberTransferResult {
  transferred: number;
  preservedExisting: number;
  adminDowngradedToEngineer: number;
  skippedInactive: number;
}

/**
 * Copy active member access from a duplicate/source project to the canonical target.
 *
 * Security rule:
 * - Current user must be ADMIN on the canonical target.
 * - Existing target roles are never downgraded.
 * - A source-only ADMIN is transferred as EDITOR unless that email is already ADMIN
 *   on the target. This prevents an accidental personal duplicate from granting itself
 *   ADMIN over the organisation's canonical project.
 *
 * The source project/member documents are NOT deleted.
 */
export async function transferProjectMembersToCanonical(
  sourceProjectId: string,
  targetProjectId: string
): Promise<CanonicalMemberTransferResult> {
  if (!sourceProjectId || !targetProjectId || sourceProjectId === targetProjectId) {
    return { transferred: 0, preservedExisting: 0, adminDowngradedToEngineer: 0, skippedInactive: 0 };
  }

  const user = getCurrentRealFirebaseUser();
  if (!user) throw new Error('Cần đăng nhập Google để chuyển thành viên.');

  const targetRole = await fetchProjectUserRoleFromCloud(targetProjectId, user);
  if (!targetRole.allowed || targetRole.role !== 'ADMIN') {
    throw new Error('Cần quyền ADMIN trên dự án chính để chuyển thành viên.');
  }

  const [sourceMembers, targetMembers] = await Promise.all([
    fetchProjectMembersFromCloud(sourceProjectId),
    fetchProjectMembersFromCloud(targetProjectId),
  ]);

  const targetByEmail = new Map<string, any>();
  targetMembers.forEach((member) => {
    const email = normalizeEmail(member?.email);
    if (email && member?.active !== false) targetByEmail.set(email, member);
  });

  const sourceByEmail = new Map<string, any>();
  sourceMembers.forEach((member) => {
    const email = normalizeEmail(member?.email);
    if (!email) return;
    const existing = sourceByEmail.get(email);
    if (!existing || Number(member?.updatedAt || 0) >= Number(existing?.updatedAt || 0)) {
      sourceByEmail.set(email, member);
    }
  });

  let transferred = 0;
  let preservedExisting = 0;
  let adminDowngradedToEngineer = 0;
  let skippedInactive = 0;

  for (const [email, member] of sourceByEmail.entries()) {
    if (member?.active === false) {
      skippedInactive++;
      continue;
    }

    const existingTarget = targetByEmail.get(email);
    let incomingRole = normalizeProjectRole(member?.role);
    if (!existingTarget && incomingRole === 'ADMIN') {
      // A duplicate project's owner/admin must not silently become ADMIN of the
      // canonical project. The canonical ADMIN can promote them afterwards.
      incomingRole = 'EDITOR';
      adminDowngradedToEngineer++;
    }
    const finalRole = existingTarget
      ? strongerProjectRole(existingTarget?.role, incomingRole)
      : incomingRole;

    if (existingTarget && normalizeProjectRole(existingTarget?.role) === finalRole) {
      preservedExisting++;
    }

    await saveProjectMemberToCloud(targetProjectId, {
      email,
      uid: member?.uid,
      role: finalRole,
      assignedAt: Number(member?.assignedAt || Date.now()),
    });
    transferred++;
  }

  return { transferred, preservedExisting, adminDowngradedToEngineer, skippedInactive };
}

/**
 * Mark a duplicate/source project as an archive that redirects to the canonical ID.
 * No source data, photos, chat or audit history is deleted.
 *
 * The current user must be ADMIN on the source project and must at least have access
 * to the target project. This supports the common recovery case where a user owns an
 * accidental duplicate but is only EDITOR on the organisation's canonical project.
 */
export async function markProjectMergedIntoCloud(
  sourceProjectId: string,
  targetProjectId: string
): Promise<void> {
  if (!sourceProjectId || !targetProjectId || sourceProjectId === targetProjectId) return;
  const user = getCurrentRealFirebaseUser();
  if (!user || !user.email) throw new Error('Cần đăng nhập Google để hợp nhất projectId.');

  const [sourceRole, targetRole, sourceSnap, targetSnap] = await Promise.all([
    fetchProjectUserRoleFromCloud(sourceProjectId, user),
    fetchProjectUserRoleFromCloud(targetProjectId, user),
    getDoc(doc(db, 'projects', sourceProjectId)),
    getDoc(doc(db, 'projects', targetProjectId)),
  ]);

  if (!sourceRole.allowed || sourceRole.role !== 'ADMIN') {
    throw new Error('Cần quyền ADMIN trên ID nguồn để đánh dấu dự án đã hợp nhất.');
  }
  if (!targetRole.allowed) {
    throw new Error('Tài khoản hiện tại chưa có quyền truy cập ID dự án chính.');
  }
  if (!sourceSnap.exists() || !targetSnap.exists()) {
    throw new Error('Không tìm thấy một trong hai projectId trên Cloud.');
  }

  await setDoc(doc(db, 'projects', sourceProjectId), {
    canonicalProjectId: targetProjectId,
    mergedIntoProjectId: targetProjectId,
    mergedAt: serverTimestamp(),
    mergedByUid: user.uid,
    mergedByEmail: normalizeEmail(user.email),
    updatedAt: Date.now(),
  }, { merge: true });
}

export function subscribeProjectMembersRealtime(projectId: string, onUpdate: (members: any[]) => void): () => void {
  if (!projectId) return () => {};
  let disposed = false;
  let snapshotUnsub: (() => void) | null = null;

  const attach = (user: User | null) => {
    snapshotUnsub?.();
    snapshotUnsub = null;
    if (disposed || !user) return;
    snapshotUnsub = onSnapshot(collection(db, 'projects', projectId, 'members'), (snap) => {
      const byEmail = new Map<string, any>();
      snap.docs.forEach((d) => {
        const data = d.data();
        const email = normalizeEmail(data?.email || (d.id.includes('@') ? d.id : ''));
        if (!email) return;
        const candidate = { id: d.id, ...data, email };
        const existing = byEmail.get(email);
        const candidateCanonical = d.id.toLowerCase() === email;
        const existingCanonical = String(existing?.id || '').toLowerCase() === email;
        if (!existing || candidateCanonical || (!existingCanonical && Number(data?.updatedAt || 0) >= Number(existing?.updatedAt || 0))) {
          byEmail.set(email, candidate);
        }
      });
      if (!disposed) onUpdate(Array.from(byEmail.values()));
    }, (err) => console.warn('Project members realtime error:', err));
  };

  attach(getCurrentRealFirebaseUser());
  const authUnsub = onAuthStateChanged(auth, attach);
  return () => {
    disposed = true;
    snapshotUnsub?.();
    authUnsub();
  };
}

export interface ProjectRoleInfo {
  allowed: boolean;
  role: 'ADMIN' | 'EDITOR' | 'VIEWER';
  isCloudSynced: boolean;
  ownerUid?: string;
  ownerEmail?: string;
  isOwner?: boolean;
  pinResetEpoch?: number;
  // `verified` means Firestore answered authoritatively, including an authoritative
  // VIEWER/deny result. `unavailable` means the network/backend could not verify the
  // role and MUST NOT downgrade a previously verified offline lease.
  verification: 'verified' | 'unavailable';
}

export async function fetchProjectUserRoleFromCloud(
  projectId: string,
  user: User | null
): Promise<ProjectRoleInfo> {
  if (!projectId || !user) {
    return { allowed: false, role: 'VIEWER', isCloudSynced: false, verification: 'unavailable' };
  }

  try {
    // 1. Fetch project document to check ownerUid and ownerEmail.
    // Firestore rules now allow the stored ownerEmail to recover ADMIN even if UID changed.
    const projectSnap = await getDocFromServer(doc(db, 'projects', projectId));
    let pOwnerUid: string | undefined;
    let pOwnerEmail: string | undefined;

    if (projectSnap.exists()) {
      const pData = projectSnap.data();
      pOwnerUid = pData?.ownerUid;
      pOwnerEmail = normalizeEmail(pData?.ownerEmail);

      if (pData) {
        // Company SUPER ADMIN may open every existing Cloud project without being added
        // to projects/{projectId}/members. This does not transfer project ownership.
        if (isSuperAdminEmail(user.email)) {
          return { allowed: true, role: 'ADMIN', isCloudSynced: true, ownerUid: pData.ownerUid, ownerEmail: pData.ownerEmail, isOwner: false, verification: 'verified' };
        }
        // Direct UID match -> Project Owner (ADMIN)
        if (pData.ownerUid && pData.ownerUid === user.uid) {
          return { allowed: true, role: 'ADMIN', isCloudSynced: true, ownerUid: pData.ownerUid, ownerEmail: pData.ownerEmail, isOwner: true, verification: 'verified' };
        }
        // Direct Email match -> Project Owner (ADMIN)
        if (pOwnerEmail && normalizeEmail(user.email) && pOwnerEmail === normalizeEmail(user.email)) {
          return { allowed: true, role: 'ADMIN', isCloudSynced: true, ownerUid: pData.ownerUid || user.uid, ownerEmail: pData.ownerEmail, isOwner: true, verification: 'verified' };
        }
      }
    }

    // 2. Fetch direct member documents by UID and normalized email.
    // Avoid collection-wide reads because Firestore rules cannot authorize a broad members scan.
    for (const memberDocId of getMemberDocIdsForUser(user)) {
      const memberSnap = await getDocFromServer(doc(db, 'projects', projectId, 'members', memberDocId));
      if (memberSnap.exists()) {
        const mData = memberSnap.data();
        if (mData && mData.active === false) {
          return { allowed: false, role: 'VIEWER', isCloudSynced: true, ownerUid: pOwnerUid, ownerEmail: pOwnerEmail, isOwner: false, verification: 'verified' };
        }
        const role = normalizeProjectRole(mData?.role);
        return { allowed: true, role, isCloudSynced: true, ownerUid: pOwnerUid, ownerEmail: pOwnerEmail, isOwner: role === 'ADMIN', pinResetEpoch: Number(mData?.pinResetEpoch || 0), verification: 'verified' };
      }
    }

    // If project exists on Cloud with an ownerUid or members, but user is not listed -> VIEWER
    if (projectSnap.exists() && (projectSnap.data()?.ownerUid || projectSnap.data()?.ownerEmail)) {
      return { allowed: false, role: 'VIEWER', isCloudSynced: true, ownerUid: pOwnerUid, ownerEmail: pOwnerEmail, isOwner: false, verification: 'verified' };
    }

    // Default safe role: VIEWER (never fail-open to EDITOR)
    return { allowed: false, role: 'VIEWER', isCloudSynced: false, ownerUid: pOwnerUid, ownerEmail: pOwnerEmail, isOwner: false, verification: 'verified' };
  } catch (err) {
    console.warn('Error fetching project user role from cloud; role verification unavailable, preserving any matching offline lease:', err);
    return { allowed: false, role: 'VIEWER', isCloudSynced: false, verification: 'unavailable' };
  }
}

export function subscribeProjectUserRoleRealtime(
  projectId: string,
  user: User,
  onUpdate: (info: ProjectRoleInfo) => void
): () => void {
  if (!projectId || !user?.uid) return () => {};
  let cancelled = false;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rootSignature = '';
  const memberSignatures = new Map<string, string>();

  const refresh = async (reason: string) => {
    const mySeq = ++seq;
    console.debug('[role refresh]', projectId, reason);
    const info = await fetchProjectUserRoleFromCloud(projectId, user);
    if (!cancelled && mySeq === seq) onUpdate(info);
  };
  const scheduleRefresh = (reason: string) => {
    if (cancelled) return;
    seq++;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void refresh(reason);
    }, 140);
  };

  const unsubs: Array<() => void> = [];
  unsubs.push(onSnapshot(doc(db, 'projects', projectId), (snap) => {
    const data = snap.exists() ? snap.data() : {};
    // Ignore root changes that only touch updatedAt/sync metadata. Ownership/deleted
    // are the only root fields that can affect the effective role.
    const nextSignature = JSON.stringify([
      snap.exists(),
      data?.deleted === true,
      String(data?.ownerUid || ''),
      normalizeEmail(data?.ownerEmail),
    ]);
    if (nextSignature !== rootSignature) {
      rootSignature = nextSignature;
      scheduleRefresh('project-owner');
    }
  }, (err) => console.warn('Role project listener warning:', err)));

  for (const memberId of getMemberDocIdsForUser(user)) {
    unsubs.push(onSnapshot(doc(db, 'projects', projectId, 'members', memberId), (snap) => {
      const data = snap.exists() ? snap.data() : {};
      const nextSignature = JSON.stringify([
        snap.exists(),
        data?.active !== false,
        String(data?.role || ''),
        String(data?.uid || ''),
        normalizeEmail(data?.email),
      ]);
      if (memberSignatures.get(memberId) !== nextSignature) {
        memberSignatures.set(memberId, nextSignature);
        scheduleRefresh(`member:${memberId}`);
      }
    }, (err) => console.warn('Role member listener warning:', err)));
  }

  scheduleRefresh('initial');
  return () => {
    cancelled = true;
    seq++;
    if (timer) clearTimeout(timer);
    unsubs.forEach((u) => u());
  };
}

/**
 * Claim or recover ownership for projects lacking an owner or matching the owner email
 */
export async function claimProjectOwnership(
  projectId: string,
  user: User,
  projectName = 'Dự án'
): Promise<{ success: boolean; message: string }> {
  if (!projectId || !user) {
    return { success: false, message: 'Thiếu thông tin dự án hoặc tài khoản Google.' };
  }
  try {
    const projRef = doc(db, 'projects', projectId);
    const snap = await getDoc(projRef);
    const userEmail = user.email ? user.email.trim().toLowerCase() : '';

    if (!snap.exists()) {
      // Create new project metadata with current user as owner
      await setDoc(projRef, {
        id: projectId,
        name: projectName || projectId,
        ownerUid: user.uid,
        ownerEmail: userEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
      return { success: true, message: 'Đã khởi tạo quyền Chủ Sở Hữu (ADMIN) thành công!' };
    }

    const pData = snap.data();
    const existingOwnerUid = pData?.ownerUid;
    const existingOwnerEmail = pData?.ownerEmail ? pData.ownerEmail.trim().toLowerCase() : '';

    // Allow claim if:
    // 1. No ownerUid or ownerEmail assigned yet (orphaned/unowned project)
    // 2. Or existing ownerEmail matches current user email
    if (!existingOwnerUid || (existingOwnerEmail && userEmail && existingOwnerEmail === userEmail)) {
      await setDoc(projRef, {
        ownerUid: user.uid,
        ownerEmail: userEmail || existingOwnerEmail,
        updatedAt: Date.now()
      }, { merge: true });
      return { success: true, message: 'Đã khôi phục quyền Chủ Sở Hữu (ADMIN) thành công!' };
    } else {
      return {
        success: false,
        message: 'Dự án này đã có Chủ sở hữu khác trên Cloud. Vui lòng liên hệ Admin của dự án để được cấp quyền.'
      };
    }
  } catch (err: any) {
    return { success: false, message: 'Lỗi khôi phục quyền: ' + (err?.message || err) };
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {},
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface CloudProjectRecord {
  id: string;
  name: string;
  syncCode?: string;
  updatedAt: number;
  updatedBy?: string;
  data: any;
}

export interface FirestoreCachedProjectSnapshot {
  projectId: string;
  found: boolean;
  metadata: {
    projectName: string;
    contractorName: string;
    inspectorName: string;
    updatedAt: number;
  };
  data: Record<string, any[]>;
  recordCount: number;
}

/**
 * Hydrate the UI from Firestore's official persistent cache only.
 *
 * Security note: the caller MUST resolve an identity-bound project role/lease before
 * rendering this snapshot, because Firestore's on-device cache is shared by the web
 * app origin. This function never consults localStorage/localforage business arrays.
 */
export async function loadProjectFromFirestoreCache(projectId: string): Promise<FirestoreCachedProjectSnapshot> {
  const emptyData: Record<string, any[]> = Object.fromEntries(REALTIME_COLLECTIONS.map(({ stateKey }) => [stateKey, []]));
  if (!projectId) {
    return {
      projectId,
      found: false,
      metadata: { projectName: '', contractorName: '', inspectorName: '', updatedAt: 0 },
      data: emptyData,
      recordCount: 0,
    };
  }

  let meta: any = null;
  try {
    const metaSnap = await getDocFromCache(doc(db, 'projects', projectId));
    if (metaSnap.exists()) meta = metaSnap.data();
  } catch (_) {}

  let recordCount = 0;
  const data: Record<string, any[]> = { ...emptyData };
  await Promise.all(REALTIME_COLLECTIONS.map(async ({ cloudName, stateKey }) => {
    try {
      const snap = await getDocsFromCache(collection(db, 'projects', projectId, cloudName));
      const list = snap.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((item: any) => item?.deleted !== true && !item?.deletedAt);
      if (stateKey === 'floorPlans') list.sort((a: any, b: any) => Number(a.order || 0) - Number(b.order || 0));
      data[stateKey] = list;
      recordCount += list.length;
    } catch (_) {
      data[stateKey] = [];
    }
  }));

  return {
    projectId,
    found: Boolean(meta) || recordCount > 0,
    metadata: {
      projectName: String(meta?.name || ''),
      contractorName: String(meta?.contractorName || ''),
      inspectorName: String(meta?.inspectorName || ''),
      updatedAt: cloudTimestampToMillis(meta?.updatedAt),
    },
    data,
    recordCount,
  };
}

export interface CloudBackupRecord {
  id: string;
  backupName: string;
  createdAt: string;
  projectCount: number;
  projects: any[];
  ownerUid?: string | null;
}

/**
 * Extracts payload data dictionary uniformly from legacy flat format or new payload format
 */
export function getCloudPayload(record: any): Record<string, string> | null {
  if (!record) return null;
  if (record.data && record.data.payload && typeof record.data.payload === 'object') {
    return record.data.payload;
  }
  if (record.payload && typeof record.payload === 'object') {
    return record.payload;
  }
  if (record.data && typeof record.data === 'object') {
    const copy = { ...record.data };
    delete copy.id;
    delete copy.name;
    delete copy.syncCode;
    delete copy.updatedAt;
    delete copy.updatedBy;
    delete copy.contractorName;
    delete copy.inspectorName;
    return copy;
  }
  return null;
}

/**
 * Helper to compress or sanitize base64 images so cloud backup payloads stay within Firestore limits
 */
export function sanitizePayloadForCloud(obj: any): any {
  if (obj === undefined) return null;
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizePayloadForCloud).filter(item => item !== undefined);

  const copy: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val === undefined) {
      continue; // Skip undefined values
    } else if (typeof val === 'string' && val.startsWith('data:image/') && val.length > 50000) {
      // Large base64 image: truncate to lightweight metadata so cloud backup doesn't crash
      copy[key] = '[IMAGE_OMITTED_FOR_CLOUD_SIZE_LIMIT]';
    } else if (typeof val === 'object' && val !== null) {
      copy[key] = sanitizePayloadForCloud(val);
    } else {
      copy[key] = val;
    }
  }
  return copy;
}

function sanitizeSubcollectionItemForCloud(subcollection: string, item: any): any {
  const sanitized = sanitizePayloadForCloud(item);

  // Floor-plan binaries are uploaded by floorPlanImageSync.ts. When a user replaces
  // an existing drawing, never publish the intermediate local data/blob URL (or an
  // IMAGE_OMITTED marker) through the generic Firestore merge. Doing so can replace
  // the valid old cloud pointer before the new binary is actually available, making
  // another device temporarily show a blank/stale floor plan. Keep the previous cloud
  // image metadata until the dedicated binary upload atomically publishes the new one.
  if (subcollection === 'floor_plans') {
    const rawImageUrl = typeof item?.imageUrl === 'string' ? item.imageUrl.trim() : '';
    const hasLocalBinary = rawImageUrl.startsWith('data:image/') || rawImageUrl.startsWith('blob:');
    if (hasLocalBinary && sanitized && typeof sanitized === 'object') {
      for (const key of [
        'imageUrl',
        'driveFileId',
        'driveUrl',
        'cloudFileId',
        'storageProvider',
        'imageMimeType',
        'imageFileSize',
        'imageRevision',
        'imageCloudRevision',
        'imageCloudSyncedAt',
      ]) {
        delete sanitized[key];
      }
    }
  }

  return sanitized;
}

export interface ProjectSharedSettings {
  driveAutoSyncEnabled?: boolean;
  syncOptions?: {
    norms?: boolean;
    inventory?: boolean;
    workVolumes?: boolean;
    floorPlans?: boolean;
    defects?: boolean;
    roomProgress?: boolean;
    checklist?: boolean;
    crew?: boolean;
  };
  report?: Record<string, any>;
  workflow?: Record<string, any>;
  photoBackup?: Record<string, any>;
  trash?: {
    enabled?: boolean;
    retentionDays?: number;
  };
  updatedAt?: number;
  updatedByUid?: string;
  updatedByEmail?: string;
}

export async function saveProjectSharedSettings(projectId: string, patch: Partial<ProjectSharedSettings>): Promise<void> {
  if (!projectId) return;
  const user = getCurrentRealFirebaseUser();
  if (!user || !user.email) return;
  await setDoc(doc(db, 'projects', projectId, 'settings', 'shared'), sanitizePayloadForCloud({
    ...patch,
    updatedAt: Date.now(),
    updatedByUid: user.uid,
    updatedByEmail: normalizeEmail(user.email),
    updatedByDeviceId: getDeviceId(),
    updatedByDeviceName: getDeviceName(),
  }), { merge: true });
}

export function subscribeProjectSharedSettings(projectId: string, onUpdate: (settings: ProjectSharedSettings) => void): () => void {
  if (!projectId) return () => {};
  let disposed = false;
  let snapshotUnsub: (() => void) | null = null;

  const attach = (user: User | null) => {
    snapshotUnsub?.();
    snapshotUnsub = null;
    if (disposed || !user) return;
    snapshotUnsub = onSnapshot(doc(db, 'projects', projectId, 'settings', 'shared'), (snap) => {
      if (!disposed && snap.exists()) onUpdate(snap.data() as ProjectSharedSettings);
    }, (err) => console.warn('Project shared settings realtime error:', err));
  };

  attach(getCurrentRealFirebaseUser());
  const authUnsub = onAuthStateChanged(auth, attach);
  return () => {
    disposed = true;
    snapshotUnsub?.();
    authUnsub();
  };
}

/**
 * Save / sync a single project to Firebase Cloud using modern subcollections
 */
export async function saveProjectMetadataToCloud(projectId: string, name: string, extra: { contractorName?: string; inspectorName?: string } = {}): Promise<void> {
  if (!projectId || !name.trim()) return;
  const user = getCurrentRealFirebaseUser();
  if (!user || !user.email) throw new Error('Cần đăng nhập Google/Firebase để đồng bộ dự án.');
  const ref = doc(db, 'projects', projectId);
  const snap = await getDoc(ref).catch(() => null);
  const now = Date.now();
  if (!snap || !snap.exists()) {
    await setDoc(ref, {
      id: projectId,
      name: name.trim(),
      ownerUid: user.uid,
      ownerEmail: normalizeEmail(user.email),
      contractorName: extra.contractorName || '',
      inspectorName: extra.inspectorName || '',
      syncCode: projectId.slice(0, 8).toUpperCase(),
      // New projects are canonical by definition. Existing legacy projects keep
      // their current identity until an ADMIN explicitly merges them.
      canonicalProjectId: projectId,
      schemaVersion: 3,
      dataSchemaVersion: CURRENT_DATA_SCHEMA_VERSION,
      createdAt: serverTimestamp(),
      updatedAt: now,
      updatedByUid: user.uid,
      updatedByEmail: normalizeEmail(user.email),
      updatedByDeviceId: getDeviceId(),
      updatedByDeviceName: getDeviceName(),
    });
    await writeProjectMemberDocs(projectId, { uid: user.uid, email: user.email, role: 'ADMIN', active: true, displayName: user.displayName || '' }).catch(() => {});
    await registerProjectForCurrentUser(projectId, name.trim(), 'ADMIN');
    return;
  }
  if (!snap.data()?.createdAt) {
    await ensureProjectMigrationsInCloud(projectId).catch(() => {});
  }
  await setDoc(ref, {
    name: name.trim(),
    ...(extra.contractorName !== undefined ? { contractorName: extra.contractorName } : {}),
    ...(extra.inspectorName !== undefined ? { inspectorName: extra.inspectorName } : {}),
    updatedAt: now,
    updatedByUid: user.uid,
    updatedByEmail: normalizeEmail(user.email),
    updatedByDeviceId: getDeviceId(),
    updatedByDeviceName: getDeviceName(),
  }, { merge: true });
  const roleInfo = await fetchProjectUserRoleFromCloud(projectId, user).catch(() => null);
  await registerProjectForCurrentUser(projectId, name.trim(), roleInfo?.allowed ? roleInfo.role : 'VIEWER');
}

export async function saveProjectToCloud(project: { id: string; name: string; syncCode?: string; payload?: any; contractorName?: string; inspectorName?: string; [key: string]: any }): Promise<void> {
  try {
    await ensureAuth();
    let payloadData = project.payload;
    if (!payloadData) {
      const copy = { ...project };
      delete copy.id;
      delete copy.name;
      delete copy.syncCode;
      delete copy.updatedAt;
      delete copy.updatedBy;
      delete copy.contractorName;
      delete copy.inspectorName;
      payloadData = copy;
    }

    const syncCode = project.syncCode || project.id.slice(0, 8).toUpperCase();
    
    // Save metadata with ownerUid and ownerEmail immutability
    try {
      const metadataRef = doc(db, 'projects', project.id);
      const existingSnap = await getDoc(metadataRef).catch(() => null);
      const existingData = existingSnap && existingSnap.exists() ? existingSnap.data() : null;
      const currentUser = getCurrentAppUser();
      const finalOwnerUid = existingData?.ownerUid || (currentUser ? currentUser.uid : null);
      const finalOwnerEmail = existingData?.ownerEmail || normalizeEmail(currentUser?.email);
      if (existingData && !existingData.createdAt) {
        await ensureProjectMigrationsInCloud(project.id).catch(() => {});
      }

      await setDoc(metadataRef, {
        id: project.id,
        ...(!existingData ? { createdAt: serverTimestamp(), canonicalProjectId: project.id } : {}),
        name: project.name || 'Dự án',
        syncCode,
        updatedAt: Date.now(),
        schemaVersion: 3, // Legacy storage-format marker; data schema is tracked separately below
        dataSchemaVersion: CURRENT_DATA_SCHEMA_VERSION,
        updatedBy: typeof window !== 'undefined' ? window.navigator.userAgent : 'device',
        contractorName: project.contractorName || '',
        inspectorName: project.inspectorName || '',
        ...(finalOwnerUid ? { ownerUid: finalOwnerUid } : {}),
        ...(finalOwnerEmail ? { ownerEmail: finalOwnerEmail } : {}),
      }, { merge: true });
      if (currentUser && !currentUser.isAnonymous) {
        const roleInfo = await fetchProjectUserRoleFromCloud(project.id, currentUser).catch(() => null);
        const safeRole = roleInfo?.allowed ? roleInfo.role : (finalOwnerUid === currentUser.uid ? 'ADMIN' : 'VIEWER');
        await registerProjectForCurrentUser(project.id, project.name || project.id, safeRole);
      }
    } catch (metaErr) {
      console.warn('[Cloud Sync] Project metadata update skipped or disallowed for current role:', metaErr);
    }

    // Extract subcollections and write them
    const subNames = REALTIME_COLLECTIONS;

    let batch = writeBatch(db);
    let operationCount = 0;
    const now = Date.now();

    for (const { cloudName, stateKey } of subNames) {
      const list = payloadData[stateKey];
      const cloudById = new Map<string, any>();
      try {
        const existingSnap = await getDocs(collection(db, 'projects', project.id, cloudName));
        existingSnap.docs.forEach((row) => cloudById.set(row.id, row.data()));
      } catch (err) {
        console.warn(`[Cloud Sync] Could not read current ${cloudName} revisions before full UPSERT:`, err);
      }

      // Firebase-only rule: a missing item in a local snapshot is NOT proof of deletion.
      // A device may have an incomplete/offline cache. Deletions travel only as explicit
      // tombstones via saveProjectDiffsToCloud(), so a partial local cache can never wipe
      // valid Cloud records during a full/manual save.

      // Upload active local records (UPSERT-only)
      if (Array.isArray(list)) {
        for (const item of list) {
          if (!item || !item.id) continue;
          const docRef = doc(db, 'projects', project.id, cloudName, item.id);
          const sanitized = sanitizeSubcollectionItemForCloud(cloudName, item);
          const currentCloud = cloudById.get(String(item.id));
          const localUpdatedAt = Number(item.updatedAt || 0);
          const cloudUpdatedAt = Number(currentCloud?.updatedAt || 0);
          // A full/import snapshot is never allowed to overwrite a newer Cloud record.
          // Missing/legacy timestamps are accepted only when the Cloud record is also legacy.
          if (currentCloud && cloudUpdatedAt > 0 && localUpdatedAt <= cloudUpdatedAt) continue;
          const nextRevision = Math.max(Number(item.revision || 0), Number(currentCloud?.revision || 0) + 1, 1);

          if (cloudName === 'inventory' && sanitized.sourceType === 'room-auto') {
            // Deterministic room-auto records are monotonic. Two devices may calculate
            // the same missing quantity at the same time; a transaction keeps only one
            // cumulative record and never lets a stale device lower it.
            if (operationCount > 0) {
              await batch.commit();
              batch = writeBatch(db);
              operationCount = 0;
            }
            await runTransaction(db, async (transaction) => {
              const snap = await transaction.get(docRef);
              const current = snap.exists() ? snap.data() : {};
              const quantity = Math.max(Number(current?.quantity || 0), Number(sanitized.quantity || 0));
              transaction.set(docRef, {
                ...sanitized,
                quantity,
                deleted: false,
                deletedAt: null,
                deletedByUid: null,
          deletedBy: null,
                revision: Math.max(nextRevision, Number(current?.revision || 0) + 1),
                updatedAt: Math.max(Number(current?.updatedAt || 0) + 1, Number(item.updatedAt || now)),
              }, { merge: true });
            });
            continue;
          }

          batch.set(docRef, {
            ...sanitized,
            deleted: false,
            deletedAt: null,
            deletedByUid: null,
          deletedBy: null,
            revision: nextRevision,
            updatedAt: Number(item.updatedAt || now)
          }, { merge: true });
          operationCount++;

          if (operationCount >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            operationCount = 0;
          }
        }
      }
    }

    if (operationCount > 0) {
      await batch.commit();
    }
  } catch (err) {
    console.error("Firestore Write Error:", err);
    throw new Error('Lỗi lưu dự án lên đám mây: Dữ liệu quá lớn hoặc mất kết nối.');
  }
}

/**
 * Save only incremental changesets (diffs) to Firestore subcollections
 * Decouples project root metadata write from subcollection writes for EDITOR role support
 */
function auditSafeValue(value: any): any {
  if (typeof value === 'string') {
    if (value.startsWith('data:image/') || value.length > 2000) return `[VALUE_OMITTED:${value.length}]`;
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 30) return `[ARRAY:${value.length}]`;
    return value.map(auditSafeValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value).slice(0, 30)) {
      if (/base64|dataUrl|localUri|blob/i.test(k)) continue;
      out[k] = auditSafeValue(v);
    }
    return out;
  }
  return value;
}

function buildAuditChangedFields(before: any, after: any): Record<string, { before: any; after: any }> {
  const result: Record<string, { before: any; after: any }> = {};
  const skip = new Set(['updatedAt','updatedByUid','updatedByEmail','updatedByDeviceId','updatedByDeviceName','deletedAt']);
  const keys = new Set<string>([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (skip.has(key) || /base64|dataUrl|localUri|blob/i.test(key)) continue;
    const b = before?.[key];
    const a = after?.[key];
    let same = false;
    try { same = JSON.stringify(b) === JSON.stringify(a); } catch (_) { same = b === a; }
    if (!same) result[key] = { before: auditSafeValue(b), after: auditSafeValue(a) };
    if (Object.keys(result).length >= 40) break;
  }
  return result;
}


/**
 * Queue business mutations into Firestore's official persistent write queue while the
 * browser is offline. This function deliberately performs no server reads and does not
 * await acknowledgement: writeBatch.commit() immediately enters the SDK mutation queue
 * and its Promise settles only after reconnect/server validation.
 *
 * This is NOT a second database/outbox. Firestore persistence owns the pending writes.
 * Rules still validate role/revision when connectivity returns; stale writes are rejected
 * and the realtime/cache listener reconciles the authoritative server state.
 */
export function queueProjectDiffsToFirestoreOffline(
  projectId: string,
  projectName: string,
  contractorName: string,
  inspectorName: string,
  diffs: {
    addedOrModified: { [subcollection: string]: any[] };
    deletedIds: { [subcollection: string]: Array<string | { id: string; deletedAt?: number; revision?: number }> };
  },
  options: { touchProjectMetadata?: boolean } = {},
): { queuedRecords: number; commitPromises: Promise<void>[] } {
  if (!projectId) return { queuedRecords: 0, commitPromises: [] };
  const currentUser = getCurrentAppUser();
  let batch = writeBatch(db);
  let operationCount = 0;
  let queuedRecords = 0;
  const commitPromises: Promise<void>[] = [];

  const flush = () => {
    if (operationCount <= 0) return;
    const pending = batch.commit();
    // Keep the rejection observable in the current session without blocking offline UI.
    pending.catch((err) => console.warn('[Firestore offline queue] server rejected pending batch after reconnect:', err));
    commitPromises.push(pending);
    batch = writeBatch(db);
    operationCount = 0;
  };

  if (options.touchProjectMetadata) {
    batch.set(doc(db, 'projects', projectId), {
      id: projectId,
      name: projectName,
      contractorName,
      inspectorName,
      updatedAt: Date.now(),
      dataSchemaVersion: CURRENT_DATA_SCHEMA_VERSION,
      updatedByUid: currentUser?.uid || '',
      updatedByEmail: normalizeEmail(currentUser?.email),
      updatedByDeviceId: getDeviceId(),
      updatedByDeviceName: getDeviceName(),
    }, { merge: true });
    operationCount++;
  }

  for (const [subName, items] of Object.entries(diffs.addedOrModified || {})) {
    for (const item of items || []) {
      if (!item?.id) continue;
      const docRef = doc(db, 'projects', projectId, subName, String(item.id));
      const sanitized = sanitizeSubcollectionItemForCloud(subName, item);
      batch.set(docRef, {
        ...sanitized,
        id: String(item.id),
        deleted: false,
        deletedAt: null,
        deletedByUid: null,
        deletedBy: null,
        revision: Math.max(Number(item.revision || 0), 1),
        updatedAt: Number(item.updatedAt || Date.now()),
        updatedByUid: currentUser?.uid || '',
        updatedByEmail: normalizeEmail(currentUser?.email),
        updatedByDeviceId: getDeviceId(),
        updatedByDeviceName: getDeviceName(),
      }, { merge: true });
      operationCount++;
      queuedRecords++;
      if (operationCount >= 400) flush();
    }
  }

  for (const [subName, ids] of Object.entries(diffs.deletedIds || {})) {
    for (const deleteEntry of ids || []) {
      const id = typeof deleteEntry === 'string' ? deleteEntry : String(deleteEntry?.id || '');
      if (!id) continue;
      const deletedAt = typeof deleteEntry === 'string' ? Date.now() : Number(deleteEntry.deletedAt || Date.now());
      const revision = typeof deleteEntry === 'string' ? 1 : Math.max(Number(deleteEntry.revision || 0), 1);
      batch.set(doc(db, 'projects', projectId, subName, id), {
        id,
        deleted: true,
        deletedAt,
        deletedByUid: currentUser?.uid || '',
        deletedBy: currentUser?.uid || '',
        revision,
        updatedAt: deletedAt,
        updatedByUid: currentUser?.uid || '',
        updatedByEmail: normalizeEmail(currentUser?.email),
        updatedByDeviceId: getDeviceId(),
        updatedByDeviceName: getDeviceName(),
      }, { merge: true });
      operationCount++;
      queuedRecords++;
      if (operationCount >= 400) flush();
    }
  }

  flush();
  return { queuedRecords, commitPromises };
}

export async function saveProjectDiffsToCloud(
  projectId: string,
  projectName: string,
  contractorName: string,
  inspectorName: string,
  diffs: {
    addedOrModified: { [subcollection: string]: any[] };
    deletedIds: { [subcollection: string]: Array<string | { id: string; deletedAt?: number; revision?: number }> };
  },
  options: { touchProjectMetadata?: boolean; allowRootMetadataWrite?: boolean; rootTouchIntervalMs?: number; auditDetailLimit?: number } = {}
): Promise<void> {
  try {
    await ensureAuth();

    const totalChangedRecords =
      Object.values(diffs.addedOrModified).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0) +
      Object.values(diffs.deletedIds).reduce((sum, ids) => sum + (Array.isArray(ids) ? ids.length : 0), 0);
    const nowForRoot = Date.now();
    const rootTouchIntervalMs = Math.max(30000, Number(options.rootTouchIntervalMs || 60000));
    const lastRootTouch = projectRootMetadataTouchAt.get(projectId) || 0;
    const shouldTouchRoot = options.allowRootMetadataWrite !== false && (
      options.touchProjectMetadata === true ||
      (totalChangedRecords > 0 && nowForRoot - lastRootTouch >= rootTouchIntervalMs)
    );

    // 1. Root project metadata is NOT touched on every autosave.
    if (shouldTouchRoot) try {
      const metadataRef = doc(db, 'projects', projectId);
      const currentUser = getCurrentAppUser();
      // IMPORTANT: normal autosync never rewrites ownerUid/ownerEmail or grants ADMIN.
      // Ownership is assigned only when a project is created/claimed and membership is managed separately.
      const metaPayload: Record<string, any> = {
        id: projectId,
        name: projectName,
        contractorName,
        inspectorName,
        updatedAt: Date.now(),
        schemaVersion: 3,
        dataSchemaVersion: CURRENT_DATA_SCHEMA_VERSION,
        syncCode: projectId.slice(0, 8).toUpperCase(),
        updatedByUid: currentUser?.uid || '',
        updatedByEmail: normalizeEmail(currentUser?.email),
        updatedByDeviceId: getDeviceId(),
        updatedByDeviceName: getDeviceName()
      };
      await setDoc(metadataRef, metaPayload, { merge: true });
      projectRootMetadataTouchAt.set(projectId, nowForRoot);
      console.debug('[cloud save] root metadata touched', projectId, 'changes=', totalChangedRecords);
    } catch (metaErr) {
      // Engineer role may not have permissions on root /projects/{projectId} document - this is expected
      console.warn('[Cloud Sync] Project metadata update skipped or disallowed for current role:', metaErr);
    }

    let batch = writeBatch(db);
    let operationCount = 0;
    const AUDIT_DETAIL_LIMIT = Math.max(0, Math.min(30, Number(options.auditDetailLimit ?? 20)));
    let auditCandidateCount = 0;
    const auditEntries: Array<{ module: string; action: string; recordId: string; description: string; changedFields?: Record<string, { before: any; after: any }>; beforeData?: any; afterData?: any }> = [];

    // 2. Process added / modified items in subcollections
    for (const [subName, items] of Object.entries(diffs.addedOrModified)) {
      for (const item of items) {
        if (!item.id) continue;
        auditCandidateCount++;
        const docRef = doc(db, 'projects', projectId, subName, item.id);
        const sanitized = sanitizeSubcollectionItemForCloud(subName, item);
        const beforeSnap = auditEntries.length < AUDIT_DETAIL_LIMIT ? await getDoc(docRef).catch(() => null) : null;
        const beforeData = beforeSnap && beforeSnap.exists() ? beforeSnap.data() : null;
        const changedFields = buildAuditChangedFields(beforeData || {}, sanitized);
        if (Object.keys(changedFields).length > 0 && auditEntries.length < AUDIT_DETAIL_LIMIT) {
          auditEntries.push({
            module: subName,
            action: beforeData ? 'UPDATE' : 'CREATE',
            recordId: item.id,
            description: `${beforeData ? 'Cập nhật' : 'Tạo'} ${subName} · ${item.id}`,
            changedFields,
            ...(beforeData ? { beforeData: auditSafeValue(beforeData) } : {}),
            afterData: auditSafeValue(sanitized),
          });
        }
        
        const currentUser = getCurrentAppUser();
        if (subName === 'inventory' && sanitized.sourceType === 'room-auto') {
          const browserOnline = typeof navigator === 'undefined' || navigator.onLine;
          if (browserOnline) {
            if (operationCount > 0) {
              await batch.commit();
              batch = writeBatch(db);
              operationCount = 0;
            }
            await runTransaction(db, async (transaction) => {
              const snap = await transaction.get(docRef);
              const current = snap.exists() ? snap.data() : {};
              const quantity = Math.max(Number(current?.quantity || 0), Number(sanitized.quantity || 0));
              transaction.set(docRef, {
                ...sanitized,
                quantity,
                deleted: false,
                deletedAt: null,
                deletedByUid: null,
          deletedBy: null,
                revision: Math.max(Number(current?.revision || 0) + 1, Number(item.revision || 0), 1),
                updatedAt: Math.max(Number(current?.updatedAt || 0) + 1, Number(item.updatedAt || Date.now())),
                updatedByUid: currentUser?.uid || '',
                updatedByEmail: normalizeEmail(currentUser?.email),
                updatedByDeviceId: getDeviceId(),
                updatedByDeviceName: getDeviceName(),
              }, { merge: true });
            });
            continue;
          }
          // Firestore transactions require a server connection. While offline, queue
          // the deterministic ledger row through the official persistent write queue;
          // Rules/revision guards reconcile it on reconnect instead of losing the edit.
        }

        const incomingRevision = Math.max(Number(item.revision || 0), 1);
        batch.set(docRef, {
          ...sanitized,
          deleted: false,
          deletedAt: null,
          deletedByUid: null,
          deletedBy: null,
          revision: incomingRevision,
          ...(!beforeData && currentUser?.uid ? { createdByUid: currentUser.uid } : {}),
          updatedAt: Number(item.updatedAt || Date.now()),
          updatedByUid: currentUser?.uid || '',
          updatedByEmail: normalizeEmail(currentUser?.email),
          updatedByDeviceId: getDeviceId(),
          updatedByDeviceName: getDeviceName()
        }, { merge: true });
        operationCount++;

        if (operationCount >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          operationCount = 0;
        }
      }
    }

    // 3. Process deleted items as soft-delete tombstones so other devices learn about deletions
    for (const [subName, ids] of Object.entries(diffs.deletedIds)) {
      for (const deleteEntry of ids) {
        const id = typeof deleteEntry === 'string' ? deleteEntry : String(deleteEntry?.id || '');
        if (!id) continue;
        auditCandidateCount++;
        const docRef = doc(db, 'projects', projectId, subName, id);
        const beforeSnap = auditEntries.length < AUDIT_DETAIL_LIMIT ? await getDoc(docRef).catch(() => null) : null;
        const beforeData = beforeSnap && beforeSnap.exists() ? beforeSnap.data() : null;
        const requestedDeletedAt = typeof deleteEntry === 'string' ? Date.now() : Number(deleteEntry.deletedAt || Date.now());
        const requestedRevision = typeof deleteEntry === 'string' ? 0 : Number(deleteEntry.revision || 0);
        const tombstoneRevision = Math.max(requestedRevision, 1);
        if (auditEntries.length < AUDIT_DETAIL_LIMIT) {
          auditEntries.push({ module: subName, action: 'DELETE', recordId: id, description: `Xóa ${subName} · ${id}`, beforeData: auditSafeValue(beforeData || { id }) });
        }
        const currentUser = getCurrentAppUser();
        // Preserve the actual user delete time across offline/reconnect. A stale offline
        // deletion must not become artificially newest merely because connectivity returned.
        batch.set(docRef, {
          id,
          deleted: true,
          deletedAt: requestedDeletedAt,
          deletedByUid: currentUser?.uid || '',
          deletedBy: currentUser?.uid || '',
          revision: tombstoneRevision,
          updatedAt: requestedDeletedAt,
          updatedByUid: currentUser?.uid || '',
          updatedByEmail: normalizeEmail(currentUser?.email),
          updatedByDeviceId: getDeviceId(),
          updatedByDeviceName: getDeviceName()
        }, { merge: true });
        operationCount++;

        if (operationCount >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          operationCount = 0;
        }
      }
    }

    if (operationCount > 0) {
      await batch.commit();
    }

    if (auditCandidateCount > auditEntries.length) {
      auditEntries.push({
        module: 'autosave',
        action: 'BATCH_UPDATE',
        recordId: projectId,
        description: `Đồng bộ nền ${auditCandidateCount} thay đổi (${auditEntries.length} mục ghi chi tiết)`,
      });
    }
    if (auditEntries.length > 0) {
      const auditUser = getCurrentRealFirebaseUser();
      const roleInfo = auditUser
        ? await fetchProjectUserRoleFromCloud(projectId, auditUser).catch(() => null)
        : null;
      const actorRole = roleInfo?.role || 'VIEWER';
      console.debug('[cloud save]', projectId, 'changes=', totalChangedRecords, 'audit=', auditEntries.length);
      await Promise.all(auditEntries.map((entry) => saveProjectAuditLog(projectId, {
        module: entry.module,
        action: entry.action,
        recordId: entry.recordId,
        description: entry.description,
        details: entry.description,
        changedFields: entry.changedFields,
        beforeData: entry.beforeData,
        afterData: entry.afterData,
        actorRole,
      }).catch((err) => console.warn('Activity log write warning:', err))));
    }
  } catch (err) {
    console.error("Firestore Save Diffs Error:", err);
    throw err;
  }
}

/**
 * Fetch a single project from Cloud by ID
 */
export async function fetchProjectFromCloud(projectId: string, options?: { serverOnly?: boolean }): Promise<CloudProjectRecord | null> {
  try {
    await ensureAuth();
    const snap = options?.serverOnly
      ? await getDocFromServer(doc(db, 'projects', projectId))
      : await getDoc(doc(db, 'projects', projectId));
    if (!snap.exists()) return null;

    const meta = snap.data();
    
    // Schema v2+ stores business data in subcollections; reconstruct a full project snapshot.
    if (Number(meta.schemaVersion || 0) >= 2) {
      const payload: any = {
        projectName: meta.name,
        contractorName: meta.contractorName || '',
        inspectorName: meta.inspectorName || '',
        updatedAt: meta.updatedAt || 0,
      };

      const subNames = REALTIME_COLLECTIONS;

      for (const { cloudName, stateKey } of subNames) {
        const querySnap = options?.serverOnly
          ? await getDocsFromServer(collection(db, 'projects', projectId, cloudName))
          : await getDocs(collection(db, 'projects', projectId, cloudName));
        const list: any[] = [];
        querySnap.forEach((docSnap) => {
          const data = docSnap.data();
          if (!data.deleted) {
            list.push({ id: docSnap.id, ...data });
          }
        });
        if (stateKey === 'floorPlans' && Array.isArray(list)) {
          list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        }
        payload[stateKey] = list;
      }

      return {
        id: projectId,
        name: meta.name,
        syncCode: meta.syncCode,
        updatedAt: meta.updatedAt || 0,
        updatedBy: meta.updatedBy || 'device',
        data: {
          id: projectId,
          name: meta.name,
          syncCode: meta.syncCode,
          payload
        }
      } as CloudProjectRecord;
    }

    // Legacy fallback
    return meta as CloudProjectRecord;
  } catch (err) {
    console.error("Firestore Get Error:", err);
    return null;
  }
}

/**
 * Listen for real-time changes using subcollections (for multi-device concurrent sync)
 */
export function subscribeToProjectRealtime(
  projectId: string,
  onMetadataUpdate: (metadata: { projectName: string; contractorName: string; inspectorName: string; updatedAt: number }) => void,
  onSubcollectionUpdate: (subcollectionName: string, items: any[], isInitial: boolean, isPatch?: boolean) => void,
  onError?: (err: any) => void
) {
  const unsubscribers: (() => void)[] = [];
  let isCancelled = false;

  ensureAuth().then(() => {
    if (isCancelled) return;

    // 1. Listen for metadata changes
    const metaUnsub = onSnapshot(
      doc(db, 'projects', projectId),
      (snap) => {
        if (isCancelled) return;
        if (snap.exists()) {
          const data = snap.data();
          onMetadataUpdate({
            projectName: data.name || '',
            contractorName: data.contractorName || '',
            inspectorName: data.inspectorName || '',
            updatedAt: data.updatedAt || 0,
          });
        }
      },
      (err) => {
        console.warn('Metadata subscribe error:', err);
        if (onError) onError(err);
      }
    );
    unsubscribers.push(metaUnsub);

    // 2. Listen for each subcollection changes
    const subNames = REALTIME_COLLECTIONS;

    subNames.forEach(({ cloudName, stateKey }) => {
      let isFirst = true;
      const unsub = onSnapshot(
        collection(db, 'projects', projectId, cloudName),
        (snap) => {
          if (isCancelled) return;
          if (isFirst) {
            const items: any[] = [];
            snap.forEach((docSnap) => {
              items.push({ id: docSnap.id, ...docSnap.data() });
            });
            if (stateKey === 'floorPlans') {
              items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            }
            onSubcollectionUpdate(stateKey, items, true, false);
            isFirst = false;
            return;
          }

          // After bootstrap, send only changed documents. This avoids rebuilding and reconciling
          // an entire project collection on every phone/PC edit.
          const changedItems = snap.docChanges().map((change) => ({
            id: change.doc.id,
            ...change.doc.data(),
            __firestoreChangeType: change.type
          }));
          if (changedItems.length > 0) {
            onSubcollectionUpdate(stateKey, changedItems, false, true);
          }
        },
        (err) => {
          console.warn(`Subcollection ${cloudName} subscribe error:`, err);
          if (onError) onError(err);
        }
      );
      unsubscribers.push(unsub);
    });
  }).catch((err) => {
    console.warn('ensureAuth failed before subscribeToProjectRealtime:', err);
    if (onError) onError(err);
  });

  return () => {
    isCancelled = true;
    console.debug('[project realtime] unsubscribe', projectId, 'listeners=', unsubscribers.length);
    unsubscribers.splice(0).forEach((unsub) => unsub());
  };
}

/**
 * Legacy single-document snapshot fallback listener
 */
export function subscribeToCloudProject(projectId: string, onUpdate: (data: CloudProjectRecord) => void, onError?: (err: any) => void) {
  return onSnapshot(
    doc(db, 'projects', projectId),
    (snap) => {
      if (snap.exists()) {
        onUpdate(snap.data() as CloudProjectRecord);
      }
    },
    (err) => {
      console.warn("Firestore Snapshot Error:", err);
      if (onError) onError(err);
    }
  );
}


export interface ProjectAuditCloudEntry {
  id?: string;
  projectId: string;
  userUid?: string;
  userEmail?: string;
  userName?: string;
  actorRole?: string;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  clientType?: 'WEB' | 'APK' | 'DESKTOP';
  browser?: string;
  appVersion?: string;
  module?: string;
  action: string;
  recordId?: string;
  description?: string;
  details?: string;
  changedFields?: Record<string, { before: any; after: any }>;
  beforeData?: any;
  afterData?: any;
  createdAt?: any;
  clientTimestamp: number;
  timestamp?: number;
  syncStatus?: 'SYNCED' | 'PENDING';
}

function getClientAuditContext() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'server';
  const w = typeof window !== 'undefined' ? (window as any) : {};
  const clientType: 'WEB' | 'APK' | 'DESKTOP' = w.AndroidBridge ? 'APK' : (w.electronAPI || w.__TAURI__ ? 'DESKTOP' : 'WEB');
  const platform = typeof navigator !== 'undefined' ? (navigator.platform || (/Android/i.test(ua) ? 'Android' : 'Web')) : 'server';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Unknown';
  return { clientType, platform, browser, appVersion: String((import.meta as any).env?.VITE_APP_VERSION || 'web') };
}

export async function saveProjectAuditLog(projectId: string, entry: Omit<ProjectAuditCloudEntry, 'projectId' | 'id' | 'userUid' | 'userEmail' | 'userName' | 'deviceId' | 'deviceName' | 'clientTimestamp'> & { clientTimestamp?: number; timestamp?: number }): Promise<void> {
  if (!projectId) return;
  const user = getCurrentRealFirebaseUser();
  if (!user || user.isAnonymous || !user.email) return;
  const clientTimestamp = Number(entry.clientTimestamp || entry.timestamp || Date.now());
  const id = `activity_${clientTimestamp}_${Math.random().toString(36).slice(2, 10)}`;
  const ctx = getClientAuditContext();
  const description = entry.description || entry.details || entry.action;
  const roleInfo = entry.actorRole ? null : await fetchProjectUserRoleFromCloud(projectId, user).catch(() => null);
  await setDoc(doc(db, 'projects', projectId, 'activityLogs', id), sanitizePayloadForCloud({
    ...entry,
    id,
    projectId,
    userUid: user.uid,
    userEmail: normalizeEmail(user.email),
    userName: user.displayName || '',
    actorRole: entry.actorRole || roleInfo?.role || 'VIEWER',
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
    ...ctx,
    description,
    details: description,
    clientTimestamp,
    timestamp: clientTimestamp,
    createdAt: clientTimestamp,
    syncStatus: 'SYNCED',
  }));
}

export function subscribeProjectAuditLogsRealtime(projectId: string, onUpdate: (items: ProjectAuditCloudEntry[]) => void, maxItems = 200): () => void {
  if (!projectId) return () => {};
  let disposed = false;
  let snapshotUnsub: (() => void) | null = null;

  const attach = (user: User | null) => {
    snapshotUnsub?.();
    snapshotUnsub = null;
    if (disposed || !user) return;
    const q = query(collection(db, 'projects', projectId, 'activityLogs'), orderBy('clientTimestamp', 'desc'), limit(Math.max(1, Math.min(500, maxItems))));
    // includeMetadataChanges lets the UI distinguish a locally queued/offline audit write
    // from a server-acknowledged entry without mutating the append-only log document.
    snapshotUnsub = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
      if (disposed) return;
      onUpdate(snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        syncStatus: d.metadata.hasPendingWrites ? 'PENDING' : 'SYNCED',
      } as ProjectAuditCloudEntry)));
    }, (err) => console.warn('Project activity log realtime error:', err));
  };

  attach(getCurrentRealFirebaseUser());
  const authUnsub = onAuthStateChanged(auth, attach);
  return () => {
    disposed = true;
    snapshotUnsub?.();
    authUnsub();
  };
}

export async function fetchProjectAuditLogsFromCloud(projectId: string, maxItems = 200): Promise<ProjectAuditCloudEntry[]> {
  if (!projectId) return [];
  try {
    const q = query(collection(db, 'projects', projectId, 'activityLogs'), orderBy('clientTimestamp', 'desc'), limit(Math.max(1, Math.min(500, maxItems))));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProjectAuditCloudEntry));
  } catch (err) {
    console.warn('Error fetching project activity logs:', err);
    return [];
  }
}

/**
 * Create a full system snapshot backup on Firebase Cloud
 */
export async function saveCloudBackup(backupName: string, allProjects: any[]): Promise<string> {
  const backupId = `backup_${Date.now()}`;
  try {
    await ensureAuth();
    const sanitizedProjects = sanitizePayloadForCloud(allProjects);
    
    const record: CloudBackupRecord = {
      id: backupId,
      backupName: backupName || `Bản sao lưu ${formatDateTime(new Date())}`,
      createdAt: new Date().toISOString(),
      projectCount: Array.isArray(sanitizedProjects) ? sanitizedProjects.length : 1,
      projects: sanitizedProjects,
      ownerUid: getCurrentAppUser() ? getCurrentAppUser()!.uid : null
    };

    await setDoc(doc(db, 'cloud_backups', backupId), record);
    return backupId;
  } catch (err) {
    console.error("Firestore Backup Write Error:", err);
    throw new Error('Không thể lưu bản sao lưu lên Đám Mây: Dung lượng dữ liệu quá lớn hoặc mạng yếu.');
  }
}

/**
 * Save user profile and check pending invitations upon Google Login
 */
export async function registerCurrentDevice(): Promise<void> {
  const user = getCurrentRealFirebaseUser();
  if (!user || !user.email) return;
  const ctx = getClientAuditContext();
  const deviceId = getDeviceId();
  await setDoc(doc(db, 'users', user.uid, 'devices', deviceId), {
    deviceId, deviceName: getDeviceName(), ...ctx, userEmail: normalizeEmail(user.email), lastActiveAt: Date.now()
  }, { merge: true });
}

export async function saveUserProfileToCloud(user: { uid: string; email: string; displayName?: string; photoURL?: string }): Promise<void> {
  if (!user || !user.uid) return;
  try {
    const normalizedEmail = normalizeEmail(user.email);
    // 1. Save user profile
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      email: normalizedEmail,
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      updatedAt: Date.now()
    }, { merge: true });
    await registerCurrentDevice().catch((err) => console.warn('Device registration warning:', err));

    // 2. Check pending invitations
    // 2. Check pending invitations using constrained queries.
    // Legacy builds wrote "email"; current builds write "invitedEmail".
    const invitationQueries = [
      query(collection(db, 'projectInvitations'), where('invitedEmail', '==', normalizedEmail)),
      query(collection(db, 'projectInvitations'), where('email', '==', normalizedEmail))
    ];
    const handledInvitationIds = new Set<string>();
    for (const invQuery of invitationQueries) {
      const invSnap = await getDocs(invQuery).catch((err) => {
        console.warn('Pending invitation query skipped:', err);
        return null;
      });
      if (!invSnap) continue;

      for (const invDoc of invSnap.docs) {
        if (handledInvitationIds.has(invDoc.id)) continue;
        handledInvitationIds.add(invDoc.id);
        const data = invDoc.data();
        const inviteEmail = normalizeEmail(data?.invitedEmail || data?.email);
        if (data && inviteEmail === normalizedEmail && data.projectId) {
          const acceptedRole = data.role || 'EDITOR';
          let memberMaterialized = false;
          let userIndexPersisted = false;
          try {
            await writeProjectMemberDocs(data.projectId, {
              uid: user.uid,
              email: normalizedEmail,
              displayName: user.displayName || '',
              role: acceptedRole,
              active: true
            });
            memberMaterialized = true;
          } catch (err) {
            console.warn('Could not materialize invitation as UID member:', err);
          }

          // The invited user is the only principal allowed to update users/{uid}.
          // CRITICAL: never delete the invitation until this durable discovery index
          // succeeds. Older builds deleted first and could leave a valid member with
          // "Danh sách dự án (0)" after a transient write failure.
          try {
            await registerProjectForCurrentUser(
              String(data.projectId),
              String(data.projectName || data.name || data.projectId),
              acceptedRole,
            );
            userIndexPersisted = true;
          } catch (err) {
            console.warn('Could not register accepted project for current user:', err);
          }

          if (memberMaterialized && userIndexPersisted) {
            await deleteDoc(doc(db, 'projectInvitations', invDoc.id)).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    console.warn('saveUserProfileToCloud error:', err);
  }
}

/**
 * SUPER ADMIN remote PIN invalidation. PIN/hash never leaves the device.
 */
export async function requestProjectMemberPinReset(projectId: string, memberEmail: string, reason = 'SUPER ADMIN remote reset'): Promise<number> {
  const actor = getCurrentRealFirebaseUser();
  const normalizedEmail = normalizeEmail(memberEmail);
  if (!actor || !isSuperAdminEmail(actor.email)) throw new Error('Chỉ SUPER ADMIN được reset PIN từ xa.');
  if (!projectId || !normalizedEmail) throw new Error('Thiếu project hoặc email user cần reset PIN.');
  const memberRef = doc(db, 'projects', projectId, 'members', normalizedEmail);
  const memberSnap = await getDocFromServer(memberRef);
  if (!memberSnap.exists()) throw new Error('User chưa có member record trong dự án này.');
  const epoch = Date.now();
  await setDoc(memberRef, {
    pinResetEpoch: epoch,
    pinResetByUid: actor.uid,
    pinResetByEmail: normalizeEmail(actor.email),
    pinResetReason: String(reason || '').slice(0, 240),
    updatedAt: epoch,
  }, { merge: true });
  await saveProjectAuditLog(projectId, {
    timestamp: epoch,
    action: 'SECURITY_CONFIG_CHANGE',
    description: `SUPER ADMIN yêu cầu reset PIN từ xa cho ${normalizedEmail}`,
    details: `Remote PIN reset: ${normalizedEmail}`,
    module: 'security',
    syncStatus: 'PENDING',
  }).catch(() => {});
  return epoch;
}

export function subscribeCurrentUserPinResetRealtime(projectId: string, user: User, onResetEpoch: (epoch: number) => void): () => void {
  const email = normalizeEmail(user?.email);
  if (!projectId || !email) return () => {};
  return onSnapshot(doc(db, 'projects', projectId, 'members', email), (snap) => {
    if (!snap.exists()) return;
    const epoch = Number(snap.data()?.pinResetEpoch || 0);
    if (Number.isFinite(epoch) && epoch > 0) onResetEpoch(epoch);
  }, (err) => console.warn('Remote PIN reset subscription warning:', err));
}

/**
 * Add or update project member in Cloud by email/UID
 */
export async function saveProjectMemberToCloud(
  projectId: string,
  member: { email: string; role: string; assignedAt?: number; uid?: string }
): Promise<void> {
  if (!projectId || !member.email) return;
  try {
    const normalizedEmail = normalizeEmail(member.email);
    const targetUid = member.uid;

    await writeProjectMemberDocs(projectId, {
      uid: targetUid,
      email: normalizedEmail,
      role: member.role,
      active: true,
      assignedAt: member.assignedAt
    });

    // Converge every legacy UID alias for this email to the canonical role. This is
    // idempotent and prevents a stale physical row from resurfacing on older clients.
    const memberRows = await getDocs(collection(db, 'projects', projectId, 'members'));
    for (const memberRow of memberRows.docs) {
      const rowData = memberRow.data();
      const rowEmail = normalizeEmail(rowData?.email || (memberRow.id.includes('@') ? memberRow.id : ''));
      if (!rowEmail || rowEmail !== normalizedEmail || memberRow.id.toLowerCase() === normalizedEmail) continue;
      await setDoc(doc(db, 'projects', projectId, 'members', memberRow.id), {
        email: normalizedEmail,
        role: member.role,
        active: true,
        updatedAt: Date.now(),
      }, { merge: true });
    }

    const projectSnap = await getDoc(doc(db, 'projects', projectId));
    const projectName = projectSnap.exists() ? String(projectSnap.data()?.name || projectId) : projectId;

    // Write the backward-compatible invitation FIRST. The production project currently
    // still has V6.2.1 Rules because GitHub's service account cannot deploy newer Rules
    // (HTTP 403 firebaserules.rulesets.test). Under those Rules projectAccess is denied,
    // but projectInvitations is allowed. Previously the projectAccess failure aborted this
    // function before the invitation was created, leaving a visible member row in ADMIN
    // while VIEWER/EDITOR saw "Danh sách dự án (0)".
    await ensureProjectInvitationIndex(projectId, normalizedEmail, member.role, projectName);

    // Newer discovery index is an optimization only. Do not make membership assignment
    // fail if its Rules have not been deployed yet.
    await writeProjectAccessIndex(projectId, normalizedEmail, member.role, projectName, true).catch((err) => {
      console.warn('projectAccess index unavailable; invitation compatibility path remains active:', err);
    });
  } catch (err) {
    console.warn('saveProjectMemberToCloud error:', err);
    throw err;
  }
}

/**
 * Remove project member from Cloud
 */
export async function removeProjectMemberFromCloud(projectId: string, email: string, uid?: string): Promise<void> {
  if (!projectId || !email) return;
  try {
    const normalizedEmail = normalizeEmail(email);
    const aliasIds = new Set<string>([normalizedEmail]);
    if (uid) aliasIds.add(uid);
    const membersSnap = await getDocs(collection(db, 'projects', projectId, 'members'));
    membersSnap.forEach((mDoc) => {
      const mData = mDoc.data();
      const rowEmail = normalizeEmail(mData?.email || (mDoc.id.includes('@') ? mDoc.id : ''));
      if (rowEmail === normalizedEmail) aliasIds.add(mDoc.id);
    });

    for (const memberDocId of aliasIds) {
      await deleteDoc(doc(db, 'projects', projectId, 'members', memberDocId)).catch(() => {});
    }

    await deleteDoc(doc(db, 'projectAccess', projectAccessDocId(projectId, normalizedEmail))).catch(() => {});

    const invId = `${projectId}_${normalizedEmail}`;
    await deleteDoc(doc(db, 'projectInvitations', invId)).catch(() => {});
    const legacyInvId = `${projectId}_${normalizedEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
    await deleteDoc(doc(db, 'projectInvitations', legacyInvId)).catch(() => {});
  } catch (err) {
    console.warn('removeProjectMemberFromCloud error:', err);
    throw err;
  }
}

/**
 * Delete a project in Cloud and leave cloud tombstone so other devices delete it
 */
export async function deleteCloudProject(projectId: string, retentionDays = 7): Promise<void> {
  if (!projectId) return;
  try {
    await ensureAuth();
    const now = Date.now();
    const safeRetentionDays = [3, 7, 15, 30, 60, 90].includes(Number(retentionDays)) ? Number(retentionDays) : 7;
    await setDoc(doc(db, 'projects', projectId), {
      id: projectId,
      deleted: true,
      deletedAt: now,
      trashRetentionDays: safeRetentionDays,
      trashExpiresAt: now + safeRetentionDays * 24 * 60 * 60 * 1000,
      updatedAt: now
    }, { merge: true });
  } catch (err) {
    console.warn('deleteCloudProject error:', err);
    throw err;
  }
}

/** Restore a project that is still inside its trash retention window. Subcollections
 * are not duplicated/deleted during soft-delete, so restoring the root makes the
 * existing realtime data visible again without copying photos or business records. */
export async function restoreCloudProject(projectId: string): Promise<void> {
  if (!projectId) return;
  await ensureAuth();
  const now = Date.now();
  await setDoc(doc(db, 'projects', projectId), {
    id: projectId,
    deleted: false,
    deletedAt: null,
    trashExpiresAt: null,
    updatedAt: now,
  }, { merge: true });
}

/**
 * List all Cloud Backups
 */
export async function listCloudBackups(): Promise<CloudBackupRecord[]> {
  try {
    await ensureAuth();
    const q = query(collection(db, 'cloud_backups'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    const results: CloudBackupRecord[] = [];
    snap.forEach((docSnap) => {
      results.push(docSnap.data() as CloudBackupRecord);
    });
    return results;
  } catch (err) {
    console.warn("Firestore List Backups Error:", err);
    return [];
  }
}

/**
 * Delete a cloud backup
 */
export async function deleteCloudBackup(backupId: string): Promise<void> {
  try {
    await ensureAuth();
    await deleteDoc(doc(db, 'cloud_backups', backupId));
  } catch (err) {
    console.warn("Firestore Delete Backup Error:", err);
  }
}
