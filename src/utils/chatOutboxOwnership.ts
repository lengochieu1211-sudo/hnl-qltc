/** Keep legacy message IDs; validate FULL UID and client-message ownership. */
export function deterministicMessageId(uid: string, clientMessageId: string): string {
  return `${uid}_${clientMessageId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 190);
}
export function isChatOutboxEntryOwnedByUid(id: string, uid: string, clientMessageId: string): boolean {
  return Boolean(id && uid && clientMessageId) && id === deterministicMessageId(uid, clientMessageId);
}
