from pathlib import Path

path = Path('scripts/dev-live-backend-golden.mjs')
text = path.read_text(encoding='utf-8')

old_decl = "let r2ObjectKey = '';\n"
new_decl = "let r2ObjectKey = '';\nlet floorPlanR2ObjectKey = '';\n"
if old_decl not in text:
    raise SystemExit('r2ObjectKey declaration anchor not found')
text = text.replace(old_decl, new_decl, 1)

anchor = """  await requireStatus('EDITOR cannot upload floor-plan structure to DEV R2', await fetch(`${r2Url}/v1/object?key=${encodeURIComponent(`projects/${pid}/floor-plans/editor-denied.txt`)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${editorIdToken}`, Origin: hostingUrl, 'Content-Type': 'text/plain' },
    body: Buffer.from('deny-floor'),
  }), 403);

"""
if anchor not in text:
    raise SystemExit('floor-plan R2 deny anchor not found')

block = r"""  // P0 regression: prove the real floor-plan cloud path works end-to-end on live DEV.
  // This is intentionally separate from generic defect/media coverage because floor plans
  // use the privileged /floor-plans namespace and Firestore cloud-revision metadata.
  floorPlanR2ObjectKey = `projects/${pid}/floor-plans/${floorId}/original.png`;
  const floorPlanEndpoint = `${r2Url}/v1/object?key=${encodeURIComponent(floorPlanR2ObjectKey)}`;
  const floorPlanPayload = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(`HNL-QLTC-DEV-FLOORPLAN-${nonce}`, 'utf8'),
  ]);
  const floorPlanMetadata = encodeURIComponent(JSON.stringify({
    projectId: pid,
    entityType: 'floorPlan',
    entityId: floorId,
    assetId: floorId,
    createdByUid: adminUid,
    golden: 'true',
  }));

  const floorPlanUploadResponse = await requireStatus('ADMIN uploads floor-plan image to DEV R2', await fetch(floorPlanEndpoint, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminIdToken}`,
      Origin: hostingUrl,
      'Content-Type': 'image/png',
      'X-HNL-Metadata': floorPlanMetadata,
    },
    body: floorPlanPayload,
  }), 200);
  const floorPlanUploadResult = await floorPlanUploadResponse.json();
  if (Number(floorPlanUploadResult?.size || 0) !== floorPlanPayload.length) {
    throw new Error(`Floor-plan R2 upload size mismatch: ${floorPlanUploadResult?.size} != ${floorPlanPayload.length}`);
  }
  const floorPlanUploadSha = String(floorPlanUploadResult?.sha256 || '').trim().toLowerCase();
  if (!floorPlanUploadSha) throw new Error('Floor-plan R2 upload missing sha256');
  pass('floor-plan R2 upload returns exact byte size + SHA256', `${floorPlanPayload.length} bytes`);

  const viewerFloorPlanHead = await requireStatus('VIEWER HEADs ADMIN floor-plan image cross-account', await fetch(floorPlanEndpoint, {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${viewerIdToken}`, Origin: hostingUrl },
  }), 200);
  if (Number(viewerFloorPlanHead.headers.get('content-length') || 0) !== floorPlanPayload.length) {
    throw new Error('Floor-plan R2 HEAD content-length mismatch');
  }
  const viewerFloorPlanSha = String(viewerFloorPlanHead.headers.get('x-hnl-sha256') || '').trim().toLowerCase();
  if (!viewerFloorPlanSha || viewerFloorPlanSha !== floorPlanUploadSha) {
    throw new Error(`Floor-plan R2 HEAD SHA256 mismatch: ${viewerFloorPlanSha || 'missing'} != ${floorPlanUploadSha}`);
  }
  pass('floor-plan R2 durability visible cross-account', viewerFloorPlanSha);

  const floorPlanRefAdmin = doc(admin.db, 'projects', pid, 'floor_plans', floorId);
  const floorPlanRefEditor = doc(editor.db, 'projects', pid, 'floor_plans', floorId);
  const floorPlanRefViewer = doc(viewer.db, 'projects', pid, 'floor_plans', floorId);
  const viewerSeesFloorPlanCloud = waitForSnapshot(
    floorPlanRefViewer,
    data => data.storageProvider === 'r2'
      && data.storagePath === floorPlanR2ObjectKey
      && Number(data.imageRevision || 0) === 2
      && Number(data.imageCloudRevision || 0) === 2,
    'VIEWER realtime floor-plan cloud metadata',
  );

  await updateDoc(floorPlanRefAdmin, {
    imageUrl: `cloud-floorplan:r2:${floorPlanR2ObjectKey}`,
    cloudFileId: `r2:${floorPlanR2ObjectKey}`,
    storageProvider: 'r2',
    storagePath: floorPlanR2ObjectKey,
    thumbnailPath: '',
    storageMd5Hash: floorPlanUploadSha,
    imageMimeType: 'image/png',
    imageFileSize: floorPlanPayload.length,
    imageRevision: 2,
    imageCloudRevision: 2,
    imageCloudSyncedAt: now + 10,
    revision: 2,
    updatedByUid: adminUid,
    updatedAt: now + 10,
    deletedAt: null,
  });
  pass('ADMIN publishes durable floor-plan cloud metadata to Firestore');

  const viewerFloorPlan = await viewerSeesFloorPlanCloud;
  if (viewerFloorPlan.cloudFileId !== `r2:${floorPlanR2ObjectKey}` || Number(viewerFloorPlan.imageFileSize || 0) !== floorPlanPayload.length) {
    throw new Error('VIEWER floor-plan cloud metadata mismatch');
  }
  pass('VIEWER receives floor-plan R2 metadata realtime with matching revision');

  await expectDenied('EDITOR cannot publish floor-plan cloud metadata', () => updateDoc(floorPlanRefEditor, {
    imageCloudRevision: 3,
    storagePath: floorPlanR2ObjectKey,
    revision: 3,
    updatedAt: now + 11,
  }));

  const viewerFloorPlanGet = await requireStatus('VIEWER downloads floor-plan image cross-account', await fetch(floorPlanEndpoint, {
    headers: { Authorization: `Bearer ${viewerIdToken}`, Origin: hostingUrl },
  }), 200);
  const viewerFloorPlanBytes = Buffer.from(await viewerFloorPlanGet.arrayBuffer());
  if (!viewerFloorPlanBytes.equals(floorPlanPayload)) throw new Error('Cross-account floor-plan R2 byte parity mismatch');
  pass('cross-account floor-plan R2 binary byte parity');

  await requireStatus('ADMIN purges DEV R2 golden floor-plan image', await fetch(floorPlanEndpoint, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminIdToken}`, Origin: hostingUrl },
  }), 200);
  floorPlanR2ObjectKey = '';

"""
text = text.replace(anchor, anchor + block, 1)

cleanup_anchor = """} finally {
  if (r2ObjectKey && admin?.auth?.currentUser) {
"""
cleanup_replacement = r"""} finally {
  if (floorPlanR2ObjectKey && admin?.auth?.currentUser) {
    try {
      const token = await admin.auth.currentUser.getIdToken(true);
      await fetch(`${r2Url}/v1/object?key=${encodeURIComponent(floorPlanR2ObjectKey)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, Origin: hostingUrl },
      });
      report.cleanup.push({ floorPlanR2ObjectKey, status: 'DELETE_ATTEMPTED' });
    } catch {}
  }

  if (r2ObjectKey && admin?.auth?.currentUser) {
"""
if cleanup_anchor not in text:
    raise SystemExit('R2 cleanup anchor not found')
text = text.replace(cleanup_anchor, cleanup_replacement, 1)

path.write_text(text, encoding='utf-8')
print('Applied live floor-plan runtime golden regression patch')
