from pathlib import Path


def replace_exact(path: str, old: str, new: str):
    p = Path(path)
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'missing expected source block in {path}: {old[:120]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

# 1) Material Need Engine: lifecycle-safe inputs + skip explicit stale/deleted category IDs.
engine = 'src/utils/materialNeedEngine.ts'
replace_exact(engine,
"const textKey = (value?: string) => String(value || '').trim().toLocaleLowerCase('vi-VN');\n",
"const textKey = (value?: string) => String(value || '').trim().toLocaleLowerCase('vi-VN');\nconst isActiveLifecycle = <T extends { deletedAt?: number | null }>(item: T): boolean => item.deletedAt === undefined || item.deletedAt === null;\n")
replace_exact(engine,
"    cats.forEach((cat) => {\n      const categoryRef = cat.id || cat.name;\n",
"    cats.forEach((cat) => {\n      // An explicit category ID that no longer exists in the active WorkVolume catalog is an orphan linkage.\n      // Do not turn a deleted category into a false MISSING_NORM warning; Health Center owns the orphan audit.\n      if (cat.id && !workVolumes.some((work) => work.id === cat.id)) return;\n      const categoryRef = cat.id || cat.name;\n")
replace_exact(engine,
"  const { rooms, materialNorms, inventory, workVolumes } = params;\n  const scope = params.scope || {};\n",
"  const { rooms: rawRooms, materialNorms: rawMaterialNorms, inventory: rawInventory, workVolumes: rawWorkVolumes } = params;\n  const rooms = rawRooms.filter(isActiveLifecycle);\n  const materialNorms = rawMaterialNorms.filter(isActiveLifecycle);\n  const inventory = rawInventory.filter(isActiveLifecycle);\n  const workVolumes = rawWorkVolumes.filter(isActiveLifecycle);\n  const scope = params.scope || {};\n")

# 2) Material Norm modal: hide deleted norms/work categories and never offer deleted categories for new links.
modal = 'src/components/MaterialNormModal.tsx'
replace_exact(modal,
"  const hasManageAccess = roleResolved && canManageMaterialNorms(userRole);\n  const hasImportAccess = roleResolved && canImportData(userRole);\n",
"  const hasManageAccess = roleResolved && canManageMaterialNorms(userRole);\n  const hasImportAccess = roleResolved && canImportData(userRole);\n  const activeMaterialNorms = React.useMemo(() => materialNorms.filter((norm) => norm.deletedAt === undefined || norm.deletedAt === null), [materialNorms]);\n  const activeWorkVolumes = React.useMemo(() => (workVolumes || []).filter((volume) => volume.deletedAt === undefined || volume.deletedAt === null), [workVolumes]);\n")
replace_exact(modal,
"    if (workVolumes && workVolumes.length > 0) {\n      workVolumes.forEach((v) => {\n",
"    if (activeWorkVolumes.length > 0) {\n      activeWorkVolumes.forEach((v) => {\n")
replace_exact(modal,
"    if (list.size === 0) {\n      WORK_CATEGORIES_LIST.forEach(cat => list.add(cat));\n    }\n    return Array.from(list);\n  }, [workVolumes]);\n",
"    // Keep the legacy starter list only when there is genuinely no catalog at all.\n    // If records exist but are all deleted, do not resurrect deleted category names in the selector.\n    if (list.size === 0 && (!workVolumes || workVolumes.length === 0)) {\n      WORK_CATEGORIES_LIST.forEach(cat => list.add(cat));\n    }\n    return Array.from(list);\n  }, [activeWorkVolumes, workVolumes]);\n")
replace_exact(modal,
"  const categoriesInUse = Array.from(new Set(materialNorms.map((n) => n.category).filter(Boolean)));\n\n  const filteredNorms = materialNorms.filter((norm) => {\n",
"  const categoriesInUse = Array.from(new Set(activeMaterialNorms.map((n) => n.category).filter(Boolean)));\n\n  const filteredNorms = activeMaterialNorms.filter((norm) => {\n")
# Only UI count, not raw import state.
replace_exact(modal, "Tất cả ({materialNorms.length})", "Tất cả ({activeMaterialNorms.length})")
# Targeted active work-volume usage in selector/calculation/edit/save paths.
for old, new in [
    ("(workVolumes || [])\n        .filter((v) => v.title === cat", "activeWorkVolumes\n        .filter((v) => v.title === cat"),
    ("(workVolumes || []).filter((v) => workCategories.includes(v.title))", "activeWorkVolumes.filter((v) => workCategories.includes(v.title))"),
    ("if (!workVolumes || workCategories.length === 0) return null;", "if (activeWorkVolumes.length === 0 || workCategories.length === 0) return null;"),
    ("const catVolume = workVolumes\n        .filter(v => v.title === cat)", "const catVolume = activeWorkVolumes\n        .filter(v => v.title === cat)"),
    ("}, [workVolumes, workCategories, workCategoryNorms, unitNormPerM2, hasMixedBasisUnits]);", "}, [activeWorkVolumes, workCategories, workCategoryNorms, unitNormPerM2, hasMixedBasisUnits]);"),
    ("if (norm.workCategoryIds && norm.workCategoryIds.length > 0 && workVolumes && workVolumes.length > 0) {", "if (norm.workCategoryIds && norm.workCategoryIds.length > 0 && activeWorkVolumes.length > 0) {"),
    ("const foundVol = workVolumes.find(v => v.id === id);", "const foundVol = activeWorkVolumes.find(v => v.id === id);"),
    ("const matched = workVolumes?.find(v => v.title === catName || v.id === catName);", "const matched = activeWorkVolumes.find(v => v.title === catName || v.id === catName);"),
    ("getResolvedNormWorkCategories(norm, workVolumes)", "getResolvedNormWorkCategories(norm, activeWorkVolumes)"),
]:
    p = Path(modal); s = p.read_text(encoding='utf-8')
    if old in s:
        p.write_text(s.replace(old, new), encoding='utf-8')

# 3) Health Center: report active norms that still point to deleted/missing work-category IDs.
hc = 'src/healthCenter/healthCenterEngine.ts'
replace_exact(hc,
"function lightweightBusinessQualityIssues(snapshot: HnlAiProjectSnapshot): HealthCenterIssue[] {\n  const issues: HealthCenterIssue[] = [];\n  active(snapshot.inventory).forEach((item) => {\n",
"function lightweightBusinessQualityIssues(snapshot: HnlAiProjectSnapshot): HealthCenterIssue[] {\n  const issues: HealthCenterIssue[] = [];\n  const activeWorkVolumeIds = new Set(active(snapshot.workVolumes).map((item) => item.id));\n  active(snapshot.inventory).forEach((item) => {\n")
replace_exact(hc,
"  active(snapshot.materialNorms).forEach((norm) => {\n    if (!String(norm.materialName || '').trim() || !String(norm.unit || '').trim()) {\n",
"  active(snapshot.materialNorms).forEach((norm) => {\n    const linkedWorkCategoryIds = Array.from(new Set([...(norm.workCategoryIds || []), ...(norm.workCategoryId ? [norm.workCategoryId] : [])].filter(Boolean)));\n    const orphanWorkCategoryIds = linkedWorkCategoryIds.filter((id) => !activeWorkVolumeIds.has(id));\n    if (orphanWorkCategoryIds.length > 0) {\n      issues.push(makeIssue({\n        ruleId: 'MATERIAL_NORM_ORPHAN_WORK_CATEGORY', severity: 'WARNING', module: 'materialNorms', entityType: 'materialNorm', entityId: norm.id,\n        message: `Định mức ${norm.materialName || norm.id} còn liên kết tới hạng mục đã xoá/không còn tồn tại.`, actionClass: 'NEEDS_CONFIRMATION', evidenceIds: [`material_norms:${norm.id}`], location: { workItem: norm.materialName },\n        details: { workCategoryId: norm.workCategoryId || null, workCategoryIds: norm.workCategoryIds || [], orphanWorkCategoryIds },\n      }));\n    }\n    if (!String(norm.materialName || '').trim() || !String(norm.unit || '').trim()) {\n")

# 4) Material golden: deleted lifecycle records must never participate; deleted category must not create false missing-norm warning.
golden = 'scripts/material-need-golden.ts'
p = Path(golden); s = p.read_text(encoding='utf-8')
marker = "const missingNorm = computeMaterialNeeds({ rooms: [multiTeamRoom], materialNorms: [], inventory: [], workVolumes, teams, scope: { floorId: 'floor-3' } });\n"
if marker not in s:
    raise SystemExit('missing material golden insertion marker')
block = """// Lifecycle regression: soft-deleted norms/categories are historical only and must not participate in live Material Need.\nconst deletedNormOnly = computeMaterialNeeds({\n  rooms: [multiTeamRoom], materialNorms: [{ ...norm, deletedAt: Date.now() } as MaterialNorm], inventory: [], workVolumes, teams,\n  scope: { floorId: 'floor-3' },\n});\nassert.equal(deletedNormOnly.lines.length, 0, 'Soft-deleted material norm must never generate live demand');\nassert.ok(deletedNormOnly.warnings.some((w) => w.code === 'MISSING_NORM'), 'Active category with only a deleted norm is genuinely missing an active norm');\n\nconst deletedWorkCategory = computeMaterialNeeds({\n  rooms: [multiTeamRoom], materialNorms: [norm], inventory: [], workVolumes: [{ ...workVolumes[0], deletedAt: Date.now() } as WorkVolume], teams,\n  scope: { floorId: 'floor-3' },\n});\nassert.equal(deletedWorkCategory.lines.length, 0, 'Room reference to a deleted explicit work-category ID must not generate demand');\nassert.equal(deletedWorkCategory.warnings.some((w) => w.code === 'MISSING_NORM'), false, 'Deleted/orphan category must not be misreported as a missing material norm');\n\n"""
p.write_text(s.replace(marker, block + marker, 1), encoding='utf-8')

print('material orphan lifecycle candidate applied')
