import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));

function assert(ok, message) {
  if (!ok) throw new Error(`PROD READINESS FAIL: ${message}`);
  console.log(`PASS PROD READINESS: ${message}`);
}
function includesAll(text, parts, label) {
  for (const part of parts) assert(text.includes(part), `${label} includes ${part}`);
}

assert(pkg.dependencies?.express === '^4.22.3', 'Express release floor is 4.22.3');
assert(pkg.dependencies?.xlsx === 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz', 'SheetJS uses authoritative 0.20.3 tarball');
assert(String(pkg.scripts?.['security:audit'] || '').includes('--audit-level=high'), 'production dependency audit blocks HIGH and CRITICAL advisories');
assert(lock.packages?.['node_modules/express']?.version === '4.22.3', 'lockfile pins Express 4.22.3');
const bodyParserMatch = /^1\.20\.(\d+)$/.exec(lock.packages?.['node_modules/body-parser']?.version || '');
assert(Boolean(bodyParserMatch) && Number(bodyParserMatch[1]) >= 9, 'lockfile pins patched Express 4-compatible body-parser >=1.20.9');
const multerMatch = /^2\.(\d+)\.(\d+)$/.exec(lock.packages?.['node_modules/multer']?.version || '');
assert(Boolean(multerMatch) && Number(multerMatch[1]) >= 5, 'lockfile pins patched multer >=2.5.0');
const qsMatch = /^6\.(\d+)\.(\d+)$/.exec(lock.packages?.['node_modules/qs']?.version || '');
assert(Boolean(qsMatch) && (Number(qsMatch[1]) > 16 || (Number(qsMatch[1]) === 16 && Number(qsMatch[2]) >= 1)), 'lockfile pins patched qs >=6.16.1');
const re2Match = /^2\.(\d+)\.(\d+)$/.exec(lock.packages?.['node_modules/re2js']?.version || '');
assert(Boolean(re2Match) && (Number(re2Match[1]) > 8 || (Number(re2Match[1]) === 8 && Number(re2Match[2]) >= 7)), 'lockfile pins patched re2js >=2.8.7');
assert(lock.packages?.['node_modules/xlsx']?.version === '0.20.3', 'lockfile pins SheetJS 0.20.3');
assert(lock.packages?.['node_modules/xlsx']?.resolved === 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz', 'lockfile resolves SheetJS from authoritative CDN');

const workflow = read('.github/workflows/firebase-hosting-merge.yml');
includesAll(workflow, [
  'backup_confirmation:',
  'migration_confirmation:',
  'dev_certified_sha:',
  'expected_main_sha:',
  'BACKUP-VERIFIED',
  'MIGRATION-PARITY-VERIFIED',
  'git merge-base --is-ancestor',
  'refs/heads/main',
  'selected workflow SHA does not match approved main SHA',
  'Dependency version and PROD readiness gate',
  "x.version!=='0.20.3'",
  'Security audit (production, HIGH or above blocks release)',
  'Deploy exact-source HNL R2 Gateway PROD',
  'bucket_name = "hnl-qltc-media"',
  'policyVersion":"immutable-deleted-project-v2',
  'Deploy isolated HNL AI Gateway PROD',
  'Deploy Firestore + Storage rules',
  '--only firestore:rules,storage',
  '--only hosting --config firebase.prod.json',
  'VITE_FIREBASE_PROJECT_ID: com-example-qlct-61329',
  'VITE_R2_GATEWAY_URL: https://hnl-qltc-r2-gateway.lengochieu1211.workers.dev',
  'VITE_HNL_AI_GATEWAY_URL: https://hnl-qltc-ai-gateway.lengochieu1211.workers.dev',
], 'PROD workflow');

const r2Workflow = read('.github/workflows/r2-worker-deploy.yml');
includesAll(r2Workflow, ['DEPLOY-R2-PROD', 'refs/heads/main', 'policyVersion":"immutable-deleted-project-v2'], 'standalone PROD R2 workflow');

const storageRules = read('storage.rules');
includesAll(storageRules, ['projectActive(projectId)', 'allow create, update: if false;', 'allow delete: if isAdmin(projectId);'], 'Storage Rules legacy read/purge policy');

const r2Worker = read('cloudflare/r2-gateway/worker.js');
includesAll(r2Worker, [
  "policyVersion: 'immutable-deleted-project-v2'",
  "if (access.projectDeleted && request.method !== 'DELETE')",
  "error: 'IMMUTABLE_OBJECT_CONFLICT'",
  "AUTH_BACKEND_UNAVAILABLE",
  "backendUnavailable",
  "response.status === 404",
  "canonicalEmailLookup ? 'EMAIL_MEMBER' : 'UID_MEMBER'",
], 'R2 hardening');

const excelUtils = read('src/utils/excelImportUtils.ts');
includesAll(excelUtils, ['MAX_EXCEL_IMPORT_BYTES = 12 * 1024 * 1024', 'assertSafeExcelImportFile', '/\\.(xlsx|xls)$/i'], 'Excel import preflight');
for (const file of [
  'src/components/WorkVolumeTab.tsx',
  'src/components/FloorPlanDefectTab.tsx',
  'src/components/ChecklistTab.tsx',
  'src/components/WarehouseTab.tsx',
  'src/components/MaterialNormModal.tsx',
  'src/components/CrewTabBase.tsx',
]) {
  assert(read(file).includes('assertSafeExcelImportFile(file)'), `${file} uses shared Excel import preflight`);
}

console.log('PROD READINESS GOLDEN PASS');
