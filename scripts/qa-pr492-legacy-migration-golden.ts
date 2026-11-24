import assert from 'node:assert/strict';
import { migrateLegacyStorageCopies, LEGACY_AUTOSAVE_RAW_KEY } from '../src/utils/migrateStorage.ts';
const key='construction_room_progress_qa', raw='[{"id":"a","revision":1}]', newer='[{"id":"a","revision":2}]';
function fixture(entries: [string, any][], saved: [string, any][]=[], options: {fail?:boolean; corrupt?:boolean; change?:boolean}={}){
 const src=new Map(entries), dst=new Map(saved);
 const source={get length(){return src.size},key:i=>[...src.keys()][i]??null,getItem:k=>src.get(k)??null,removeItem:k=>src.delete(k)};
 const target={async getItem(k){return dst.get(k)??null},async setItem(k,v){if(options.fail)throw Error('disk full');dst.set(k,options.corrupt?'corrupt':v);if(options.change)src.set(key,newer);return v}};
 return {src,dst,source,target};
}
async function check(label,f,n,expectedSrc,expectedDst,k=key){
 const r=await migrateLegacyStorageCopies(f.source,f.target);
 assert.equal(r.migrated,n,label);assert.equal(f.src.get(k),expectedSrc,label);assert.deepEqual(f.dst.get(k==='construction_autosave_versions'?LEGACY_AUTOSAVE_RAW_KEY:k),expectedDst,label);
 console.log('PASS legacy:',label);
}
await check('empty destination verified',fixture([[key,raw]]),1,undefined,raw);
await check('same raw copy',fixture([[key,raw]],[[key,raw]]),1,undefined,raw);
await check('conflicting destination',fixture([[key,raw]],[[key,newer]]),0,raw,newer);
await check('structured destination retained',fixture([[key,raw]],[[key,JSON.parse(raw)]]),0,raw,JSON.parse(raw));
await check('source changes during copy',fixture([[key,raw]],[],{change:true}),0,newer,raw);
await check('failed destination write',fixture([[key,raw]],[],{fail:true}),0,raw,undefined);
await check('wrong readback',fixture([[key,raw]],[],{corrupt:true}),0,raw,'corrupt');
await check('autosave raw exact',fixture([['construction_autosave_versions',raw]]),1,undefined,raw,'construction_autosave_versions');
await check('autosave conflict preserved',fixture([['construction_autosave_versions',raw]],[[LEGACY_AUTOSAVE_RAW_KEY,newer]]),0,raw,newer,'construction_autosave_versions');
const untouched=fixture([['firestore_mutations_demo',raw],['firebase:authUser:demo',raw],['construction_unrelated',raw]]);
assert.equal((await migrateLegacyStorageCopies(untouched.source,untouched.target)).migrated,0);
assert.equal(untouched.src.size,3);assert.equal(untouched.dst.size,0);
console.log('PASS legacy: unrelated and SDK/auth keys untouched');
