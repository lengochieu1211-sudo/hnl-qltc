/** Device-local recovery for a rejected chat send. No cloud writes or schema changes. */
export interface RecoverableChatEntry {
  id: string;
  input: { projectId: string; clientMessageId: string };
  createdAt: number;
  deliveryState?: 'blocked';
  failedMessage?: string;
}
export const markChatEntryBlocked = <T extends RecoverableChatEntry>(entry: T, reason: string): T => ({
  ...entry,
  deliveryState: 'blocked',
  failedMessage: String(reason || 'Tin nhắn chưa gửi được. Kiểm tra quyền rồi bấm Gửi lại.').slice(0, 250),
});
export function isChatEntryBlockedForUser(entry: RecoverableChatEntry, uid: string, projectId: string): boolean {
  return Boolean(uid && projectId && entry.deliveryState === 'blocked'
    && entry.id.startsWith(`${uid}_`)
    && entry.input?.projectId === projectId);
}
export const shouldAutoFlushChatEntry = (entry: RecoverableChatEntry): boolean => entry.deliveryState !== 'blocked';
