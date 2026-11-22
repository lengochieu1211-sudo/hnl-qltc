import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDirectHighlightCategoryNames, resolveDirectHighlightLaunchCategory } from '../src/utils/floorHighlightDirectShapes.ts';
const catalog = [{ id: 'work-001', title: 'Trần khung nổi 610', unit: 'm²' }];
const room = {
  id: 'room-test', workCategory: 'Vách thạch cao',
  categoryVolumes: { 'work-001': 35.25, 'Vách thạch cao': 10 },
  subItems: [{ id: 'stage-1', name: 'Lắp tấm', category: 'Trần khung nổi 610', workVolume: 6 }],
};
assert.ok(getDirectHighlightCategoryNames(room).includes('Trần khung nổi 610'));
assert.equal(resolveDirectHighlightLaunchCategory(room, 'Trần khung nổi 610', 'main', catalog), 'work-001',
  'main launch must resolve the persisted WorkVolume ID even when subItem has matching title');
assert.equal(resolveDirectHighlightLaunchCategory(room, 'Trần khung nổi 610', 'stage-1', catalog), 'Trần khung nổi 610',
  'subItem keeps its own existing category and ID');
assert.equal(resolveDirectHighlightLaunchCategory(room, 'Vách thạch cao', 'main', catalog), 'Vách thạch cao');
assert.equal(resolveDirectHighlightLaunchCategory(room, 'Không tồn tại', 'main', catalog), null,
  'missing category must not be replaced with first category');
assert.equal(resolveDirectHighlightLaunchCategory(room, 'Vách thạch cao', 'stage-1', catalog), null,
  'wrong stage category must not silently fall back to main');
assert.equal(resolveDirectHighlightLaunchCategory({ ...room, categoryVolumes: { ...room.categoryVolumes, 'Trần khung nổi 610': 22 } },
  'Trần khung nổi 610', 'main', catalog), null, 'ambiguous ID/title volume keys must not be modified');
const draw = readFileSync('src/components/FloorHighlightDirectDraw.tsx','utf8');
const floor = readFileSync('src/components/FloorPlanDefectTab.tsx','utf8');
assert.match(draw, /data-hnl-direct-highlight-quantity-summary/);
assert.match(draw, /KL đang lưu:/);
assert.match(draw, /Đo theo vùng:/);
assert.match(draw, /resolveDirectHighlightLaunchCategory\(room, launch.category, launch.target, workVolumes\)/);
assert.doesNotMatch(draw, /categories\.includes\(launch\.category\) \? launch\.category : \(categories\[0\]/);
assert.match(floor, /room=\{selectedRoomObject\}\s+workVolumes=\{workVolumes\}/);
assert.match(draw, /unresolvedAutoAlias/);
assert.doesNotMatch(draw, /updateDoc\(|runTransaction\(|writeBatch\(/);
console.log('PASS: main ID/title mapping, subItem identity, ambiguity block, visible quantity, no new database writes');
