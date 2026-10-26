/**
 * P20.5 P1 copied-DEV data gate (OFFLINE, NO CLOUD WRITES).
 * It checks an externally captured, complete, same-instant DEV COPY export.
 * File digests prove local consistency only, not cloud completeness or snapshot isolation.
 * Never use a PROD export for this DEV-only migration readiness gate.
 * firebaseProjectId is the Firebase environment; projectId is the construction project/document ID.
 * Neither is standalone proof of snapshot provenance.
 *
 * node --experimental-strip-types scripts/p1-copied-dev-data-gate.mjs \
 *   --manifest /private/snapshot-manifest.json --directory /private/snapshot
 */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditRoomSidecarSeedParity } from './room-sidecar-seed-parity.mjs';
import { auditWarehouseSnapshots } from './warehouse-balance-snapshot-audit.mjs';

const FILES = Object.freeze({
  rooms: 'rooms.json',
  definitions: 'definitions.json',
  progress: 'progress.json',
  inventory: 'inventory.json',
  balances: 'inventory_balances.json',
});
const SHA256 = /^[a-f0-9]{64}$/;
const devFirebaseProject = id => typeof id === 'string' &&
  (id === 'hnl-qltc-dev' || id === 'hnl-qltc-dev-backup' || /^demo-[a-z0-9-]+$/.test(id));
const validBusinessProjectId = id => typeof id === 'string' && id.length > 0
  && id.trim() === id && id !== '.' && id !== '..' && !id.includes('/')
  && !/^__.*__$/.test(id) && Buffer.byteLength(id, 'utf8') <= 1500;
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const noPrivateData = error => {
  const code = String(error?.message || 'INVALID_SNAPSHOT');
  return /^[A-Z0-9_:-]{3,120}$/.test(code) ? code : 'INVALID_SNAPSHOT_OR_FORMAT';
};

function assertNoForeignProjects(items, projectId, label) {
  if (!Array.isArray(items)) throw Error(`INVALID_${label}_ARRAY`);
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || item.projectId !== projectId) {
      throw Error(`UNVERIFIED_${label}_PROJECT_ID`);
    }
  }
}
function verifyManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('INVALID_MANIFEST');
  if (!devFirebaseProject(raw.firebaseProjectId)) throw Error('DEV_FIREBASE_PROJECT_ONLY');
  if (!validBusinessProjectId(raw.projectId)) throw Error('INVALID_BUSINESS_PROJECT_ID');
  if (raw.completeCollections !== true || raw.consistentRead !== true) throw Error('SNAPSHOT_COMPLETENESS_UNVERIFIED');
  if (typeof raw.snapshotId !== 'string' || !/^[a-zA-Z0-9_-]{8,120}$/.test(raw.snapshotId)) {
    throw Error('INVALID_SNAPSHOT_ID');
  }
  const millis = Date.parse(raw.capturedAt || '');
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== raw.capturedAt || millis > Date.now() + 60_000) {
    throw Error('INVALID_CAPTURE_TIMESTAMP');
  }
  if (!raw.sha256 || typeof raw.sha256 !== 'object' || Array.isArray(raw.sha256) ||
    Object.keys(raw.sha256).sort().join(',') !== Object.keys(FILES).sort().join(',')) {
    throw Error('INCOMPLETE_FILE_DIGEST_MANIFEST');
  }
  for (const key of Object.keys(FILES)) if (!SHA256.test(raw.sha256[key])) throw Error('INVALID_SHA256_DIGEST');
  return raw;
}
function readPrivateJson(dir, file) {
  const root = realpathSync(dir);
  const path = join(root, file);
  const target = realpathSync(path);
  if (!target.startsWith(root + sep) || basename(target) !== file || !statSync(target).isFile()) {
    throw Error('UNSAFE_SNAPSHOT_FILE_PATH');
  }
  const buffer = readFileSync(target);
  if (buffer.byteLength > 50 * 1024 * 1024) throw Error('SNAPSHOT_FILE_TOO_LARGE');
  return { data: JSON.parse(buffer.toString('utf8')), digest: sha256(buffer) };
}
export function auditP1DevSnapshot(manifest, data, digests) {
  const m = verifyManifest(manifest);
  const findings = [];
  for (const key of Object.keys(FILES)) {
    if (m.sha256[key] !== digests[key]) findings.push(`FILE_DIGEST_MISMATCH_${key.toUpperCase()}`);
  }
  if (findings.length) return { status: 'BLOCKED', firebaseProjectId: m.firebaseProjectId, projectId: m.projectId, snapshotId: m.snapshotId,
    reasonCodes: findings.sort() };
  if (!Array.isArray(data.rooms) || !data.rooms.length) throw Error('UNVERIFIED_ROOM_COLLECTION');
  // Strict project ownership: legacy unscoped rows must be reconciled by an ADMIN,
  // not silently accepted or assigned to the requested project during a migration.
  for (const room of data.rooms) if (room?.projectId !== m.projectId) throw Error('UNVERIFIED_ROOM_PROJECT_ID');
  for (const key of ['definitions', 'progress']) {
    if (!Array.isArray(data[key])) throw Error(`INVALID_${key.toUpperCase()}_COLLECTION`);
    for (const row of data[key]) {
      if (row?.data?.projectId !== m.projectId ||
          typeof row.path !== 'string' || !row.path.startsWith(`projects/${m.projectId}/rooms/`)) {
        throw Error(`UNVERIFIED_${key.toUpperCase()}_PROJECT_ID`);
      }
    }
  }
  assertNoForeignProjects(data.inventory, m.projectId, 'INVENTORY');
  assertNoForeignProjects(data.balances, m.projectId, 'BALANCE');
  if (!data.inventory.length || !data.balances.length) throw Error('EMPTY_STOCK_COLLECTION_NEEDS_ADMIN_REVIEW');
  const room = auditRoomSidecarSeedParity({ rooms: data.rooms,
    definitions: data.definitions, progress: data.progress }, m.projectId);
  const balance = auditWarehouseSnapshots(data.inventory, data.balances);
  if (room.status !== 'SEED_PARITY_PASS_OFFLINE_ONLY') findings.push('P1_ROOM_SEED_PARITY_BLOCKED');
  if (balance.status !== 'NO_DISCREPANCY_DETECTED') findings.push('P1_BALANCE_LEDGER_PARITY_BLOCKED');
  return {
    // Never label this READY_FOR_PROD. No Rules/Emulator, race, restore, upload, or
    // verified live snapshots were checked here.
    status: findings.length ? 'BLOCKED' : 'COPIED_DEV_OFFLINE_PARITY_ONLY',
    firebaseProjectId: m.firebaseProjectId, projectId: m.projectId, snapshotId: m.snapshotId, capturedAt: m.capturedAt,
    reasonCodes: findings,
    counts: { ...room.counts, ledgerRows: balance.counts.ledgerRows,
      balanceRows: balance.counts.balanceRows, stockErrors: balance.counts.errors },
    note: 'No Firestore/R2 access. Snapshot provenance/atomic capture, Emulator Rules, live migration, replay, RESTORE and cross-device Golden remain MANDATORY. PROD NO-GO.',
  };
}
function cli(args) {
  if (args.length !== 4 || args[0] !== '--manifest' || args[2] !== '--directory') {
    throw Error('USAGE: --manifest PRIVATE_MANIFEST.json --directory PRIVATE_SNAPSHOT_FOLDER');
  }
  const manifestPath = resolve(args[1]);
  const dir = resolve(args[3]);
  if (!isAbsolute(manifestPath) || !isAbsolute(dir)) throw Error('INVALID_LOCAL_PATH');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  verifyManifest(manifest);
  const data = {}, digests = {};
  for (const [key, file] of Object.entries(FILES)) {
    const result = readPrivateJson(dir, file);
    data[key] = result.data;
    digests[key] = result.digest;
  }
  const result = auditP1DevSnapshot(manifest, data, digests);
  console.log(JSON.stringify(result, null, 2));
  return result.status === 'BLOCKED' ? 2 : 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { process.exitCode = cli(process.argv.slice(2)); }
  catch (error) { console.error(`P1_COPIED_DEV_AUDIT_ABORTED: ${noPrivateData(error)}`); process.exitCode = 2; }
}
