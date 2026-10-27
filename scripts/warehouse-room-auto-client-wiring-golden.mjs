import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../src/components/RoomHighlightModal.tsx',import.meta.url),'utf8');
const floor=readFileSync(new URL('../src/components/FloorPlanDefectTab.tsx',import.meta.url),'utf8');
const client=readFileSync(new URL('../src/lib/warehouseTrustedClient.ts',import.meta.url),'utf8');
const cloud=readFileSync(new URL('../warehouse-trusted/index.mjs',import.meta.url),'utf8');
const engine=readFileSync(new URL('../warehouse-trusted/room-auto.mjs',import.meta.url),'utf8');
for(const needle of ['callTrustedWarehouseRoomAutoIssue({','expectedRoomRevision:','expectedRoomUpdatedAt:',
  'data-hnl-room-auto-issue','!button.hasAttribute(\'data-hnl-room-auto-issue\')'])
  assert.ok(ui.includes(needle),`DEV auto issue UI wiring missing ${needle}`);
assert.ok(floor.includes('projectId={currentProjectId}'),'Project identity must come from active verified tab');
assert.ok(client.includes("'hnlWarehouseRoomAutoIssueDevV1'"),'DEV callable name missing');
assert.ok(cloud.includes('export const hnlWarehouseRoomAutoIssueDevV1') &&
  cloud.includes('activeDev()'),'Function must be DEV-only');
assert.ok(cloud.includes("'expectedRoomRevision','expectedRoomUpdatedAt'"),'Callable must reject client-supplied quantities');
assert.ok(engine.includes('ledgerByKey') && engine.includes('manualIssued'),'Server computes all quantities');
assert.ok(engine.includes('tx.set') && engine.includes('runTransaction'),'Server transactional authoritativeness missing');
console.log('WAREHOUSE ROOM AUTO DEV STATIC WIRING PASS (NOT runtime/Emulator)');
