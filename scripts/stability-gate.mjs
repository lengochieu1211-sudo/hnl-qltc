import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fail = (msg) => { console.error(`STABILITY GATE FAIL: ${msg}`); process.exit(1); };
const pass = (msg) => console.log(`PASS: ${msg}`);

const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const appVersion = read('src/config/appVersion.ts');
const mergeWorkflow = read('.github/workflows/firebase-hosting-merge.yml');
const prWorkflow = read('.github/workflows/firebase-hosting-pull-request.yml');
const realtime = read('src/config/realtimeCollections.ts');
const firebase = read('src/lib/firebase.ts');
const sw = read('public/sw.js');

if (pkg.version !== '6.2.27') fail(`package.json version is ${pkg.version}`);
if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) fail('package-lock root version mismatch');
if (!appVersion.includes("APP_VERSION = '6.2.27'")) fail('appVersion.ts mismatch');
if (!mergeWorkflow.includes('VITE_APP_VERSION: "V6.2.27"')) fail('merge workflow version mismatch');
if (!prWorkflow.includes('VITE_APP_VERSION: "V6.2.27"')) fail('PR workflow version mismatch');
pass('runtime/package/workflow version consistency');

const expectedPairs = [
  ['rooms','roomProgressList'], ['inventory','inventory'], ['defects','defects'],
  ['work_volumes','workVolumes'], ['floor_plans','floorPlans'], ['checklist','checklist'],
  ['crew_records','crewRecords'], ['teams','teams'], ['material_norms','materialNorms'],
];
for (const [cloud, state] of expectedPairs) {
  if (!realtime.includes(`cloudName: '${cloud}'`) || !realtime.includes(`stateKey: '${state}'`)) fail(`missing realtime mapping ${cloud}<->${state}`);
}
if ((realtime.match(/cloudName:/g) || []).length !== 9) fail('realtime mapping must contain exactly 9 collections');
if (!firebase.includes('REALTIME_COLLECTIONS')) fail('firebase.ts is not using centralized realtime mapping');
pass('9/9 centralized realtime mappings');

const dataSchema = read('src/config/dataSchema.ts');
if (!dataSchema.includes('CURRENT_DATA_SCHEMA_VERSION = 4')) fail('data schema version not locked to 4');
if (!dataSchema.includes('DATA_SCHEMA_MIGRATIONS') || !dataSchema.includes('realtime-stability-baseline')) fail('central data migration registry missing');
if (!firebase.includes('ensureProjectMigrationsInCloud') || !firebase.includes('getPendingDataSchemaMigrations')) fail('central idempotent project migration runner missing');
if (!firebase.includes('dataSchemaVersion: CURRENT_DATA_SCHEMA_VERSION')) fail('cloud metadata does not publish data schema version');
if (firebase.includes('schemaVersion: 2,')) fail('new project root still writes legacy schemaVersion 2');
pass('independent schema version + centralized idempotent migration runner');

if (!sw.includes('cache-v15')) fail('service worker cache was not bumped to v15');
pass('service worker cache bump');

const android = read('android-wrapper/res/values/strings.xml');
if (!android.includes('v=6.2.27')) fail('Android wrapper URL version mismatch');
const desktop = read('desktop-wrapper/QLTCAnPhuLauncher.cs');
if (!desktop.includes('v=6.2.27')) fail('desktop wrapper URL version mismatch');
pass('APK/EXE wrapper query version consistency');

const errorBoundary = read('src/components/ErrorBoundary.tsx');
const diagnosticsUi = read('src/components/GoogleConfigTab.tsx');
const diagnosticsRuntime = read('src/lib/runtimeDiagnostics.ts');
if (!errorBoundary.includes('appendRuntimeDiagnostic') || !errorBoundary.includes('Copy log') || !errorBoundary.includes('Tải log')) fail('ErrorBoundary copy/download diagnostics missing');
for (const marker of ['Chẩn đoán đồng bộ', 'Dữ liệu chờ:', 'Sync cuối:', 'Cảnh báo project trùng tên:']) {
  if (!diagnosticsUi.includes(marker)) fail(`sync diagnostics UI missing ${marker}`);
}
if (!diagnosticsRuntime.includes('sanitizeDiagnosticValue') || !diagnosticsRuntime.includes('[redacted]')) fail('diagnostic secret redaction missing');
pass('runtime diagnostics, safe export and visible sync diagnostics');

const app = read('src/App.tsx');
if (!app.includes('REALTIME_STATE_KEYS') || !app.includes('STATE_KEY_TO_CLOUD_NAME')) fail('autosave is not using centralized realtime mapping');
if (!app.includes('cloudInitialReady') || !app.includes('receivedInitialSubcollectionsRef')) fail('realtime bootstrap guard missing');
pass('autosave/read mapping and initial-snapshot guard');

const trash = read('src/lib/trash.ts');
if (!trash.includes('retentionDays: 7')) fail('trash default must remain 7 days');
const superAdmin = read('src/config/superAdmin.ts');
const rules = read('firestore.rules');
if (!superAdmin.includes("lengochieu1211@gmail.com") || !rules.includes("lengochieu1211@gmail.com")) fail('Super Admin identity mismatch between app/rules');
if (!rules.includes("trashExpiresAt") || !rules.includes("ownerUid")) fail('legacy trash rule hardening markers missing');
pass('7-day trash default and Super Admin rule invariants');

const photoSync = read('src/lib/photoCloudSync.ts');
const floorPlanSync = read('src/lib/floorPlanImageSync.ts');
if (!photoSync.includes('idempotent') || !photoSync.includes('driveFileId')) fail('photo cloud idempotency guard missing');
if (photoSync.includes('Bytes.fromUint8Array') || floorPlanSync.includes('Bytes.fromUint8Array')) fail('new Firestore binary chunk upload path still exists');
if (!photoSync.includes('binary remains local for retry') || !floorPlanSync.includes('binary remains local for retry')) fail('Drive-only pending/retry policy missing');
if (!rules.includes('allow create, update: if false;')) fail('Firestore Rules do not block new legacy nested binary chunks');
pass('Drive-only binary policy + legacy read/delete compatibility + idempotency');

const packageScripts = pkg.scripts || {};
for (const script of ['typecheck', 'lint', 'test:rules', 'security:audit']) {
  if (!packageScripts[script]) fail(`missing required package script ${script}`);
}
for (const workflow of [read('.github/workflows/build.yml'), mergeWorkflow, prWorkflow]) {
  for (const marker of ['npm run test:stability', 'npm run typecheck', 'npm run lint', 'npm run test:rules', 'npm run security:audit', 'npm run build']) {
    if (!workflow.includes(marker)) fail(`workflow stability gate missing ${marker}`);
  }
}
pass('CI stability gate includes golden/typecheck/lint/rules/security/build');

console.log('STABILITY GATE PASS');
