import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const src = {
  security: read('src/utils/securityUtils.ts'),
  app: read('src/App.tsx'),
  work: read('src/components/WorkVolumeTab.tsx'),
  floor: read('src/components/FloorPlanDefectTab.tsx'),
  room: read('src/components/RoomHighlightModal.tsx'),
  warehouse: read('src/components/WarehouseTab.tsx'),
  checklist: read('src/components/ChecklistTab.tsx'),
  crew: read('src/components/CrewTab.tsx'),
  norms: read('src/components/MaterialNormModal.tsx'),
  securityModal: read('src/components/SecurityModal.tsx'),
  projects: read('src/components/ProjectManagerModal.tsx'),
  pdf: read('src/components/ExportPdfModal.tsx'),
  header: read('src/components/GoogleAuthHeader.tsx'),
  config: read('src/components/GoogleConfigTab.tsx'),
  photos: read('src/components/PhotoAttachmentPicker.tsx'),
  firestore: read('firestore.rules'),
  storage: read('storage.rules'),
};

let failed = false;
function check(label, ok) {
  if (ok) console.log(`PASS RBAC: ${label}`);
  else { console.error(`FAIL RBAC: ${label}`); failed = true; }
}
const has = (text, ...needles) => needles.every((n) => text.includes(n));
const adminOnlyHelper = (name) => new RegExp(`export function ${name}\\(role: UserRole\\): boolean \\{\\s*return role === 'ADMIN';\\s*\\}`, 'm').test(src.security);
const editorHelper = (name) => new RegExp(`export function ${name}\\(role: UserRole\\): boolean \\{\\s*return role === 'ADMIN' \\|\\| role === 'EDITOR';\\s*\\}`, 'm').test(src.security);

// Canonical role boundary.
for (const helper of [
  'canManageProjects','canCreateProject','canDeleteProject','canManageMembers','canManageSecurity',
  'canImportData','canRestoreData','canManageWorkVolumeStructure','canManageFloorPlanStructure',
  'canManageMaterialNorms','canManageTeams','canManageChecklistStructure','canDeleteBusinessData',
  'canManageBackups','canUseGlobalUndoRedo','canViewFinancials'
]) check(`${helper} is ADMIN-only`, adminOnlyHelper(helper));
for (const helper of ['canEditProjectData','canEditDefectData','canEditChecklistData','canEditCrewData','canEditWarehouseData']) {
  check(`${helper} is ADMIN+EDITOR`, editorHelper(helper));
}

// App handler defense (not UI-only).
check('WorkVolume structure handlers use shared ADMIN helper', (src.app.match(/canManageWorkVolumeStructure\(currentUserRole\)/g) || []).length >= 5);
check('Floor/room structure handlers use shared ADMIN helper', (src.app.match(/canManageFloorPlanStructure\(currentUserRole\)/g) || []).length >= 10);
check('Material norm handlers are ADMIN-only', (src.app.match(/canManageMaterialNorms\(currentUserRole\)/g) || []).length >= 3);
check('Checklist separates operational vs structure permission', has(src.app, 'canEditChecklistData(currentUserRole)', 'canManageChecklistStructure(currentUserRole)'));
check('Defect operational handlers require EDITOR/ADMIN', has(src.app, 'canEditDefectData(currentUserRole)'));
check('Crew operational handlers require EDITOR/ADMIN', has(src.app, 'canEditCrewData(currentUserRole)'));
check('Warehouse operational handlers require EDITOR/ADMIN', has(src.app, 'canEditWarehouseData(currentUserRole)'));
check('Broad deletes use ADMIN-only helper', (src.app.match(/canDeleteBusinessData\(currentUserRole\)/g) || []).length >= 4);
check('Backup/restore handlers use ADMIN-only helper', (src.app.match(/canManageBackups\(currentUserRole\)/g) || []).length >= 12);
check('Backup autosave/settings fail closed during unresolved role changes', has(src.app, "isProjectRoleResolved && currentUserRole === 'ADMIN' && getCurrentRealFirebaseUser()", "if (!isProjectRoleResolved || !canManageBackups(currentUserRole)) return;"));
check('Core save queue fails closed until project role is resolved', has(src.app, "if (!isProjectRoleResolved || !canEditProjectData(currentUserRole)) return;"));
check('Whole-App undo/redo is ADMIN-only', has(src.app, 'canUseGlobalUndoRedo(currentUserRole)'));
check('FloorPlan receives verified-role state from App', has(src.app, 'roleResolved={isProjectRoleResolved}', '<FloorPlanDefectTab'));

// UI + stale-session defense.
check('WorkVolume structural UI uses ADMIN helper', has(src.work, 'canManageWorkVolumeStructure', 'hasStructureManageAccess'));
check('FloorPlan structural UI uses ADMIN helper', has(src.floor, 'canManageFloorPlanStructure', 'canManageStructure', 'structureReadOnly={!canManageStructure}'));
check('FloorPlan defect UI separates operational and delete permission', has(src.floor, 'canEditDefectData', 'canDeleteBusinessData', 'canEditDefects', 'canDeleteDefects'));
check('Room modal supports structural read-only mode', has(src.room, 'structureReadOnly?: boolean', 'disabled={structureReadOnly}', 'const effectivePatch = structureReadOnly', 'subItems: (roomItem.subItems || []).map'));
check('Room modal hides nested sub-item structure controls for Editor', has(src.room, '!structureReadOnly && selectedSubItemIds.length > 0', '!structureReadOnly && activeCategories.length > 1', '!structureReadOnly && itemsInCat.length > 1', '!structureReadOnly && (deletingSubItemId === item.id'));
check('Floor target-date settings are ADMIN-only in UI', (src.config.match(/disabled=\{userRole !== 'ADMIN'\}/g) || []).length >= 6 && has(src.config, 'targetFrameDate', 'targetBoardDate'));
check('Photo picker read-only mode is enforced in handlers, not UI-only', (src.photos.match(/if \(readOnly\) return;/g) || []).length >= 3 && has(src.photos, 'if (readOnly || !editingPhoto || !projectId) return;'));
check('Warehouse has verified role, edit/delete/import/norm gates', has(src.warehouse, 'roleResolved: boolean', 'hasEditAccess', 'hasDeleteAccess', 'hasImportAccess', 'hasNormManageAccess'));
check('Checklist has verified role and separates operational/structure/delete/import', has(src.checklist, 'roleResolved: boolean', 'canOperate', 'canManageStructure', 'canDelete', 'canImport'));
check('Crew has verified role and separates operations/team/delete/import', has(src.crew, 'roleResolved: boolean', 'canOperate', 'canManageTeamDirectory', 'canDelete', 'canImportTeams'));
check('Material norms are structurally ADMIN-only', has(src.norms, 'roleResolved: boolean', 'hasManageAccess', 'hasImportAccess'));
check('Security member mutation is ADMIN-only', has(src.securityModal, 'canManageProjectMembers', 'canManageMembers(currentRole)'));
check('Viewer cannot read audit tab while Editor/Admin can', has(src.securityModal, 'canReadAudit', "currentRole === 'ADMIN' || currentRole === 'EDITOR'"));
check('Project backup/restore surface is ADMIN-only', has(src.projects, 'canBackup = canManageBackups(effectiveRole)', '{canBackup ? ('));
check('Project create/rename/delete/orphan maintenance is ADMIN-only in handlers and UI', has(src.projects, 'if (!canManage || !newProjectName.trim()) return;', 'if (!canManage || !editingProjectName.trim()) return;', 'if (!canManage || !confirmDeleteId) return;', 'if (!canManage || !orphan?.id || recoveringOrphanId) return;', 'const handleMergeDuplicateInto = async (target: ProjectInfo) => {\n    if (!canManage) return;', '{canManage && <>', '{canManage && deletedProjects.length > 0 && (', 'Fail closed on live role downgrade/account switch', 'if (!canManage || !onDriveSyncUpAll) return;', 'if (!canManage || !onDriveSyncDownAll) return;', '{hasDriveBackend && canManage && ('));
check('Financial report fields remain ADMIN-only', has(src.pdf, 'canViewFinancials', 'hasFinancialAccess'));
check('Project title editing remains ADMIN-only', has(src.header, "userRole === 'ADMIN'", 'Chỉ ADMIN được sửa thông tin dự án'));

// Firestore enforcement: UI bypass must still fail.
check('Firestore has canonical ADMIN structural collection classifier', has(src.firestore, 'function isAdminOwnedStructureCollection', "name == 'work_volumes'", "name == 'floor_plans'", "name == 'rooms'", "name == 'material_norms'", "name == 'teams'", "name == 'checklist'", "name == 'settings'", "name == 'trash'"));
check('Firestore EDITOR generic writes fail closed to explicit operational allowlist', has(src.firestore, 'function isEditorOperationalCollection', "name == 'inventory'", "name == 'defects'", "name == 'crew_records'", 'isEditorOperationalCollection(collectionName)'));
check('Firestore legacy floor-plan image fallback is read-only', has(src.firestore, 'function isLegacyReadOnlyCollection', "name == 'floor_plan_images'", '!isLegacyReadOnlyCollection(collectionName)'));
check('Firestore generic physical delete is ADMIN-only', has(src.firestore, "allow delete: if collectionName != 'activityLogs'", '&& isAdmin(projectId)', '&& !isCoreBusinessCollection(collectionName)'));
check('Firestore Editor room update is operational-only', has(src.firestore, 'function editorRoomOperationalUpdateOnly', 'editorKeepsActiveLifecycle()', "'frameStatus'", "'inspectionStatus'", "'subItems'"));
check('Firestore Editor checklist update is operational-only', has(src.firestore, 'function editorChecklistOperationalUpdateOnly', "'status'", "'notes'", "'inspectedBy'"));
check('Firestore Editor cannot tombstone normal operational records', has(src.firestore, 'function editorCreatesActiveOnly', 'function editorKeepsActiveLifecycle'));
check('Firestore core identity/revision guard is retained', has(src.firestore, 'coreIdentityUpdateIsValid(recordId)', 'lifecycleUpdateIsMonotonic()'));
check('Viewer project data remains read-only via isMember/canEdit split', has(src.firestore, 'allow read:', 'isMember(projectId)', 'function canEdit(projectId)'));
check('Viewer chat exception is explicit and identity-bound', has(src.firestore, 'VIEWER may chat', 'allow create: if isMember(projectId)', 'request.resource.data.senderUid == request.auth.uid'));

// Storage enforcement.
check('Storage project media upload requires EDITOR/ADMIN', has(src.storage, 'match /projects/{projectId}/media/', 'allow create: if canEdit(projectId)'));
check('Storage floor-plan binaries are ADMIN-only', has(src.storage, 'match /projects/{projectId}/floor-plans/', 'Floor-plan drawing binaries are project structure: ADMIN-only.', 'allow create: if isAdmin(projectId)', 'allow update: if isAdmin(projectId)'));
check('Storage binary purge remains ADMIN-only', (src.storage.match(/allow delete: if isAdmin\(projectId\);/g) || []).length >= 2);

// Regression tooling must cover all three roles and structural/operational split.
const rulesTest = read('scripts/firebase-rules-behavior.mjs');
check('Rules behavior test includes ADMIN/EDITOR/VIEWER identities', has(rulesTest, 'ownerEmail', 'editorEmail', 'viewerEmail'));
check('Rules behavior test covers WorkVolume and FloorPlan structural denial', has(rulesTest, 'EDITOR cannot create work-volume master definition', 'EDITOR cannot create floor-plan structure', 'EDITOR cannot create room geometry'));
check('Rules behavior test covers master structure collections', has(rulesTest, 'material norm', 'team directory', 'checklist definition'));
check('Rules behavior test covers operational Editor permissions', has(rulesTest, 'checklist inspection status', 'defect operational update', 'crew operational record', 'warehouse operational record'));
check('Rules behavior test covers Admin-only settings/trash and legacy floor image fallback', has(rulesTest, 'EDITOR cannot mutate shared settings', 'EDITOR cannot create trash metadata', 'ADMIN cannot recreate legacy floor-plan Firestore metadata'));
check('Rules behavior test covers fail-closed future collection denial', has(rulesTest, 'EDITOR cannot create unclassified future project collection'));
check('Rules behavior test covers Viewer write denial', has(rulesTest, 'VIEWER cannot write core record'));

if (failed) process.exit(1);
console.log('MASTER RBAC MATRIX PASS – ADMIN / EDITOR / VIEWER');
