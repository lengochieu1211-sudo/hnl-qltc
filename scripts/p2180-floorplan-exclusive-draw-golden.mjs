import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/components/FloorPlanDefectTab.tsx', import.meta.url), 'utf8');

const check = (ok, label) => { assert.ok(ok, label); console.log(`PASS P21.80: ${label}`); };
check(/const isRoomCreationDrawing = canManageStructure && \(viewMode === 'all' \|\| viewMode === 'highlight'\)[\s\S]{0,180}drawTool === 'freehand'[\s\S]{0,100}drawTool === 'polygon'[\s\S]{0,100}drawTool === '2point'/.test(src), 'only actual drawing tools arm exclusive canvas mode');
check(src.includes('data-hnl-exclusive-room-draw="true"') && src.includes('absolute inset-0 z-[60] pointer-events-auto cursor-crosshair'), 'draw hit-surface covers room, handles, labels and Defect pins');
check(src.includes('onPointerDown={handlePointerDownImage}') && src.includes('onClick={handleImageClick}'), 'canvas retains original pointer and click drawing handlers');
check(/const handleRoomSelectClick[^]*?if \(isRoomCreationDrawing\) return;/.test(src), 'room selection is gated while drawing');
check(/const handleStartDrag[^]*?if \(isRoomCreationDrawing\) return;/.test(src), 'room drag/resize is gated while drawing');
check(/const handleRoomTouchStart[^]*?if \(isRoomCreationDrawing\) return;/.test(src), 'mobile room long-press cannot steal draw gestures');
check(/const handleContextMenuOnBg[^]*?if \(isRoomCreationDrawing\) return;/.test(src), 'context menu is disabled while drawing');
check(src.includes('setIsDefectPinPlacementMode(false);') && src.includes('setRelocatingDefectId(null);') && src.includes('setSelectedDefectIds([]);'), 'existing Defect selection/placement state is cleared when drawing starts');
check(src.includes("isFullscreen ? 'relative mx-2 mb-1") && !src.includes('top-20 sm:top-16'), 'fullscreen room toolbar occupies its own line, not overlaid by a fixed top offset');
check(src.includes('construction_room_highlight_stroke_percent') && src.includes('const strokeScale = (roomHighlightStrokePercent / 100) / Math.max(1, zoomScale)'), 'stroke width is project-scoped local preference, preserving zoom compensation');
check((src.match(/aria-label="Độ dày nét highlight"/g) || []).length === 2, 'stroke slider available in PC fullscreen and ordinary controls');
console.log('P21.80 FLOORPLAN EXCLUSIVE DRAW SOURCE GATE PASS');
