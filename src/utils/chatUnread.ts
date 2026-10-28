/** Project chat unread badge: message counts are authoritative when present.
 * Server timestamps are a fallback ONLY for pre-count legacy records.
 * Do not combine both via `||`: Firestore serverTimestamp() can be later than
 * the last sent timestamp even when all messages have been read. */
export function getChatUnreadCount(
  totalCount: number | null | undefined,
  lastReadCount: number | null | undefined,
  lastMessageAt: number,
  lastReadAt: number,
): number {
  if (typeof totalCount === 'number' && typeof lastReadCount === 'number' && Number.isFinite(totalCount) && Number.isFinite(lastReadCount) && totalCount >= 0 && lastReadCount >= 0) {
    return Math.max(0, Math.trunc(totalCount) - Math.trunc(lastReadCount));
  }
  // Missing or malformed counters on legacy docs: use timestamps conservatively.
  return lastMessageAt > 0 && lastMessageAt > lastReadAt ? 1 : 0;
}
