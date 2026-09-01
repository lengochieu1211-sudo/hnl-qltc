from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
pdf = ROOT / 'src/components/ExportPdfModal.tsx'
excel = ROOT / 'src/utils/excelExport.ts'

text = pdf.read_text(encoding='utf-8')
anchor = "  const effectiveFloorPlans = resolvedFloorPlans.length === floorPlans.length ? resolvedFloorPlans : floorPlans;\n"
helper = """

  // Report hygiene: legacy room metadata may retain categories that were removed from
  // the active Khối lượng catalog. Keep that metadata for history/recovery, but never
  // resurrect deleted categories in current PDF output.
  const activeWorkCategoryNames = new Set(
    workVolumes
      .filter((item) => !item.deletedAt)
      .map((item) => String(item.title || '').trim())
      .filter(Boolean)
  );
  const isActiveReportCategory = (name: unknown): boolean => {
    const normalized = String(name || '').trim();
    if (!normalized) return false;
    // Legacy projects without a WorkVolume catalog keep their historical display.
    if (activeWorkCategoryNames.size === 0) return true;
    return activeWorkCategoryNames.has(normalized);
  };
  const getActiveRoomCategoryNames = (room: RoomProgressItem): string[] => Array.from(new Set([
    ...Object.keys(room.categoryVolumes || {}),
    ...(room.subItems || []).map((sub) => sub.category || room.workCategory || '').filter(Boolean),
    ...(room.workCategory ? [room.workCategory] : []),
  ].map((name) => String(name || '').trim()).filter(isActiveReportCategory)));
  const getActiveRoomVolumeEntries = (room: RoomProgressItem): Array<[string, number]> =>
    (Object.entries(room.categoryVolumes || {}) as Array<[string, number]>)
      .filter(([name]) => isActiveReportCategory(name));
  const getActiveRoomSubItems = (room: RoomProgressItem) => (room.subItems || [])
    .filter((sub) => isActiveReportCategory(sub.category || room.workCategory || ''));
"""
if 'const activeWorkCategoryNames = new Set(' not in text:
    if anchor not in text:
        raise SystemExit('PDF helper anchor not found')
    text = text.replace(anchor, anchor + helper, 1)

old_category = """const categoryNames = Array.from(new Set([
                                  ...Object.keys(r.categoryVolumes || {}),
                                  ...(r.subItems || []).map((sub) => sub.category || r.workCategory || '').filter(Boolean),
                                  ...(r.workCategory ? [r.workCategory] : []),
                                ])).filter(Boolean);
                                const volumeEntries = Object.entries(r.categoryVolumes || {}) as Array<[string, number]>;"""
new_category = """const categoryNames = getActiveRoomCategoryNames(r);
                                const volumeEntries = getActiveRoomVolumeEntries(r);"""
if old_category in text:
    text = text.replace(old_category, new_category, 1)

old_category2 = """const categoryNames = Array.from(new Set([
                  ...Object.keys(r.categoryVolumes || {}),
                  ...(r.subItems || []).map((sub) => sub.category || r.workCategory || '').filter(Boolean),
                  ...(r.workCategory ? [r.workCategory] : []),
                ])).filter(Boolean);
                const volumeEntries = Object.entries(r.categoryVolumes || {}) as Array<[string, number]>;"""
new_category2 = """const categoryNames = getActiveRoomCategoryNames(r);
                const volumeEntries = getActiveRoomVolumeEntries(r);"""
if old_category2 in text:
    text = text.replace(old_category2, new_category2, 1)

text = text.replace(
    "const hasSubs = Boolean(r.subItems && r.subItems.length > 0);\n                const categoryNames = getActiveRoomCategoryNames(r);",
    "const reportSubItems = getActiveRoomSubItems(r);\n                const hasSubs = reportSubItems.length > 0;\n                const categoryNames = getActiveRoomCategoryNames(r);",
    1,
)
text = text.replace("const subRows = hasSubs ? r.subItems!.map(sub => `", "const subRows = hasSubs ? reportSubItems.map(sub => `", 1)

pdf.write_text(text, encoding='utf-8')

x = excel.read_text(encoding='utf-8')
needle = """  // 3. Tien do can ho & defect
  if (mods.floorPlan) {
    if (params.roomProgressList && params.roomProgressList.length > 0) {
      const roomData = params.roomProgressList.map((r, idx) => {
        const fp = params.floorPlans?.find((f) => f.id === r.floorId);
        const subItemsSummary = (r.subItems && r.subItems.length > 0)
          ? r.subItems.map(s => `${s.name || (s as any).title || 'Hạng mục'}: ${s.status || s.inspectionStatus || 'Chưa làm'}`).join('; ')
          : '';"""
replacement = """  // 3. Tien do can ho & defect
  if (mods.floorPlan) {
    if (params.roomProgressList && params.roomProgressList.length > 0) {
      const activeWorkCategoryNames = new Set(
        (params.workVolumes || [])
          .filter((item) => !item.deletedAt)
          .map((item) => String(item.title || '').trim())
          .filter(Boolean)
      );
      const isActiveCategory = (name: unknown) => {
        const normalized = String(name || '').trim();
        if (!normalized) return false;
        return activeWorkCategoryNames.size === 0 || activeWorkCategoryNames.has(normalized);
      };
      const roomData = params.roomProgressList.map((r, idx) => {
        const fp = params.floorPlans?.find((f) => f.id === r.floorId);
        const activeSubItems = (r.subItems || []).filter((s) => isActiveCategory(s.category || r.workCategory || ''));
        const subItemsSummary = activeSubItems.length > 0
          ? activeSubItems.map(s => `${s.name || (s as any).title || 'Hạng mục'}: ${s.status || s.inspectionStatus || 'Chưa làm'}`).join('; ')
          : '';"""
if needle in x:
    x = x.replace(needle, replacement, 1)
elif 'const activeWorkCategoryNames = new Set(' not in x:
    raise SystemExit('Excel room export anchor not found')
excel.write_text(x, encoding='utf-8')

print('Applied active work-category report hygiene')
