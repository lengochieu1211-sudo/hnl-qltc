import fs from 'node:fs';
import type { RoomProgressItem } from '../src/types';
import {
  getRoomHighlightBounds,
  mirrorRoomHighlight,
  resizeRoomHighlightToBounds,
  rotateRoomHighlight,
  snapRotationDelta,
} from '../src/utils/roomHighlightGeometry';
import { isPointInsideRoom } from '../src/utils/defectLinkageUtils';
import {
  DEFAULT_CAD_ALIGNMENT,
  rebuildCadRoomForAlignment,
  remapPointBetweenCadAlignments,
} from '../src/utils/cadAlignment';

const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const near = (a: number, b: number, tolerance = 0.2) => Math.abs(a - b) <= tolerance;

const base: RoomProgressItem = {
  id: 'ROOM-ROTATE-1', floorId: 'floor-a', floorName: 'Tầng 8', roomName: 'Căn A08',
  x: 20, y: 30, width: 20, height: 10,
  frameStatus: 'Chưa làm', boardStatus: 'Chưa làm', inspectionStatus: 'Chưa nghiệm thu',
  teamId: 'team-1', assignedTeam: 'Đội A', workCategoryId: 'cat-1', workCategory: 'Trần', updatedAt: 1,
};

const rotated = rotateRoomHighlight(base, 37, 1.5);
check(rotated.id === base.id && rotated.floorId === base.floorId && rotated.teamId === base.teamId && rotated.workCategoryId === base.workCategoryId, 'Rotation must preserve authoritative business IDs.');
check(rotated.roomName === base.roomName && rotated.assignedTeam === base.assignedTeam, 'Rotation must preserve room/team labels.');
check(Array.isArray(rotated.points) && rotated.points.length === 4, 'Rotating a rectangle must persist real polygon geometry.');
const baseCenter = getRoomHighlightBounds(base);
const rotatedCenter = getRoomHighlightBounds(rotated);
check(near(baseCenter.cx, rotatedCenter.cx) && near(baseCenter.cy, rotatedCenter.cy), 'Arbitrary rotation must preserve the room center unless canvas-edge fitting is required.');

const quarterTurn = rotateRoomHighlight(base, 90, 1);
check(near(quarterTurn.width, 10) && near(quarterTurn.height, 20), '90-degree rotation must swap rectangle width/height on square geometry.');
check(isPointInsideRoom(30, 35, quarterTurn), 'Hit-test must follow rotated polygon geometry.');

const mirroredTwice = mirrorRoomHighlight(mirrorRoomHighlight(base, 'horizontal'), 'horizontal');
const mirroredBounds = getRoomHighlightBounds(mirroredTwice);
check(near(mirroredBounds.x, base.x) && near(mirroredBounds.y, base.y) && near(mirroredBounds.width, base.width) && near(mirroredBounds.height, base.height), 'Double horizontal mirror must restore original bounds.');

const resized = resizeRoomHighlightToBounds(rotated, { x: 10, y: 12, width: 30, height: 24 });
const resizedBounds = getRoomHighlightBounds(resized);
check(near(resizedBounds.x, 10) && near(resizedBounds.y, 12) && near(resizedBounds.width, 30) && near(resizedBounds.height, 24), 'Polygon resize must transform real points to the requested bounds.');

check(snapRotationDelta(87) === 90 && snapRotationDelta(94) === 90 && snapRotationDelta(82) === 82, 'Rotation handle must softly snap only near 90-degree increments.');

const cadRoom: RoomProgressItem = {
  ...base,
  id: 'ROOM-CAD-1',
  cadSource: {
    format: 'DXF',
    rawPoints: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }, { x: 100, y: 200 }],
    extents: { minX: 0, minY: 0, maxX: 400, maxY: 400 },
    layer: 'ROOM',
    source: 'LWPOLYLINE',
  },
};
const alignedCadRoom = rebuildCadRoomForAlignment(cadRoom, { left: 10, top: 20, width: 80, height: 60, rotation: 0 });
check(near(alignedCadRoom.x, 30) && near(alignedCadRoom.y, 50), 'CAD alignment must rebuild room position from immutable rawPoints.');
check(near(alignedCadRoom.width, 40) && near(alignedCadRoom.height, 15), 'CAD alignment must scale room geometry into the target floor-plan rectangle.');
check(alignedCadRoom.id === cadRoom.id && alignedCadRoom.cadSource === cadRoom.cadSource, 'CAD alignment must preserve roomId and immutable CAD source.');
const remappedDefect = remapPointBetweenCadAlignments({ x: 50, y: 50 }, DEFAULT_CAD_ALIGNMENT, { left: 10, top: 20, width: 80, height: 60, rotation: 0 });
check(near(remappedDefect.x, 50) && near(remappedDefect.y, 50), 'Defect point must remap through the same CAD transform.');
const rotatedDefect = remapPointBetweenCadAlignments({ x: 25, y: 50 }, DEFAULT_CAD_ALIGNMENT, { left: 0, top: 0, width: 100, height: 100, rotation: 90 });
check(near(rotatedDefect.x, 50) && near(rotatedDefect.y, 25), 'Defect remap must follow CAD rotation.');

const floorPlanUi = fs.readFileSync('src/components/FloorPlanDefectTab.tsx', 'utf8');
const pdfUi = fs.readFileSync('src/components/ExportPdfModal.tsx', 'utf8');
check(floorPlanUi.includes("handleStartDrag(e, room, 'rotate')"), 'Selected room must expose a draggable rotation handle.');
check(floorPlanUi.includes("applySelectedRoomTransform('rotate90')") && floorPlanUi.includes("applySelectedRoomTransform('rotate180')"), 'Selected room must expose quick 90/180 rotation actions.');
check(floorPlanUi.includes("applySelectedRoomTransform('mirror-horizontal')") && floorPlanUi.includes("applySelectedRoomTransform('mirror-vertical')"), 'Selected room must expose horizontal/vertical mirror actions.');
check(floorPlanUi.includes('rotationPreview?.roomId === room.id'), 'Free rotation must show a live angle badge.');
check(floorPlanUi.includes('preserveValidRoomId: true'), 'Highlight geometry edits must not silently reassign an existing Defect roomId.');
check(pdfUi.includes('<polygon points="${ptsStr}"'), 'PDF export must render persisted polygon geometry after rotation.');
check(floorPlanUi.includes('Căn chỉnh CAD với mặt bằng'), 'Floor-plan UI must expose floor-level CAD alignment for later image/PDF backgrounds.');
check(floorPlanUi.includes('remapPointBetweenCadAlignments'), 'CAD alignment must remap Defect pins together with the CAD layer.');
check(floorPlanUi.includes('cadAlignment'), 'Floor-plan alignment must persist on the FloorPlan record.');

console.log('ROOM HIGHLIGHT TRANSFORM GOLDEN PASS');
