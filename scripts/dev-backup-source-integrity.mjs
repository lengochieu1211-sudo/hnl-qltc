#!/usr/bin/env node
/**
 * P20.3.7 backup source lock. Deliberately read-only: fail closed if the
 * checked-out application differs from the Drive-verified source ZIP.
 * This is not a Firebase project credential or a deployment script.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EXPECTED_SOURCE_COUNT = 642;
// Base HEAD 6b43494b: 642 original files. The last relay patch was removed
// precisely (main.tsx + firebaseBase.ts are original Git blobs). Only the
// isolated backup .env template changes to use same-origin Auth and LIVE R2.
const BASE_SOURCE_FINGERPRINT = '68880f80d5b450424691d2eb4b424f983ab809b539ee1f29193cd32b41619d25';
const EXPECTED_UNCHANGED_COUNT = 641;
const EXPECTED_UNCHANGED_FINGERPRINT = '7dd95daeccbe566298add0c6e305e5af75d49bd668208d5a3d15b4f0e00b5df7';
const LOCKED_BACKUP_ENV_SHA256 = '4e3309ac7df4516ba522ecb6127957a4f7425c5ab86c8eb10b856201429e3a86';
const LOCKED_BACKUP_AUTH_TEST_SHA256 = 'b69c83e06ae0685a0dfe4911a0715d763976c6d2d7d888abe328b492b319ebfe';
const AUTH_TEST_FILE = 'scripts/backup-mobile-auth-golden.mjs';
const MODIFIED_BASE_SOURCE = '.env.dev-backup.example';
const EXCLUDED = new Set([
  '.git', 'node_modules', 'dist', 'dist-dev-backup-hosting', 'build', 'coverage', '.firebase',
  // Created by Firebase Rules Emulator; never source or a tracked app artifact.
  'firestore-debug.log',
]);
const GENERATED_LOCAL_FILES = new Set(['.env.local', '.env.dev-backup.local']);
const ALLOWED_PATCH_FILES = new Set([
  '.github/workflows/hnl-dev-backup-ci.yml',
  'scripts/dev-backup-source-integrity.mjs',
]);
const fail = message => { throw new Error(`BACKUP_SOURCE_LOCK_BLOCKED: ${message}`); };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const names = [];
function scan(dirname = '.') {
  for (const entry of fs.readdirSync(dirname, { withFileTypes: true })) {
    if (dirname === '.' && EXCLUDED.has(entry.name)) continue;
    const filePath = path.join(dirname, entry.name);
    if (entry.isSymbolicLink()) fail(`symlink: ${filePath}`);
    if (entry.isDirectory()) scan(filePath);
    else if (entry.isFile()) {
      const rel = filePath.split(path.sep).join('/').replace(/^\.\//, '');
      if (!GENERATED_LOCAL_FILES.has(rel)) names.push(rel);
    }
    else fail(`unexpected file type: ${filePath}`);
  }
}
scan();
for (const file of ALLOWED_PATCH_FILES) {
  if (!names.includes(file)) fail(`missing approved patch: ${file}`);
}
for (const [file, expected] of [[MODIFIED_BASE_SOURCE, LOCKED_BACKUP_ENV_SHA256], [AUTH_TEST_FILE, LOCKED_BACKUP_AUTH_TEST_SHA256]]) {
  if (!names.includes(file)) fail(`missing pinned file: ${file}`);
  if (sha(fs.readFileSync(file)) !== expected) fail(`pinned file drift: ${file}`);
}
const sourceNames = names.filter(name => !ALLOWED_PATCH_FILES.has(name) && name !== AUTH_TEST_FILE).sort();
const unchangedNames = sourceNames.filter(name => name !== MODIFIED_BASE_SOURCE);
const hash = crypto.createHash('sha256');
for (const name of unchangedNames) hash.update(name + '\0' + sha(fs.readFileSync(name)) + '\n');
const actual = hash.digest('hex');
if (sourceNames.length !== EXPECTED_SOURCE_COUNT) fail(`file count ${sourceNames.length} != ${EXPECTED_SOURCE_COUNT}`);
if (unchangedNames.length !== EXPECTED_UNCHANGED_COUNT || actual !== EXPECTED_UNCHANGED_FINGERPRINT) fail(`original source drift: ${actual}`);
const envSource = fs.readFileSync(MODIFIED_BASE_SOURCE,'utf8');
if (!/^VITE_FIREBASE_AUTH_DOMAIN=hnl-qltc-dev-backup\.web\.app$/m.test(envSource)) fail('MOBILE_AUTH_NOT_FIRST_PARTY_WEB_APP');
if (!/^VITE_R2_GATEWAY_URL=https:\/\/hnl-qltc-r2-gateway-dev-backup\.lengochieu1211\.workers\.dev$/m.test(envSource)) fail('LIVE_BACKUP_R2_GATEWAY_MISMATCH');
if (names.includes('src/lib/backupMobileAuth.ts')) fail('LEGACY_CROSS_DOMAIN_RELAY_STILL_PRESENT');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const packageLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
if (packageJson.version !== '6.3.0' || packageLock.version !== packageJson.version || packageLock.packages?.['']?.version !== packageJson.version) fail('package version / lock mismatch');
const webBackup = JSON.parse(fs.readFileSync('firebase.dev-backup.json', 'utf8'));
if (Object.keys(webBackup).length !== 1 || webBackup.hosting?.site !== 'hnl-qltc-dev-backup' || webBackup.hosting?.public !== 'dist-dev-backup-hosting') fail('Firebase backup Hosting target changed');
const envExample = fs.readFileSync('.env.dev-backup.example', 'utf8');
if (!/^VITE_FIREBASE_PROJECT_ID=hnl-qltc-dev-backup$/m.test(envExample) || !/^VITE_DEV_FIREBASE_TARGET=backup$/m.test(envExample)) fail('backup SDK config no longer isolated');
console.log(`PASS P20.3.7 base lock: ${sourceNames.length} original files; ${EXPECTED_UNCHANGED_COUNT} unchanged source files; original fingerprint ${BASE_SOURCE_FINGERPRINT}`);
console.log(`PASS first-party Auth and live R2 env pinned; unchanged fingerprint: ${actual}`);
console.log('PASS backup Firebase Hosting config/SDK template/lockfile invariant. No cloud writes.');
