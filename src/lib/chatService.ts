import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, getCurrentRealFirebaseUser } from './firebase';
import type { ProjectChatMessage, ProjectConversationSummary, ChatReplyTo, ChatAttachment } from '../features/chat/types';

export const GENERAL_CONVERSATION_ID = 'general';
export const CHAT_PAGE_SIZE = 50;

const messageCollection = (projectId: string, conversationId = GENERAL_CONVERSATION_ID) =>
  collection(db, 'projects', projectId, 'conversations', conversationId, 'messages');

const conversationRef = (projectId: string, conversationId = GENERAL_CONVERSATION_ID) =>
  doc(db, 'projects', projectId, 'conversations', conversationId);

const readStateRef = (projectId: string, uid: string, conversationId = GENERAL_CONVERSATION_ID) =>
  doc(db, 'projects', projectId, 'conversations', conversationId, 'members', uid);

const toMillis = (value: any): number => {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return Math.round(value.seconds * 1000 + Number(value.nanoseconds || 0) / 1_000_000);
  return 0;
};

const mapMessage = (snap: QueryDocumentSnapshot | DocumentSnapshot): ProjectChatMessage => {
  const data = snap.data() as any;
  return {
    id: snap.id,
    conversationId: String(data?.conversationId || GENERAL_CONVERSATION_ID),
    projectId: String(data?.projectId || ''),
    senderUid: String(data?.senderUid || ''),
    senderEmail: String(data?.senderEmail || ''),
    senderName: String(data?.senderName || data?.senderEmail || 'Thành viên'),
    text: String(data?.text || ''),
    createdAt: data?.createdAt,
    createdAtMillis: toMillis(data?.createdAt),
    clientMessageId: String(data?.clientMessageId || snap.id),
    replyTo: data?.replyTo || null,
    mentions: Array.isArray(data?.mentions) ? data.mentions : [],
    attachments: Array.isArray(data?.attachments) ? data.attachments : [],
    editedAt: data?.editedAt,
    deletedAt: data?.deletedAt,
    deletedBy: data?.deletedBy,
    pending: snap.metadata?.hasPendingWrites || false,
  };
};

export function subscribeLatestMessages(
  projectId: string,
  conversationId: string,
  onUpdate: (messages: ProjectChatMessage[], cursor: QueryDocumentSnapshot | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!projectId) return () => {};
  const q = query(messageCollection(projectId, conversationId), orderBy('createdAt', 'desc'), limit(CHAT_PAGE_SIZE));
  return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    const messages = snap.docs.map(mapMessage).reverse();
    const cursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
    onUpdate(messages, cursor);
  }, (err) => onError?.(err));
}

export async function loadOlderMessages(
  projectId: string,
  conversationId: string,
  cursor: QueryDocumentSnapshot,
): Promise<{ messages: ProjectChatMessage[]; cursor: QueryDocumentSnapshot | null }> {
  const q = query(
    messageCollection(projectId, conversationId),
    orderBy('createdAt', 'desc'),
    startAfter(cursor),
    limit(CHAT_PAGE_SIZE),
  );
  const snap = await getDocs(q);
  return {
    messages: snap.docs.map(mapMessage).reverse(),
    cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
  };
}

export interface SendMessageInput {
  projectId: string;
  conversationId?: string;
  text: string;
  clientMessageId: string;
  replyTo?: ChatReplyTo | null;
  mentions?: string[];
  attachments?: ChatAttachment[];
}

export async function sendProjectMessage(input: SendMessageInput): Promise<string> {
  const user = getCurrentRealFirebaseUser();
  if (!user || !user.email) throw new Error('Bạn cần đăng nhập Google để gửi tin nhắn.');
  const conversationId = input.conversationId || GENERAL_CONVERSATION_ID;
  const cleanText = input.text.trim();
  const attachments = input.attachments || [];
  if (!cleanText && attachments.length === 0) throw new Error('Tin nhắn đang trống.');

  // Deterministic doc ID makes retries idempotent across offline/reconnect attempts.
  const messageId = `${user.uid}_${input.clientMessageId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 190);
  const msgRef = doc(messageCollection(input.projectId, conversationId), messageId);
  const existing = await getDoc(msgRef).catch(() => null);
  if (existing?.exists()) return existing.id;

  const batch = writeBatch(db);
  batch.set(msgRef, {
    id: messageId,
    conversationId,
    projectId: input.projectId,
    senderUid: user.uid,
    senderEmail: user.email.trim().toLowerCase(),
    senderName: user.displayName || user.email,
    text: cleanText,
    createdAt: serverTimestamp(),
    clientMessageId: input.clientMessageId,
    replyTo: input.replyTo || null,
    mentions: Array.from(new Set((input.mentions || []).filter(Boolean))),
    attachments,
    editedAt: null,
    deletedAt: null,
  });
  batch.set(conversationRef(input.projectId, conversationId), {
    id: conversationId,
    projectId: input.projectId,
    lastMessageAt: serverTimestamp(),
    lastMessageText: cleanText.slice(0, 180),
    lastSenderUid: user.uid,
    lastSenderName: user.displayName || user.email,
    lastMentions: Array.from(new Set((input.mentions || []).filter(Boolean))),
    messageCount: increment(1),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  return messageId;
}

export async function markConversationRead(projectId: string, conversationId = GENERAL_CONVERSATION_ID): Promise<void> {
  const user = getCurrentRealFirebaseUser();
  if (!user) return;
  const summary = await getDoc(conversationRef(projectId, conversationId)).catch(() => null);
  const messageCount = summary?.exists() ? Number(summary.data()?.messageCount || 0) : 0;
  await setDoc(readStateRef(projectId, user.uid, conversationId), {
    uid: user.uid,
    projectId,
    conversationId,
    lastReadAt: serverTimestamp(),
    lastReadMessageCount: messageCount,
  }, { merge: true });
}

export function subscribeConversationReadState(
  projectId: string,
  onUpdate: (lastReadAtMillis: number, lastReadMessageCount?: number) => void,
  conversationId = GENERAL_CONVERSATION_ID,
): Unsubscribe {
  const user = getCurrentRealFirebaseUser();
  if (!user) { onUpdate(0, 0); return () => {}; }
  return onSnapshot(readStateRef(projectId, user.uid, conversationId), (snap) => {
    onUpdate(toMillis(snap.data()?.lastReadAt), Number(snap.data()?.lastReadMessageCount || 0));
  }, () => onUpdate(0, 0));
}

export function subscribeConversationSummary(
  projectId: string,
  onUpdate: (summary: ProjectConversationSummary | null) => void,
  conversationId = GENERAL_CONVERSATION_ID,
): Unsubscribe {
  return onSnapshot(conversationRef(projectId, conversationId), (snap) => {
    if (!snap.exists()) { onUpdate(null); return; }
    const data = snap.data();
    onUpdate({
      projectId,
      conversationId,
      lastMessageAt: data.lastMessageAt,
      lastMessageAtMillis: toMillis(data.lastMessageAt),
      lastMessageText: data.lastMessageText,
      lastSenderUid: data.lastSenderUid,
      lastSenderName: data.lastSenderName,
      lastMentions: Array.isArray(data.lastMentions) ? data.lastMentions : [],
      messageCount: data.messageCount,
    });
  }, () => onUpdate(null));
}

export async function editOwnMessage(projectId: string, messageId: string, text: string, conversationId = GENERAL_CONVERSATION_ID): Promise<void> {
  const user = getCurrentRealFirebaseUser();
  if (!user) throw new Error('Bạn cần đăng nhập Google.');
  const ref = doc(messageCollection(projectId, conversationId), messageId);
  const snap = await getDoc(ref);
  if (!snap.exists() || snap.data().senderUid !== user.uid) throw new Error('Bạn chỉ có thể sửa tin nhắn của mình.');
  await updateDoc(ref, { text: text.trim(), editedAt: serverTimestamp() });
}

export async function softDeleteMessage(projectId: string, messageId: string, conversationId = GENERAL_CONVERSATION_ID): Promise<void> {
  const user = getCurrentRealFirebaseUser();
  if (!user) throw new Error('Bạn cần đăng nhập Google.');
  const ref = doc(messageCollection(projectId, conversationId), messageId);
  await updateDoc(ref, { deletedAt: serverTimestamp(), deletedBy: user.uid, text: '' });
}

export async function findMentionableMembers(projectId: string, searchText: string): Promise<Array<{ uid: string; email: string; name: string; role: string }>> {
  // Members are project-scoped; never query global Firebase users.
  const membersRef = collection(db, 'projects', projectId, 'members');
  const snap = await getDocs(membersRef);
  const q = searchText.trim().toLowerCase();
  const dedup = new Map<string, { uid: string; email: string; name: string; role: string }>();
  snap.forEach((memberSnap) => {
    const data = memberSnap.data() as any;
    if (data?.active === false) return;
    const uid = String(data.uid || memberSnap.id);
    const email = String(data.email || '').toLowerCase();
    const name = String(data.name || data.displayName || email || 'Thành viên');
    const role = String(data.role || 'VIEWER');
    if (q && !name.toLowerCase().includes(q) && !email.includes(q)) return;
    const key = uid || email;
    if (!dedup.has(key)) dedup.set(key, { uid, email, name, role });
  });
  return Array.from(dedup.values()).slice(0, 20);
}
