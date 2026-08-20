import { initializeApp, getApps } from 'firebase/app';
import { 
  initializeFirestore, 
  memoryLocalCache,
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  deleteDoc, 
  collection, 
  onSnapshot, 
  getDocFromServer,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  serverTimestamp,
  runTransaction
} from 'firebase/firestore';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut as fbSignOut, onAuthStateChanged, User } from 'firebase/auth';
import { getDeviceId, getDeviceName } from '../utils/deviceIdentity';
import { cleanupTransientLocalStorage, estimateLocalStorageBytes } from '../utils/storage';
const env = (import.meta as any).env || {};
const isDev = env.DEV || env.MODE === 'development' || !env.PROD;

const hostedFirebaseConfig = {
  apiKey: 'AIzaSyAShhTKSnmLMOEm4dST--1_X7fjJUE4znY',
  authDomain: 'com-example-qlct-61329.firebaseapp.com',
  projectId: 'com-example-qlct-61329',
  storageBucket: 'com-example-qlct-61329.firebasestorage.app',
  messagingSenderId: '119152410850',
  appId: '',
  firestoreDatabaseId: '(default)'
};

// Use the real Firebase project as the fallback in every client build.
// Development must not silently switch to a different/mock project because that
// makes the same Google account see different project lists on PC vs Web/APK.
const defaultFirebaseConfig = hostedFirebaseConfig;

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

const firebaseConfig = {
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

if (!isDev && !isFirebaseConfigured) {
  console.error('⚠️ THIẾU CẤU HÌNH FIREBASE TRONG MÔI TRƯỜNG PRODUCTION! Ứng dụng sẽ hoạt động ở chế độ Offline/Local Storage. Vui lòng khai báo đầy đủ các biến VITE_FIREBASE_* trước khi build APK/Web App.');
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

// V6.2.10: Firestore uses memory cache only. QLCT already keeps business data,
// photos and backup history in its own IndexedDB stores. This avoids Firestore 12.x
// WebStorage client-state writes (`firestore_clients_*`, `firestore_mutations_*`) from
// crashing browsers whose localStorage is already near quota. Multi-device realtime
// sync remains unchanged; only Firestore's page-reload persistent cache is disabled.
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
    localCache: memoryLocalCache(),
    experimentalForceLongPolling: true,
  }, dbId);
} catch (e) {
  console.warn('Firestore memory cache initialization warning, retrying default memory cache:', e);
  dbInstance = initializeFirestore(app, {
    experimentalForceLongPolling: true,
  }, dbId);
}

export const db = dbInstance;

export const auth = getAuth(app);

const authListeners: Array<(user: User | null) => void> = [];

function normalizeEmail(email?: string | null): string {
  return (email || '').trim().toLowerCase();
}

function getCurrentAppUser(): User | null {
  return auth.currentUser;
}


function getMemberDocIdsForUser(user: { uid?: string | null; email?: string | null }): string[] {
  const ids = new Set<string>();
  if (user.uid) ids.add(user.uid);
  const email = normalizeEmail(user.email);
  if (email) ids.add(email);
  return Array.from(ids);
}

export interface CloudProjectSummary {
  id: string;
  name: string;
  role?: string;
  createdAt?: number;
  updatedAt?: number;
  createdAtSource?: 'cloud' | 'migrating';
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
  const activeId = String(localStorage.getItem('active_project_id') || '').trim();
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
// VIEWER/ENGINEER discovery on projects that were assigned while older Rules are live.
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

export async function repairProjectAccessIndexForProject(projectId: string): Promise<void> {
  if (!projectId || projectAccessRepairInFlight.has(projectId)) return;
  projectAccessRepairInFlight.add(projectId);
  try {
    const user = getCurrentRealFirebaseUser();
    if (!user) return;
    const roleInfo = await fetchProjectUserRoleFromCloud(projectId, user);
    if (!roleInfo.allowed || roleInfo.role !== 'ADMIN') return;

    const projectSnap = await getDoc(doc(db, 'projects', projectId));
    const projectName = projectSnap.exists() ? String(projectSnap.data()?.name || projectId) : projectId;
    const membersSnap = await getDocs(collection(db, 'projects', projectId, 'members'));
    const seen = new Set<string>();
    const members: Array<{ email: string; role: string }> = [];
    membersSnap.forEach((memberSnap) => {
      const data = memberSnap.data();
      const memberEmail = normalizeEmail(data?.email || (memberSnap.id.includes('@') ? memberSnap.id : ''));
      if (!memberEmail || seen.has(memberEmail) || data?.active === false) return;
      seen.add(memberEmail);
      members.push({ email: memberEmail, role: String(data?.role || 'VIEWER').toUpperCase() });
    });

    // Do not run the compatibility invitation and the newer projectAccess write in one
    // Promise.all. On projects still using older production Rules, projectAccess is
    // expected to fail. We want a deterministic guarantee that every active member gets
    // the backward-compatible invitation first.
    for (const member of members) {
      try {
        await ensureProjectInvitationIndex(projectId, member.email, member.role, projectName);
      } catch (err) {
        console.warn(`Project invitation repair warning (${member.email}):`, err);
        continue;
      }
      await writeProjectAccessIndex(projectId, member.email, member.role, projectName, true).catch((err) => {
        console.warn(`projectAccess optional repair warning (${member.email}):`, err);
      });
    }
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

const createdAtMigrationInFlight = new Set<string>();
const projectAccessRepairInFlight = new Set<string>();

/**
 * One-time migration for legacy project documents that do not yet have createdAt.
 * IMPORTANT: the value comes from Firestore serverTimestamp(), never from local cache,
 * updatedAt or Date.now(). Once written, firestore.rules prevents it from changing.
 */
export async function ensureProjectCreatedAtInCloud(projectId: string): Promise<void> {
  if (!projectId || createdAtMigrationInFlight.has(projectId)) return;
  const user = getCurrentRealFirebaseUser();
  if (!user || !user.email) return;

  createdAtMigrationInFlight.add(projectId);
  try {
    const ref = doc(db, 'projects', projectId);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data?.createdAt) return;
      transaction.update(ref, {
        createdAt: serverTimestamp(),
        createdAtMigrated: true,
        createdAtMigrationVersion: 1,
        createdAtMigrationAt: serverTimestamp(),
      });
    });
  } catch (err) {
    // VIEWER/ENGINEER may not be allowed to update project metadata. In that case
    // we keep the UI in "migrating" state until an ADMIN opens the project.
    console.warn(`[Project createdAt migration] ${projectId}:`, err);
  } finally {
    createdAtMigrationInFlight.delete(projectId);
  }
}

async function registerProjectForCurrentUser(projectId: string, projectName: string, role = 'ADMIN'): Promise<void> {
  const user = getCurrentAppUser();
  if (!user || !user.uid || (user as any).isAnonymous) return;

  const normalizedEmail = normalizeEmail(user.email);
  await setDoc(doc(db, 'users', user.uid), {
    uid: user.uid,
    email: normalizedEmail,
    projects: {
      [projectId]: {
        id: projectId,
        name: projectName || projectId,
        role,
        updatedAt: Date.now(),
      }
    },
    updatedAt: Date.now(),
  }, { merge: true });
}

export async function fetchCurrentUserProjectsFromCloud(): Promise<CloudProjectSummary[]> {
  try {
    await ensureAuth();
    const user = getCurrentAppUser();
    if (!user || !user.uid || (user as any).isAnonymous) return [];

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
  // Candidate IDs from this device. They are included only after a server read proves
  // that the signed-in Google account is still authorized by Firestore Rules.
  let localCandidateProjects: Record<string, any> = readLocalProjectDiscoveryCandidates();
  let cancelled = false;
  let refreshSeq = 0;

  const emit = async () => {
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
      const durableHint = userProjects[id] || accessProjects[id] || invitationProjects[id] || legacyInvitationProjects[id] || ownerUidProjects[id] || ownerEmailProjects[id];
      const localHint = localCandidateProjects[id];
      const hint = durableHint || localHint || {};
      const isLocalProbeOnly = Boolean(localHint && !durableHint);
      try {
        const projectRef = doc(db, 'projects', id);
        // A local-only candidate MUST be verified against the server. Falling back to a
        // persisted cache here could resurrect a project after the member was removed.
        // Durable Cloud-discovery rows may still use Firestore cache while offline.
        let snap;
        if (isLocalProbeOnly) {
          snap = await getDocFromServer(projectRef);
        } else {
          try {
            snap = await getDocFromServer(projectRef);
          } catch (_) {
            snap = await getDoc(projectRef);
          }
        }
        if (!snap.exists() || snap.data()?.deleted) continue;
        const data = snap.data();
        const createdAt = cloudTimestampToMillis(data?.createdAt);
        const updatedAt = cloudTimestampToMillis(data?.updatedAt) || Number(hint.updatedAt || 0);

        let effectiveRole = String(hint.role || '').toUpperCase();
        if (isLocalProbeOnly || !effectiveRole) {
          const roleInfo = await fetchProjectUserRoleFromCloud(id, user).catch(() => ({ allowed: false, role: 'VIEWER' as const }));
          if (!roleInfo.allowed) continue;
          effectiveRole = String(roleInfo.role || 'VIEWER').toUpperCase();
          // Self-heal the UID index after the server has proven this legacy candidate is
          // actually accessible. This fixes legacy `default`/Mizuki projects without
          // asking the ADMIN to remove and invite the user again.
          registerProjectForCurrentUser(id, String(data?.name || hint.name || id), effectiveRole).catch(() => {});
        }
        // Invitations are a durable compatibility discovery source. Once the project
        // read succeeds, immediately persist the signed-in user's own index so the project
        // remains visible even after the invitation is later consumed/deleted on login.
        if ((invitationProjects[id] || legacyInvitationProjects[id]) && effectiveRole) {
          registerProjectForCurrentUser(id, String(data?.name || hint.name || id), effectiveRole).catch(() => {});
        }

        if (!createdAt && (effectiveRole === 'ADMIN' || data?.ownerUid === user.uid || normalizeEmail(data?.ownerEmail) === email)) {
          // Fire-and-forget one-time migration. The next realtime emission will pick up
          // the server-generated value. We intentionally do NOT invent a temporary date.
          ensureProjectCreatedAtInCloud(id).catch(() => {});
        }
        result.push({
          id,
          name: String(data?.name || hint.name || id),
          role: effectiveRole || hint.role,
          createdAt,
          createdAtSource: createdAt ? 'cloud' : 'migrating',
          updatedAt,
        });
      } catch (err: any) {
        // A stale users/{uid}.projects entry must never keep an unauthorized project
        // visible after the member was removed/disabled. Only use the hint when the
        // project read failed for a transient/offline reason; permission-denied is
        // authoritative and the project is omitted from the authorized Cloud list.
        const code = String(err?.code || '');
        if (code.includes('permission-denied') || isLocalProbeOnly) continue;
        result.push({
          id,
          name: String(hint.name || id),
          role: hint.role,
          createdAt: 0,
          createdAtSource: 'migrating',
          updatedAt: Number(hint.updatedAt || 0),
        });
      }
    }
    if (!cancelled && seq === refreshSeq) onUpdate(result.sort((a,b) => Number(b.updatedAt||0)-Number(a.updatedAt||0)));
  };

  const unsubs: Array<() => void> = [];
  unsubs.push(onSnapshot(doc(db, 'users', user.uid), (snap) => {
    const data = snap.exists() ? snap.data() : {};
    userProjects = data?.projects && typeof data.projects === 'object' ? data.projects : {};
    emit();
  }, (err) => console.warn('User project index realtime error:', err)));

  const invitationQ = query(collection(db, 'projectInvitations'), where('invitedEmail', '==', email));
  unsubs.push(onSnapshot(invitationQ, (snap) => {
    invitationProjects = {};
    snap.docs.forEach((d) => { const x=d.data(); if (x?.projectId) invitationProjects[String(x.projectId)] = { id: String(x.projectId), role: x.role || 'VIEWER', updatedAt: cloudTimestampToMillis(x.updatedAt || x.createdAt) }; });
    emit();
  }, (err) => console.warn('Project invitations realtime error:', err)));

  // Legacy builds sometimes stored only the `email` field. Keep this listener so an
  // already signed-in invitee can discover the project without signing out/in again.
  const legacyInvitationQ = query(collection(db, 'projectInvitations'), where('email', '==', email));
  unsubs.push(onSnapshot(legacyInvitationQ, (snap) => {
    legacyInvitationProjects = {};
    snap.docs.forEach((d) => { const x=d.data(); if (x?.projectId) legacyInvitationProjects[String(x.projectId)] = { id: String(x.projectId), role: x.role || 'VIEWER', updatedAt: cloudTimestampToMillis(x.updatedAt || x.createdAt) }; });
    emit();
  }, (err) => console.warn('Legacy project invitations realtime error:', err)));

  // Durable email -> project access index. Invitations may legitimately be deleted after
  // acceptance, while users/{uid}.projects can fail to write during a transient network
  // issue. Keeping this small index prevents an authorized VIEWER/ENGINEER from ending up
  // with an empty project list even though projects/{id}/members/{email} still grants access.
  const accessQ = query(collection(db, 'projectAccess'), where('email', '==', email));
  unsubs.push(onSnapshot(accessQ, (snap) => {
    accessProjects = {};
    snap.docs.forEach((d) => {
      const x = d.data();
      if (!x?.projectId || x?.active === false) return;
      const projectId = String(x.projectId);
      const projectName = String(x.projectName || projectId);
      const role = String(x.role || 'VIEWER').toUpperCase();
      accessProjects[projectId] = { id: projectId, name: projectName, role, updatedAt: cloudTimestampToMillis(x.updatedAt) };
      // Self-heal the per-UID index. Only the signed-in user can write users/{uid}.
      registerProjectForCurrentUser(projectId, projectName, role).catch(() => {});
    });
    emit();
  }, (err) => console.warn('Project access index realtime error:', err)));

  // Recovery path for legacy projects whose users/{uid}.projects index was never
  // created or was lost during an old migration. Owner UID/email is authoritative
  // and lets the same Google account rediscover the project without creating a copy.
  const ownerUidQ = query(collection(db, 'projects'), where('ownerUid', '==', user.uid));
  unsubs.push(onSnapshot(ownerUidQ, (snap) => {
    ownerUidProjects = {};
    snap.docs.forEach((d) => {
      const x = d.data();
      if (!x?.deleted) {
        const name = String(x?.name || d.id);
        ownerUidProjects[d.id] = { id: d.id, name, role: 'ADMIN', updatedAt: Number(x?.updatedAt || 0) };
        registerProjectForCurrentUser(d.id, name, 'ADMIN').catch(() => {});
        repairProjectAccessIndexForProject(d.id).catch(() => {});
      }
    });
    emit();
  }, (err) => console.warn('Owner UID projects realtime recovery warning:', err)));

  const ownerEmailQ = query(collection(db, 'projects'), where('ownerEmail', '==', email));
  unsubs.push(onSnapshot(ownerEmailQ, (snap) => {
    ownerEmailProjects = {};
    snap.docs.forEach((d) => {
      const x = d.data();
      if (!x?.deleted) {
        const name = String(x?.name || d.id);
        ownerEmailProjects[d.id] = { id: d.id, name, role: 'ADMIN', updatedAt: Number(x?.updatedAt || 0) };
        registerProjectForCurrentUser(d.id, name, 'ADMIN').catch(() => {});
        repairProjectAccessIndexForProject(d.id).catch(() => {});
      }
    });
    emit();
  }, (err) => console.warn('Owner email projects realtime recovery warning:', err)));

  return () => { cancelled = true; unsubs.forEach((u) => u()); };
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

  // An invited VIEWER/ENGINEER is allowed by Firestore Rules to materialize only
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

export async function signInWithGoogle(): Promise<User | null> {
  // If Firebase is configured with real credentials, attempt popup sign-in
  if (isFirebaseConfigured) {
    try {
      const provider = new GoogleAuthProvider();
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
    const list: any[] = [];
    snapshot.forEach(docSnap => {
      list.push(docSnap.data());
    });
    return list;
  } catch (err) {
    console.warn('Error fetching cloud project members:', err);
    return [];
  }
}

export function subscribeProjectMembersRealtime(projectId: string, onUpdate: (members: any[]) => void): () => void {
  if (!projectId) return () => {};
  return onSnapshot(collection(db, 'projects', projectId, 'members'), (snap) => {
    const byEmail = new Map<string, any>();
    snap.docs.forEach((d) => {
      const data = d.data();
      const email = normalizeEmail(data?.email || (d.id.includes('@') ? d.id : ''));
      if (!email) return;
      const existing = byEmail.get(email);
      if (!existing || Number(data?.updatedAt || 0) >= Number(existing?.updatedAt || 0)) byEmail.set(email, { id: d.id, ...data, email });
    });
    onUpdate(Array.from(byEmail.values()));
  }, (err) => console.warn('Project members realtime error:', err));
}

export async function fetchProjectUserRoleFromCloud(
  projectId: string,
  user: User | null
): Promise<{ allowed: boolean; role: 'ADMIN' | 'ENGINEER' | 'VIEWER'; isCloudSynced: boolean; ownerUid?: string; ownerEmail?: string; isOwner?: boolean }> {
  if (!projectId || !user) {
    return { allowed: false, role: 'VIEWER', isCloudSynced: false };
  }

  try {
    // 1. Fetch project document to check ownerUid and ownerEmail.
    // Firestore rules now allow the stored ownerEmail to recover ADMIN even if UID changed.
    const projectSnap = await getDoc(doc(db, 'projects', projectId));
    let pOwnerUid: string | undefined;
    let pOwnerEmail: string | undefined;

    if (projectSnap.exists()) {
      const pData = projectSnap.data();
      pOwnerUid = pData?.ownerUid;
      pOwnerEmail = normalizeEmail(pData?.ownerEmail);

      if (pData) {
        // Direct UID match -> Project Owner (ADMIN)
        if (pData.ownerUid && pData.ownerUid === user.uid) {
          return { allowed: true, role: 'ADMIN', isCloudSynced: true, ownerUid: pData.ownerUid, ownerEmail: pData.ownerEmail, isOwner: true };
        }
        // Direct Email match -> Project Owner (ADMIN)
        if (pOwnerEmail && normalizeEmail(user.email) && pOwnerEmail === normalizeEmail(user.email)) {
          return { allowed: true, role: 'ADMIN', isCloudSynced: true, ownerUid: pData.ownerUid || user.uid, ownerEmail: pData.ownerEmail, isOwner: true };
        }
      }
    }

    // 2. Fetch direct member documents by UID and normalized email.
    // Avoid collection-wide reads because Firestore rules cannot authorize a broad members scan.
    for (const memberDocId of getMemberDocIdsForUser(user)) {
      const memberSnap = await getDoc(doc(db, 'projects', projectId, 'members', memberDocId));
      if (memberSnap.exists()) {
        const mData = memberSnap.data();
        if (mData && mData.active === false) {
          return { allowed: false, role: 'VIEWER', isCloudSynced: true, ownerUid: pOwnerUid, ownerEmail: pOwnerEmail, isOwner: false };
        }
        const role = (mData?.role as 'ADMIN' | 'ENGINEER' | 'VIEWER') || 'VIEWER';
        return { allowed: true, role, isCloudSynced: true, ownerUid: pOwnerUid, ownerEmail: pOwnerEmail, isOwner: role === 'ADMIN' };
      }
    }

    // If project exists on Cloud with an ownerUid or members, but user is not listed -> VIEWER
    if (projectSnap.exists() && (projectSnap.data()?.ownerUid || projectSnap.data()?.ownerEmail)) {
      return { allowed: false, role: 'VIEWER', isCloudSynced: true, ownerUid: pOwnerUid, ownerEmail: pOwnerEmail, isOwner: false };
    }

    // Default safe role: VIEWER (never fail-open to ENGINEER)
    return { allowed: false, role: 'VIEWER', isCloudSynced: false, ownerUid: pOwnerUid, ownerEmail: pOwnerEmail, isOwner: false };
  } catch (err) {
    console.warn('Error fetching project user role from cloud, defaulting to VIEWER (fail-secure):', err);
    return { allowed: false, role: 'VIEWER', isCloudSynced: false };
  }
}

export function subscribeProjectUserRoleRealtime(
  projectId: string,
  user: User,
  onUpdate: (info: { allowed: boolean; role: 'ADMIN' | 'ENGINEER' | 'VIEWER'; isCloudSynced: boolean; ownerUid?: string; ownerEmail?: string; isOwner?: boolean }) => void
): () => void {
  if (!projectId || !user?.uid) return () => {};
  let cancelled = false;
  let seq = 0;
  const refresh = async () => {
    const mySeq = ++seq;
    const info = await fetchProjectUserRoleFromCloud(projectId, user);
    if (!cancelled && mySeq === seq) onUpdate(info);
  };
  const unsubs: Array<() => void> = [];
  unsubs.push(onSnapshot(doc(db, 'projects', projectId), refresh, (err) => console.warn('Role project listener warning:', err)));
  for (const memberId of getMemberDocIdsForUser(user)) {
    unsubs.push(onSnapshot(doc(db, 'projects', projectId, 'members', memberId), refresh, (err) => console.warn('Role member listener warning:', err)));
  }
  refresh();
  return () => { cancelled = true; unsubs.forEach((u) => u()); };
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
  return onSnapshot(doc(db, 'projects', projectId, 'settings', 'shared'), (snap) => {
    if (snap.exists()) onUpdate(snap.data() as ProjectSharedSettings);
  }, (err) => console.warn('Project shared settings realtime error:', err));
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
      schemaVersion: 3,
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
    await ensureProjectCreatedAtInCloud(projectId).catch(() => {});
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
        await ensureProjectCreatedAtInCloud(project.id).catch(() => {});
      }

      await setDoc(metadataRef, {
        id: project.id,
        ...(!existingData ? { createdAt: serverTimestamp() } : {}),
        name: project.name || 'Dự án',
        syncCode,
        updatedAt: Date.now(),
        schemaVersion: 2, // New subcollection schema
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
    const subNames = [
      { cloudName: 'rooms', stateKey: 'roomProgressList' },
      { cloudName: 'inventory', stateKey: 'inventory' },
      { cloudName: 'defects', stateKey: 'defects' },
      { cloudName: 'work_volumes', stateKey: 'workVolumes' },
      { cloudName: 'floor_plans', stateKey: 'floorPlans' },
      { cloudName: 'checklist', stateKey: 'checklist' },
      { cloudName: 'crew_records', stateKey: 'crewRecords' },
      { cloudName: 'teams', stateKey: 'teams' },
      { cloudName: 'material_norms', stateKey: 'materialNorms' }
    ];

    let batch = writeBatch(db);
    let operationCount = 0;
    const now = Date.now();

    for (const { cloudName, stateKey } of subNames) {
      const list = payloadData[stateKey];
      const localIds = new Set<string>();
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && item.id) localIds.add(item.id);
        }
      }

      // 1. Tombstone any Cloud records no longer present locally
      try {
        const existingSnap = await getDocs(collection(db, 'projects', project.id, cloudName));
        for (const docSnap of existingSnap.docs) {
          if (!localIds.has(docSnap.id)) {
            const docData = docSnap.data();
            if (!docData.deleted) {
              const docRef = doc(db, 'projects', project.id, cloudName, docSnap.id);
              batch.set(docRef, {
                id: docSnap.id,
                deleted: true,
                deletedAt: now,
                updatedAt: now
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
      } catch (err) {
        console.warn(`Reconcile stale cloud docs warning for ${cloudName}:`, err);
      }

      // 2. Upload active local records
      if (Array.isArray(list)) {
        for (const item of list) {
          if (!item || !item.id) continue;
          const docRef = doc(db, 'projects', project.id, cloudName, item.id);
          const sanitized = sanitizePayloadForCloud(item);

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
                updatedAt: Math.max(Number(current?.updatedAt || 0), Number(item.updatedAt || now)),
              }, { merge: true });
            });
            continue;
          }

          batch.set(docRef, {
            ...sanitized,
            deleted: false,
            deletedAt: null,
            updatedAt: item.updatedAt || now
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
 * Decouples project root metadata write from subcollection writes for ENGINEER role support
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

export async function saveProjectDiffsToCloud(
  projectId: string,
  projectName: string,
  contractorName: string,
  inspectorName: string,
  diffs: {
    addedOrModified: { [subcollection: string]: any[] };
    deletedIds: { [subcollection: string]: string[] };
  }
): Promise<void> {
  try {
    await ensureAuth();

    // 1. Try updating metadata (only if user has Admin/Owner permissions; ignore error if Engineer)
    try {
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
        syncCode: projectId.slice(0, 8).toUpperCase(),
        updatedByUid: currentUser?.uid || '',
        updatedByEmail: normalizeEmail(currentUser?.email),
        updatedByDeviceId: getDeviceId(),
        updatedByDeviceName: getDeviceName()
      };
      await setDoc(metadataRef, metaPayload, { merge: true });
    } catch (metaErr) {
      // Engineer role may not have permissions on root /projects/{projectId} document - this is expected
      console.warn('[Cloud Sync] Project metadata update skipped or disallowed for current role:', metaErr);
    }

    let batch = writeBatch(db);
    let operationCount = 0;
    const auditEntries: Array<{ module: string; action: string; recordId: string; description: string; changedFields?: Record<string, { before: any; after: any }>; beforeData?: any; afterData?: any }> = [];

    // 2. Process added / modified items in subcollections
    for (const [subName, items] of Object.entries(diffs.addedOrModified)) {
      for (const item of items) {
        if (!item.id) continue;
        const docRef = doc(db, 'projects', projectId, subName, item.id);
        const sanitized = sanitizePayloadForCloud(item);
        const beforeSnap = auditEntries.length < 120 ? await getDoc(docRef).catch(() => null) : null;
        const beforeData = beforeSnap && beforeSnap.exists() ? beforeSnap.data() : null;
        const changedFields = buildAuditChangedFields(beforeData || {}, sanitized);
        if (Object.keys(changedFields).length > 0 && auditEntries.length < 120) {
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
              updatedAt: Math.max(Number(current?.updatedAt || 0), Number(item.updatedAt || Date.now())),
              updatedByUid: currentUser?.uid || '',
              updatedByEmail: normalizeEmail(currentUser?.email),
              updatedByDeviceId: getDeviceId(),
              updatedByDeviceName: getDeviceName(),
            }, { merge: true });
          });
          continue;
        }

        batch.set(docRef, {
          ...sanitized,
          deleted: false,
          deletedAt: null,
          updatedAt: item.updatedAt || Date.now(),
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
    const now = Date.now();
    for (const [subName, ids] of Object.entries(diffs.deletedIds)) {
      for (const id of ids) {
        const docRef = doc(db, 'projects', projectId, subName, id);
        const beforeSnap = auditEntries.length < 120 ? await getDoc(docRef).catch(() => null) : null;
        const beforeData = beforeSnap && beforeSnap.exists() ? beforeSnap.data() : null;
        if (auditEntries.length < 120) {
          auditEntries.push({ module: subName, action: 'DELETE', recordId: id, description: `Xóa ${subName} · ${id}`, beforeData: auditSafeValue(beforeData || { id }) });
        }
        const currentUser = getCurrentAppUser();
        batch.set(docRef, {
          id,
          deleted: true,
          deletedAt: now,
          updatedAt: now,
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

    // Audit is append-only and written only after the business batch succeeds.
    // Failures here never roll back field work; they are surfaced for diagnostics.
    for (const entry of auditEntries) {
      await saveProjectAuditLog(projectId, {
        module: entry.module,
        action: entry.action,
        recordId: entry.recordId,
        description: entry.description,
        details: entry.description,
        changedFields: entry.changedFields,
        beforeData: entry.beforeData,
        afterData: entry.afterData,
      }).catch((err) => console.warn('Activity log write warning:', err));
    }
  } catch (err) {
    console.error("Firestore Save Diffs Error:", err);
    throw err;
  }
}

/**
 * Fetch a single project from Cloud by ID
 */
export async function fetchProjectFromCloud(projectId: string): Promise<CloudProjectRecord | null> {
  try {
    await ensureAuth();
    const snap = await getDoc(doc(db, 'projects', projectId));
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

      const subNames = [
        { cloudName: 'rooms', stateKey: 'roomProgressList' },
        { cloudName: 'inventory', stateKey: 'inventory' },
        { cloudName: 'defects', stateKey: 'defects' },
        { cloudName: 'work_volumes', stateKey: 'workVolumes' },
        { cloudName: 'floor_plans', stateKey: 'floorPlans' },
        { cloudName: 'checklist', stateKey: 'checklist' },
        { cloudName: 'crew_records', stateKey: 'crewRecords' },
        { cloudName: 'teams', stateKey: 'teams' },
        { cloudName: 'material_norms', stateKey: 'materialNorms' }
      ];

      for (const { cloudName, stateKey } of subNames) {
        const querySnap = await getDocs(collection(db, 'projects', projectId, cloudName));
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
    const subNames = [
      { cloudName: 'rooms', stateKey: 'roomProgressList' },
      { cloudName: 'inventory', stateKey: 'inventory' },
      { cloudName: 'defects', stateKey: 'defects' },
      { cloudName: 'work_volumes', stateKey: 'workVolumes' },
      { cloudName: 'floor_plans', stateKey: 'floorPlans' },
      { cloudName: 'checklist', stateKey: 'checklist' },
      { cloudName: 'crew_records', stateKey: 'crewRecords' },
      { cloudName: 'teams', stateKey: 'teams' },
      { cloudName: 'material_norms', stateKey: 'materialNorms' }
    ];

    subNames.forEach(({ cloudName, stateKey }) => {
      let isFirst = true;
      const unsub = onSnapshot(
        collection(db, 'projects', projectId, cloudName),
        (snap) => {
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
    unsubscribers.forEach((unsub) => unsub());
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
  const q = query(collection(db, 'projects', projectId, 'activityLogs'), orderBy('clientTimestamp', 'desc'), limit(Math.max(1, Math.min(500, maxItems))));
  // includeMetadataChanges lets the UI distinguish a locally queued/offline audit write
  // from a server-acknowledged entry without mutating the append-only log document.
  return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    onUpdate(snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      syncStatus: d.metadata.hasPendingWrites ? 'PENDING' : 'SYNCED',
    } as ProjectAuditCloudEntry)));
  }, (err) => console.warn('Project activity log realtime error:', err));
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
      backupName: backupName || `Bản sao lưu ${new Date().toLocaleString('vi-VN')}`,
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
          const acceptedRole = data.role || 'ENGINEER';
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

    const projectSnap = await getDoc(doc(db, 'projects', projectId));
    const projectName = projectSnap.exists() ? String(projectSnap.data()?.name || projectId) : projectId;

    // Write the backward-compatible invitation FIRST. The production project currently
    // still has V6.2.1 Rules because GitHub's service account cannot deploy newer Rules
    // (HTTP 403 firebaserules.rulesets.test). Under those Rules projectAccess is denied,
    // but projectInvitations is allowed. Previously the projectAccess failure aborted this
    // function before the invitation was created, leaving a visible member row in ADMIN
    // while VIEWER/ENGINEER saw "Danh sách dự án (0)".
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
    let targetUid = uid;

    if (!targetUid) {
      const membersSnap = await getDocs(collection(db, 'projects', projectId, 'members'));
      membersSnap.forEach((mDoc) => {
        const mData = mDoc.data();
        if (mData && mData.email === normalizedEmail) {
          targetUid = mDoc.id;
        }
      });
    }

    if (targetUid) {
      await deleteDoc(doc(db, 'projects', projectId, 'members', targetUid));
    }
    await deleteDoc(doc(db, 'projects', projectId, 'members', normalizedEmail)).catch(() => {});

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
export async function deleteCloudProject(projectId: string): Promise<void> {
  if (!projectId) return;
  try {
    await ensureAuth();
    await setDoc(doc(db, 'projects', projectId), {
      id: projectId,
      deleted: true,
      deletedAt: Date.now(),
      updatedAt: Date.now()
    }, { merge: true });
  } catch (err) {
    console.warn('deleteCloudProject error:', err);
  }
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
