import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
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
  getDocFromServer,
  query,
  orderBy
} from 'firebase/firestore';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const firestoreDatabaseId = import.meta.env.VITE_FIRESTORE_DATABASE_ID || '(default)';

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let anonymousSignInStarted = false;

function getFirebaseServices(): { db: Firestore; auth: Auth } | null {
  if (!isFirebaseConfigured) {
    return null;
  }

  if (!app) {
    app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  }

  if (!db) {
    db = initializeFirestore(app, {
      experimentalForceLongPolling: true,
    }, firestoreDatabaseId);
  }

  if (!auth) {
    auth = getAuth(app);
  }

  if (typeof window !== 'undefined' && !anonymousSignInStarted) {
    anonymousSignInStarted = true;
    signInAnonymously(auth).catch((err) => {
      console.warn('Firebase Anonymous Auth warning:', err);
    });
  }

  return { db, auth };
}

function requireFirestore(operationType: OperationType, path: string | null): Firestore {
  const services = getFirebaseServices();
  if (!services) {
    handleFirestoreError(
      new Error('Firebase chưa được cấu hình. Hãy thiết lập các biến VITE_FIREBASE_* khi deploy.'),
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
    path
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
}

export interface CloudBackupRecord {
  id: string;
  backupName: string;
  createdAt: string;
  projectCount: number;
  projects: any[];
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
 * Save / sync a single project to Firebase Cloud
 */
export async function saveProjectToCloud(project: { id: string; name: string; syncCode?: string; payload?: any; [key: string]: any }): Promise<void> {
  const firestore = requireFirestore(OperationType.WRITE, `projects/${project.id}`);
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

    const sanitizedPayload = sanitizePayloadForCloud(payloadData);
    const syncCode = project.syncCode || project.id.slice(0, 8).toUpperCase();
    
    const record: CloudProjectRecord = {
      id: project.id,
      name: project.name || 'Dự án',
      syncCode,
      updatedAt: new Date().toISOString(),
      updatedBy: typeof window !== 'undefined' ? window.navigator.userAgent : 'device',
      data: {
        id: project.id,
        name: project.name || 'Dự án',
        syncCode,
        payload: sanitizedPayload
      }
    };
    await setDoc(doc(firestore, 'projects', project.id), record);
  } catch (err) {
    console.error("Firestore Write Error:", err);
    throw new Error('Lỗi lưu dự án lên đám mây: Dữ liệu quá lớn hoặc mất kết nối.');
  }
}

/**
 * Fetch a single project from Cloud by ID
 */
export async function fetchProjectFromCloud(projectId: string): Promise<CloudProjectRecord | null> {
  const firestore = getFirebaseServices()?.db;
  if (!firestore) return null;

  try {
    const snap = await getDoc(doc(firestore, 'projects', projectId));
    if (snap.exists()) {
      return snap.data() as CloudProjectRecord;
    }
    return null;
  } catch (err) {
    console.error("Firestore Get Error:", err);
    return null;
  }
}

/**
 * Listen for real-time changes to a project for multi-phone / multi-PC live collaboration
 */
export function subscribeToCloudProject(projectId: string, onUpdate: (data: CloudProjectRecord) => void, onError?: (err: any) => void) {
  const firestore = getFirebaseServices()?.db;
  if (!firestore) {
    if (onError) {
      onError(new Error('Firebase chưa được cấu hình.'));
    }
    return () => {};
  }

  return onSnapshot(
    doc(firestore, 'projects', projectId),
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
  const firestore = requireFirestore(OperationType.WRITE, `cloud_backups/${backupId}`);
  try {
    const sanitizedProjects = sanitizePayloadForCloud(allProjects);
    
    const record: CloudBackupRecord = {
      id: backupId,
      backupName: backupName || `Bản sao lưu ${new Date().toLocaleString('vi-VN')}`,
      createdAt: new Date().toISOString(),
      projectCount: Array.isArray(sanitizedProjects) ? sanitizedProjects.length : 1,
      projects: sanitizedProjects
    };

    await setDoc(doc(firestore, 'cloud_backups', backupId), record);
    return backupId;
  } catch (err) {
    console.error("Firestore Backup Write Error:", err);
    throw new Error('Không thể lưu bản sao lưu lên Đám Mây: Dung lượng dữ liệu quá lớn hoặc mạng yếu.');
  }
}

/**
 * List all Cloud Backups
 */
export async function listCloudBackups(): Promise<CloudBackupRecord[]> {
  const firestore = getFirebaseServices()?.db;
  if (!firestore) return [];

  try {
    const q = query(collection(firestore, 'cloud_backups'), orderBy('createdAt', 'desc'));
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
  const firestore = getFirebaseServices()?.db;
  if (!firestore) return;

  try {
    await deleteDoc(doc(firestore, 'cloud_backups', backupId));
  } catch (err) {
    console.warn("Firestore Delete Backup Error:", err);
  }
}
