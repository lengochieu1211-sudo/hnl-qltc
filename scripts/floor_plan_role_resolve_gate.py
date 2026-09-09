from pathlib import Path

EXPECTED_BASE = 'b7534aba4db5b9749d4bcc0605e233dda086edc0'

app_path = Path('src/App.tsx')
app = app_path.read_text(encoding='utf-8')
start_marker = "// Floor-plan images use the same multi-device principle as Defect/Crew photos:"
end_marker = "// Hydrate cloud-backed floor-plan binaries on another phone/PC."
start = app.find(start_marker)
end = app.find(end_marker, start + 1)
assert start >= 0 and end > start, 'floor-plan upload effect block not found'
block = app[start:end]
old_guard = "if (!isHydrated || isLoadingProject || isRestoring || isInitializing || !cloudUserKey || !isOnline || projectRoleSource !== 'cloud' || !projectRoleAllowed || switchingProjectRef.current) return;"
new_guard = "// Upload scheduling is role-aware: re-run as soon as the cloud role resolves to ADMIN.\n    if (!isHydrated || isLoadingProject || isRestoring || isInitializing || !cloudUserKey || !isOnline || !isProjectRoleResolved || projectRoleSource !== 'cloud' || !projectRoleAllowed || currentUserRole !== 'ADMIN' || switchingProjectRef.current) return;"
assert block.count(old_guard) == 1, f'floor-plan upload guard anchor count={block.count(old_guard)}'
block = block.replace(old_guard, new_guard, 1)
old_deps = "}, [floorPlans, activeProjectId, cloudUserKey, isHydrated, isLoadingProject, isRestoring, isInitializing, floorPlanImageSyncRetryTick, isOnline, projectRoleSource, projectRoleAllowed]);"
new_deps = "}, [floorPlans, activeProjectId, cloudUserKey, isHydrated, isLoadingProject, isRestoring, isInitializing, floorPlanImageSyncRetryTick, isOnline, isProjectRoleResolved, currentUserRole, projectRoleSource, projectRoleAllowed]);"
assert block.count(old_deps) == 1, f'floor-plan dependency anchor count={block.count(old_deps)}'
block = block.replace(old_deps, new_deps, 1)
app = app[:start] + block + app[end:]
app_path.write_text(app, encoding='utf-8')

floor_path = Path('src/lib/floorPlanImageSync.ts')
floor = floor_path.read_text(encoding='utf-8')
old_predicate = "export function floorPlanNeedsCloudUpload(plan: FloorPlan): boolean {\n  if (getCurrentUserRole() !== 'ADMIN') return false;\n  if (!plan?.id || !isLocalFloorPlanBinaryUrl(plan.imageUrl)) return false;"
new_predicate = "export function floorPlanNeedsCloudUpload(plan: FloorPlan): boolean {\n  // Pure data predicate. Role gating belongs to the scheduler and the upload function;\n  // keeping it out of this helper prevents a pre-resolve VIEWER role from hiding pending work.\n  if (!plan?.id || !isLocalFloorPlanBinaryUrl(plan.imageUrl)) return false;"
assert floor.count(old_predicate) == 1, f'floorPlanNeedsCloudUpload anchor count={floor.count(old_predicate)}'
floor = floor.replace(old_predicate, new_predicate, 1)
assert floor.count("if (getCurrentUserRole() !== 'ADMIN') return null;") == 1, 'ADMIN defense-in-depth upload guard missing'
floor_path.write_text(floor, encoding='utf-8')

stability_path = Path('scripts/stability-gate.mjs')
stability = stability_path.read_text(encoding='utf-8')
anchor = "requireAll(floorPlanSync, ['uploadFloorPlanBinaryToCloud', 'BINARY_STORAGE_PROVIDER', 'storagePath:', 'thumbnailPath:'], 'floor-plan object-storage pipeline');"
insert = anchor + "\nconst floorPlanNeedsStart = floorPlanSync.indexOf('export function floorPlanNeedsCloudUpload');\nconst floorPlanNeedsEnd = floorPlanSync.indexOf('export async function syncFloorPlanImagesToCloud', floorPlanNeedsStart);\nif (floorPlanNeedsStart < 0 || floorPlanNeedsEnd <= floorPlanNeedsStart) fail('floorPlanNeedsCloudUpload source block missing');\nconst floorPlanNeedsBlock = floorPlanSync.slice(floorPlanNeedsStart, floorPlanNeedsEnd);\nif (floorPlanNeedsBlock.includes(\"getCurrentUserRole() !== 'ADMIN'\")) fail('floorPlanNeedsCloudUpload must remain a pure data predicate; role resolution belongs to the scheduler');\nrequireAll(floorPlanSync, [\"if (getCurrentUserRole() !== 'ADMIN') return null;\"], 'floor-plan upload ADMIN defense-in-depth');\nrequireAll(app, [\n  '// Upload scheduling is role-aware: re-run as soon as the cloud role resolves to ADMIN.',\n  \"currentUserRole !== 'ADMIN'\",\n  'isProjectRoleResolved, currentUserRole',\n], 'floor-plan pending upload restarts after cloud ADMIN role resolution');\npass('floor-plan pending image survives pre-resolve role and upload scheduler re-runs on ADMIN resolution');"
assert stability.count(anchor) == 1, f'stability floor-plan anchor count={stability.count(anchor)}'
stability = stability.replace(anchor, insert, 1)
stability_path.write_text(stability, encoding='utf-8')

print('Floor-plan role-resolution regression patch applied')
