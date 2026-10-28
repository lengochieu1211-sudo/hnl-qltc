import assert from 'node:assert/strict';
import fs from 'node:fs';
import { snapRoomPointOrthogonal } from '../src/utils/roomHighlightSnap.ts';
import { getChatUnreadCount } from '../src/utils/chatUnread.ts';
const snap=(p,anchors,opts={})=>snapRoomPointOrthogonal(p,anchors,{width:1000,height:800},opts);
assert.deepEqual(snap({x:20.5,y:63},[{x:20,y:30}]),{x:20,y:63},'Snap X to vertical edge');
assert.deepEqual(snap({x:40,y:10.6},[{x:20,y:10}]),{x:40,y:10},'Snap Y to horizontal edge');
assert.deepEqual(snap({x:60,y:60},[{x:20,y:20}]),{x:60,y:60},'Outside tolerance no snapping');
assert.deepEqual(snap({x:20.5,y:63},[{x:20,y:30}],{disabled:true}),{x:20.5,y:63},'Alt bypass');
assert.deepEqual(snap({x:20.5,y:10.5},[{x:20,y:10}]),{x:20.5,y:10},'No zero-length corner snap');
assert.deepEqual(snap({x:20.5,y:30.5},[{x:20,y:10},{x:40,y:30}]),{x:20,y:30},'Snap both axes to different neighbours');
assert.equal(getChatUnreadCount(12,12,5000,3000),0,'Same counters: timestamp ghost must not appear');
assert.equal(getChatUnreadCount(13,12,5000,3000),1,'One real unread');
assert.equal(getChatUnreadCount(12,14,5000,3000),0,'Counters clamped');
assert.equal(getChatUnreadCount(0,0,5000,3000),0,'No message count: no fake unread');
assert.equal(getChatUnreadCount(null,null,5000,3000),1,'Legacy fallback');
assert.equal(getChatUnreadCount(null,null,1000,3000),0,'Legacy already read');
for(const file of ['src/App.tsx','src/features/chat/ChatTab.tsx']){
  const code=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
  assert.match(code,/getChatUnreadCount\(/, file+' uses shared read counter');
  assert.doesNotMatch(code,/lastMessageAt > lastReadAt \? 1 : 0/,file+' no ghost fallback');
}
const floor=fs.readFileSync(new URL('../src/components/FloorPlanDefectTab.tsx',import.meta.url),'utf8');
assert.equal((floor.match(/snapRoomPointOrthogonal\(/g)||[]).length,3,'Draw, hover and drag use same orthogonal snap');
console.log('PASS orthogonal snap and shared unread badge regression');
