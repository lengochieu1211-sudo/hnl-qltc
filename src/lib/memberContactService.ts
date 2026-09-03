import { collection, doc, getDocs, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from './firebaseBase';

export interface ProjectMemberContact {
  email: string;
  phone?: string;
  displayName?: string;
  projectId: string;
  updatedAt?: number;
  updatedByUid?: string;
  updatedByEmail?: string;
}

function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

function mapContact(data: any, id = ''): ProjectMemberContact | null {
  const email = normalizeEmail(data?.email || id);
  if (!email) return null;
  return {
    email,
    phone: String(data?.phone || '').trim() || undefined,
    displayName: String(data?.displayName || '').trim() || undefined,
    projectId: String(data?.projectId || '').trim(),
    updatedAt: typeof data?.updatedAt === 'number' ? data.updatedAt : undefined,
    updatedByUid: String(data?.updatedByUid || '').trim() || undefined,
    updatedByEmail: normalizeEmail(data?.updatedByEmail || '') || undefined,
  };
}

export async function fetchProjectMemberContactsFromCloud(projectId: string): Promise<ProjectMemberContact[]> {
  if (!projectId) return [];
  const snapshot = await getDocs(collection(db, 'projects', projectId, 'memberContacts'));
  return snapshot.docs
    .map((item) => mapContact(item.data(), item.id))
    .filter((item): item is ProjectMemberContact => Boolean(item));
}

export function subscribeProjectMemberContactsRealtime(
  projectId: string,
  onUpdate: (contacts: ProjectMemberContact[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  if (!projectId) return () => {};
  return onSnapshot(
    collection(db, 'projects', projectId, 'memberContacts'),
    (snapshot) => {
      const contacts = snapshot.docs
        .map((item) => mapContact(item.data(), item.id))
        .filter((item): item is ProjectMemberContact => Boolean(item));
      onUpdate(contacts);
    },
    (error) => {
      // VIEWER is intentionally denied by Firestore Rules. Callers may ignore the
      // permission-denied callback and render the member list without private contact data.
      onError?.(error);
    },
  );
}

export async function saveProjectMemberContactToCloud(
  projectId: string,
  input: { email: string; phone?: string; displayName?: string },
): Promise<void> {
  const email = normalizeEmail(input.email);
  if (!projectId || !email) throw new Error('Thiếu projectId hoặc email thành viên.');
  const actor = auth.currentUser;
  if (!actor) throw new Error('Cần đăng nhập Firebase trước khi lưu liên hệ thành viên.');
  const updatedByEmail = normalizeEmail(actor.email || '');
  if (!updatedByEmail) throw new Error('Tài khoản Firebase hiện tại chưa có email để ghi nhật ký liên hệ.');

  await setDoc(doc(db, 'projects', projectId, 'memberContacts', email), {
    projectId,
    email,
    phone: String(input.phone || '').trim(),
    displayName: String(input.displayName || '').trim(),
    updatedAt: Date.now(),
    updatedByUid: actor.uid,
    updatedByEmail,
  }, { merge: true });
}
