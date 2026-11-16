import assert from 'node:assert/strict';
import { detectRoomsFromDxf, renderDxfFloorPlanSvgDataUrl, analyzeDxfQuantities, exportDxfQuantitiesCsv } from '../src/utils/dxfRoomDetection';
import { buildCadLayerComparison, supportedCadMetrics, exportCadLayerComparisonCsv } from '../src/utils/cadLayerMapping';

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
assert.equal(roomA?.areaM2, 11.75, 'nested HATCH island must be subtracted from room area');
assert.equal(roomB?.areaM2, 12);
assert.ok(complexResult.warnings.some((warning) => /island\/hole/i.test(warning)), 'nested HATCH loops must surface a review warning');
const nestedTakeoff = analyzeDxfQuantities(complexDxf);
assert.equal(nestedTakeoff.layers.find((layer) => layer.layer === 'ROOMS')?.areaM2, 23.75, 'nested HATCH area sums outer regions minus holes');
assert.equal(nestedTakeoff.layers.find((layer) => layer.layer === 'ROOMS')?.perimeterM, 30, 'HATCH perimeter includes boundary of inner hole');


const rendered = renderDxfFloorPlanSvgDataUrl(complexDxf);
assert.match(rendered.dataUrl, /^data:image\/svg\+xml/, 'DXF renderer must produce a persistent SVG data URL');
assert.ok(rendered.renderedEntities >= 2, 'DXF renderer must materialize CAD geometry/text for floor-plan background');
assert.equal(rendered.extents.minX, 0);
assert.equal(rendered.extents.maxX, 10000);
assert.ok(rendered.layers.includes('ROOM_TEXT'));

console.log('DXF Room Detection Golden: PASS');

// CAD quantity survey is read-only and MUST NOT double-count a matching
// HATCH and closed LWPOLYLINE on the same layer.
const quantityDxf = [
  '0','SECTION','2','HEADER','9','$INSUNITS','70','4','0','ENDSEC',
  '0','SECTION','2','ENTITIES',
  '0','HATCH','8','TRAN_CHIM','91','1','92','2','72','0','73','1','93','4',
  '10','0','20','0','10','4000','20','0','10','4000','20','3000','10','0','20','3000',
  '0','LWPOLYLINE','8','TRAN_CHIM','90','4','70','1',
  '10','0','20','0','10','4000','20','0','10','4000','20','3000','10','0','20','3000',
  '0','LINE','8','NEP_BIEN','10','0','20','0','11','3000','21','0',
  '0','LINE','8','NEP_BIEN','10','3000','20','0','11','0','21','0',
  '0','LWPOLYLINE','8','THANH','90','3','70','0','10','0','20','0','10','1000','20','0','10','1000','20','1000',
  '0','ARC','8','UON','10','0','20','0','40','1000','50','0','51','90',
  '0','CIRCLE','8','COT','10','0','20','0','40','1000',
  '0','INSERT','8','DEN','2','DEN_LED','10','200','20','100',
  '0','INSERT','8','DEN','2','DEN_LED','10','500','20','100',
  '0','ENDSEC','0','EOF',
].join('\n');
const quantities = analyzeDxfQuantities(quantityDxf);
const quantityLayer = (name: string) => quantities.layers.find((layer) => layer.layer === name);
assert.equal(quantityLayer('TRAN_CHIM')?.areaM2, 12);
assert.equal(quantityLayer('TRAN_CHIM')?.perimeterM, 14);
assert.equal(quantityLayer('TRAN_CHIM')?.closedPolylineCount, 0, 'matching closed polyline must not inflate hatch measurement');
assert.equal(quantityLayer('NEP_BIEN')?.lengthM, 3, 'reversed duplicate line must not count twice');
assert.equal(quantityLayer('THANH')?.lengthM, 2);
assert.equal(quantityLayer('UON')?.lengthM, 1.5708);
assert.equal(quantityLayer('COT')?.areaM2, 3.1416);
assert.equal(quantityLayer('COT')?.perimeterM, 6.2832);
assert.equal(quantityLayer('DEN')?.blockCount, 2);
assert.ok(quantities.warnings.some((warning) => warning.includes('trùng')));

const unitlessQuantityDxf = quantityDxf.replace('9\n$INSUNITS\n70\n4', '9\n$INSUNITS\n70\n0');
const unitlessTakeoff = analyzeDxfQuantities(unitlessQuantityDxf);
assert.equal(unitlessTakeoff.layers.find((layer) => layer.layer === 'TRAN_CHIM')?.areaM2, undefined, 'unknown units must not invent m²');
assert.equal(unitlessTakeoff.layers.find((layer) => layer.layer === 'TRAN_CHIM')?.areaDrawingUnits, 12000000);

const riskyDxf = [
  '0','SECTION','2','HEADER','9','$INSUNITS','70','4','0','ENDSEC',
  '0','SECTION','2','ENTITIES',
  '0','LWPOLYLINE','8','=CMD|unsafe','90','4','70','1',
  '10','0','20','0','42','0.5','10','1000','20','0','10','1000','20','1000','10','0','20','1000',
  '0','HATCH','8','BAD','91','1','92','0','93','1','72','2',
  '0','INSERT','8','MINSERT','2','GRID','70','3','71','2',
  '0','LINE','8','=CMD|unsafe','10','0','20','0','11','500','21','0',
  '0','ENDSEC','0','EOF'
].join('\n');
const riskyTakeoff = analyzeDxfQuantities(riskyDxf);
assert.equal(riskyTakeoff.layers.find((layer) => layer.layer === '=CMD|unsafe')?.areaM2, 0, 'bulge polyline must not create phantom area');
assert.equal(riskyTakeoff.skippedEntities, 3, 'bulge, unsupported hatch and MINSERT must be flagged');
assert.ok(riskyTakeoff.warnings.some((warning) => warning.includes('MINSERT')));
assert.ok(exportDxfQuantitiesCsv(riskyTakeoff).includes("\"'=CMD|unsafe\""), 'CSV must neutralize spreadsheet formulas');

assert.throws(() => detectRoomsFromDxf(riskyDxf), /Không tìm thấy HATCH boundary/, 'curved polyline and incomplete HATCH must never become rooms with false area');
const riskySvg = renderDxfFloorPlanSvgDataUrl(riskyDxf);
assert.ok(riskySvg.skippedEntities >= 2, 'curved polyline and unsupported blocks must be listed as skipped floor background entities');


console.log('DXF Layer Quantity Takeoff Golden: PASS');

// Read-only layer-to-work-category comparison: no Firestore writes, no unit guessing.
assert.deepEqual(supportedCadMetrics('m2'), ['area']);
assert.deepEqual(supportedCadMetrics('m'), ['length', 'perimeter']);
assert.deepEqual(supportedCadMetrics('cái'), ['block']);
assert.deepEqual(supportedCadMetrics('tấm'), [], 'one block is not necessarily one board');
const category = { id: 'work-a', workCategoryId: 'CAT-A', title: '=TRAN_CHIM', unit: 'm²', floor: 'Tầng 1', floorId: 'floor-a', category: 'Trần', planned: 10, actual: 0, unitPrice: 0, status: 'Chưa thi công' } as const;
const comparison = buildCadLayerComparison(quantities,
  { TRAN_CHIM: { workCategoryId: 'CAT-A', metric: 'area' } },
  [category], [{ id: 'room-a', floorId: 'floor-a', roomName: 'A101', workCategoryId: 'CAT-A', workCategory: '=TRAN_CHIM',
    categoryVolumes: { '=TRAN_CHIM': 10 }, categoryVolumeUnits: { '=TRAN_CHIM': 'm2' },
  } as never], 'floor-a');
assert.equal(comparison.length, 1);
assert.equal(comparison[0].cadQuantity, 12);
assert.equal(comparison[0].existingQuantity, 10);
assert.equal(comparison[0].delta, 2);
assert.equal(comparison[0].issues.length, 0);
assert.ok(exportCadLayerComparisonCsv(comparison).includes("\"'=TRAN_CHIM\""), 'mapping CSV must neutralize Excel formulas');
const mismatch = buildCadLayerComparison(quantities,
  { TRAN_CHIM: { workCategoryId: 'CAT-A', metric: 'block' } }, [category], [], 'floor-a');
assert.ok(mismatch[0].issues.some((issue) => issue.includes('không phù hợp')));
assert.equal(mismatch[0].delta, undefined);
const unknownUnits = buildCadLayerComparison(unitlessTakeoff,
  { TRAN_CHIM: { workCategoryId: 'CAT-A', metric: 'area' } }, [category], [], 'floor-a');
assert.equal(unknownUnits[0].cadQuantity, undefined, 'unitless CAD cannot create metric quantity');
assert.equal(unknownUnits[0].delta, undefined);
const wrongFloor = buildCadLayerComparison(quantities,
  { TRAN_CHIM: { workCategoryId: 'CAT-A', metric: 'area' } }, [category], [], 'floor-other');
assert.ok(wrongFloor[0].issues.some((issue) => issue.includes('tầng khác')));
const mixed = buildCadLayerComparison(quantities,
  { TRAN_CHIM: { workCategoryId: 'CAT-A', metric: 'area' }, NEP_BIEN: { workCategoryId: 'CAT-A', metric: 'length' } },
  [category], [], 'floor-a');
assert.ok(mixed[0].issues.some((issue) => issue.includes('nhiều cách đo')));
assert.equal(mixed[0].cadQuantity, undefined, 'mixed or invalid units cannot produce a trusted CAD total');
console.log('DXF Layer Mapping & Safe Comparison Golden: PASS');
