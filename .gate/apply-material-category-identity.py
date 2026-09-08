from pathlib import Path


def replace_exact(path: str, old: str, new: str):
    p = Path(path)
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'missing expected source block in {path}: {old[:120]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

engine = 'src/utils/materialNeedEngine.ts'
replace_exact(engine,
"  return workVolumes.find((item) => item.id === categoryIdOrName || textKey(item.title) === key);",
"  return workVolumes.find((item) => item.id === categoryIdOrName || item.workCategoryId === categoryIdOrName || textKey(item.title) === key);")
replace_exact(engine,
"  if (work && volumes[work.id] !== undefined) return Number(volumes[work.id]) || 0;\n  if (work && volumes[work.title] !== undefined) return Number(volumes[work.title]) || 0;",
"  if (work?.workCategoryId && volumes[work.workCategoryId] !== undefined) return Number(volumes[work.workCategoryId]) || 0;\n  if (work && volumes[work.id] !== undefined) return Number(volumes[work.id]) || 0;\n  if (work && volumes[work.title] !== undefined) return Number(volumes[work.title]) || 0;")
replace_exact(engine,
"  return normalizeUnit(units[categoryIdOrName] || (work ? units[work.id] || units[work.title] : '') || work?.unit || room.volumeUnit || 'm²') || 'm²';",
"  return normalizeUnit(units[categoryIdOrName] || (work ? (work.workCategoryId ? units[work.workCategoryId] : '') || units[work.id] || units[work.title] : '') || work?.unit || room.volumeUnit || 'm²') || 'm²';")
replace_exact(engine,
"    const id = work?.id || (raw === room.workCategoryId ? raw : undefined);",
"    const id = work?.workCategoryId || work?.id || (raw === room.workCategoryId ? raw : undefined);")
replace_exact(engine,
"    out.set(work?.id || room.workCategoryId || textKey(room.workCategory), {\n      id: work?.id || room.workCategoryId,",
"    const canonicalId = work?.workCategoryId || room.workCategoryId || work?.id;\n    out.set(canonicalId || textKey(room.workCategory), {\n      id: canonicalId,")
replace_exact(engine,
"      out.set(work?.id || sub.workCategoryId || textKey(sub.category), {\n        id: work?.id || sub.workCategoryId,",
"      const canonicalId = work?.workCategoryId || sub.workCategoryId || work?.id;\n      out.set(canonicalId || textKey(sub.category), {\n        id: canonicalId,")
replace_exact(engine,
"      if (cat.id && !workVolumes.some((work) => work.id === cat.id)) return;",
"      if (cat.id && !workVolumes.some((work) => work.id === cat.id || work.workCategoryId === cat.id)) return;")

# Health Center must use both catalog record IDs and canonical category IDs.
hc = 'src/healthCenter/healthCenterEngine.ts'
replace_exact(hc,
"  const activeWorkVolumeIds = new Set(active(snapshot.workVolumes).map((item) => item.id));",
"  const activeWorkVolumeIds = new Set(active(snapshot.workVolumes).flatMap((item) => [item.id, item.workCategoryId].filter(Boolean) as string[]));")

# Material Norm editor should resolve existing canonical category IDs and save canonical ID first.
modal = 'src/components/MaterialNormModal.tsx'
replace_exact(modal,
"        const foundVol = activeWorkVolumes.find(v => v.id === id);",
"        const foundVol = activeWorkVolumes.find(v => v.id === id || v.workCategoryId === id);")
replace_exact(modal,
"      const matched = activeWorkVolumes.find(v => v.title === catName || v.id === catName);\n      if (matched && matched.id) {\n        if (!selectedWorkCategoryIds.includes(matched.id)) {\n          selectedWorkCategoryIds.push(matched.id);\n        }\n        if (workCategoryNorms[catName] !== undefined) {\n          normCategoryNormsById[matched.id] = workCategoryNorms[catName];\n        }\n",
"      const matched = activeWorkVolumes.find(v => v.title === catName || v.id === catName || v.workCategoryId === catName);\n      const canonicalCategoryId = matched?.workCategoryId || matched?.id;\n      if (matched && canonicalCategoryId) {\n        if (!selectedWorkCategoryIds.includes(canonicalCategoryId)) {\n          selectedWorkCategoryIds.push(canonicalCategoryId);\n        }\n        if (workCategoryNorms[catName] !== undefined) {\n          normCategoryNormsById[canonicalCategoryId] = workCategoryNorms[catName];\n        }\n")

# Extend material golden with distinct record-id vs workCategoryId identity case.
golden = 'scripts/material-need-golden.ts'
p = Path(golden); s = p.read_text(encoding='utf-8')
marker = "const deletedNormOnly = computeMaterialNeeds({\n"
if marker not in s:
    raise SystemExit('missing lifecycle golden marker')
block = """const canonicalIdentityWork: WorkVolume = { ...workVolumes[0], id: 'wv-record-1', workCategoryId: 'wc-ceiling' } as WorkVolume;\nconst canonicalIdentityResult = computeMaterialNeeds({\n  rooms: [multiTeamRoom], materialNorms: [norm], inventory: [], workVolumes: [canonicalIdentityWork], teams,\n  scope: { floorId: 'floor-3', teamId: 'team-a' },\n});\nassert.equal(canonicalIdentityResult.lines[0]?.estimatedQty, 17.5, 'Material engine must resolve canonical workCategoryId even when WorkVolume record id differs');\n\n"""
p.write_text(s.replace(marker, block + marker, 1), encoding='utf-8')
print('material category identity candidate applied')
