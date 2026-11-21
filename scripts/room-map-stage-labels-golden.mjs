#!/usr/bin/env node
/** Read-only floor-plan room sub-item labels regression. No Firebase, R2, or writes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getRoomMapStageLabels, getRoomMapConstructionIcon, getRoomMapInspectionIcon } from '../src/utils/roomMapStageLabels.ts';

const fixture = {
  workCategory: 'Trần thạch cao',
  frameStatus: 'Đã hoàn thành',
  boardStatus: 'Đã hoàn thành',
  frameInspectionStatus: 'Đạt nghiệm thu',
  boardInspectionStatus: 'Đạt nghiệm thu',
  targetFrameDate: '2026-11-01',
  targetBoardDate: '2026-11-03',
  subItems: [
    { id: 's1', name: 'Ty ren M8', status: 'Đang làm', inspectionStatus: 'Chưa nghiệm thu', targetDate: '2026-11-25', category: 'Trần chìm' },
    { id: 's2', name: 'Lắp khung', status: 'Đã hoàn thành', inspectionStatus: 'Đạt nghiệm thu', targetDate: '2026-11-26', category: 'Trần chìm' },
    { id: 's3', name: 'Xử lý mối nối', status: 'Chưa làm', inspectionStatus: 'Chưa đạt (Cần sửa)', targetDate: '2026-11-27', category: 'Trần chìm' },
  ],
};
const before = JSON.stringify(fixture);
const mapped = getRoomMapStageLabels(fixture);
assert.deepEqual(mapped.map(x=>x.name), ['Ty ren M8', 'Lắp khung', 'Xử lý mối nối']);
assert.deepEqual(mapped.map(x=>x.status), ['Đang làm', 'Đã hoàn thành', 'Chưa làm']);
assert.deepEqual(mapped.map(x=>x.inspectionStatus), ['Chưa nghiệm thu','Đạt nghiệm thu','Chưa đạt (Cần sửa)']);
assert.deepEqual(mapped.map(x=>x.targetDate), ['2026-11-25','2026-11-26','2026-11-27']);
assert.equal(JSON.stringify(fixture), before, 'Reading map labels must never mutate persisted room state');
assert.deepEqual(getRoomMapStageLabels({...fixture,subItems:[]}).map(x=>x.name), ['Khung','Tấm']);
assert.deepEqual(getRoomMapStageLabels({...fixture,subItems:undefined}).map(x=>x.status), ['Đã hoàn thành','Đã hoàn thành']);
assert.deepEqual(getRoomMapStageLabels({...fixture,subItems:[{id:'one',name:'Trám khe',status:'Đang làm'}]}).map(x=>x.name),['Trám khe']);
assert.equal(getRoomMapStageLabels({...fixture,subItems:[{id:'one',name:'  ',status:'Chưa làm'}]})[0].name,'Hạng mục con 1');
const many=getRoomMapStageLabels({...fixture,subItems:Array.from({length:20},(_,i)=>({id:String(i),name:'Công đoạn '+i,status:'Chưa làm'}))});
assert.equal(many.length,20);
const duplicates=getRoomMapStageLabels({...fixture,subItems:[{id:'same',name:'A',status:'Chưa làm'},{id:'same',name:'B',status:'Đã hoàn thành'}]});
assert.equal(new Set(duplicates.map(x=>x.key)).size,2);
assert.equal(getRoomMapConstructionIcon('Đã hoàn thành'),'✅');
assert.equal(getRoomMapConstructionIcon('Đang làm'),'🚧');
assert.equal(getRoomMapConstructionIcon('Chưa làm'),'⏳');
assert.equal(getRoomMapInspectionIcon('Đạt nghiệm thu'),'🏆');
assert.equal(getRoomMapInspectionIcon('Chưa đạt (Cần sửa)'),'⚠️');
assert.equal(getRoomMapInspectionIcon('Chưa nghiệm thu'),'⏳');

const ui=readFileSync(new URL('../src/components/FloorPlanDefectTab.tsx',import.meta.url),'utf8');
const section=ui.slice(ui.indexOf('{/* MINIMALIST OR FULL TEXT BADGES OVERLAY */}'),ui.indexOf('{/* MODE 2: DEFECT PIN OVERLAYS */}'));
assert.ok(section.length>1000,'Room map section is present');
assert.match(section,/getRoomMapStageLabels\(room\)/);
assert.match(section,/data-hnl-room-map-stage-list="true"/);
assert.match(section,/data-hnl-room-map-stage-row="true"/);
assert.match(section,/data-hnl-room-map-stage-badges="true"/);
assert.equal((section.match(/roomMapStages\.map\(\(stage\) =>/g)||[]).length,2,'Both map modes must use saved stages');
assert.doesNotMatch(section,/room\.(frameStatus|boardStatus|frameInspectionStatus|boardInspectionStatus)/,'Map labels must not use legacy data when subItems exist');
console.log('Room sub-item map labels Golden: PASS – multi-stage TC/NT/date, legacy, keys, two map modes, immutable records');
