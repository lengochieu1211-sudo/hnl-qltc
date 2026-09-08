from pathlib import Path


def replace_between(text: str, start_marker: str, end_marker: str, replacement: str) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'missing start marker: {start_marker!r}')
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f'missing end marker: {end_marker!r}')
    return text[:start] + replacement + text[end:]


def replace_once(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one occurrence, got {count}: {old[:120]!r}')
    return text.replace(old, new, 1)

# 1) Material Need Engine: multi-floor + multi-team scope, preserving old single-ID compatibility.
engine_path = Path('src/utils/materialNeedEngine.ts')
engine = engine_path.read_text()
engine = replace_once(engine, "export interface MaterialNeedScope {\n  floorId?: string;\n  teamId?: string;\n  roomId?: string;\n}", "export interface MaterialNeedScope {\n  floorId?: string;\n  floorIds?: string[];\n  teamId?: string;\n  teamIds?: string[];\n  roomId?: string;\n}")
engine = replace_once(engine, "const isActiveLifecycle = <T extends { deletedAt?: number | null }>(item: T): boolean => item.deletedAt === undefined || item.deletedAt === null;", "const isActiveLifecycle = <T extends { deletedAt?: number | null }>(item: T): boolean => item.deletedAt === undefined || item.deletedAt === null;\nconst scopeIds = (single?: string, multiple?: string[]): string[] => Array.from(new Set([...(multiple || []), ...(single ? [single] : [])].map((value) => String(value || '').trim()).filter(Boolean)));\nconst scopeIncludes = (ids: string[], value?: string): boolean => ids.length === 0 || Boolean(value && ids.includes(value));")

new_build = r'''function buildContributions(
  rooms: RoomProgressItem[],
  workVolumes: WorkVolume[],
  scope: MaterialNeedScope,
  warnings: MaterialNeedWarning[],
): NeedContribution[] {
  const contributions: NeedContribution[] = [];
  const scopedFloorIds = scopeIds(scope.floorId, scope.floorIds);
  const scopedTeamIds = scopeIds(scope.teamId, scope.teamIds);
  const hasTeamScope = scopedTeamIds.length > 0;

  rooms.forEach((room) => {
    if (scope.roomId && room.id !== scope.roomId) return;
    if (!scopeIncludes(scopedFloorIds, room.floorId)) return;
    const cats = roomCategories(room, workVolumes);
    const roomTeamIds = uniqueRoomTeamIds(room);

    cats.forEach((cat) => {
      // An explicit category ID that no longer exists in the active WorkVolume catalog is an orphan linkage.
      // Do not turn a deleted category into a false MISSING_NORM warning; Health Center owns the orphan audit.
      if (cat.id && !workVolumes.some((work) => work.id === cat.id || work.workCategoryId === cat.id)) return;
      const categoryRef = cat.id || cat.name;
      const totalVolume = categoryVolumeForRoom(room, categoryRef, workVolumes);
      if (totalVolume <= 0) return;
      const sourceUnit = sourceUnitForRoomCategory(room, categoryRef, workVolumes);

      if (!hasTeamScope) {
        contributions.push({ roomId: room.id, floorId: room.floorId, workCategoryId: cat.id, workCategoryName: cat.name, sourceUnit, volume: totalVolume });
        return;
      }

      const categorySubs = categorySubItems(room, cat.id, cat.name);
      const categoryTeamIds = uniqueCategoryTeamIds(room, cat.id, cat.name);

      // When every possible team for this category is inside the selected team set,
      // the combined aggregate is deterministic even if the internal split is unknown.
      if (categoryTeamIds.length > 0 && categoryTeamIds.every((id) => scopedTeamIds.includes(id))) {
        contributions.push({ roomId: room.id, floorId: room.floorId, workCategoryId: cat.id, workCategoryName: cat.name, sourceUnit, volume: totalVolume });
        return;
      }
      if (categoryTeamIds.length === 0 && roomTeamIds.length > 0 && roomTeamIds.every((id) => scopedTeamIds.includes(id))) {
        contributions.push({ roomId: room.id, floorId: room.floorId, workCategoryId: cat.id, workCategoryName: cat.name, sourceUnit, volume: totalVolume });
        return;
      }

      const matchingSubs = categorySubs.filter((sub) => Boolean(sub.teamId && scopedTeamIds.includes(sub.teamId)));
      const explicitVolume = matchingSubs.reduce((sum, sub) => sum + (Number(sub.workVolume) || 0), 0);
      if (explicitVolume > 0) {
        contributions.push({ roomId: room.id, floorId: room.floorId, workCategoryId: cat.id, workCategoryName: cat.name, sourceUnit: normalizeUnit(matchingSubs[0]?.volumeUnit || sourceUnit) || sourceUnit, volume: explicitVolume });
        return;
      }

      if (categoryTeamIds.length === 1 && scopedTeamIds.includes(categoryTeamIds[0])) {
        contributions.push({ roomId: room.id, floorId: room.floorId, workCategoryId: cat.id, workCategoryName: cat.name, sourceUnit, volume: totalVolume });
        return;
      }

      if (roomTeamIds.length === 1 && scopedTeamIds.includes(roomTeamIds[0])) {
        contributions.push({ roomId: room.id, floorId: room.floorId, workCategoryId: cat.id, workCategoryName: cat.name, sourceUnit, volume: totalVolume });
        return;
      }

      const intersectsCategory = categoryTeamIds.some((id) => scopedTeamIds.includes(id));
      const intersectsRoom = categoryTeamIds.length === 0 && roomTeamIds.some((id) => scopedTeamIds.includes(id));
      if (intersectsCategory || intersectsRoom) {
        warnings.push({
          code: 'AMBIGUOUS_TEAM',
          roomId: room.id,
          floorId: room.floorId,
          teamId: scopedTeamIds.length === 1 ? scopedTeamIds[0] : undefined,
          workCategoryId: cat.id,
          message: `Căn ${room.roomName}: hạng mục ${cat.name} có nhiều đội nhưng chưa có khối lượng phân bổ đủ cho phạm vi đội đã chọn. Không tự chia nhu cầu.`,
        });
      }
    });
  });
  return contributions;
}
'''
engine = replace_between(engine, 'function buildContributions(', '\nfunction matchingNormsForContribution', new_build)

new_issued = r'''  const issued = new Map<string, number>();
  const unallocated = new Map<string, number>();
  const scopedFloorIds = scopeIds(scope.floorId, scope.floorIds);
  const scopedTeamIds = scopeIds(scope.teamId, scope.teamIds);
  const hasTeamScope = scopedTeamIds.length > 0;
  inventory.forEach((tx) => {
    if (tx.type !== 'out') return;
    if (scope.roomId && tx.sourceRoomId !== scope.roomId) return;
    if (scopedFloorIds.length > 0 && !scopeIncludes(scopedFloorIds, tx.sourceFloorId)) return;
    let key = canonicalKey(tx.materialId, tx.materialName, tx.unit);
    if (!tx.materialId) {
      const norm = materialNorms.find((n) => normalizeMaterialNameKey(n.materialName) === normalizeMaterialNameKey(tx.materialName) && areSameUnit(n.unit, tx.unit));
      if (norm) key = canonicalKey(resolveNormMaterialId(norm), norm.materialName, norm.unit);
    }
    const qty = Number(tx.quantity) || 0;
    if (hasTeamScope) {
      if (tx.sourceTeamId && scopedTeamIds.includes(tx.sourceTeamId)) {
        issued.set(key, (issued.get(key) || 0) + qty);
      } else if (!tx.sourceTeamId && tx.sourceRoomId) {
        const room = rooms.find((r) => r.id === tx.sourceRoomId);
        const ids = room ? uniqueRoomTeamIds(room) : [];
        if (ids.length > 0 && ids.every((id) => scopedTeamIds.includes(id))) {
          issued.set(key, (issued.get(key) || 0) + qty);
        } else if (ids.some((id) => scopedTeamIds.includes(id))) {
          unallocated.set(key, (unallocated.get(key) || 0) + qty);
          warnings.push({
            code: 'UNALLOCATED_ISSUE',
            roomId: tx.sourceRoomId,
            floorId: tx.sourceFloorId,
            teamId: scopedTeamIds.length === 1 ? scopedTeamIds[0] : undefined,
            message: `Phiếu ${tx.id} chưa có sourceTeamId và không thể chứng minh toàn bộ phiếu thuộc phạm vi đội đã chọn. Không trừ vào nhu cầu đội.`,
          });
        }
      }
      return;
    }
    if (scopedFloorIds.length > 0 && scopeIncludes(scopedFloorIds, tx.sourceFloorId)) issued.set(key, (issued.get(key) || 0) + qty);
    else if (scope.roomId && tx.sourceRoomId === scope.roomId) issued.set(key, (issued.get(key) || 0) + qty);
  });

'''
engine = replace_between(engine, '  const issued = new Map<string, number>();', '  const lines = Array.from(demand.entries())', new_issued + '  const lines = Array.from(demand.entries())')
engine_path.write_text(engine)

# 2) Shared expand/collapse control.
Path('src/components/ExpandCollapseButton.tsx').write_text(r'''import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface ExpandCollapseButtonProps {
  expanded: boolean;
  onToggle: () => void;
  controls?: string;
  className?: string;
  expandLabel?: string;
  collapseLabel?: string;
}

export const ExpandCollapseButton: React.FC<ExpandCollapseButtonProps> = ({
  expanded,
  onToggle,
  controls,
  className = '',
  expandLabel = 'Mở rộng',
  collapseLabel = 'Thu gọn',
}) => (
  <button
    type="button"
    onClick={onToggle}
    className={`shrink-0 inline-flex min-h-9 items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 active:scale-95 ${className}`}
    aria-expanded={expanded}
    aria-controls={controls}
  >
    {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
    {expanded ? collapseLabel : expandLabel}
  </button>
);
''')

# 3) Warehouse UI: default collapsed + intersection multi-select.
warehouse_path = Path('src/components/WarehouseTab.tsx')
warehouse = warehouse_path.read_text()
warehouse = replace_once(warehouse, '  ChevronDown,\n  ChevronUp\n', '  ChevronDown\n')
warehouse = replace_once(warehouse, "import { QuickSortBar } from './QuickSortBar';", "import { QuickSortBar } from './QuickSortBar';\nimport { ExpandCollapseButton } from './ExpandCollapseButton';")
warehouse = replace_between(
    warehouse,
    "  const [materialNeedMode, setMaterialNeedMode]",
    "\n\n  const materialNeedFloors = useMemo(() => {",
    "  const [materialNeedFloorIds, setMaterialNeedFloorIds] = useState<string[]>([]);\n  const [materialNeedTeamIds, setMaterialNeedTeamIds] = useState<string[]>([]);\n  const [isMaterialNeedExpanded, setIsMaterialNeedExpanded] = useState(false);\n  const [showMaterialFloorPicker, setShowMaterialFloorPicker] = useState(false);\n  const [showMaterialTeamPicker, setShowMaterialTeamPicker] = useState(false);\n"
)
warehouse = replace_between(
    warehouse,
    "  useEffect(() => {\n    if (!materialNeedFloorId",
    "\n\n  useEffect(() => {\n    if (!hasEditAccess)",
    r'''  const materialNeedResult = useMemo(() => computeMaterialNeeds({
    rooms: roomProgressList,
    materialNorms,
    inventory,
    workVolumes: workVolumes || [],
    teams,
    scope: {
      floorIds: materialNeedFloorIds.length > 0 ? materialNeedFloorIds : undefined,
      teamIds: materialNeedTeamIds.length > 0 ? materialNeedTeamIds : undefined,
    },
  }), [roomProgressList, materialNorms, inventory, workVolumes, teams, materialNeedFloorIds, materialNeedTeamIds]);

  const toggleMaterialNeedFloor = (id: string) => {
    setMaterialNeedFloorIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };
  const toggleMaterialNeedTeam = (id: string) => {
    setMaterialNeedTeamIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };
  const materialNeedFloorSummary = materialNeedFloorIds.length === 0 ? 'Tất cả tầng' : `${materialNeedFloorIds.length} tầng`;
  const materialNeedTeamSummary = materialNeedTeamIds.length === 0 ? 'Tất cả đội' : `${materialNeedTeamIds.length} đội`;
  const hasMaterialTeamFilter = materialNeedTeamIds.length > 0;
'''
)

new_section = r'''      {/* Gợi ý vật tư tổng hợp */}
      <section className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 shadow-sm">
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-extrabold text-slate-900">Gợi ý vật tư tổng hợp</h3>
              <p className="text-[11px] text-slate-600">{materialNeedFloorSummary} · {materialNeedTeamSummary} · {materialNeedResult.lines.length} loại vật tư</p>
            </div>
            <ExpandCollapseButton
              expanded={isMaterialNeedExpanded}
              onToggle={() => setIsMaterialNeedExpanded((value) => !value)}
              controls="material-need-details"
            />
          </div>

          {isMaterialNeedExpanded && (
            <div id="material-need-details" className="flex flex-col gap-3">
              <p className="text-[11px] text-slate-600">Chọn một hoặc nhiều tầng và một hoặc nhiều đội. Không chọn nghĩa là Tất cả. Kết quả luôn tính lại từ dữ liệu gốc để tránh double-count.</p>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="relative">
                  <button type="button" onClick={() => setShowMaterialFloorPicker((value) => !value)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 text-left text-xs font-semibold">
                    <span>{materialNeedFloorSummary}</span><ChevronDown className="h-4 w-4 text-slate-400" />
                  </button>
                  {showMaterialFloorPicker && (
                    <div className="mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-xs font-semibold hover:bg-slate-50">
                        <input type="checkbox" checked={materialNeedFloorIds.length === 0} onChange={() => setMaterialNeedFloorIds([])} /> Tất cả tầng
                      </label>
                      {materialNeedFloors.map((floor) => (
                        <label key={floor.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-xs hover:bg-slate-50">
                          <input type="checkbox" checked={materialNeedFloorIds.includes(floor.id)} onChange={() => toggleMaterialNeedFloor(floor.id)} /> {floor.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button type="button" onClick={() => setShowMaterialTeamPicker((value) => !value)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 text-left text-xs font-semibold">
                    <span>{materialNeedTeamSummary}</span><ChevronDown className="h-4 w-4 text-slate-400" />
                  </button>
                  {showMaterialTeamPicker && (
                    <div className="mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-xs font-semibold hover:bg-slate-50">
                        <input type="checkbox" checked={materialNeedTeamIds.length === 0} onChange={() => setMaterialNeedTeamIds([])} /> Tất cả đội
                      </label>
                      {teams.map((team) => (
                        <label key={team.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-xs hover:bg-slate-50">
                          <input type="checkbox" checked={materialNeedTeamIds.includes(team.id)} onChange={() => toggleMaterialNeedTeam(team.id)} /> {team.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {(materialNeedFloorIds.length > 0 || materialNeedTeamIds.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {materialNeedFloorIds.map((id) => {
                    const floor = materialNeedFloors.find((item) => item.id === id);
                    return <button key={`floor-${id}`} type="button" onClick={() => toggleMaterialNeedFloor(id)} className="rounded-full bg-indigo-100 px-2 py-1 text-[10px] font-bold text-indigo-700">{floor?.name || id} ×</button>;
                  })}
                  {materialNeedTeamIds.map((id) => {
                    const team = teams.find((item) => item.id === id);
                    return <button key={`team-${id}`} type="button" onClick={() => toggleMaterialNeedTeam(id)} className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-700">{team?.name || id} ×</button>;
                  })}
                </div>
              )}

              {materialNeedResult.lines.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">Chưa có nhu cầu vật tư xác định cho phạm vi đã chọn.</div>
              ) : (
                <div className="max-h-[52vh] overflow-auto overscroll-contain rounded-xl border border-indigo-100 bg-white sm:max-h-[28rem]">
                  <table className="min-w-[720px] w-full text-[11px]">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600"><tr><th className="p-2 text-left">Vật tư</th><th className="p-2 text-right">Tổng cần</th><th className="p-2 text-right">Đã xuất</th>{hasMaterialTeamFilter && <th className="p-2 text-right">Chưa phân bổ</th>}<th className="p-2 text-right">Còn cần</th><th className="p-2 text-right">Tồn kho</th><th className="p-2 text-right">Thiếu</th></tr></thead>
                    <tbody>
                      {materialNeedResult.lines.map((line) => (
                        <tr key={line.materialKey} className="border-t border-slate-100">
                          <td className="p-2"><div className="font-bold text-slate-800">{line.materialName}</div><div className="text-[10px] text-slate-500">{line.category} · {line.unit}</div></td>
                          <td className="p-2 text-right font-semibold">{formatDecimal(line.estimatedQty)}</td>
                          <td className="p-2 text-right text-emerald-700">{formatDecimal(line.alreadyIssued)}</td>
                          {hasMaterialTeamFilter && <td className="p-2 text-right text-amber-700">{formatDecimal(line.unallocatedIssued)}</td>}
                          <td className="p-2 text-right font-bold text-indigo-700">{formatDecimal(line.remainingQty)}</td>
                          <td className="p-2 text-right">{formatDecimal(line.stockQty)}</td>
                          <td className={`p-2 text-right font-bold ${line.deficitQty > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{formatDecimal(line.deficitQty)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {materialNeedResult.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
                  <div className="font-bold mb-1">Thiếu liên kết/định mức — hệ thống đang fail-closed:</div>
                  <ul className="list-disc pl-4 space-y-0.5">{materialNeedResult.warnings.slice(0, 8).map((w, idx) => <li key={`${w.code}-${idx}`}>{w.message}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

'''
warehouse = replace_between(warehouse, '      {/* Gợi ý vật tư tổng hợp */}', '      {lowStockItems.length > 0 && (', new_section + '      {lowStockItems.length > 0 && (')
warehouse_path.write_text(warehouse)

# 4) Regression coverage for floor/team intersections.
test_path = Path('scripts/material-need-golden.ts')
test = test_path.read_text()
new_tests = r'''
const floor1TeamARoom = {
  ...multiTeamRoom,
  id: 'room-101',
  roomName: '101',
  floorId: 'floor-1',
  workVolume: 40,
  subItems: [
    { id: 'sub-101-a', category: 'Trần thạch cao', workCategoryId: 'wc-ceiling', teamId: 'team-a', status: 'Đang làm' },
  ],
} as RoomProgressItem;

const teamAFloor1 = computeMaterialNeeds({ rooms: [floor1TeamARoom, multiTeamRoom], materialNorms: [norm], inventory: [], workVolumes, teams, scope: { floorIds: ['floor-1'], teamIds: ['team-a'] } });
assert.equal(teamAFloor1.lines[0]?.estimatedQty, 14, 'Team A on floor 1 must use only floor 1 demand');

const teamAFloor3 = computeMaterialNeeds({ rooms: [floor1TeamARoom, multiTeamRoom], materialNorms: [norm], inventory: [], workVolumes, teams, scope: { floorIds: ['floor-3'], teamIds: ['team-a'] } });
assert.equal(teamAFloor3.lines[0]?.estimatedQty, 17.5, 'Team A on floor 3 must use only floor 3 demand');

const teamAFloor1And3 = computeMaterialNeeds({ rooms: [floor1TeamARoom, multiTeamRoom], materialNorms: [norm], inventory: [], workVolumes, teams, scope: { floorIds: ['floor-1', 'floor-3'], teamIds: ['team-a'] } });
assert.equal(teamAFloor1And3.lines[0]?.estimatedQty, 31.5, 'Team A across floors 1+3 must aggregate both floors exactly once');

const bothTeamsFloor3 = computeMaterialNeeds({ rooms: [multiTeamRoom], materialNorms: [norm], inventory: [], workVolumes, teams, scope: { floorIds: ['floor-3'], teamIds: ['team-a', 'team-b'] } });
assert.equal(bothTeamsFloor3.lines[0]?.estimatedQty, 35, 'Selecting all teams on floor 3 must equal floor demand without double-count');

const allTeamsFloors1And3 = computeMaterialNeeds({ rooms: [floor1TeamARoom, multiTeamRoom], materialNorms: [norm], inventory: [], workVolumes, teams, scope: { floorIds: ['floor-1', 'floor-3'] } });
assert.equal(allTeamsFloors1And3.lines[0]?.estimatedQty, 49, 'All teams across floors 1+3 must aggregate room demand once');

'''
test = replace_once(test, "const missingNorm = computeMaterialNeeds", new_tests + "const missingNorm = computeMaterialNeeds")
test_path.write_text(test)

print('MATERIAL MULTI-SCOPE TRANSFORM APPLIED')
