import localforage from 'localforage';
import type { SendMessageInput } from '../lib/chatService';

export interface ChatOutboxEntry {
  id: string;
  input: SendMessageInput;
  createdAt: number;
}

const store = localforage.createInstance({
  name: 'ConstructionAppDB',
  storeName: 'chat_outbox',
});

export async function putChatOutbox(entry: ChatOutboxEntry): Promise<void> {
  await store.setItem(entry.id, entry);
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
