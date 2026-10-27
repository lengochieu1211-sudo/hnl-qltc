/**
 * P1 release-preflight, intentionally READ ONLY.
 * This is a conservative SOURCE audit. It does NOT replace the Firebase Rules
 * Emulator, live DEV regression or PROD go/no-go approval. Fail closed.
 * Run: node scripts/p1-release-safety-gate.mjs
 */
import { readFileSync } from 'node:fs';

const firestore = readFileSync('firestore.rules', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const stock = readFileSync('src/lib/warehouseTransactions.ts', 'utf8');
const behavior = readFileSync('scripts/firebase-rules-behavior.mjs', 'utf8');

function balancedSection(source, anchor, open = '{') {
  const at = source.indexOf(anchor);
  if (at < 0) throw new Error(`Required source anchor missing: ${anchor}`);
  const start = source.indexOf(open, at + anchor.length);
  if (start < 0) throw new Error(`Missing body: ${anchor}`);
  let nesting = 0;
  for (let pos = start; pos < source.length; pos += 1) {
    if (source[pos] === '{') nesting += 1;
    if (source[pos] === '}') {
      nesting -= 1;
      if (nesting === 0) return source.slice(start + 1, pos);
    }
  }
  throw new Error(`Unbalanced source section: ${anchor}`);
}

const roomGuard = balancedSection(firestore, 'function editorRoomOperationalUpdateOnly()');
const balanceGuard = balancedSection(firestore, 'match /inventory_balances/{balanceId}');
const failures = [];
const evidences = [];

const roomAllowsNested = /['"]subItems['"]/.test(roomGuard);
const roomHasServerNestedProof = /getAfter\s*\(/.test(roomGuard)
  || /request\.resource\.data\.subItems\s*==\s*resource\.data\.subItems/.test(roomGuard)
  || /editorSubItems\w*Invariant\s*\(/.test(roomGuard);
if (roomAllowsNested && !roomHasServerNestedProof) {
  failures.push('P1-ROOM: EDITOR can replace top-level subItems without any observed server-side nested-identity proof.');
} else {
  evidences.push('P1-ROOM: structural pattern no longer immediately matches known vulnerable rule; emulator ALLOW/DENY proof still mandatory.');
}

const editorBalanceWrite = /allow\s+(create|update):[\s\S]*?isEditor\s*\(projectId\)/.test(balanceGuard);
const hasVoucherLink = /getAfter\s*\(/.test(balanceGuard)
  && /(inventory\b|voucher|transaction)/i.test(balanceGuard);
if (editorBalanceWrite && !hasVoucherLink) {
  failures.push('P1-BALANCE: EDITOR can update stock balance without a linked voucher/ledger getAfter proof.');
} else {
  evidences.push('P1-BALANCE: known standalone-write signature absent; full voucher math proof still mandatory.');
}

if (!app.includes('mergeEditorRoomSubItems(existing.subItems, incoming.subItems)')) {
  failures.push('CLIENT: EDITOR centralized room subItems structural guard missing from App.tsx.');
} else evidences.push('CLIENT: P3 nested subItem merge guard remains wired.');

if (!stock.includes('runTransaction(db, async (tx) =>')
  || !stock.includes('tx.set(transactionRef,')
  || !stock.includes('tx.set(balanceRef,')) {
  failures.push('CLIENT: warehouse atomic transaction voucher/balance write signatures missing.');
} else evidences.push('CLIENT: atomic voucher + balance transaction signatures remain.');

if (!behavior.includes("process.env.HNL_P1_RULES_NEGATIVE_PROBE === '1'")
  || !behavior.includes('P1 RULES RELEASE BLOCKED')) {
  failures.push('TESTS: negative Rules emulator probes not found.');
} else evidences.push('TESTS: opt-in negative Rules emulator probes exist but are NOT executed by this check.');

for (const note of evidences) console.log(`CHECK: ${note}`);
for (const issue of failures) console.error(`BLOCKED: ${issue}`);
if (failures.length) {
  console.error(`P1 RELEASE BLOCKED: ${failures.length} source-level gate finding(s). No Cloud changes performed.`);
  process.exitCode = 2;
} else {
  // A static check can never produce a release certification on its own.
  console.log('P1 STATIC TRIAGE: no known signatures detected. Release remains blocked pending emulator/runtime/data-parity evidence.');
}
