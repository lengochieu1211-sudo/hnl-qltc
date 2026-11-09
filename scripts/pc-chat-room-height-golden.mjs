import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculatePcChatRoomHeight } from '../src/utils/pcChatRoomHeight.ts';

const chat = readFileSync('src/features/chat/ChatTab.tsx', 'utf8');
const rules = readFileSync('firestore.rules', 'utf8');
for (const [bottom, top, expected] of [
  [720, 112, 596], [720, 188, 520], [600, 260, 328], [400, 220, 240],
]) assert.equal(calculatePcChatRoomHeight(bottom, top), expected, `PC viewport ${bottom}/${top}`);
assert.equal(calculatePcChatRoomHeight(Infinity, 88), 240);
assert.equal(calculatePcChatRoomHeight(700, NaN), 240);
assert.match(chat, /document\.querySelector<HTMLElement>\('\[data-hnl-nav-surface="desktop"\]'\)/,
  'do not change mobile Chat layout');
assert.match(chat, /getComputedStyle\(rail\)\.display === 'none'/,
  'desktop rail must be visible before PC height is applied');
assert.match(chat, /pcChatRoomHeight \?\? Math\.max\(320, visualViewportHeight - 112\)/,
  'keep the original height on mobile and as initialization fallback');
assert.match(chat, /window\.visualViewport\?\.addEventListener\('resize', schedule\)/);
assert.match(chat, /window\.visualViewport\?\.removeEventListener\('resize', schedule\)/);
assert.match(chat, /observer\?\.disconnect\(\)/, 'teardown observer on Chat exit');
assert.match(chat, /shellChanges\?\.disconnect\(\)/, 'cleanup after dynamic PC banners');
assert.match(chat, /shellChanges\?\.observe\(shell, \{ childList: true \}\)/, 'track sync/contextual banner insertion safely');
assert.ok(!rules.includes('calculatePcChatRoomHeight'), 'UI fix must not touch Firestore Rules');
console.log('HNL PC CHAT ROOM HEIGHT GOLDEN PASS – dynamic usable space, short windows, mobile guard, cleanup');
