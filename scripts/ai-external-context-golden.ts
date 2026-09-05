import assert from 'node:assert/strict';
import { buildExternalAiProjectContext } from '../src/ai/data/externalAiContext';

const snapshot = {
  projectId: 'dev-project', projectName: 'HNL demo 0901234567 owner@example.com', asOf: 1, freshness: 'live',
  teams: [], floors: [], workVolumes: [], inventory: [], materialNorms: [], checklist: [],
  rooms: [{ id: 'r1', roomName: 'A01', floorId: 'f1', floorName: 'L1', subItems: [] }],
  defects: [{ id: 'd1', floorId: 'f1', floorName: 'L1', category: 'TC', description: 'Gọi 0901234567 hoặc owner@example.com', severity: 'HIGH', status: 'OPEN', createdAt: 1 }],
  crewRecords: [{ id: 'c1', teamName: 'Đội A', date: '2026-09-05', workerCount: 5, taskDescription: 'Liên hệ +84 901 234 567', notes: 'mail worker@example.com' }],
} as any;

const noOptIn = buildExternalAiProjectContext(snapshot, { progress: false, defects: false, crew: false, inventory: false, checklist: false });
assert.equal('defects' in noOptIn, false);
assert.equal('crew' in noOptIn, false);

const allowed = buildExternalAiProjectContext(snapshot, { progress: false, defects: true, crew: true, inventory: false, checklist: false });
const serialized = JSON.stringify(allowed);
assert.equal(serialized.includes('0901234567'), false);
assert.equal(serialized.includes('owner@example.com'), false);
assert.equal(serialized.includes('worker@example.com'), false);
assert.match(serialized, /đã ẩn/);
console.log('AI external context golden: PASS');
