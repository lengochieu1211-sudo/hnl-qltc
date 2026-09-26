import assert from 'node:assert/strict';
import { detectRoomsFromDxf } from '../src/utils/dxfRoomDetection';

const dxf = [
  '0','SECTION','2','HEADER','9','$INSUNITS','70','4','0','ENDSEC',
  '0','SECTION','2','ENTITIES',
  '0','HATCH','8','ROOMS','91','1','92','2','72','0','73','1','93','4',
  '10','0','20','0','10','4000','20','0','10','4000','20','3000','10','0','20','3000',
  '0','TEXT','8','ROOM_TEXT','10','2000','20','1500','1','A101',
  '0','ENDSEC','0','EOF'
].join('\n');

const result = detectRoomsFromDxf(dxf);
assert.equal(result.unitCode, 4);
assert.equal(result.unitLabel, 'mm');
assert.equal(result.candidates.length, 1);
assert.equal(result.candidates[0].roomName, 'A101');
assert.equal(result.candidates[0].source, 'HATCH');
assert.equal(result.candidates[0].areaM2, 12);
assert.equal(result.candidates[0].points.length, 4);
assert.ok(result.candidates[0].width > 99.9);
assert.ok(result.candidates[0].height > 99.9);

console.log('DXF Room Detection Golden: PASS');
