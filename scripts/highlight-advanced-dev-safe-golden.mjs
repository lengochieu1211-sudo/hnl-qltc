import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getDirectHighlightEffectiveUnit, canApplyDirectHighlightQuantity} from '../src/utils/floorHighlightDirectShapes.ts';
const read = p => readFileSync(p,'utf8');
const room = {id:'room-1',roomName:'P101',floorId:'floor-1',x:2,y:2,width:50,height:45,
  updatedAt:100,revision:5,workCategory:'Ceiling',categoryVolumes:{Ceiling:120,Other:9},
  categoryVolumeUnits:{Ceiling:'m'},subItems:[
  {id:'stage-inherit',name:'Khung',category:'Ceiling',volumeUnit:'',status:'Đang làm'},
  {id:'stage-area',name:'Tấm',category:'Ceiling',volumeUnit:'m²',status:'Đang làm'},
  {id:'stage-count',name:'Số bộ',category:'Ceiling',volumeUnit:'Cái',status:'Đang làm'},
  {id:'stage-accepted',name:'Nghiệm thu',category:'Ceiling',volumeUnit:'m²',status:'Đã hoàn thành',inspectionStatus:'Đạt nghiệm thu'},
  ]};
const request=(target,unit) => ({roomId:room.id,expectedUpdatedAt:room.updatedAt,expectedRevision:room.revision,
  category:'Ceiling',target,floorId:room.floorId,expectedFloorSourceKey:'test-source',expectedCalibrationUpdatedAt:123,
  measuredQuantity:{value:12,unit}});
assert.equal(getDirectHighlightEffectiveUnit(room,'Ceiling','stage-inherit'),'m');
assert.equal(getDirectHighlightEffectiveUnit(room,'Ceiling','stage-area'),'m²');
assert.equal(getDirectHighlightEffectiveUnit(room,'Ceiling','stage-count'),'Cái');
assert.equal(canApplyDirectHighlightQuantity(room,request('stage-inherit','m²')),false);
assert.equal(canApplyDirectHighlightQuantity(room,request('stage-inherit','m')),true);
const mdRoom={...room,categoryVolumeUnits:{Ceiling:'md'}};
assert.equal(canApplyDirectHighlightQuantity(mdRoom,request('stage-inherit','m')),true);
assert.equal(canApplyDirectHighlightQuantity(mdRoom,request('stage-inherit','m²')),false);
assert.equal(canApplyDirectHighlightQuantity(mdRoom,{...request('stage-inherit','m'),shapes:[{x:0,y:0,width:10,height:10}]}),false);
assert.equal(canApplyDirectHighlightQuantity(room,request('stage-area','m²')),true);
assert.equal(canApplyDirectHighlightQuantity(room,request('stage-count','m²')),false);
assert.equal(canApplyDirectHighlightQuantity(room,request('stage-accepted','m²')),false);
assert.equal(canApplyDirectHighlightQuantity({...room,revision:6},request('stage-area','m²')),false);
const noUnit={...room,workCategory:'Other',categoryVolumeUnits:{}};
assert.equal(getDirectHighlightEffectiveUnit(noUnit,'Ceiling','stage-inherit'),'');
assert.equal(canApplyDirectHighlightQuantity(noUnit,request('stage-inherit','m²')),false);
const ui=read('src/components/FloorHighlightDirectDraw.tsx');
assert.match(ui,/getDirectHighlightEffectiveUnit\(room, currentCategory, currentTarget\)/);
assert.match(ui,/data-hnl-highlight-unit-unknown="true"/);
assert.match(ui,/data-hnl-highlight-inherited-region="true"/);
assert.match(ui,/if \(\(draft\.length \|\| corners\.length \|\| freehand\.length \|\| measurePath\.length\) &&\s*!window\.confirm\('Đổi chế độ thay vùng/);
assert.match(ui,/!window\.confirm\('Xóa toàn bộ vùng nháp chưa lưu\?'\)/);
assert.match(ui,/showAllCategoryMeasures, setShowAllCategoryMeasures\] = useState\(false\)/);
const modal=read('src/components/RoomHighlightModal.tsx');
assert.match(modal,/<select data-hnl-ui-only="true" aria-label=\{`Chọn hạng mục con đã có/);
assert.match(modal,/<button type="button" data-hnl-ui-only="true" onClick=\{\(\) => \{\s*const target = mapPickerTarget/);
assert.match(modal,/handleUpdateSubItem\(selected\.id, \{name:nextName\}\)/);
const floor=read('src/components/FloorPlanDefectTab.tsx');
assert.match(floor,/data-hnl-map-measure-display-row="true"/);
assert.match(floor,/grid-cols-2/);
assert.match(floor,/data-hnl-map-calibration-inline="anchored-popover"/);
assert.match(floor,/data-hnl-map-calibration-start="true"/);
assert.match(floor,/data-hnl-cach2-calibrate-toolbar="true"/);
const css=read('src/index.css');
assert.match(css,/\[data-hnl-map-measure-display-row="true"\] \[data-hnl-map-display-popover="true"\]/);
assert.match(css,/position: absolute !important/);
assert.match(css,/\[data-hnl-map-measure-display-row="true"\] \[data-hnl-map-calibration-popover="true"\]/);
console.log('HIGHLIGHT ADVANCED DEV SAFE GOLDEN PASS: inherited units and rejects, locked stages, CAS, draft guard, UI-only navigation, mobile paired popovers');
