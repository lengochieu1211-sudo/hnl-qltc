import localforage from 'localforage';
import type { SendMessageInput } from '../lib/chatService';
import { writeAndVerifyChatOutbox } from './chatOutboxDurability';

export interface ChatOutboxEntry {
  id: string;
  input: SendMessageInput;
  createdAt: number;
  status?: 'pending' | 'failed';
  failureMessage?: string;
  failedAt?: number;
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

/** A permanent Firebase rejection must remain recoverable after app restart.
 * The original payload, account-specific key and clientMessageId never change.
 */
export async function markChatOutboxFailed(id: string, message: string): Promise<void> {
  const entry = await store.getItem<ChatOutboxEntry>(id);
  if (!entry) return; // Already confirmed on Cloud and removed by a successful send.
  const failedEntry: ChatOutboxEntry = {
    ...entry,
    status: 'failed',
    failureMessage: message.slice(0, 500),
    failedAt: Date.now(),
  };
  await writeAndVerifyChatOutbox(failedEntry,
    (key, value) => store.setItem(key, value),
    (key) => store.getItem<ChatOutboxEntry>(key),
  );
}

export async function listFailedChatOutbox(projectId: string, uid: string): Promise<ChatOutboxEntry[]> {
  if (!projectId || !uid) return [];
  const rows = await listChatOutbox();
  return rows.filter(row => row.status === 'failed'
    && row.input.projectId === projectId
    && row.id.startsWith(`${uid}_`));
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
