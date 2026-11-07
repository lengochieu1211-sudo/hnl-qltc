import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// PR375 isolated iPhone regression check: no Firebase credentials or live writes.
const source = readFileSync(new URL('../src/components/FloorPlanDefectTab.tsx', import.meta.url), 'utf8');
const check = (condition, title) => {
  assert.ok(condition, title);
  console.log(`PASS PR375 IPHONE FREEHAND: ${title}`);
};

check(source.includes("const isRoomCreationDrawing = canManageStructure && (viewMode === 'all' || viewMode === 'highlight')"),
  'Drawing permission and all/highlight map modes preserved');
check(source.includes("touchAction: (isRoomCreationDrawing && (drawTool === 'freehand' || drawTool === '2point'))"),
  'iPhone frees one-finger drawing from Safari pan in all/highlight modes');
check(!source.includes("touchAction: (viewMode === 'highlight' && drawTool === 'freehand')"),
  'Old highlight-only touch guard removed');
check(source.includes('onPointerDown={handlePointerDownImage}') &&
      source.includes('onPointerMove={handlePointerMoveImage}') &&
      source.includes('onPointerUp={handlePointerUpImage}'),
  'Regular and fullscreen reuse one pointer event pipeline');
check(source.includes('onPointerCancel={handleCancelledDrawPointer}') &&
      !source.includes('handlePointerUpImage(e);'),
  'Cancelled touches cannot call save-on-pointer-up');
check(source.includes('const handleCancelledDrawPointer =') &&
      source.includes('setIsFreehandDrawing(false);\n    setFreehandPoints([]);') &&
      source.includes('setObjectSnapPreview(null);'),
  'Cancelled freehand state cleared without saving partial rooms');
check(source.includes("if (isFreehandDrawing) {") && source.includes('setPendingDraftHighlight({'),
  'Successful stroke still opens existing draft highlighting flow');
check(source.includes('getSavedRoomSnap') && source.includes('findRoomObjectSnap'),
  'Existing room OSNAP algorithm retained');
console.log('PR375 IPHONE FREEHAND SOURCE REGRESSION PASS (not physical-device Golden)');
