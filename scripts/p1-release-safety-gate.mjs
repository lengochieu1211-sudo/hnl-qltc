/**
 * HNL QLTC PROD P1 source-release interlock.
 * READ-ONLY. Designed to fail closed until DEV-copy room sidecars and
 * server-authoritative warehouse cutover have passed their own test gates.
 * A PASS here is NOT a migration, Rules Emulator, or Runtime Golden approval.
 */
import { readFileSync } from 'node:fs';

const rules = readFileSync('firestore.rules', 'utf8');
const behavior = readFileSync('scripts/firebase-rules-behavior.mjs', 'utf8');
const failures = [];

function section(anchor) {
  const from = rules.indexOf(anchor);
  if (from < 0) return '';
  const begin = rules.indexOf('{', from + anchor.length);
  if (begin < 0) return '';
  let depth = 0;
  for (let i = begin; i < rules.length; i++) {
    if (rules[i] === '{') depth++;
    if (rules[i] === '}' && --depth === 0) return rules.slice(begin + 1, i);
  }
  return '';
}

const rooms = section('function editorRoomOperationalUpdateOnly()');
const whitelist = rooms.match(/affectedKeys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/)?.[1] || '';
if (!rooms || !whitelist || /['"]subItems['"]/.test(whitelist)) {
  failures.push('P1-ROOM: EDITOR legacy embedded subItems structural writes are not fully denied.');
}
if (!rules.includes('function editorSubItemProgressUpdateSafe(') ||
    !rules.includes('match /rooms/{roomId}/subitem_progress/{subItemId}')) {
  failures.push('P1-ROOM: sidecar progress privilege boundary is missing.');
}

const balance = section('match /inventory_balances/{balanceId}');
if (!balance || !/allow\s+create,\s*update,\s*delete:\s*if\s+false\s*;/.test(balance)) {
  failures.push('P1-BALANCE: client balance writes not fully denied; Admin SDK trusted writer required.');
}
for (const verb of ['create', 'update', 'delete']) {
  const lines = [...rules.matchAll(new RegExp('allow\\s+' + verb + ': if collectionName != [^\\n]+', 'g'))]
    .map(hit => hit[0]);
  if (lines.length !== 1 || !lines[0].includes("collectionName != 'inventory'")) {
    failures.push('P1-BALANCE: generic inventory ' + verb + ' fallback could bypass trusted voucher writer.');
  }
}
if (!behavior.includes("process.env.HNL_P1_RULES_NEGATIVE_PROBE === '1'")) {
  failures.push('P1-TEST: opt-in negative Rules Emulator probes absent.');
}
for (const message of failures) console.error('BLOCKED: ' + message);
if (failures.length) {
  console.error('PROD RELEASE BLOCKED: ' + failures.length + ' P1 release-source finding(s).');
  process.exitCode = 2;
} else {
  console.log('P1 STATIC TRIAGE PASS ONLY: Emulator, DEV migration parity, backup/restore and Runtime Golden remain mandatory.');
}
