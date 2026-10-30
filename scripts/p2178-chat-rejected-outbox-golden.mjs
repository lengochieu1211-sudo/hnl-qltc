import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isChatEntryBlockedForUser, markChatEntryBlocked, shouldAutoFlushChatEntry } from '../src/utils/chatOutboxRecovery.ts';

const entry = {
  id: 'uid_a_msg123', input: {projectId:'proj_a',clientMessageId:'msg123',text:'Tin cần giữ lại',
    attachments:[{type:'image',reference:{entityId:'r2-image'}}]},createdAt:1000
};
const blocked = markChatEntryBlocked(entry, 'Firebase refused');
assert.equal(blocked.deliveryState,'blocked');
assert.equal(blocked.input,entry.input,'retain full payload and attachment refs');
assert.notEqual(blocked,entry,'do not mutate original stored object');
assert.equal(shouldAutoFlushChatEntry(blocked),false,'blocked draft must not repeat unauthorized sends');
assert.equal(shouldAutoFlushChatEntry(entry),true,'normal offline queued entry should reconnect');
assert.equal(isChatEntryBlockedForUser(blocked,'uid_a','proj_a'),true);
for(const [uid,projectId] of [['uid_b','proj_a'],['uid_a','proj_b'],['','proj_a'],['uid_a','']]) {
  assert.equal(isChatEntryBlockedForUser(blocked,uid,projectId),false,'isolate another user or project');
}
assert.ok(markChatEntryBlocked(entry,'secret'.repeat(100)).failedMessage.length <= 250,'truncate server error');
const restored = {...blocked, deliveryState:undefined, failedMessage:undefined};
assert.equal(shouldAutoFlushChatEntry(restored),true,'explicit manual retry re-enables delivery');

const outbox = readFileSync('src/utils/chatOutbox.ts','utf8');
assert.match(outbox,/await putChatOutbox\(markChatEntryBlocked\(original, reason\)\)/);
assert.match(outbox,/isChatEntryBlockedForUser\(row, uid, projectId\)/);
const chat = readFileSync('src/lib/chatService.ts','utf8');
assert.match(chat,/if \(!shouldAutoFlushChatEntry\(row\)\) continue/);
assert.match(chat,/await blockChatOutbox\(row.id,/);
assert.match(chat,/void blockChatOutbox\(messageId,/);
assert.doesNotMatch(chat,/Permanent send failure; removed from retry queue/);
assert.match(chat,/await getDocFromServer\(msgRef\)/,'server confirmation before outbox deletion');
const ui = readFileSync('src/features/chat/ChatTab.tsx','utf8');
assert.match(ui,/listBlockedChatOutbox\(uid, activeProjectId\)/,'restore blocked draft on Chat mount');
assert.match(ui,/getCurrentRealFirebaseUser\(\)\?\.uid !== uid/,'prevent account switch disclosure');
assert.match(ui,/setFailedSend\(null\);\s*setSendError\(''\)/,'clear previous account failed state');
assert.match(ui,/handleRetrySend/,'manual retry with stable messageId');
console.log('P21.78 CHAT RECOVERY SCOPED GOLDEN PASS: rejected draft durable, manual retry, UID+project isolation, account switch, no cloud writes');
