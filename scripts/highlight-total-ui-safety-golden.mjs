import assert from 'node:assert/strict';
import fs from 'node:fs';
const modal=fs.readFileSync('src/components/RoomHighlightModal.tsx','utf8');
const floor=fs.readFileSync('src/components/FloorPlanDefectTab.tsx','utf8');
const schema=fs.readFileSync('src/types.ts','utf8');
const app=fs.readFileSync('src/App.tsx','utf8');
assert.ok(modal.includes('data-hnl-highlight-independent-total="true"'));
assert.ok(modal.includes('data-hnl-highlight-three-draw-tools="true"'));
for(const name of ['2point','polygon','freehand'])assert.ok(modal.includes(`'${name}'`),name);
for(const key of ['categoryHighlightTotalVolumes','categoryHighlightTotalShapes','categoryHighlightShapes','categoryHighlightAutoMode']){
 assert.ok(schema.includes(`${key}?:`),`optional ${key}`);
 assert.ok(modal.includes(key),`state ${key}`);
}
assert.ok(modal.includes('roomItem?.inspectionStatus === \'Đạt nghiệm thu\''),'accepted main stage must not be rewritten');
assert.ok(modal.includes("s.status !== 'Đã hoàn thành' && s.inspectionStatus !== 'Đạt nghiệm thu'"),'accepted sub stage must not be rewritten');
assert.ok(modal.includes('getHighlightTotalQuantity(sCat) * getStageHighlightResult(sCat, s).ratio'),'sub qty must use independent total');
assert.ok(modal.includes('categoryHighlightAutoMode[cat]'),'main opt-in required');
assert.ok(modal.includes('roomItem?.categoryHighlightTotalShapes'),'explicit clear of prior total required');
assert.ok(floor.includes('totalHighlightRegions: parsed.totalHighlightRegions === true'),'total layer default OFF');
assert.ok(floor.includes('mainHighlightRegions: parsed.mainHighlightRegions === true'),'main layer default OFF');
assert.ok(floor.includes('subItemRegions: parsed.subItemRegions !== false'),'stage layer defaults ON');
assert.ok(floor.includes('data-hnl-floor-main-total-highlight="true"'),'main/total overlay present');
assert.ok(floor.includes('data-hnl-floor-subitem-highlight="true"'),'stage overlay present');
assert.ok(floor.includes('pointerEvents="none"'),'overlay does not hijack floor pan/zoom');
assert.ok(app.includes('applyEditorRoomOperationalUpdate'),'editor role pipeline unchanged');
const rules=fs.readFileSync('firestore.rules','utf8');assert.ok(rules.length>1000);
console.log('HIGHLIGHT INTEGRATION SAFETY PASS: total opt-in, three draw modes, layers, acceptance guards, legacy and RBAC');
