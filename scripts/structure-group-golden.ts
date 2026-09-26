import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFloorDuplicateNames, moveFloorsToStructureGroup, normalizeStructureGroupConfig, resolveFloorStructureGroupId } from '../src/utils/structureGroupUtils';

const config = normalizeStructureGroupConfig({
  enabled: true,
  label: 'Khu / Khối',
  groups: [
    { id: 'tower-1', name: 'Tháp 1', order: 0 },
    { id: 'tower-2', name: 'Tháp 2', order: 1 },
  ],
  defaultGroupId: 'tower-1',
});

assert.equal(resolveFloorStructureGroupId({ structureGroupId: 'tower-2' } as any, config), 'tower-2');
assert.equal(resolveFloorStructureGroupId({} as any, config), 'tower-1', 'legacy floor must remain readable via default group');
assert.equal(normalizeStructureGroupConfig({ ...config, groups: [{ id: 'tower-1', name: 'Tháp 1' }], defaultGroupId: 'tower-2' }).defaultGroupId, 'tower-1');
assert.equal(normalizeStructureGroupConfig({ ...config, groups: [{ id: 'tower-1', name: 'Tháp 1' }, { id: 'tower-1', name: 'Duplicate' }] }).groups.length, 1);

const bulkSource = [
  { id: 'f-a', floorName: 'Tầng A', structureGroupId: 'tower-1', order: 0, imageUrl: 'a', uploadedAt: '2026-09-25' },
  { id: 'f-b', floorName: 'Tầng B', structureGroupId: 'tower-2', order: 1, imageUrl: 'b', uploadedAt: '2026-09-25' },
  { id: 'f-c', floorName: 'Tầng C', structureGroupId: 'tower-1', order: 2, imageUrl: 'c', uploadedAt: '2026-09-25' },
] as any[];
const bulkMoved = moveFloorsToStructureGroup(bulkSource, ['f-c', 'f-a'], 'tower-2', config);
assert.equal(bulkMoved.find((floor) => floor.id === 'f-a')?.structureGroupId, 'tower-2');
assert.equal(bulkMoved.find((floor) => floor.id === 'f-c')?.structureGroupId, 'tower-2');
assert.equal(bulkMoved[1], bulkSource[1], 'unselected floor object must remain untouched');
assert.ok(Number(bulkMoved.find((floor) => floor.id === 'f-a')?.order) < Number(bulkMoved.find((floor) => floor.id === 'f-c')?.order), 'selected floors must preserve prior relative order');
assert.ok(Number(bulkMoved.find((floor) => floor.id === 'f-a')?.order) > Number(bulkMoved.find((floor) => floor.id === 'f-b')?.order), 'moved floors must append after existing destination floors');

assert.deepEqual(
  buildFloorDuplicateNames('Tầng 5', 3, ['Tầng 5', 'Tầng 5 (Bản sao)']),
  ['Tầng 5 (Bản sao 2)', 'Tầng 5 (Bản sao 3)', 'Tầng 5 (Bản sao 4)'],
  'bulk duplicate names must stay unique and deterministic',
);
assert.equal(buildFloorDuplicateNames('Tầng 2', 99).length, 20, 'duplicate copies must be safety-capped at 20 per source floor');

const exportSource = readFileSync(new URL('../src/components/ExportPdfModal.tsx', import.meta.url), 'utf8');
assert.ok(exportSource.includes('const roomScopeOptions = baseRoomScopeOptions.slice().sort'), 'report room options must cascade from floor scope, not selected team');
assert.equal(exportSource.includes('baseRoomScopeOptions.filter(roomMatchesTeamScope).slice().sort'), false, 'team filter must not cyclically remove room options');
assert.ok(exportSource.includes('const groupScopedFloorIdsKey = groupScopedFloorPlans.map((floor) => floor.id).sort().join'), 'report cascade must track actual floor IDs after a floor moves Khu/Khối');

const warehouseSource = readFileSync(new URL('../src/components/WarehouseTab.tsx', import.meta.url), 'utf8');
assert.ok(warehouseSource.includes('linkedRoom?.floorId || item.sourceFloorId ||'), 'warehouse edit must resolve Room -> Floor before Khu/Khối');
assert.ok(warehouseSource.includes('const finalIssueStructureGroupId = finalIssueFloor && normalizedStructureConfig.enabled'), 'warehouse submit must derive Khu/Khối from the authoritative floor');
assert.ok(warehouseSource.includes('materialNeedGroupFloorIdSet && materialNeedGroupFloorIdSet.size === 0'), 'empty Khu/Khối material scope must not fail open to all floors');

assert.ok(warehouseSource.includes('absolute left-0 right-0 z-40 mt-1 max-h-52'), 'material-need pickers must open as compact floating dropdowns');
assert.ok(warehouseSource.includes('setShowMaterialFloorPicker(false); setShowMaterialRoomPicker(false);'), 'material-need picker must close sibling dropdowns');

assert.ok(exportSource.includes('showReportStructureGroupPicker'), 'report scope must use compact dropdown picker state');
assert.ok(exportSource.includes('reportFloorSummary'), 'report scope must render compact summaries instead of always-open checkbox columns');
assert.ok(exportSource.includes('absolute left-0 right-0 z-40 mt-1 max-h-52'), 'report scope pickers must open as floating dropdowns');

const floorPlanSource = readFileSync(new URL('../src/components/FloorPlanDefectTab.tsx', import.meta.url), 'utf8');
assert.ok(floorPlanSource.includes("const [editingStructureGroupId"), 'Khu/Khối rename must use explicit edit state');
assert.ok(floorPlanSource.includes("title=\"Lưu tên Khu/Khối\""), 'Khu/Khối rename must require an explicit save action');
assert.equal(floorPlanSource.includes("defaultValue={group.name}"), false, 'Khu/Khối must not auto-save rename through blur/defaultValue');
assert.ok(floorPlanSource.includes('applyGroupQuickSort'), 'Khu/Khối quick sort must persist group order');
assert.ok(floorPlanSource.includes('applyFloorQuickSortWithinGroups'), 'floor quick sort must persist order inside each Khu/Khối');
assert.ok(floorPlanSource.includes("moveFloorWithinGroup"), 'manual floor reorder must stay inside its Khu/Khối');
assert.ok(floorPlanSource.includes("visibleFloorPlans.map((fp)"), 'project floor list must honor Khu/Khối filter');
assert.ok(floorPlanSource.includes("getFloorStructureGroupName(activeFloor, normalizedStructureConfig)"), 'active floor breadcrumb must show its Khu/Khối');
assert.ok(floorPlanSource.includes("getFloorStructureGroupName(fp, normalizedStructureConfig)} → ${fp.floorName}"), 'floor chips must disambiguate duplicate floor names by Khu/Khối');

assert.ok(floorPlanSource.includes("visibleFloorPlans.find((fp) => fp.id === selectedFloorId)"), 'active floor must stay inside selected Khu/Khối filter');
assert.ok(floorPlanSource.includes("Never carry hidden bulk-delete targets across Khu/Khối filters"), 'Khu/Khối filter must clear hidden bulk-delete targets');
assert.ok(floorPlanSource.includes("visibleFloorPlans.map((floor) =>"), 'floor progress list must honor the Khu/Khối filter');
assert.ok(floorPlanSource.includes("changeFloorStructureGroupStable"), 'moving a floor to another Khu/Khối must preserve a stable persisted order');
assert.ok(floorPlanSource.includes("changeFloorStructureGroupStable(fp.id, event.target.value)"), 'management Khu/Khối reassignment must use stable move helper');
assert.ok(floorPlanSource.includes('moveSelectedFloorsToStructureGroupStable'), 'floor manager must support bulk Khu/Khối move without rewriting linked business IDs');
assert.ok(floorPlanSource.includes('Thao tác tầng đã chọn'), 'floor manager must expose one unified checkbox-driven action bar');
assert.equal(floorPlanSource.includes('Chuyển nhiều tầng giữa Khu/Khối'), false, 'separate legacy bulk-move panel must be removed');
assert.ok(floorPlanSource.includes('Số bản / tầng'), 'bulk floor duplicate must let the user choose how many copies per selected floor');
assert.ok(floorPlanSource.includes('duplicateManagedFloors'), 'bulk duplicate must use the guarded selected-floor flow');
assert.ok(floorPlanSource.includes('deleteManagedFloors'), 'bulk delete must use the guarded selected-floor flow');
assert.ok(floorPlanSource.includes('Không thể xóa toàn bộ mặt bằng. Dự án cần duy trì ít nhất 1 tầng.'), 'bulk delete must fail closed when every floor is selected');
assert.ok(floorPlanSource.includes('onBulkMoveFloorPlansToStructureGroup(selectedInSavedOrder.map((floor) => floor.id), nextGroupId)'), 'bulk Khu/Khối move must use the dedicated minimal App handler when available');
assert.ok(floorPlanSource.includes('Chọn tất cả ${currentGroupFloors.length} tầng trong'), 'bulk Khu/Khối move must support selecting every floor inside one group');
assert.ok(floorPlanSource.includes('<span>Chọn tất cả</span>'), 'multi-select Khu/Khối UI must visibly label select-all per group');
assert.ok(floorPlanSource.includes('grid-cols-[minmax(0,1fr)_auto]') && floorPlanSource.includes('justify-self-end self-start') && floorPlanSource.includes('Sửa tên / Nhân bản / Xóa'), 'floor overflow menu must stay pinned to the far right independently from long floor names');
assert.ok(floorPlanSource.includes("confirmLabel: 'Tắt và giữ nguyên dữ liệu'"), 'disabling Khu/Khối must require an explicit data-preserving confirmation');
assert.ok(floorPlanSource.includes('Tắt Khu/Khối chỉ ẩn phân nhóm, không gộp/xóa dữ liệu'), 'disable warning must state that grouping data is preserved');
assert.ok(floorPlanSource.includes('Tầng chưa gán nhóm hiển thị tại') && !floorPlanSource.includes('Khu/Khối mặc định cho tầng chưa phân nhóm') && !floorPlanSource.includes('legacy chưa có <code>structureGroupId</code>'), 'legacy floor display-group control must stay simple, non-technical, and only appear with grouping UI');
assert.equal(floorPlanSource.includes('>\n                          Xem\n'), false, 'floor manager must not keep a separate Xem button');
assert.ok(floorPlanSource.includes('setSelectedFloorId(fp.id);\n                        setShowManageFloorsModal(false);'), 'clicking the floor row must open/select that floor directly');

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const rulesSource = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const firebaseBaseSource = readFileSync(new URL('../src/lib/firebaseBase.ts', import.meta.url), 'utf8');
assert.ok(appSource.includes("saveProjectSharedSettings(activeProjectIdRef.current, { structure: next })"), 'Khu/Khối config must sync through shared project settings');
assert.ok(appSource.includes('subscribeProjectSharedSettings(activeProjectId, (settings) =>'), 'Khu/Khối config must update in realtime across authenticated accounts');
assert.ok(appSource.includes('const handleBulkMoveFloorPlansToStructureGroup = (ids: string[], targetGroupId: string) =>') && appSource.includes('floorPlans: moveFloorsToStructureGroup(prev.floorPlans, ids, targetGroupId, normalizedStructure)'), 'bulk move must use the minimal pure helper and not rewrite linked business collections');
assert.ok(rulesSource.includes('isSuperAdmin() || isOwner(projectId) || canonicalMemberActive(projectId)'), 'SuperAdmin and project members must retain project read access for Khu/Khối data');
assert.ok(firebaseBaseSource.includes("if (isSuperAdminEmail(user.email))") && firebaseBaseSource.includes("return { allowed: true, role: 'ADMIN'"), 'SuperAdmin must resolve as ADMIN for every existing project without per-project membership');
assert.ok(firebaseBaseSource.includes("getDocsFromServer(collection(db, 'projects'))") && firebaseBaseSource.includes("const allProjectsQuery = collection(db, 'projects')"), 'SuperAdmin project discovery must include all project roots in initial and realtime reads');

assert.ok(floorPlanSource.includes("const [editingStructureLabel"), 'structure level label must use explicit edit state');
assert.ok(
  floorPlanSource.includes('title="Lưu tên cấp"')
    && floorPlanSource.includes('editingStructureLabelValue.trim()')
    && floorPlanSource.includes("setEditingStructureLabel(false);"),
  'structure level label must require explicit save'
);
assert.equal(floorPlanSource.includes('value={normalizedStructureConfig.label}\n                    onChange={(e) => onStructureConfigChange'), false, 'structure level label must not save on every keystroke');
assert.ok(floorPlanSource.includes('normalizedStructureConfig.groups.length >= 6'), 'Khu/Khối quick sort must follow the 6-item rule');
assert.equal(floorPlanSource.includes('minItems={0}'), false, 'Khu/Khối/Tầng quick sort must not bypass the global 6-item threshold');

assert.ok(exportSource.includes("if (current.includes('all')) return [value];"), 'report multi-select must allow switching from Tất cả to one item');
assert.equal(exportSource.includes('disabled={allStructureGroupsSelected}'), false, 'report Khu/Khối options must stay selectable while Tất cả is active');
assert.equal(exportSource.includes('disabled={isAllSelected}'), false, 'report floor options must stay selectable while Tất cả is active');
assert.equal(exportSource.includes('disabled={allRoomsSelected}'), false, 'report room options must stay selectable while Tất cả is active');
assert.equal(exportSource.includes('disabled={allTeamsSelected}'), false, 'report team options must stay selectable while Tất cả is active');

console.log('structure-group-golden: PASS');
