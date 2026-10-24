/**
 * Chat can report a queued message only after a device-local copy survives a
 * successful write + read-back. Firebase's offline cache is not this guarantee.
 * Injected storage functions allow quota/IndexedDB failure regression tests.
 */
export interface DurableChatEntry {
  id: string;
  input: { clientMessageId: string };
}

export async function writeAndVerifyChatOutbox<T extends DurableChatEntry>(
  entry: T,
  write: (id: string, value: T) => Promise<unknown>,
  read: (id: string) => Promise<T | null>,
): Promise<void> {
  try {
    await write(entry.id, entry);
    const stored = await read(entry.id);
    if (!stored || stored.id !== entry.id || JSON.stringify(stored) !== JSON.stringify(entry)) {
      throw new Error('Outbox read-back mismatch');
    }
  } catch (error) {
    console.warn('[Chat outbox] Durable local storage unavailable:', error);
    throw new Error('Không lưu được tin nhắn vào bộ nhớ thiết bị. Tin chưa được gửi; nội dung vẫn ở ô soạn. Hãy giải phóng dung lượng hoặc kiểm tra bộ nhớ rồi thử lại.');
  }
}
