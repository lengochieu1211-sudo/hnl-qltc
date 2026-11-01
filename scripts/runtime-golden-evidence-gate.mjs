#!/usr/bin/env node
// Fail-closed release evidence verifier. Never creates evidence from simulation.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const required = [
  'web_windows_signed_in', 'windows_exe_signed_in', 'android_chrome_signed_in',
  'android_apk_signed_in', 'ios_safari_signed_in', 'multi_user_lock_realtime',
  'viewer_denied_write', 'offline_reconnect_no_duplicates',
  'chat_old_new_client_parity', 'chat_outbox_account_switch',
  'r2_real_image_cross_account', 'legacy_media_11_links',
  'warehouse_excel_pdf', 'json_roundtrip_ids', 'prod_rollback_version_captured'
];
const file = process.argv[2];
const sha = process.argv[3];
if (!file || !/^[a-f0-9]{40}$/.test(sha || '')) {
  console.error('HOLD: usage node scripts/runtime-golden-evidence-gate.mjs <EVIDENCE.json> <EXACT_CANDIDATE_SHA>');
  process.exit(2);
}
try {
  const payload = JSON.parse(readFileSync(file,'utf8'));
  assert.equal(payload.candidateSha, sha, 'candidate HEAD mismatch');
  assert.equal(payload.environment, 'DEV_QA_ISOLATED', 'golden must first use isolated DEV QA');
  assert.equal(payload.productionWrites, false, 'unapproved PROD write detected');
  assert(Array.isArray(payload.tests), 'missing tests');
  for (const id of required) {
    const rows=payload.tests.filter(x=>x.id===id);
    assert.equal(rows.length,1,`missing/duplicate test: ${id}`);
    const t=rows[0];
    assert.equal(t.result,'PASS',`test not PASS: ${id}`);
    assert.equal(t.realDevice,true,`simulated browser cannot certify: ${id}`);
    assert(typeof t.operator==='string' && t.operator.length>=3,`missing tester: ${id}`);
    assert(typeof t.testedAt==='string' && Number.isFinite(Date.parse(t.testedAt)),`missing time: ${id}`);
    assert(Array.isArray(t.evidence) && t.evidence.length,`missing attachments: ${id}`);
    for (const ev of t.evidence) {
      assert(typeof ev.path==='string' && /^[a-f0-9]{64}$/.test(ev.sha256||''),`missing SHA for ${id}`);
      const target=resolve(dirname(file),ev.path);
      assert(existsSync(target),`missing evidence file ${id}: ${ev.path}`);
      const digest=createHash('sha256').update(readFileSync(target)).digest('hex');
      assert.equal(digest,ev.sha256,`evidence hash mismatch: ${id}`);
    }
  }
  console.log(`RUNTIME GOLDEN EVIDENCE STRUCTURE VERIFIED: ${required.length} cases / exact ${sha}`);
  console.log('Note: file/hash verification is not independent proof of truthful execution.');
} catch (e) {
  console.error('PROD HOLD — RUNTIME GOLDEN INCOMPLETE:',e.message);
  process.exitCode=1;
}
