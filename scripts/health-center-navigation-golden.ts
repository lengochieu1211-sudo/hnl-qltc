import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHealthCenterNavigationRequest } from '../src/healthCenter/healthCenterNavigation';

const base = { id: 'x', ruleId: 'CREW_FLOOR_WORK_CATEGORY_EMPTY', severity: 'WARNING', module: 'crew', message: 'x', actionClass: 'NEEDS_CONFIRMATION', evidenceIds: ['crew_records:crew_123'], location: { floorId: 'fp-1', roomId: '', roomName: '', teamId: 'team-1' }, details: { recordId: 'crew_123' } } as any;
const crew = buildHealthCenterNavigationRequest('proj-1', { ...base, entityType: 'crew', entityId: 'crew_123:0:0' });
assert.equal(crew.entityType, 'crewRecord');
assert.equal(crew.entityId, 'crew_123');

const room = buildHealthCenterNavigationRequest('proj-1', { ...base, entityType: 'room', entityId: 'ROOM-1:0', evidenceIds: ['rooms:ROOM-1'], location: { floorId: 'fp-2', roomId: 'ROOM-1', roomName: 'Trục ND/A9-A15' }, details: { roomId: 'ROOM-1', subItemId: 'sub-board' } });
assert.equal(room.entityId, 'ROOM-1');
assert.equal(room.floorId, 'fp-2');
assert.equal(room.roomName, 'Trục ND/A9-A15');
assert.equal(room.subItemId, 'sub-board');

const defect = buildHealthCenterNavigationRequest('proj-1', { ...base, entityType: 'defect', entityId: 'defect_1:child', evidenceIds: ['defects:defect_1'], location: { floorId: 'fp-3' }, details: {} });
assert.equal(defect.entityId, 'defect_1');
const appSource = fs.readFileSync('src/App.tsx', 'utf8');
const panelSource = fs.readFileSync('src/healthCenter/HealthCenterPanel.tsx', 'utf8');
const floorSource = fs.readFileSync('src/components/FloorPlanDefectTab.tsx', 'utf8');
const configSource = fs.readFileSync('src/components/GoogleConfigTab.tsx', 'utf8');
const navSource = fs.readFileSync('src/components/BottomNav.tsx', 'utf8');
assert.match(appSource, /entityType === 'room'.*'floorplan'/s);
assert.match(panelSource, /entityType === 'room'[\s\S]*qlct_diagnostic_navigation_request[\s\S]*qlct-diagnostic-open-entity/);
assert.match(floorSource, /HEALTH_CENTER_ROOM_OPEN/);
assert.match(configSource, /HNL Health Center/);
assert.match(configSource, /Trạng thái hệ thống & đồng bộ/);
assert.match(navSource, /HNL Health Center/);
console.log('health-center-navigation-golden: PASS');
