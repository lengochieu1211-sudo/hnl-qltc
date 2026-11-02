#!/usr/bin/env node
// Staged PROD release safety: allow old split writes, enable new atomic chat.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const rules=fs.readFileSync('firestore.rules','utf8');
const client=fs.readFileSync('src/lib/chatService.ts','utf8');
const chat=fs.readFileSync('src/features/chat/ChatTab.tsx','utf8');
const behavior=fs.readFileSync('scripts/firebase-rules-behavior.mjs','utf8');
assert.match(rules,/positionLockUpdateIsSafe\(projectId, collectionName\)/);
assert.match(rules,/changed\.hasAny\(\[\s*'floorId'/);
assert.match(rules,/resource\.data\.get\('positionLocked', false\)/);
assert.doesNotMatch(rules,/chatMessageHasAtomicSummary|chatSummaryNewMessageIsAtomic/,'legacy client must remain allowed in phase 1');
assert.match(client,/batch\.set\(msgRef/);
assert.match(client,/batch\.set\(conversationRef\(/);
assert.match(client,/lastMessageId:\s*messageId/);
assert.match(client,/await batch\.commit\(\);\s*await removeChatOutbox/);
assert.match(chat,/listBlockedChatOutbox/);
for(const needle of ['old EDITOR client cannot move locked Defect geometry','old ADMIN client cannot move locked Room geometry','PROD old client: message setDoc','PROD new client: atomic message+summary']) assert.ok(behavior.includes(needle),needle);
console.log('PROD10 LEGACY CHAT + LOCK COMPAT SOURCE PASS; runtime is checked separately');
