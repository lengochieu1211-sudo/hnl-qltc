/** No Firebase writes: reject retry payload collisions before any inventory mutation. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isExactWarehouseTransferReplay, isExactWarehouseReceiptReplay } from '../src/lib/warehouseTransferReplayGuard.ts';
const item={id:'XK-001',type:'out',itemKind:'material',materialName:'Tấm TC',materialId:'VL-1',unit:'tấm',quantity:10,
  location:'A',handler:'ADMIN',date:'2026-11-05',notes:'fixture'};
const ctx={fromProjectId:'A',toProjectId:'B',transferId:'TR-A-XK-001'};
const outgoing={...item,sourceType:'project-transfer-out',warehouseTransferId:ctx.transferId,
  transferToProjectId:'B',deleted:false,deletedAt:null};
const incoming={id:ctx.transferId,fromProjectId:'A',toProjectId:'B',sourceTransactionId:item.id,itemKind:item.itemKind,
  materialName:item.materialName,originalMaterialId:item.materialId,unit:item.unit,quantity:item.quantity,
  date:item.date,handler:item.handler,notes:item.notes,status:'pending'};
const sameUnit=(a,b)=>a.trim().toLowerCase()===b.trim().toLowerCase();
const check=(o=outgoing,i=incoming,requested=item,c=ctx)=>isExactWarehouseTransferReplay(o,i,requested,c,sameUnit);
assert.equal(check(),true);
assert.equal(check(outgoing,{...incoming,status:'received'}),true);
for(const [label,o,i,req] of [
  ['quantity',outgoing,incoming,{...item,quantity:9}],
  ['different unit',outgoing,incoming,{...item,unit:'thùng'}],
  ['different material ID',outgoing,incoming,{...item,materialId:'VL-2'}],
  ['different itemKind',outgoing,incoming,{...item,itemKind:'equipment'}],
  ['different notes',outgoing,incoming,{...item,notes:'changed'}],
  ['different source location',outgoing,incoming,{...item,location:'Other warehouse'}],
  ['different date',outgoing,incoming,{...item,date:'2026-11-06'}],
  ['different handler',outgoing,incoming,{...item,handler:'EDITOR'}],
  ['tampered incoming',outgoing,{...incoming,quantity:4},item],
  ['soft deleted',{...outgoing,deleted:true},incoming,item],
  ['orphan',{},incoming,item],
]) assert.equal(check(o,i,req),false,`Retry collision must reject: ${label}`);
const received={id:'NK-TR-A-XK-001',type:'in',itemKind:'material',materialName:'Tấm TC',materialId:'VL-1',
  unit:'tấm',quantity:10,sourceType:'project-transfer-in',warehouseTransferId:ctx.transferId,
  transferFromProjectId:'A',deleted:false,deletedAt:null};
const after={...incoming,status:'received',receiptId:received.id};
const map={materialName:'Tấm TC',materialId:'VL-1',unit:'tấm'};
const repeat=(row=received,mapping=map)=>isExactWarehouseReceiptReplay(row,after,mapping,ctx.transferId,received.id,sameUnit);
assert.equal(repeat(),true);
assert.equal(repeat({...received,quantity:9}),false);
assert.equal(repeat(received,{...map,unit:'thùng'}),false);
assert.equal(repeat(received,{...map,materialId:'VL-2'}),false);
const source=fs.readFileSync('src/lib/warehouseProjectTransfer.ts','utf8');
assert(source.includes('isExactWarehouseTransferReplay(existingOut.data(), existingInbox.data(), item,'));
assert(source.includes('TRANSFER_RETRY_CONFLICT'));
assert(source.includes('unit: item.unit, quantity: item.quantity,'));
assert(source.includes('isExactWarehouseReceiptReplay(existingReceipt.data(), incoming, mapped,'));
console.log('DEV WAREHOUSE TRANSFER RETRY PURE GOLDEN PASS');
