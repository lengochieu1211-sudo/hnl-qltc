import fs from 'node:fs';
const read = (p) => fs.readFileSync(p, 'utf8');
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
const pass = (m) => console.log(`PASS: ${m}`);
const includesAll = (t, ns, l) => { for (const n of ns) if (!t.includes(n)) fail(`${l}: missing ${n}`); };

const firebase = read('src/lib/firebase.ts');
const storage = read('src/lib/firebaseStorage.ts');
const appCheck = read('src/lib/appCheck.ts');
const authModal = read('src/components/GoogleAuthModal.tsx');
const workVolumeTab = read('src/components/WorkVolumeTab.tsx');
const securityUtils = read('src/utils/securityUtils.ts');
const app = read('src/App.tsx');
const firebaseJson = JSON.parse(read('firebase.json'));
const pkg = JSON.parse(read('package.json'));
const vite = read('vite.config.ts');
const workflow = read('.github/workflows/firebase-hosting-pull-request.yml');

includesAll(firebase, ['VITE_USE_FIREBASE_EMULATORS', "APP_ENVIRONMENT === 'PROD'", 'FIREBASE_EMULATOR_PROJECT_ID === PROD_FIREBASE_PROJECT_ID', "startsWith('demo-')", 'connectFirestoreEmulator', 'connectAuthEmulator', 'signInWithEmulatorTestAccount'], 'Firebase emulator runtime guard');
if (!firebase.includes("const PROD_FIREBASE_PROJECT_ID = 'com-example-qlct-61329'")) fail('Production project guard changed or missing');
if (!firebase.includes('const firebaseConfig = FIREBASE_EMULATOR_ENABLED')) fail('Emulator config is not forced independently of ambient live VITE_FIREBASE_* variables');
pass('Emulator runtime is DEV-only, demo-only, and ignores ambient live Firebase config');

includesAll(storage, ['connectStorageEmulator', 'FIREBASE_EMULATOR_ENABLED'], 'Storage emulator connection');
includesAll(appCheck, ['FIREBASE_EMULATOR_ENABLED', 'if (FIREBASE_EMULATOR_ENABLED) return null'], 'App Check emulator bypass');
includesAll(authModal, ['DEV Emulator Golden', 'signInWithEmulatorTestAccount', "['ADMIN', 'EDITOR', 'VIEWER']"], 'Deterministic DEV users');
pass('Auth/Firestore/Storage and deterministic multi-user test identities are wired');


includesAll(securityUtils, [
  'canManageWorkVolumeStructure',
  "return role === 'ADMIN';",
], 'Work-volume structure permission helper');
includesAll(workVolumeTab, [
  'hasStructureManageAccess',
  "{hasStructureManageAccess && (",
  "Chỉ ADMIN được nhập Excel để thay đổi cấu trúc hạng mục khối lượng",
  "hasStructureManageAccess && (showAddForm || editingVolume !== null)",
], 'Work-volume ADMIN-only structure UI');
if (workVolumeTab.includes('const hasEditAccess = canEditProjectData')) fail('Regression: EDITOR can still inherit structural WorkVolume controls from generic edit permission');
includesAll(app, [
  "Chỉ ADMIN được tạo hạng mục khối lượng",
  "Chỉ ADMIN được sửa định nghĩa hạng mục khối lượng",
  "Chỉ ADMIN được xóa hạng mục khối lượng",
  "Chỉ ADMIN được nhập thay đổi cấu trúc hạng mục khối lượng",
], 'Work-volume App handler RBAC defense');
pass('Work-volume structure is ADMIN-only in UI and App handlers while EDITOR progress remains field-driven');

const rules = read('firestore.rules');
includesAll(rules, [
  'function projectExists(projectId)',
  "('ownerUid' in projectDoc(projectId).data)",
  "('ownerEmail' in projectDoc(projectId).data)",
  'isGoogleAuthed() && !projectExists(projectId)',
  "function isAdminOwnedStructureCollection",
  "name == 'work_volumes'",
  "name == 'floor_plans'",
  "name == 'rooms'",
  "function isEditorOperationalCollection",
  "editorRoomOperationalUpdateOnly",
], 'Firestore missing-project owner-claim + work-volume structure guard');
const rulesBehavior = read('scripts/firebase-rules-behavior.mjs');
if (!rulesBehavior.includes('authenticated owner can probe missing project root before first claim')) {
  fail('Missing runtime regression for a fresh Emulator project root owner claim');
}
if (!rulesBehavior.includes('unlisted authenticated user cannot read an existing project root')) {
  fail('Missing runtime regression proving existing project roots remain access-controlled');
}
if (!rulesBehavior.includes('EDITOR cannot create work-volume master definition')
  || !rulesBehavior.includes('EDITOR cannot change work-volume structure')
  || !rulesBehavior.includes('EDITOR can update existing room field progress')) {
  fail('Missing runtime regression for EDITOR work-volume structure denial + field progress allow');
}
pass('Fresh roots remain safe; WorkVolume structure is ADMIN-only while EDITOR field progress stays allowed');

includesAll(securityUtils, [
  'canManageFloorPlanStructure',
  "return role === 'ADMIN';",
], 'Floor-plan structure permission helper');
const floorPlanTab = read('src/components/FloorPlanDefectTab.tsx');
const roomHighlightModal = read('src/components/RoomHighlightModal.tsx');
includesAll(floorPlanTab, [
  "const normalizedUserRole: UserRole = userRole === 'ADMIN' || userRole === 'EDITOR' ? userRole : 'VIEWER';",
  'const canManageStructure = roleResolved && canManageFloorPlanStructure(normalizedUserRole)',
  'structureReadOnly={!canManageStructure}',
  'canManageStructure && (viewMode',
  'canManageStructure && mapLayers.roomRegions',
  'canManageStructure && clickChoicePos',
  "canManageStructure && roomSortBy === 'manual'",
  'canManageStructure && touchMenu',
  'if (!canManageStructure || copiedRoomsState.length === 0 || !activeFloor) return;',
  'fail closed on role downgrade/switch',
], 'Floor-plan EDITOR structure UI + stale-state gates');
includesAll(roomHighlightModal, [
  'structureReadOnly?: boolean',
  'Kỹ sư chỉ cập nhật tiến độ',
  '!structureReadOnly && roomItem && onDeleteRoom',
], 'Room modal structural read-only mode');
if (!rulesBehavior.includes('EDITOR cannot create floor-plan structure')
  || !rulesBehavior.includes('EDITOR cannot create room geometry')
  || !rulesBehavior.includes('EDITOR cannot rename/move/resize room structure')
  || !rulesBehavior.includes('EDITOR can update existing room field progress')) {
  fail('Missing runtime regression for FloorPlan/Room EDITOR structural denial + operational allow');
}
pass('FloorPlan/Room structure is ADMIN-only while EDITOR existing-room field progress remains allowed');

for (const [name, port] of [['auth', 9099], ['firestore', 8080], ['storage', 9199], ['hosting', 5000]]) {
  const cfg = firebaseJson.emulators?.[name];
  if (!cfg || cfg.port !== port || cfg.host !== '0.0.0.0') fail(`${name} emulator must bind 0.0.0.0:${port}`);
}
if (firebaseJson.emulators?.ui?.port !== 4000) fail('Emulator UI port must be 4000');
pass('Emulators expose LAN-testable fixed ports');

includesAll(vite, ['VITE_USE_FIREBASE_EMULATORS', 'VITE_FIREBASE_EMULATOR_PROJECT_ID', 'VITE_FIREBASE_EMULATOR_HOST'], 'Vite emulator env propagation');
if (pkg.scripts?.['dev:emulator'] !== 'node scripts/emulator-dev.mjs start') fail('dev:emulator script missing');
if (pkg.scripts?.['build:emulator'] !== 'node scripts/emulator-dev.mjs build') fail('build:emulator script missing');
if (!String(pkg.scripts?.['test:stability'] || '').includes('emulator-golden.mjs')) fail('emulator golden is not part of stability gate');
pass('Cross-platform emulator launch/build scripts are wired into CI stability');

const launcher = read('scripts/emulator-dev.mjs');
includesAll(launcher, ["process.env.ComSpec || 'cmd.exe'", "['/d', '/s', '/c'", "`${name}.cmd`", 'quoteCmdToken', "shell: false"], 'Windows npm/npx launcher');
if (launcher.includes('spawnSync(executable(name)')) fail('Regression: Windows launcher directly spawns npm.cmd/npx.cmd and can hit EINVAL on Node 24');
if (launcher.includes('args.map(quoteCmdArg)')) fail('Regression: quoting every npm token makes Windows npm receive literal "run" and fail with Unknown command');
if (!launcher.includes('[commandName, ...args].map(quoteCmdToken)')) fail('Windows launcher must quote only cmd-sensitive tokens');
pass('Windows npm/npx launcher uses cmd.exe without turning npm subcommands into quoted literals');

if (!workflow.includes("vars.HNL_QLTC_DEV_PROJECT_ID != ''")) fail('Optional Cloud DEV preview must skip when no separate DEV project is configured');
if (!workflow.includes('DEV Firebase isolation gate') || !workflow.includes('!= "com-example-qlct-61329"')) fail('Cloud DEV workflow no longer blocks PROD');
pass('Cloud DEV preview is optional while its PROD isolation gate remains intact');
console.log('EMULATOR DEV GOLDEN CONFIG PASS');
