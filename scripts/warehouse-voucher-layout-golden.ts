import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { InventoryItem } from '../src/types';
import { paginateWarehouseVouchers } from '../src/utils/warehouseVoucherPrint';

const base: InventoryItem = {
  id:'INV-A',type:'in',itemKind:'material',materialName:'Tấm thạch cao tiêu chuẩn',
  unit:'Tấm',quantity:20,date:'2026-10-14',location:'Kho công trình',handler:'Thủ kho',
};
const itemB:InventoryItem={...base,id:'INV-B',materialName:'Ty ren M8',unit:'Cây',quantity:55};
const source=[base,itemB,{...base,id:'OUT-A',type:'out' as const},
  {...base,id:'OTHER-DAY',date:'2026-10-13'}, {...base,id:'DELETED',deletedAt:Date.now()}];
const snapshot=JSON.stringify(source);
const pages=paginateWarehouseVouchers(source);
assert.equal(pages.length,3,'Group by direction/date/location/handler, not by each material ID');
assert.deepEqual(pages[0].rows.map(r=>r.id),['INV-A','INV-B'],'Many materials must print in one receipt table');
assert.equal(pages[0].pageCount,1,'Two materials fit on one A4 page');
assert.equal(pages[0].rowOffset,0);
assert.equal(pages.flatMap(p=>p.rows).some(r=>r.id==='DELETED'),false,'Deleted receipts excluded');
assert.equal(JSON.stringify(source),snapshot,'Print grouping must not mutate ledger');
const many=Array.from({length:42},(_,i)=>({
  ...base,id:'INV-'+String(i).padStart(3,'0'),
  materialName:'Tấm thạch cao chịu ẩm dài có quy cách '+i+' 1220x2440',
  notes:'Đơn hàng công trình: cần đối chiếu theo mã gốc '+i,
}));
const multi=paginateWarehouseVouchers(many);
assert(multi.length>1,'Long material list must paginate A4 instead of one page per item');
assert(multi.every(p=>p.rows.length>=1));
assert.equal(multi.reduce((total,page)=>total+page.rows.length,0),42,'Pagination cannot drop lines');
assert(multi.every((p,index)=>p.pageIndex===index+1 && p.pageCount===multi.length));
assert(multi.every((p,index)=>p.rowOffset===multi.slice(0,index).reduce((total,x)=>total+x.rows.length,0)));
const renderer=fs.readFileSync('src/utils/warehouseVoucherPrint.ts','utf8');
const sheet=fs.readFileSync('src/components/WarehouseVoucherShareSheet.tsx','utf8');
assert(!renderer.includes('HNL QLTC'),'No app brand may be printed on warehouse vouchers');
assert(renderer.includes('Tên vật tư / thiết bị') && renderer.includes('Số lượng') && renderer.includes('Mã giao dịch'));
assert(sheet.includes('paginateWarehouseVouchers(chosen)'),'Export must group selected material rows');
assert(sheet.includes("allowTextFallback:false"),'Sharing files cannot silently send text instead');
console.log('Warehouse multi-line A4 grouped receipt / continuous IDs / branding golden: PASS');
