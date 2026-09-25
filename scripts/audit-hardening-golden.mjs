import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const checks = [];
const ok = (name, condition) => {
  if (!condition) throw new Error(`FAIL AUDIT HARDENING: ${name}`);
  checks.push(name);
  console.log(`PASS AUDIT HARDENING: ${name}`);
};

const rules = read('firestore.rules');
const storage = read('storage.rules');
const firebase = read('src/lib/firebaseBase.ts');
const schema = read('src/config/dataSchema.ts');
const app = read('src/App.tsx');
const r2 = read('cloudflare/r2-gateway/worker.js');
const ai = read('cloudflare/ai-gateway/worker.js');
const viewer = read('src/components/ImageViewerModal.tsx');
const devDeploy = read('.github/workflows/firebase-dev-environment.yml');
const runtime = read('.github/workflows/dev-runtime-golden.yml');
const deliverables = read('.github/workflows/dev-deliverables.yml');
const warehouseTransactions = read('src/lib/warehouseTransactions.ts');
const warehouseTab = read('src/components/WarehouseTab.tsx');
const materialNormModal = read('src/components/MaterialNormModal.tsx');

ok('deleted project is an explicit Firestore active-state gate', rules.includes('function projectIsActive(projectId)') && rules.includes('projectIsActive(projectId) && (isAdmin(projectId) || isEditor(projectId))'));
ok('deleted project role resolves fail-closed for normal client', firebase.includes("pData?.deleted === true && !options.allowDeletedProject"));
ok('project lifecycle keeps explicit deleted-project ADMIN override', firebase.includes("allowDeletedProject: true"));
ok('revoke writes canonical active=false tombstone before alias cleanup', firebase.includes("MEMBER_REVOKE_VERIFY_FAILED") && firebase.includes("active: false") && firebase.includes("Keep the canonical tombstone"));
ok('data schema advanced to v6 financial isolation', schema.includes('CURRENT_DATA_SCHEMA_VERSION = 6') && schema.includes('work-volume-financial-isolation'));
ok('work_volumes Cloud payload strips unitPrice', firebase.includes("subcollection === 'work_volumes'") && firebase.includes('delete sanitized.unitPrice'));
ok('financial collection is ADMIN-only in Firestore Rules', rules.includes("match /work_volume_financials/{recordId}") && rules.includes('allow read, create, update: if canAdminOperate(projectId)'));
ok('legacy work_volumes with unitPrice fail closed to non-admin reads', rules.includes("collectionName != 'work_volumes' || !('unitPrice' in resource.data) || isAdmin(projectId)"));
ok('financial v6 migration copies then deletes legacy unitPrice', firebase.includes('migrateWorkVolumeFinancialsV6') && firebase.includes('unitPrice: deleteField()'));
ok('financial writes require explicit ADMIN authorization in diff/offline paths', firebase.includes('allowFinancialWrites?: boolean') && (firebase.match(/options\.allowFinancialWrites === true/g) || []).length >= 4);
ok('ADMIN realtime waits for financial snapshot before initial WorkVolumes emission', firebase.includes('workVolumeInitialPending') && firebase.includes('includeFinancials && !financialReady') && app.includes("{ includeFinancials: currentUserRole === 'ADMIN' }"));
ok('R2 denies normal access to deleted projects', r2.includes("PROJECT_DELETED") && r2.includes("request.method !== 'DELETE'"));
ok('R2 immutable key rejects different replacement bytes', r2.includes('IMMUTABLE_OBJECT_CONFLICT') && r2.includes('immutableRetry'));
ok('AI gateway rejects deleted projects', ai.includes("new Error('PROJECT_DELETED')") && ai.includes('status: 410'));
ok('Firebase Storage production is legacy read-only for create/update', (storage.match(/allow create, update: if false;/g) || []).length >= 2);
ok('Image Viewer keyboard navigation uses functional boundary clamp', viewer.includes('Math.max(0, current - 1)') && viewer.includes('Math.min(Math.max(0, allImages.length - 1), current + 1)'));
ok('Image Viewer key listener refreshes when image count changes', viewer.includes('}, [isOpen, allImages.length]);'));
ok('DEV source gates run before Cloudflare deployment', devDeploy.indexOf('DEV pre-deploy source gates') < devDeploy.indexOf('Deploy isolated DEV R2 Worker'));
ok('Runtime Golden has no path filter and waits exact deploy SHA', !runtime.includes('    paths:') && runtime.includes('Wait for exact DEV environment deploy') && runtime.includes('x.head_sha===process.env.TARGET_SHA'));
ok('Deliverables have no hardcoded runtime certified SHA', !deliverables.includes('RUNTIME_CERTIFIED_SHA: 89174') && deliverables.includes('Wait for exact Runtime Golden'));
ok('Deliverables report exact current SHA dynamically', deliverables.includes('Exact DEV source commit') && deliverables.includes('$GITHUB_SHA'));
ok('App freezes local role when project root becomes deleted', app.includes('if (meta.deleted)') && app.includes("setCurrentUserRoleState('VIEWER')"));
ok('warehouse atomic Firestore writes sanitize undefined optional fields', warehouseTransactions.includes('sanitizeWarehouseWritePayload') && warehouseTransactions.includes('sanitizePayloadForCloud') && (warehouseTransactions.match(/tx\.set\([^,]+, sanitizeWarehouseWritePayload\(/g) || []).length >= 8);
ok('warehouse Excel import keeps blank notes as explicit empty string', (warehouseTab.match(/notes: notesStr,/g) || []).length >= 2 && (materialNormModal.match(/notes: notesStr,/g) || []).length >= 2);
ok('warehouse Excel import writes only parsed rows instead of rewriting unrelated ledger rows', warehouseTab.includes('const importedInventoryRows: InventoryItem[] = []') && materialNormModal.includes('const importedInventoryRows: InventoryItem[] = []') && warehouseTab.includes('onImportInventory(importedInventoryRows)') && materialNormModal.includes('onImportInventory(importedInventoryRows)') && !warehouseTab.includes('onImportInventory(newInventory)') && !materialNormModal.includes('onImportInventory(newInventory)'));

console.log(`AUDIT HARDENING GOLDEN PASS — ${checks.length} checks`);
