#!/usr/bin/env node
// Source-level protocol bridge audit; this is NOT an authenticated runtime test.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const client=fs.readFileSync('src/lib/chatService.ts','utf8');
const rules=fs.readFileSync('firestore.rules','utf8');
const start=client.indexOf('async function commitProjectMessage(');
const end=client.indexOf('function isPermanentChatSendError(',start);
assert(start>=0&&end>start,'atomic client scope');
const send=client.slice(start,end);
assert.match(send,/batch\.set\(msgRef,/);
assert.match(send,/batch\.set\(conversationRef\(/);
assert.match(send,/lastMessageId:\s*messageId/,'critical handshake between chat client and strict Rules');
assert.match(send,/await batch\.commit\(\);\s*await removeChatOutbox/,'no lost local drafts on failed summary');
assert.match(client,/getDocFromServer\(msgRef\)/,'server read before retransmitting outbox');
assert.match(rules,/function chatMessageHasAtomicSummary/);
assert.match(rules,/function chatSummaryNewMessageIsAtomic/);
assert.match(rules,/summaryAfter\.lastMessageId == messageId/);
assert.match(rules,/getAfter\(/);
console.log('CHAT ATOMIC HANDSHAKE SOURCE PASS');
console.log('PROD BRIDGE HOLD: strict DEV Rules cannot be deployed while legacy clients use split setDoc writes.');
console.log('PHASE 1: deploy atomic client with existing PROD Rules, then verify legacy + new clients on Emulator and physical devices.');
console.log('PHASE 2: only after old clients retired, deploy strict Rules; never claim safe legacy coexistence with strict Rules.');
