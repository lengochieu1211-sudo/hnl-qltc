import { initializeApp, getApps, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  initializeFirestore,
  type Firestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { GoogleAuthStatus } from '../types';

function readEnvFirebaseConfig(): FirebaseOptions {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  };
}

function hasFirebaseConfig(config: FirebaseOptions | null): config is FirebaseOptions {
  return Boolean(config?.apiKey && config?.projectId);
}

async function loadFirebaseConfig(): Promise<FirebaseOptions | null> {
  const envConfig = readEnvFirebaseConfig();
  if (hasFirebaseConfig(envConfig)) {
    return envConfig;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const response = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }

    const hostingConfig = await response.json();
    return hasFirebaseConfig(hostingConfig) ? hostingConfig : null;
  } catch (err) {
    console.warn('Firebase Hosting config unavailable:', err);
    return null;
  }
}

const firestoreDatabaseId = import.meta.env.VITE_FIRESTORE_DATABASE_ID || '(default)';

export const isFirebaseConfigured = hasFirebaseConfig(readEnvFirebaseConfig());

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let servicesPromise: Promise<{ db: Firestore; auth: Auth } | null> | null = null;
let anonymousSignInPromise: Promise<void> | null = null;

async function ensureAnonymousAuth(authInstance: Auth): Promise<void> {
  if (typeof window === 'undefined' || authInstance.currentUser) {
    return;
  }

  if (!anonymousSignInPromise) {
    anonymousSignInPromise = signInAnonymously(authInstance)
      .then(() => undefined)
      .catch((err) => {
        anonymousSignInPromise = null;
        console.warn('Firebase Anonymous Auth warning:', err);
      });
  }

  await anonymousSignInPromise;
}

function getGoogleProfile(user: User | null): GoogleAuthStatus {
  if (!user || user.isAnonymous) {
    return { authenticated: false };
  }

  return {
    authenticated: true,
    email: user.email || undefined,
    name: user.displayName || undefined,
    picture: user.photoURL || undefined,
  };
}

async function getFirebaseServices(): Promise<{ db: Firestore; auth: Auth } | null> {
  if (servicesPromise) {
    return servicesPromise;
  }

  servicesPromise = (async () => {
    const firebaseConfig = await loadFirebaseConfig();
    if (!firebaseConfig) {
      return null;
    }

    if (!app) {
      app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    }

    if (!db) {
      db = initializeFirestore(
        app,
        {
          experimentalForceLongPolling: true,
        },
        firestoreDatabaseId
      );
    }

    if (!auth) {
      auth = getAuth(app);
    }

    await ensureAnonymousAuth(auth);

    return { db, auth };
  })();

  return servicesPromise;
}

export async function getFirebaseAuthStatus(): Promise<GoogleAuthStatus> {
  const services = await getFirebaseServices();
  if (!services) {
    return { authenticated: false };
  }

  return getGoogleProfile(services.auth.currentUser);
}

export function subscribeToFirebaseAuthStatus(onUpdate: (status: GoogleAuthStatus) => void) {
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;

  getFirebaseServices()
    .then((services) => {
      if (cancelled) return;
      if (!services) {
        onUpdate({ authenticated: false });
        return;
      }

      unsubscribe = onAuthStateChanged(services.auth, (user) => {
        onUpdate(getGoogleProfile(user));
      });
    })
    .catch((err) => {
      console.warn('Firebase Auth status warning:', err);
      if (!cancelled) {
        onUpdate({ authenticated: false });
      }
    });

  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

export async function signInWithGoogleAccount(): Promise<GoogleAuthStatus> {
  const services = await getFirebaseServices();
  if (!services) {
    throw new Error('Firebase is not configured yet.');
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(services.auth, provider);
  return getGoogleProfile(result.user);
}

export async function signOutFirebaseAccount(): Promise<void> {
  const services = await getFirebaseServices();
  if (!services) {
    return;
  }

  await signOut(services.auth);
  anonymousSignInPromise = null;
  await ensureAnonymousAuth(services.auth);
}

async function requireFirestore(operationType: OperationType, path: string | null): Promise<Firestore> {
  const services = await getFirebaseServices();
  if (!services) {
    handleFirestoreError(
      new Error('Firebase is not configured. Deploy to Firebase Hosting or set VITE_FIREBASE_* variables.'),
      operationType,
      path
    );
  }

  return services.db;
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

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {},
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface CloudProjectRecord {
  id: string;
  name: string;
  syncCode?: string;
  updatedAt: string;
  updatedBy?: string;
  data: any;
  payloadChunked?: boolean;
  chunkCount?: number;
  payloadSize?: number;
}

export interface CloudBackupRecord {
  id: string;
  backupName: string;
  createdAt: string;
  projectCount: number;
  projects: any[];
  payloadChunked?: boolean;
  chunkCount?: number;
  payloadSize?: number;
}

const FIRESTORE_INLINE_JSON_LIMIT = 700 * 1024;
const FIRESTORE_CHUNK_SIZE = 650 * 1024;

function splitString(value: string, size = FIRESTORE_CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += size) {
    chunks.push(value.slice(i, i + size));
  }
  return chunks.length ? chunks : [''];
}

async function clearPayloadChunks(firestore: Firestore, parentCollection: 'projects' | 'cloud_backups', docId: string) {
  const snap = await getDocs(collection(firestore, parentCollection, docId, 'chunks'));
  await Promise.all(snap.docs.map((chunkDoc) => deleteDoc(chunkDoc.ref)));
}

async function replacePayloadChunks(
  firestore: Firestore,
  parentCollection: 'projects' | 'cloud_backups',
  docId: string,
  chunks: string[]
) {
  await clearPayloadChunks(firestore, parentCollection, docId);
  await Promise.all(
    chunks.map((chunk, index) => setDoc(doc(firestore, parentCollection, docId, 'chunks', String(index).padStart(6, '0')), {
      index,
      total: chunks.length,
      data: chunk,
    }))
  );
}

async function readPayloadChunks<T>(
  firestore: Firestore,
  parentCollection: 'projects' | 'cloud_backups',
  docId: string
): Promise<T> {
  const q = query(collection(firestore, parentCollection, docId, 'chunks'), orderBy('index', 'asc'));
  const snap = await getDocs(q);
  const payloadJson = snap.docs.map((chunkDoc) => String(chunkDoc.data().data || '')).join('');
  return JSON.parse(payloadJson) as T;
}

async function hydrateProjectRecord(firestore: Firestore, projectId: string, record: CloudProjectRecord): Promise<CloudProjectRecord> {
  if (record.payloadChunked || record.data?.payloadChunked) {
    const payload = await readPayloadChunks<Record<string, string>>(firestore, 'projects', projectId);
    return {
      ...record,
      data: {
        ...(record.data || {}),
        payload,
      },
    };
  }

  return record;
}

async function hydrateBackupRecord(firestore: Firestore, backupId: string, record: CloudBackupRecord): Promise<CloudBackupRecord> {
  if (record.payloadChunked) {
    const projects = await readPayloadChunks<any[]>(firestore, 'cloud_backups', backupId);
    return {
      ...record,
      projects,
    };
  }

  return record;
}

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

export function sanitizePayloadForCloud(obj: any): any {
  if (obj === undefined) return null;
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizePayloadForCloud).filter((item) => item !== undefined);

  const copy: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val === undefined) {
      continue;
    }
    if (typeof val === 'string' && val.startsWith('data:image/') && val.length > 50000) {
      copy[key] = '[IMAGE_OMITTED_FOR_CLOUD_SIZE_LIMIT]';
    } else if (typeof val === 'object' && val !== null) {
      copy[key] = sanitizePayloadForCloud(val);
    } else {
      copy[key] = val;
    }
  }
  return copy;
}

export async function saveProjectToCloud(project: {
  id: string;
  name: string;
  syncCode?: string;
  payload?: any;
  [key: string]: any;
}): Promise<void> {
  const firestore = await requireFirestore(OperationType.WRITE, `projects/${project.id}`);
  try {
    let payloadData = project.payload;
    if (!payloadData) {
      const copy = { ...project };
      delete copy.id;
      delete copy.name;
      delete copy.syncCode;
      delete copy.updatedAt;
      delete copy.updatedBy;
      payloadData = copy;
    }

    const syncCode = project.syncCode || project.id.slice(0, 8).toUpperCase();
    const payloadJson = JSON.stringify(payloadData || {});
    const chunks = payloadJson.length > FIRESTORE_INLINE_JSON_LIMIT ? splitString(payloadJson) : [];

    const record: CloudProjectRecord = {
      id: project.id,
      name: project.name || 'Du an',
      syncCode,
      updatedAt: new Date().toISOString(),
      updatedBy: typeof window !== 'undefined' ? window.navigator.userAgent : 'device',
      payloadChunked: chunks.length > 0,
      chunkCount: chunks.length,
      payloadSize: payloadJson.length,
      data: {
        id: project.id,
        name: project.name || 'Du an',
        syncCode,
        payload: chunks.length > 0 ? null : JSON.parse(payloadJson),
        payloadChunked: chunks.length > 0,
        chunkCount: chunks.length,
      },
    };

    if (chunks.length > 0) {
      await replacePayloadChunks(firestore, 'projects', project.id, chunks);
    } else {
      await clearPayloadChunks(firestore, 'projects', project.id);
    }

    await setDoc(doc(firestore, 'projects', project.id), record);
  } catch (err) {
    console.error('Firestore Write Error:', err);
    throw new Error('Loi luu du an len dam may: du lieu qua lon hoac mat ket noi.');
  }
}

export async function fetchProjectFromCloud(projectId: string): Promise<CloudProjectRecord | null> {
  const firestore = (await getFirebaseServices())?.db;
  if (!firestore) return null;

  try {
    const snap = await getDoc(doc(firestore, 'projects', projectId));
    if (!snap.exists()) return null;
    return await hydrateProjectRecord(firestore, projectId, snap.data() as CloudProjectRecord);
  } catch (err) {
    console.error('Firestore Get Error:', err);
    return null;
  }
}

export function subscribeToCloudProject(
  projectId: string,
  onUpdate: (data: CloudProjectRecord) => void,
  onError?: (err: any) => void
) {
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;

  getFirebaseServices()
    .then((services) => {
      if (cancelled) return;
      if (!services) {
        onError?.(new Error('Firebase is not configured.'));
        return;
      }

      unsubscribe = onSnapshot(
        doc(services.db, 'projects', projectId),
        async (snap) => {
          if (snap.exists()) {
            try {
              onUpdate(await hydrateProjectRecord(services.db, projectId, snap.data() as CloudProjectRecord));
            } catch (err) {
              console.warn('Firestore Chunk Hydration Error:', err);
              onError?.(err);
            }
          }
        },
        (err) => {
          console.warn('Firestore Snapshot Error:', err);
          onError?.(err);
        }
      );
    })
    .catch((err) => {
      if (!cancelled) {
        onError?.(err);
      }
    });

  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

export async function saveCloudBackup(backupName: string, allProjects: any[]): Promise<string> {
  const backupId = `backup_${Date.now()}`;
  const firestore = await requireFirestore(OperationType.WRITE, `cloud_backups/${backupId}`);
  try {
    const payloadJson = JSON.stringify(allProjects || []);
    const chunks = payloadJson.length > FIRESTORE_INLINE_JSON_LIMIT ? splitString(payloadJson) : [];

    const record: CloudBackupRecord = {
      id: backupId,
      backupName: backupName || `Backup ${new Date().toLocaleString('vi-VN')}`,
      createdAt: new Date().toISOString(),
      projectCount: Array.isArray(allProjects) ? allProjects.length : 1,
      projects: chunks.length > 0 ? [] : JSON.parse(payloadJson),
      payloadChunked: chunks.length > 0,
      chunkCount: chunks.length,
      payloadSize: payloadJson.length,
    };

    if (chunks.length > 0) {
      await replacePayloadChunks(firestore, 'cloud_backups', backupId, chunks);
    }

    await setDoc(doc(firestore, 'cloud_backups', backupId), record);
    return backupId;
  } catch (err) {
    console.error('Firestore Backup Write Error:', err);
    throw new Error('Khong the luu ban sao luu len dam may: du lieu qua lon hoac mang yeu.');
  }
}

export async function listCloudBackups(): Promise<CloudBackupRecord[]> {
  const firestore = (await getFirebaseServices())?.db;
  if (!firestore) return [];

  try {
    const q = query(collection(firestore, 'cloud_backups'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    const results: CloudBackupRecord[] = [];
    for (const docSnap of snap.docs) {
      results.push(await hydrateBackupRecord(firestore, docSnap.id, docSnap.data() as CloudBackupRecord));
    }
    return results;
  } catch (err) {
    console.warn('Firestore List Backups Error:', err);
    return [];
  }
}

export async function deleteCloudBackup(backupId: string): Promise<void> {
  const firestore = (await getFirebaseServices())?.db;
  if (!firestore) return;

  try {
    await clearPayloadChunks(firestore, 'cloud_backups', backupId);
    await deleteDoc(doc(firestore, 'cloud_backups', backupId));
  } catch (err) {
    console.warn('Firestore Delete Backup Error:', err);
  }
}
