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
/** Verify the EXACT deterministic outbox ID, not a UID-prefix match.
 * UIDs may contain underscores and one UID may prefix another.
 * Legacy rows already contain input.clientMessageId, so no storage migration.
 */
export function chatOutboxEntryBelongsToUser(entry: RecoverableChatEntry, uid: string): boolean {
  if (!uid || !entry.id || !entry.input?.clientMessageId) return false;
  const expectedId = `${uid}_${entry.input.clientMessageId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 190);
  return entry.id === expectedId;
}
export function isChatEntryBlockedForUser(entry: RecoverableChatEntry, uid: string, projectId: string): boolean {
  return Boolean(uid && projectId && entry.deliveryState === 'blocked'
    && chatOutboxEntryBelongsToUser(entry, uid)
    && entry.input?.projectId === projectId);
}
export const shouldAutoFlushChatEntry = (entry: RecoverableChatEntry): boolean => entry.deliveryState !== 'blocked';

/** Prevent an offline retry from crossing Google account boundaries. */
export function isCurrentChatSender(expectedUid: string, currentUid?: string | null): boolean {
  return Boolean(expectedUid && currentUid && expectedUid === currentUid);
}
