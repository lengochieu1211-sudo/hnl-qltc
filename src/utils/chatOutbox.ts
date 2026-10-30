import localforage from 'localforage';
import type { SendMessageInput } from '../lib/chatService';
import { writeAndVerifyChatOutbox } from './chatOutboxDurability';
import { isChatEntryBlockedForUser, markChatEntryBlocked, type RecoverableChatEntry } from './chatOutboxRecovery';

export interface ChatOutboxEntry extends RecoverableChatEntry {
  id: string;
  input: SendMessageInput;
  createdAt: number;
}

const store = localforage.createInstance({
  name: 'ConstructionAppDB',
  storeName: 'chat_outbox',
});

/** Persist and read back before a send can be acknowledged as queued.
 * An IndexedDB/quota failure must NEVER be silently treated as an offline queue.
 */
export async function putChatOutbox(entry: ChatOutboxEntry): Promise<void> {
  await writeAndVerifyChatOutbox(entry,
    (id, value) => store.setItem(id, value),
    (id) => store.getItem<ChatOutboxEntry>(id),
  );
}

/** Keep rejected messages recoverable without retrying when authorization is revoked. */
export async function blockChatOutbox(id: string, reason: string): Promise<void> {
  const original = await store.getItem<ChatOutboxEntry>(id);
  if (!original) return;
  await putChatOutbox(markChatEntryBlocked(original, reason));
}

/** Filter by BOTH current Firebase UID and project; never reveal another account's draft. */
export async function listBlockedChatOutbox(uid: string, projectId: string): Promise<ChatOutboxEntry[]> {
  if (!uid || !projectId) return [];
  const rows = await listChatOutbox();
  return rows.filter((row) => isChatEntryBlockedForUser(row, uid, projectId));
}

export async function removeChatOutbox(id: string): Promise<void> {
  await store.removeItem(id);
}

export async function listChatOutbox(): Promise<ChatOutboxEntry[]> {
  const rows: ChatOutboxEntry[] = [];
  await store.iterate<ChatOutboxEntry, void>((value) => {
    if (value?.id && value?.input) rows.push(value);
  });
  rows.sort((a, b) => a.createdAt - b.createdAt);
  return rows;
}
