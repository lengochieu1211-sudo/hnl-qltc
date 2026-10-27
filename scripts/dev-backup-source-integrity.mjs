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
const EXPECTED_FINGERPRINT = '68880f80d5b450424691d2eb4b424f983ab809b539ee1f29193cd32b41619d25';
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
const sourceNames = names.filter(name => !ALLOWED_PATCH_FILES.has(name)).sort();
const hash = crypto.createHash('sha256');
for (const name of sourceNames) {
  hash.update(name + '\0' + sha(fs.readFileSync(name)) + '\n');
}
const actual = hash.digest('hex');
if (sourceNames.length !== EXPECTED_SOURCE_COUNT) fail(`file count ${sourceNames.length} != ${EXPECTED_SOURCE_COUNT}`);
if (actual !== EXPECTED_FINGERPRINT) fail(`source fingerprint mismatch ${actual}`);
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const packageLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
if (packageJson.version !== '6.3.0' || packageLock.version !== packageJson.version || packageLock.packages?.['']?.version !== packageJson.version) fail('package version / lock mismatch');
const webBackup = JSON.parse(fs.readFileSync('firebase.dev-backup.json', 'utf8'));
if (Object.keys(webBackup).length !== 1 || webBackup.hosting?.site !== 'hnl-qltc-dev-backup' || webBackup.hosting?.public !== 'dist-dev-backup-hosting') fail('Firebase backup Hosting target changed');
const envExample = fs.readFileSync('.env.dev-backup.example', 'utf8');
if (!/^VITE_FIREBASE_PROJECT_ID=hnl-qltc-dev-backup$/m.test(envExample) || !/^VITE_DEV_FIREBASE_TARGET=backup$/m.test(envExample)) fail('backup SDK config no longer isolated');
console.log(`PASS P20.3.7 exact source fingerprint (${sourceNames.length} original files): ${actual}`);
console.log('PASS backup Firebase Hosting config/SDK template/lockfile invariant. No cloud writes.');
