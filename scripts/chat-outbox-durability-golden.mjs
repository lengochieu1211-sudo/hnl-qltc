import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeAndVerifyChatOutbox } from '../src/utils/chatOutboxDurability.ts';

const entry = { id: 'UID_ABC', input: { clientMessageId: 'ABC' } };
let networkSendCalled = false;
const local = new Map();
await writeAndVerifyChatOutbox(entry, async (id, item) => { local.set(id, item); }, async id => local.get(id) || null);
assert.equal(local.get(entry.id), entry);

await assert.rejects(async () => {
  await writeAndVerifyChatOutbox(entry, async () => { throw new Error('QuotaExceededError'); }, async () => null);
  networkSendCalled = true;
}, /Tin chưa được gửi/);
assert.equal(networkSendCalled, false, 'A quota failure must stop before sending');
await assert.rejects(
  () => writeAndVerifyChatOutbox(entry, async () => {}, async () => null),
  /Tin chưa được gửi/,
  'A missing read-back must fail closed',
);
await assert.rejects(
  () => writeAndVerifyChatOutbox(entry, async () => {}, async () => ({ id: entry.id, input: { clientMessageId: 'wrong' } })),
  /Tin chưa được gửi/,
  'A stale outbox entry must not qualify as durable',
);
await assert.rejects(
  () => writeAndVerifyChatOutbox({ ...entry, input: { clientMessageId: 'ABC', text: 'new draft' } }, async () => {}, async () => ({ ...entry, input: { clientMessageId: 'ABC', text: 'old draft' } })),
  /Tin chưa được gửi/,
  'A stale payload with the same clientMessageId must not be treated as the current draft',
);

const service = readFileSync('src/lib/chatService.ts', 'utf8');
const send = service.slice(service.indexOf('export async function sendProjectMessage'), service.indexOf('export async function markConversationRead'));
assert.match(send, /await putChatOutbox\([\s\S]*?\);[\s\S]*?let returnedAsQueued/,
  'Chat must await durable persistence before opening Firestore send');
assert.doesNotMatch(send, /Could not persist before send/, 'No swallowed IndexedDB failure');
const ui = readFileSync('src/features/chat/ChatTab.tsx', 'utf8');
const handle = ui.slice(ui.indexOf('const handleSend = async'), ui.indexOf('const handleRetrySend = async'));
const tryBody = handle.slice(handle.indexOf('try {'), handle.indexOf('} catch (err: any)'));
const catchBody = handle.slice(handle.indexOf('} catch (err: any)'), handle.indexOf('} finally {'));
assert.match(tryBody, /await sendProjectMessage\(payload\)/);
assert.match(tryBody, /setText\(''\)/);
assert.doesNotMatch(catchBody, /setText\(''\)|setDraftAttachments\(\[\]\)|draftClientIdRef\.current = createEntityId/,
  'On persist failure, composer, attachments and retry ID must be preserved');
// P1 recovery: a permanent Firebase failure must retain a durable failed entry,
// and manual retries must probe the Cloud deterministic ID before any new write.
const outbox = readFileSync('src/utils/chatOutbox.ts', 'utf8');
assert.match(outbox, /status\?: 'pending' \| 'failed'/);
assert.match(outbox, /markChatOutboxFailed\([\s\S]*?writeAndVerifyChatOutbox\(/);
assert.match(outbox, /row\.status === 'failed'[\s\S]*?row\.id\.startsWith\(`\$\{uid\}_`\)/,
  'Failed messages must be scoped to the signed-in UID and project');
assert.match(service, /if \(row\.status === 'failed'\) continue/,
  'A permanent failure must not be retried forever on reconnect');
assert.match(service, /await markChatOutboxFailed\(row\.id/,
  'Flush must persist permanent failures instead of deleting messages');
assert.doesNotMatch(service, /Permanent send failure; removed from retry queue/);
assert.match(service, /export async function retryFailedProjectMessage[\s\S]*?alreadySent = await getDoc[\s\S]*?alreadySent\.exists\(\)[\s\S]*?return sendProjectMessage\(input\)/,
  'Manual retry must check Cloud existence before writing the same deterministic ID');
assert.match(ui, /listFailedChatOutbox\(activeProjectId, uid\)/,
  'Restart UI must reload account-scoped failed queue');
assert.match(ui, /visibleFailedOutbox\.map\(entry =>/,
  'All recoverable failed entries must be visible, not only the latest one');
// P2: delivery confirmation must be server-authoritative and asynchronous errors
// must never reveal a previous Firebase account's drafts to a new account.
const flush = service.slice(service.indexOf('export async function flushChatOutbox'), service.indexOf('const messageCollection ='));
assert.match(flush, /const existing = await getDocFromServer\(msgRef\)/,
  'Do not discard a queued message based on Firestore cache');
assert.doesNotMatch(flush, /const existing = await getDoc\(msgRef\)/);
assert.match(flush, /senderUid: user\.uid/, 'Flush error events must identify the originating account');
assert.match(send, /senderUid: user\.uid/, 'Async send errors must identify the originating account');
assert.match(ui, /String\(detail\.senderUid \|\| ''\) !== user\.uid/,
  'Chat must ignore an asynchronous error from a different UID');
assert.match(ui, /setDraftAttachments\(\[\]\);[\s\S]*?setFailedSend\(null\);[\s\S]*?\}, \[user\?\.uid\]\)/,
  'Switching Firebase accounts must clear private unsubmitted drafts and errors');
assert.match(ui, /currentGeneration === generation/, 'Stale outbox reads must not replace newer results');
assert.match(ui, /visibleFailedOutbox = failedOutbox\.filter[\s\S]*?row\.input\.projectId === activeProjectId/,
  'Render-time guard must reject any stale message belonging to a prior account or project');
assert.match(ui, /failedSend\.projectId !== activeProjectId/, 'In-memory retry must reject another project');
assert.match(flush, /if \(getCurrentRealFirebaseUser\(\)\?\.uid !== user\.uid\) break/,
  'Replays must not continue on another Firebase session after a network read');
assert.match(service, /commitProjectMessage\(input: SendMessageInput, persistOutbox: boolean, expectedUid: string\)/,
  'Cloud commit must be tied to original sender UID');
assert.match(service, /user\.uid !== expectedUid/, 'Cloud commit must fail closed on account change');
assert.match(send, /await putChatOutbox\([\s\S]*?getCurrentRealFirebaseUser\(\)\?\.uid !== user\.uid[\s\S]*?commitProjectMessage\(normalizedInput, false, user\.uid\)/,
  'Auth must be rechecked after persisting draft before Firestore write');
console.log('CHAT OUTBOX DURABILITY + P2 SERVER-AUTHORITY/ACCOUNT-ISOLATION GOLDEN PASS');
