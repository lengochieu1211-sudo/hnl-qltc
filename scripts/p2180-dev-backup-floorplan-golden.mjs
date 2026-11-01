import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/FloorPlanDefectTab.tsx'), 'utf8');
function check(ok, label) {assert.ok(ok, label); console.log('PASS DEV BACKUP P21.80:', label);}
check(source.includes("drawTool === 'freehand' || drawTool === 'polygon' || drawTool === '2point'"), 'actual drawing tools activate exclusive canvas');
check(source.includes('data-hnl-exclusive-room-draw="true"') && source.includes('absolute inset-0 z-[60] pointer-events-auto cursor-crosshair'), 'drawing overlay blocks room and defect pick targets');
check(source.includes('onPointerDown={handlePointerDownImage}') && source.includes('onClick={handleImageClick}'), 'drawing still bubbles to original canvas handlers');
for(const name of ['handleRoomSelectClick','handleStartDrag','handleRoomTouchStart','handleContextMenuOnBg']) {
  const section=source.slice(source.indexOf(`  const ${name} =`),source.indexOf(`  const ${name} =`)+800);
  check(section.includes('if (isRoomCreationDrawing) return;'), `${name} rejects selection during drawing`);
}
check(source.includes('setSelectedDefectIds([]);') && source.includes('setIsDefectPinPlacementMode(false);') && source.includes('setRelocatingDefectId(null);'), 'entering drawing clears conflicting defect state');
check(source.includes("isFullscreen ? 'relative mx-2 mb-1") && !source.includes('top-20 sm:top-16'), 'room edit toolbar flows under primary toolbar in fullscreen');
check(source.includes('construction_room_highlight_stroke_percent') && source.includes('Math.min(250, Math.max(50, value))'), 'stroke width is device-only, project-scoped, constrained 50–250%');
check(source.match(/aria-label="Độ dày nét highlight"/g)?.length===1 && source.match(/renderMapDisplaySettings\(/g)?.length===2 && source.includes('data-hnl-fullscreen-display-popover'), 'shared display controls persist across normal, floating fullscreen and read-only views');
check(source.includes('const strokeScale = (roomHighlightStrokePercent / 100) / Math.max(1, zoomScale)'), 'user stroke scale respects zoom');
check(source.match(/vectorEffect="non-scaling-stroke"/g)?.length>=4, 'previous DEV Backup uniform-horizontal/vertical stroke fix retained');

// Regression P21.81: saved outlines must follow the slider after Save.
check(source.includes('const savedRoomStrokeScale = roomHighlightStrokePercent / 100;'), 'saved room outlines use same 50–250% slider setting');
const savedStart = source.indexOf('/* Render All Saved Room Highlights */');
const savedEnd = source.indexOf('{canManageStructure && mapLayers.roomRegions', savedStart);
const savedRoomRender = source.slice(savedStart, savedEnd);
check(savedStart !== -1 && savedEnd > savedStart, 'saved room overlay present');
check(savedRoomRender.includes('strokeWidth={4 * savedRoomStrokeScale}'), 'saved polyline glow scales with slider');
check((savedRoomRender.match(/strokeWidth=\{\(isSelectedForDrag \? 2\.6 : 2\) \* savedRoomStrokeScale\}/g) || []).length === 3,
  'saved polyline, polygon and rectangle borders all scale (including selection)');
check(!savedRoomRender.includes('strokeWidth={isSelectedForDrag ? 2.6 : 2}'), 'no fixed-width saved outlines remain');

console.log('DEV BACKUP P21.80 scoped source gate PASS');
