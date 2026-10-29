import assert from 'node:assert/strict';
import { getRoomHighlightBounds, resizeRoomHighlightSide, resizeRoomHighlightToBounds } from '../src/utils/roomHighlightGeometry.ts';
const base={id:'room-lock-safe',floorId:'f1',roomName:'A101',x:10,y:20,width:20,height:15,updatedAt:1,
  points:[{x:10,y:20},{x:30,y:20},{x:30,y:35},{x:10,y:35}],isPolyline:false,
  frameStatus:'Chưa làm',boardStatus:'Chưa làm',inspectionStatus:'Chưa nghiệm thu',positionLocked:false};
const a=resizeRoomHighlightSide(base,'e',{x:10,y:20,width:25,height:15});
assert.deepEqual(a.points,[{x:10,y:20},{x:35,y:20},{x:35,y:35},{x:10,y:35}]);
assert.equal(a.id,base.id);assert.equal(a.positionLocked,false);
const b=resizeRoomHighlightSide(base,'n',{x:10,y:15,width:20,height:20});
assert.deepEqual(b.points,[{x:10,y:15},{x:30,y:15},{x:30,y:35},{x:10,y:35}]);
const polygon={...base,x:10,y:10,width:30,height:30,points:[{x:10,y:10},{x:40,y:12},{x:35,y:30},{x:15,y:40},{x:12,y:25}]};
const c=resizeRoomHighlightSide(polygon,'e',{x:10,y:10,width:34,height:30});
assert.deepEqual(c.points,[{x:10,y:10},{x:44,y:12},{x:35,y:30},{x:15,y:40},{x:12,y:25}], 'Side resize must not stretch any other polygon vertex');
const scaled=resizeRoomHighlightToBounds(base,{x:5,y:5,width:30,height:50});
assert.deepEqual(getRoomHighlightBounds(scaled),{x:5,y:5,width:30,height:50,cx:20,cy:30});
assert.deepEqual(base.points,[{x:10,y:20},{x:30,y:20},{x:30,y:35},{x:10,y:35}], 'Original room must not be mutated');
console.log('DEV BACKUP GEOMETRY SIDE VS CORNER GOLDEN PASS');
