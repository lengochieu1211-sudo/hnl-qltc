import { initializeApp, getApps } from 'firebase/app';
import { 
  initializeFirestore, 
  persistentLocalCache,
  persistentMultipleTabManager,
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
  writeBatch
} from 'firebase/firestore';
import { getAuth, signInAnonymously, signInWithPopup, GoogleAuthProvider, signOut as fbSignOut, onAuthStateChanged, User } from 'firebase/auth';
const env = (import.meta as any).env || {};
const isDev = env.DEV || env.MODE === 'development' || !env.PROD;

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

export const isFirebaseConfigured = Boolean(
  env.VITE_FIREBASE_API_KEY &&
  !env.VITE_FIREBASE_API_KEY.includes('YOUR_') &&
  !env.VITE_FIREBASE_API_KEY.includes('mock') &&
  env.VITE_FIREBASE_PROJECT_ID &&
  !env.VITE_FIREBASE_PROJECT_ID.includes('mock')
);

if (!isDev && !isFirebaseConfigured) {
  console.error('⚠️ THIẾU CẤU HÌNH FIREBASE TRONG MÔI TRƯỜNG PRODUCTION! Ứng dụng sẽ hoạt động ở chế độ Offline/Local Storage. Vui lòng khai báo đầy đủ các biến VITE_FIREBASE_* trước khi build APK/Web App.');
}

const firebaseConfig = {
  apiKey: sanitizeConfigValue(env.VITE_FIREBASE_API_KEY, 'AIzaSy-mock'),
  authDomain: sanitizeConfigValue(env.VITE_FIREBASE_AUTH_DOMAIN, 'mock-project.firebaseapp.com'),
  projectId: sanitizeConfigValue(env.VITE_FIREBASE_PROJECT_ID, 'mock-project'),
  storageBucket: sanitizeConfigValue(env.VITE_FIREBASE_STORAGE_BUCKET, 'mock-project.appspot.com'),
  messagingSenderId: sanitizeConfigValue(env.VITE_FIREBASE_MESSAGING_SENDER_ID, '1234567890'),
  appId: sanitizeConfigValue(env.VITE_FIREBASE_APP_ID, '1:1234567890:web:abcdef'),
  firestoreDatabaseId: env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || env.VITE_FIRESTORE_DATABASE_ID || '(default)'
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];
const dbId = firebaseConfig.firestoreDatabaseId;

let dbInstance: any;
try {
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    }),
    experimentalForceLongPolling: true,
  }, dbId);
} catch (e) {
  console.warn('Firestore persistentLocalCache initialization failed, falling back to long polling only config:', e);
  dbInstance = initializeFirestore(app, {
    experimentalForceLongPolling: true,
  }, dbId);
}

export const db = dbInstance;

export const auth = getAuth(app);

let localMockUser: User | null = null;
const authListeners: Array<(user: User | null) => void> = [];

function normalizeEmail(email?: string | null): string {
  return (email || '').trim().toLowerCase();
}

function getCurrentAppUser(): User | null {
  return auth.currentUser || localMockUser || getStoredLocalUser();
}

function getMemberDocIdsForUser(user: { uid?: string | null; email?: string | null }): string[] {
  const ids = new Set<string>();
  if (user.uid) ids.add(user.uid);
  const email = normalizeEmail(user.email);
  if (email) ids.add(email);
  return Array.from(ids);
}

async function writeProjectMemberDocs(
  projectId: string,
  member: { uid?: string | null; email: string; role: string; active?: boolean; assignedAt?: number }
): Promise<void> {
  const normalizedEmail = normalizeEmail(member.email);
  if (!projectId || !normalizedEmail) return;

  const payload = {
    ...(member.uid ? { uid: member.uid } : {}),
    email: normalizedEmail,
    role: member.role,
    active: member.active !== false,
    assignedAt: member.assignedAt || Date.now(),
    updatedAt: Date.now()
  };

  const ids = new Set<string>([normalizedEmail]);
  if (member.uid) ids.add(member.uid);
  for (const id of ids) {
    await setDoc(doc(db, 'projects', projectId, 'members', id), payload, { merge: true });
  }
}

function getStoredLocalUser(): User | null {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('construction_app_local_user') : null;
    if (raw) {
      return JSON.parse(raw) as User;
    }
  } catch (_) {}
  return null;
}

function notifyAuthListeners(user: User | null) {
  authListeners.forEach(cb => {
    try {
      cb(user);
    } catch (_) {}
  });
}

function createLocalMockUser(email: string): User {
  const cleanEmail = email.trim().toLowerCase();
  const displayName = cleanEmail.split('@')[0];
  const uid = 'local_' + btoa(encodeURIComponent(cleanEmail)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
  const mockUser: any = {
    uid,
    email: cleanEmail,
    displayName,
    photoURL: '',
    emailVerified: true,
    isAnonymous: false,
    metadata: {
      creationTime: new Date().toISOString(),
      lastSignInTime: new Date().toISOString()
    },
    providerData: [
      {
        providerId: 'google.com',
        uid: cleanEmail,
        email: cleanEmail,
        displayName,
        photoURL: '',
        phoneNumber: null
      }
    ],
    getIdToken: async () => 'mock-token-' + Date.now(),
    getIdTokenResult: async () => ({
      token: 'mock-token-' + Date.now(),
      claims: {},
      authTime: new Date().toISOString(),
      issuedAtTime: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 3600000).toISOString(),
      signInProvider: 'google.com'
    }),
    reload: async () => {},
    toJSON: () => ({ uid, email: cleanEmail, displayName })
  };

  try {
    localStorage.setItem('construction_app_last_login_email', cleanEmail);
    localStorage.setItem('construction_app_local_user', JSON.stringify(mockUser));
  } catch (_) {}

  localMockUser = mockUser;
  notifyAuthListeners(mockUser);
  return mockUser;
}

export async function ensureAuth(): Promise<void> {
  // Do not auto sign-in anonymously if user is already present or to avoid anonymous access
  if (auth.currentUser || localMockUser || getStoredLocalUser()) return;
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

  // Offline / Local / Unconfigured fallback
  const lastEmail = typeof window !== 'undefined' ? (localStorage.getItem('construction_app_last_login_email') || 'lengochieu1211@gmail.com') : 'lengochieu1211@gmail.com';
  const emailInput = typeof window !== 'undefined'
    ? window.prompt('Hệ thống đang hoạt động ở chế độ Offline/Local.\nNhập email Google để xác thực tài khoản:', lastEmail)
    : lastEmail;

  if (!emailInput || !emailInput.trim()) {
    return null;
  }

  return createLocalMockUser(emailInput.trim());
}

export async function signOutGoogle(): Promise<void> {
  try {
    if (isFirebaseConfigured) {
      await fbSignOut(auth).catch(() => {});
    }
  } catch (err: any) {
    console.warn('Google Sign-Out Error:', err);
  } finally {
    localMockUser = null;
    try {
      localStorage.removeItem('construction_app_local_user');
    } catch (_) {}
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

export function onAuthUserChanged(callback: (user: User | null) => void): () => void {
  authListeners.push(callback);
  
  // Initial callback with current user
  const initial = getCurrentFirebaseUser();
  try {
    callback(initial);
  } catch (_) {}

  const fbUnsub = onAuthStateChanged(auth, (user) => {
    if (user) {
      callback(user);
    } else if (localMockUser) {
      callback(localMockUser);
    } else {
      callback(getStoredLocalUser());
    }
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

/**
 * Claim or recover ownership for projects lacking an owner or matching the owner email
 */
export async function claimProjectOwnership(
  projectId: string,
  user: User
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
        ownerUid: user.uid,
        ownerEmail: userEmail,
        updatedAt: Date.now()
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

/**
 * Save / sync a single project to Firebase Cloud using modern subcollections
 */
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

      await setDoc(metadataRef, {
        id: project.id,
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
      const metaPayload: Record<string, any> = {
        id: projectId,
        name: projectName,
        contractorName,
        inspectorName,
        updatedAt: Date.now(),
        schemaVersion: 2, // Subcollection mode
        syncCode: projectId.slice(0, 8).toUpperCase(),
        updatedBy: typeof window !== 'undefined' ? window.navigator.userAgent : 'device'
      };
      await setDoc(metadataRef, metaPayload, { merge: true });
    } catch (metaErr) {
      // Engineer role may not have permissions on root /projects/{projectId} document - this is expected
      console.warn('[Cloud Sync] Project metadata update skipped or disallowed for current role:', metaErr);
    }

    let batch = writeBatch(db);
    let operationCount = 0;

    // 2. Process added / modified items in subcollections
    for (const [subName, items] of Object.entries(diffs.addedOrModified)) {
      for (const item of items) {
        if (!item.id) continue;
        const docRef = doc(db, 'projects', projectId, subName, item.id);
        const sanitized = sanitizePayloadForCloud(item);
        
        batch.set(docRef, {
          ...sanitized,
          deleted: false,
          deletedAt: null,
          updatedAt: item.updatedAt || Date.now()
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
        batch.set(docRef, {
          id,
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

    if (operationCount > 0) {
      await batch.commit();
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
    
    // If schemaVersion is 2, reconstruct full project data by fetching subcollections
    if (meta.schemaVersion === 2) {
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
  onSubcollectionUpdate: (subcollectionName: string, items: any[], isInitial: boolean) => void,
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
          const items: any[] = [];
          snap.forEach((docSnap) => {
            items.push({ id: docSnap.id, ...docSnap.data() });
          });
          if (stateKey === 'floorPlans' && Array.isArray(items)) {
            items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          }
          onSubcollectionUpdate(stateKey, items, isFirst);
          isFirst = false;
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
          await writeProjectMemberDocs(data.projectId, {
            uid: user.uid,
            email: normalizedEmail,
            role: data.role || 'ENGINEER',
            active: true
          }).catch((err) => console.warn('Could not materialize invitation as member:', err));
          await deleteDoc(doc(db, 'projectInvitations', invDoc.id)).catch(() => {});
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
    let targetUid = member.uid;

    if (!targetUid) {
      // Find UID from users collection
      const userSnap = await getDocs(query(collection(db, 'users')));
      userSnap.forEach((uDoc) => {
        const uData = uDoc.data();
        if (uData && uData.email === normalizedEmail) {
          targetUid = uDoc.id;
        }
      });
    }

    await writeProjectMemberDocs(projectId, {
      uid: targetUid,
      email: normalizedEmail,
      role: member.role,
      active: true,
      assignedAt: member.assignedAt
    });

    // Keep an invitation record as a compatibility hint for first login on older builds.
    const invId = `${projectId}_${normalizedEmail}`;
    await setDoc(doc(db, 'projectInvitations', invId), {
      projectId,
      email: normalizedEmail,
      invitedEmail: normalizedEmail,
      role: member.role,
      createdByUid: getCurrentAppUser()?.uid || null,
      createdAt: Date.now()
    }, { merge: true }).catch(() => {});
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
