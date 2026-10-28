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
assert.match(send, /await putChatOutbox\([\s\S]*?\);\s*let returnedAsQueued/,
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
console.log('CHAT OUTBOX DURABILITY GOLDEN PASS — write/readback, quota, stale cache and composer guards');
