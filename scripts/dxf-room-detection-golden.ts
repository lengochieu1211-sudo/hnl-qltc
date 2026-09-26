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

const complexDxf = [
  '0','SECTION','2','HEADER','9','$INSUNITS','70','4','9','$EXTMIN','10','0','20','0','9','$EXTMAX','10','10000','20','3000','0','ENDSEC',
  '0','SECTION','2','ENTITIES',
  '0','HATCH','8','ROOMS','91','3',
  '92','2','72','0','73','1','93','4','10','0','20','0','10','4000','20','0','10','4000','20','3000','10','0','20','3000',
  '92','2','72','0','73','1','93','4','10','500','20','500','10','1000','20','500','10','1000','20','1000','10','500','20','1000',
  '92','2','72','0','73','1','93','4','10','5000','20','0','10','9000','20','0','10','9000','20','3000','10','5000','20','3000',
  '0','TEXT','8','ROOM_TEXT','10','0','20','0','72','1','73','2','11','2500','21','1500','1','A101',
  '0','TEXT','8','ROOM_TEXT','10','2000','20','1500','1','12.0 m²',
  '0','MTEXT','8','ROOM_TEXT','10','7000','20','1500','1','{\\C1;B202}',
  '0','ENDSEC','0','EOF'
].join('\n');

const complexResult = detectRoomsFromDxf(complexDxf);
assert.equal(complexResult.candidates.length, 2, 'one HATCH with two outer loops must produce two room candidates');
const roomA = complexResult.candidates.find((candidate) => candidate.roomName === 'A101');
const roomB = complexResult.candidates.find((candidate) => candidate.roomName === 'B202');
assert.ok(roomA, 'center-justified TEXT must use DXF alignment point 11/21');
assert.ok(roomB, 'formatted MTEXT must be cleaned and detected');
assert.equal(roomA?.textType, 'TEXT');
assert.equal(roomB?.textType, 'MTEXT');
assert.equal(roomA?.areaM2, 11, 'nested HATCH island must be subtracted from room area');
assert.equal(roomB?.areaM2, 12);
assert.ok(complexResult.warnings.some((warning) => /island\/hole/i.test(warning)), 'nested HATCH loops must surface a review warning');

console.log('DXF Room Detection Golden: PASS');
