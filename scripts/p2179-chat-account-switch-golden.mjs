import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chatOutboxEntryBelongsToUser, isChatEntryBlockedForUser, isCurrentChatSender } from '../src/utils/chatOutboxRecovery.ts';

assert.equal(isCurrentChatSender('user-A', 'user-A'), true);
for (const currentUid of ['user-B', '', null, undefined]) {
  assert.equal(isCurrentChatSender('user-A', currentUid), false,
    'Do not send or acknowledge user-A outbox under another account');
}
assert.equal(isCurrentChatSender('', 'user-A'), false);
const sharedProject = 'p1';
const prefixedOtherUid = 'user-A_other';
const otherRow = {
  id: 'user-A_other_client-123',
  input: { projectId: sharedProject, clientMessageId: 'client-123' },
  createdAt: 1,
  deliveryState: 'blocked',
};
assert.equal(chatOutboxEntryBelongsToUser(otherRow, 'user-A'), false,
  'UID prefix collision must not expose/replay another account outbox');
assert.equal(chatOutboxEntryBelongsToUser(otherRow, prefixedOtherUid), true);
assert.equal(isChatEntryBlockedForUser(otherRow, 'user-A', sharedProject), false);
assert.equal(isChatEntryBlockedForUser(otherRow, prefixedOtherUid, sharedProject), true);
assert.equal(isChatEntryBlockedForUser(otherRow, prefixedOtherUid, 'other-project'), false);


const chat = readFileSync('src/lib/chatService.ts', 'utf8');
assert.match(chat, /if \(!chatOutboxEntryBelongsToUser\(row, user\.uid\)\) continue;/,
  'Outbox flush must validate exact owner UID and client message ID');
assert.doesNotMatch(chat, /row\.id\.startsWith\(/,
  'UID-prefix matching is unsafe across accounts');

assert.match(chat, /commitProjectMessage\(normalizedInput, false, user\.uid\)/,
  'Capture UID before the IndexedDB persistence await');
assert.match(chat, /commitProjectMessage\(input, false, user\.uid\)/,
  'Reuse original UID on reconnect instead of trusting latest login');
assert.match(chat, /const existing = await getDocFromServer\(msgRef\);[\s\S]*?isCurrentChatSender\(user\.uid, getCurrentRealFirebaseUser\(\)\?\.uid\)/,
  'Revalidate login after server read, before outbox ACK or replay');
assert.match(chat, /assertChatSenderStillCurrent\(expectedSenderUid\);\s*await batch\.commit\(\)/,
  'Guard the last synchronous step before writeBatch commit');
console.log('P21.79 CHAT ACCOUNT SWITCH GOLDEN PASS: owner UID pinned for send, reconnect and server ACK');
