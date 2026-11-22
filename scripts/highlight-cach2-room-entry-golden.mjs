import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (name) => fs.readFileSync(name, 'utf8');
const modal = read('src/components/RoomHighlightModal.tsx');
const tab = read('src/components/FloorPlanDefectTab.tsx');
const draw = read('src/components/FloorHighlightDirectDraw.tsx');
const calibration = read('src/components/FloorMetricCalibration.tsx');
// Existing Cách 1 is preserved for history, but must not render in the room editor.
assert.match(modal, /const legacyHighlightEditorVisible = false;/);
assert.match(modal, /\{legacyHighlightEditorVisible && !structureReadOnly && roomItem\?\.id && \(/);
assert.doesNotMatch(modal, /data-hnl-cach2-room-portal="true"/);
assert.match(modal, /onStartDrawOnMap\?: \(room: RoomProgressItem, category: string, target: string\) => void/);
assert.match(modal, /onStartDrawOnMap\(roomItem, category, target\)/);
const mapLaunch = modal.slice(modal.indexOf('const launchCach2 ='), modal.indexOf('const activeDefaultInspector'));
assert.doesNotMatch(mapLaunch, /onClose\(\)/, 'Do not navigate away from map on draw');
assert.doesNotMatch(mapLaunch, /roomDraftDirtyRef\.current = false/, 'Failed launch must preserve unsaved-draft warning');
assert.match(modal, /data-hnl-highlight-draw-block-reason="true"/, 'A locked or accepted room needs visible explanation');
assert.match(tab, /setDrawTool\('none'\);[\s\S]*setCach2DrawLaunch\(\{roomId:liveRoom.id/, 'Release prior room drawing tool before launch');
assert.match(tab, /resolveDirectHighlightLaunchCategory\(liveRoom, category, target, workVolumes\)/, 'Category key must be validated');
assert.match(tab, /if \(sourceFloor.id !== selectedFloorId\) setSelectedFloorId\(sourceFloor.id\)/, 'Cross-floor launch selects its real floor');
assert.doesNotMatch(modal, /Vẽ riêng hạng mục con/);
assert.match(modal, /launchCach2\(catName, item\.id\)/);
assert.match(modal, /data-hnl-main-quantity-map=\{catName\}/);
assert.doesNotMatch(modal, /data-hnl-ui-only="true" data-hnl-open-cach2-main=\{cat\}/);
assert.match(draw, /room\.isPolyline \|\| room\.width <= 0 \|\| room\.height <= 0/);
assert.match(modal, /roomDraftDirtyRef\.current && !window\.confirm\(/);
assert.match(modal, /highlightVolumeMode: 'manual'/);
// The map editor can open on the selected stage, never silently save a volume.
assert.match(tab, /onStartDrawOnMap=\{\(room, category, target\) => \{/);
assert.match(tab, /setCach2DrawLaunch\(\{roomId:liveRoom\.id,category:resolvedCategory,target,token:Date\.now\(\)\}\)/);
assert.match(tab, /launch=\{cach2DrawLaunch\}/);
assert.match(draw, /launch\?: \{ roomId: string; category: string; target: string; token: number \} \| null/);
assert.match(draw, /setTarget\(chosenTarget\)/);
assert.match(draw, /baselineRef\.current = \{ revision: room\.revision, updatedAt: room\.updatedAt \}/);
assert.match(draw, /KL tự tính:.*\(xem trước\)/);
// Calibration is in drawing toolbar, 2-point overlay still unchanged.
assert.match(tab, /data-hnl-cach2-calibrate-toolbar="true"/);
assert.match(tab, /📏<\/span><span>Đo tỷ lệ<\/span>/);
assert.match(draw, /onClick=\{\(\) => void confirmMeasuredQuantity\('area'\)\}/);
assert.match(tab, /launch=\{metricCalibrationLaunch\}/);
assert.match(calibration, /launch\?\.floorId === floor\.id/);
assert.match(calibration, /onPointerDown=\{clickPoint\}/);
assert.match(calibration, /onSave\(floor\.id,draft\)/);
// No new Firestore/production mutation code.
assert.doesNotMatch(draw+calibration, /updateDoc\(|writeBatch\(|runTransaction\(|getFirestore\(/);
assert.match(tab, /onStartCountOnMap=\{\(room, stageId\)/);
console.log('PASS CÁCH 2 ROOM ENTRY: form→floor target, calibration toolbar, hidden old editor, historical data and count flow retained');
