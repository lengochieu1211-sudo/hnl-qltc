import assert from 'node:assert/strict';
import { prepareCrewRecordForPersistence } from '../src/utils/crewPersistence';

const ok = prepareCrewRecordForPersistence({ taskDescription: '[Tầng 1]: IW11 ()', floorWorks: [{ floorName: 'Tầng 1', categories: [{ categoryName: 'IW11', subItems: [] }, { categoryName: '', subItems: [] }] }] });
assert.equal(ok.ok, true);
assert.equal(ok.record?.taskDescription, '[Tầng 1]: IW11');
assert.equal(ok.record?.floorWorks?.[0]?.categories?.length, 1);

const rejectEmpty = prepareCrewRecordForPersistence({ taskDescription: '', floorWorks: [{ floorName: 'Tầng Trệt', categories: [{ categoryName: '', subItems: [] }] }] });
assert.equal(rejectEmpty.ok, false);

const rejectSubitemWithoutName = prepareCrewRecordForPersistence({ taskDescription: '', floorWorks: [{ floorName: 'Tầng Trệt', categories: [{ categoryName: '', subItems: ['Bắn tấm'] }] }] });
assert.equal(rejectSubitemWithoutName.ok, false);
console.log('crew-persistence-golden: PASS');
