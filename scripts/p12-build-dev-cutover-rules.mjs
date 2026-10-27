/**
 * Generate an ISOLATED post-migration DEV-copy Rules candidate.
 * NEVER overwrite firestore.rules, production rules, or firebase.json.
 * This candidate intentionally BLOCKS legacy room subItems and client voucher/balance
 * writes, so it MUST NOT be deployed before all migrations/clients are ready.
 */
import {readFileSync,writeFileSync} from 'node:fs';
const source=readFileSync('firestore.rules','utf8');
if(!source.startsWith("rules_version = '2';"))throw new Error('UNRECOGNIZED_RULES_BASELINE');
const old=source.match(/match \/inventory_balances\/\{balanceId\} \{[\s\S]*?\n      \}/);
if(!old)throw new Error('BALANCE_RULE_ANCHOR_MISSING');
let next=source.replace(old[0],`match /inventory_balances/{balanceId} {
        allow read: if isMember(projectId);
        // Admin SDK alone writes voucher-derived balance during trusted cutover.
        // Deny ALL client writes, including ADMIN, regardless of metadata fields.
        allow create, update, delete: if false;
      }`);
for(const verb of ['create','update','delete']){
  const re=new RegExp(`(allow ${verb}: if collectionName != 'activityLogs')`,'g');
  const found=[...next.matchAll(re)];if(found.length!==1)throw new Error('GENERIC_RULE_AMBIGUOUS_'+verb);
  next=next.replace(re,`$1 && collectionName != 'inventory'`);
}
const target=next.indexOf('function editorRoomOperationalUpdateOnly()');
const end=next.indexOf('function editorChecklistOperationalUpdateOnly()',target);
if(target<0||end<0)throw new Error('ROOM_EDITOR_RULE_ANCHOR_MISSING');
const chunk=next.slice(target,end);
if(!chunk.includes("'targetFrameDate', 'targetBoardDate', 'subItems',"))throw new Error('ROOM_SUBITEMS_RULE_ANCHOR_MISSING');
next=next.slice(0,target)+chunk.replace("'targetFrameDate', 'targetBoardDate', 'subItems',","'targetFrameDate', 'targetBoardDate',")+next.slice(end);
const banner=`// P12 GENERATED DEV-COPY POST-MIGRATION CUTOVER CANDIDATE — NOT DEPLOYED.\n// WARNING: old client warehouse vouchers and unmigrated EDITOR room edits WILL FAIL.\n// Use only after verified full migration + trusted callable integration + Emulator PASS.\n`;
writeFileSync('firestore.warehouse-cutover.dev.rules',banner+next);
console.log('DEV-COPY RULES CANDIDATE GENERATED. NOT DEPLOYED.');
