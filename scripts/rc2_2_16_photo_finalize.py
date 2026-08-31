from pathlib import Path

photo = Path('src/lib/photoCloudSync.ts')
s = photo.read_text()
old = """  if (cloudData && cloudUpdatedAt >= localUpdatedAt && cloudDeleteStateMatches && cloudHasResolvedBinaryState && (photo.deleted || currentProviderBacked) && !currentProviderRepairMode) return;
  if (localIsStale && !binaryRepairMode) {
    throw new Error(`PHOTO_CONFLICT:${photo.id}: Cloud revision mới hơn; giữ Cloud và chờ realtime hòa giải.`);
  }
  if (cloudData && !cloudDeleteStateMatches && cloudUpdatedAt >= localUpdatedAt) {
    throw new Error(`PHOTO_CONFLICT:${photo.id}: trạng thái xóa trên Cloud mới hơn local.`);
  }

  const now = Date.now();
  const nextRevision = binaryRepairMode
    ? Math.max(cloudRevision + 1, localRevision + 1, 1)
    : Math.max(localRevision, 1);
"""
new = """  const reconcileCloudIntoLocal = async () => {
    if (!cloudData) return;
    const cloudPhoto = { id: photo.id, ...cloudData } as PhotoAttachment;
    await mergeCloudPhotoMetadata(projectId, [cloudPhoto], [cloudPhoto]);
  };

  if (cloudData && cloudUpdatedAt >= localUpdatedAt && cloudDeleteStateMatches && cloudHasResolvedBinaryState && (photo.deleted || currentProviderBacked) && !currentProviderRepairMode) {
    await reconcileCloudIntoLocal();
    return;
  }
  if (localIsStale && !binaryRepairMode) {
    await reconcileCloudIntoLocal();
    return;
  }
  if (cloudData && !cloudDeleteStateMatches && cloudUpdatedAt >= localUpdatedAt) {
    await reconcileCloudIntoLocal();
    return;
  }

  const now = Date.now();
  // Existing Firestore photo rows must advance revision. Older releases could
  // leave pending/legacy metadata at the same revision as the local outbox;
  // reusing it violates lifecycleUpdateIsMonotonic() and strands the binary.
  const nextRevision = cloudData
    ? Math.max(cloudRevision + 1, localRevision + 1, 1)
    : Math.max(localRevision, 1);
"""
assert s.count(old) == 1, f'photo conflict/revision anchor count={s.count(old)}'
s = s.replace(old, new, 1)
old = 'updatedAt: localUpdatedAt || now,'
assert s.count(old) == 1, f'photo delete updatedAt anchor count={s.count(old)}'
s = s.replace(old, 'updatedAt: Math.max(localUpdatedAt || 0, cloudData ? cloudUpdatedAt + 1 : 0, now),', 1)
old = """  const contentVersion = binaryRepairMode
    ? Math.max(cloudUpdatedAt + 1, now)
    : (localUpdatedAt || now);
"""
new = """  // updatedAt is lifecycle-controlled too. Always advance an existing
  // pending/legacy row when replacing it with verified R2 metadata.
  const contentVersion = Math.max(
    localUpdatedAt || 0,
    cloudData ? cloudUpdatedAt + 1 : 0,
    now,
  );
"""
assert s.count(old) == 1, f'photo contentVersion anchor count={s.count(old)}'
s = s.replace(old, new, 1)
photo.write_text(s)

floor = Path('src/lib/floorPlanImageSync.ts')
s = floor.read_text()
old = "import { compressImageToBlob } from '../utils/imageCompressor';\n"
assert s.count(old) == 1, f'floor import anchor count={s.count(old)}'
s = s.replace(old, old + "import { getCurrentUserRole } from '../utils/securityUtils';\n", 1)
old = """export async function syncFloorPlanImageToCloud(projectId: string, plan: FloorPlan): Promise<Partial<FloorPlan> | null> {
  if (!projectId || !plan?.id || !isLocalFloorPlanBinaryUrl(plan.imageUrl)) return null;
"""
new = """export async function syncFloorPlanImageToCloud(projectId: string, plan: FloorPlan): Promise<Partial<FloorPlan> | null> {
  if (!projectId || !plan?.id || !isLocalFloorPlanBinaryUrl(plan.imageUrl)) return null;
  // Floor-plan structure is ADMIN-owned. EDITOR may read hydrated images but
  // must not enter an upload/migration retry loop that Rules correctly deny.
  if (getCurrentUserRole() !== 'ADMIN') return null;
"""
assert s.count(old) == 1, f'floor sync role anchor count={s.count(old)}'
s = s.replace(old, new, 1)
old = """export function floorPlanNeedsCloudUpload(plan: FloorPlan): boolean {
  if (!plan?.id || !isLocalFloorPlanBinaryUrl(plan.imageUrl)) return false;
"""
new = """export function floorPlanNeedsCloudUpload(plan: FloorPlan): boolean {
  if (getCurrentUserRole() !== 'ADMIN') return false;
  if (!plan?.id || !isLocalFloorPlanBinaryUrl(plan.imageUrl)) return false;
"""
assert s.count(old) == 1, f'floor needs-upload anchor count={s.count(old)}'
s = s.replace(old, new, 1)
old = """    try {
      await syncFloorPlanImageToCloud(projectId, plan);
      uploaded++;
    } catch (err) {
"""
new = """    try {
      const result = await syncFloorPlanImageToCloud(projectId, plan);
      if (result) uploaded++;
      else skipped++;
    } catch (err) {
"""
assert s.count(old) == 1, f'floor count anchor count={s.count(old)}'
s = s.replace(old, new, 1)
floor.write_text(s)
print('RC2.2.16 photo finalization patch applied')
