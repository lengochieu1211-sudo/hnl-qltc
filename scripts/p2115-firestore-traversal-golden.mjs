import assert from 'node:assert/strict';
import {crawlFirestore, isMissingDocument, listDocumentsQuery} from './p2115-firestore-traversal.mjs';

const prefix = 'projects/test/databases/(default)/documents/';
const tree = new Map([
  ['', ['projects']],
  ['projects/existing', ['rooms']],
  ['projects/missing-parent', ['rooms']],
  ['projects/missing-parent/rooms/orphan-child', ['notes']],
]);
const pages = new Map([
  ['projects', [{name: prefix+'projects/existing', fields:{ok:{booleanValue:true}}, createTime:'t', updateTime:'t'},
                {name: prefix+'projects/missing-parent'}]],
  ['projects/existing/rooms', [{name: prefix+'projects/existing/rooms/room-a', fields:{}, createTime:'t', updateTime:'t'}]],
  ['projects/missing-parent/rooms', [{name: prefix+'projects/missing-parent/rooms/orphan-child', fields:{v:{integerValue:'1'}}, createTime:'t', updateTime:'t'}]],
  ['projects/missing-parent/rooms/orphan-child/notes', [{name: prefix+'projects/missing-parent/rooms/orphan-child/notes/n1', fields:{}, createTime:'t', updateTime:'t'}]],
]);
const seen = [], requests = [];
await crawlFirestore({
  listCollections: async path => tree.get(path) || [],
  listDocuments: async (path, cursor) => { requests.push({path,cursor,showMissing:true}); return {documents:pages.get(path)||[]}; },
  documentPath: (doc, collection) => {
    assert.ok(doc.name.startsWith(prefix));
    const rel=doc.name.slice(prefix.length);
    assert.ok(rel.startsWith(collection+'/'));
    return rel;
  },
  onCollection: async()=>{},
  onDocument: async(_doc, rel)=>seen.push(rel),
});
assert.equal(isMissingDocument({name:'x'}),true);
assert.equal(isMissingDocument({name:'x',createTime:'t'}),false);
assert.equal(listDocumentsQuery('').get('showMissing'),'true');
assert.equal(listDocumentsQuery('next').get('pageToken'),'next');
assert.deepEqual(seen.sort(),[
  'projects/existing',
  'projects/existing/rooms/room-a',
  'projects/missing-parent/rooms/orphan-child',
  'projects/missing-parent/rooms/orphan-child/notes/n1',
].sort());
assert.ok(!seen.includes('projects/missing-parent'));
assert.ok(requests.some(x=>x.path==='projects/missing-parent/rooms'));
assert.ok(requests.every(x=>x.showMissing));
console.log('8/8 P21.15 Firestore missing-parent traversal tests PASS');
