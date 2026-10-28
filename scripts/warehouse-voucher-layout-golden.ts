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
const printed=fs.readFileSync('src/utils/warehouseVoucherPrint.ts','utf8');
const warehouse=fs.readFileSync('src/components/WarehouseTab.tsx','utf8');
const app=fs.readFileSync('src/App.tsx','utf8');
assert(app.includes('projectName={projectName}') && app.includes('projectLocation={projectLocation}') && app.includes('contractorName={contractorName}'),
  'Active project metadata must be passed from App to warehouse');
assert(warehouse.includes('projectName={projectName}') && warehouse.includes('projectLocation={projectLocation}') && warehouse.includes('contractorName={contractorName}'),
  'Warehouse must provide active project metadata to printed vouchers');
assert(sheet.includes('drawWarehouseVoucherPage(page, { projectName, projectLocation, contractorName }, options)'),
  'Both PNG and PDF render must receive project metadata');
assert(renderer.includes("ctx.fillText('Công trình:', LEFT, 83)")
  && renderer.includes("ctx.fillText('Địa điểm:', LEFT, 123)")
  && !renderer.includes("ctx.fillText('Đơn vị:")
  && !renderer.includes("ctx.fillText('Bộ phận:"),
  'Voucher headings must use project name/location instead of generic empty unit/department');
assert(renderer.includes("ctx.fillText('Đơn vị thi công:', LEFT, 166)") && renderer.includes('if (contractor) {'),
  'Only show contractor when active project contractorName is available');
assert(renderer.includes('const tableTop = TABLE_TOP + headerShift'),
  'Optional contractor header must move the table down without overlapping it');
assert(!warehouse.includes('data-hnl-voucher-share-id='),'Per-journal export action must be removed');
assert(warehouse.includes('data-hnl-warehouse-export-open="all"'),'Central journal export action must remain');
assert(!sheet.includes('initialVoucherId'),'Central export should not assume one item on open');
assert(printed.includes('handlerValueX = Math.ceil(LEFT + ctx.measureText('),
  'Printed handler value must not overlap its longer generic label');
assert(printed.includes("ctx.fillText('Người thực hiện:', LEFT, 346 + headerShift)"),
  'Legacy generic handler must not be assigned an unverified sender or recipient role');
assert(!printed.includes('drawTextLines(ctx, id') && printed.includes('const BASE_COLUMN_WIDTHS = [62, 742, 134, 174]'),
  'PNG voucher must show four columns and no printed internal IDs');
assert(printed.includes("ctx.textBaseline = 'middle'")
  && printed.includes('const centerY = rowTop + h / 2')
  && printed.includes("ctx.fillText(label, x + COLUMN_WIDTHS[index] / 2, tableTop + 63 / 2"),
  'Printed PNG table should center headings and every cell vertically');
assert(fs.readFileSync('src/utils/warehouseVoucherTextPdf.ts','utf8').includes("baseline:'middle'")
  && fs.readFileSync('src/utils/warehouseVoucherTextPdf.ts','utf8').includes('const centerY = y + data.height/2'),
  'Searchable PDF should center headings and every cell vertically without rasterizing text');
assert(printed.includes('Math.min(rowTop + 60 + 110, HEIGHT - 180)'),
  'Signature section should stay near the last table row with bottom-page safety');

assert(!renderer.includes('HNL QLTC'),'No app brand may be printed on warehouse vouchers');
assert(renderer.includes('Tên vật tư / thiết bị') && renderer.includes('Số lượng') && !renderer.includes('Mã tham chiếu'),
  'Printed PNG voucher must omit Mã tham chiếu');
assert(sheet.includes('paginateWarehouseVouchers(chosen,options)'),'Export must group selected material rows');
assert(sheet.includes("allowTextFallback:false"),'Sharing files cannot silently send text instead');
assert(sheet.includes('Chia sẻ phiếu nhập/xuất kho') && warehouse.includes('Chia sẻ phiếu nhập/xuất kho'),
  'Warehouse share action and dialog must use one concise label');
assert(!sheet.includes("['text','Nội dung',FileText]") && !sheet.includes('data-hnl-voucher-action="text-copy"')
  && sheet.includes('data-hnl-voucher-formats="unified"')
  && sheet.includes('data-hnl-export-format-count="4"')
  && sheet.includes('grid-cols-2 gap-2')
  && sheet.includes('min-[960px]:grid-cols-[repeat(4,112px)]'),
  'Voucher share must preserve three export formats plus optional settings, without Content');
assert(sheet.includes('data-hnl-voucher-date-range="compact"')
  && (sheet.match(/max-w-\[158px\]/g) || []).length === 2
  && sheet.includes('data-hnl-voucher-action-buttons="unified"')
  && sheet.includes('grid grid-cols-2 gap-2'),
  'Date inputs stay compact; paired share/download actions use equal-sized columns');
assert(sheet.includes("['png','Ảnh',ImageIcon,")
  && sheet.includes("['xlsx','Excel',FileSpreadsheet,") && sheet.includes("['pdf','PDF',FileDown,"),
  'Preserve Image/Excel/PDF formats and their export paths after attaching per-button color styles');
assert(sheet.includes("'bg-sky-600 hover:bg-sky-700")
  && sheet.includes("'bg-green-600 hover:bg-green-700")
  && sheet.includes("'bg-red-600 hover:bg-red-700")
  && sheet.includes('data-hnl-voucher-format={format}')
  && sheet.includes('voucherActionPalette[menu].download')
  && sheet.includes('voucherActionPalette[menu].share'),
  'Outer format buttons and inner actions must share sky/green/red palette and equal column layouts');

assert(sheet.includes('data-hnl-voucher-action-menu') && sheet.includes('fixed inset-0 z-[160]')
  && sheet.includes('createPortal(') && sheet.includes('document.body'),
  'The share/download menu must be viewport-fixed, not appended offscreen below form');
const excel = fs.readFileSync('src/utils/warehouseVoucherExcel.ts', 'utf8');
for (const heading of ['Công trình:', 'Địa điểm:', 'PHIẾU NHẬP KHO', 'PHIẾU XUẤT KHO',
  'Kho / Vị trí:', 'Người thực hiện:', 'Mã tham chiếu', 'Người lập phiếu', 'Thủ kho']) {
  assert(excel.includes(heading), 'Excel must preserve voucher paper heading ' + heading);
}
assert(excel.includes('hidden:true') && excel.includes('page.rows.forEach') && excel.includes('item.id')
  && excel.includes('Number(item.quantity || 0)'),
  'Excel must retain full line IDs and numeric quantities without affecting warehouse data');

const searchablePdf=fs.readFileSync('src/utils/warehouseVoucherTextPdf.ts','utf8');
assert(searchablePdf.includes("addFileToVFS('VoucherRoboto.ttf'")
    && searchablePdf.includes('doc.addFont(')
    && searchablePdf.includes('doc.text(')
    && !searchablePdf.includes('doc.addImage('),
  'PDF must have Unicode native text; a full-page PNG is not searchable');
assert(sheet.includes('buildWarehouseVoucherTextPdf(pages, {projectName, projectLocation, contractorName}, options)'),
  'Warehouse PDF exporter must use native text renderer and the active project metadata');
assert(searchablePdf.includes('item.quantity')
  && searchablePdf.includes('Người lập phiếu') && !searchablePdf.includes('Mã tham chiếu')
  && searchablePdf.includes('const COL=[10,RIGHT-LEFT-10-24-40,24,40]'),
  'Text PDF must retain quantities/signatures but no visible technical IDs');
console.log('Warehouse multi-line A4 grouped receipt / continuous IDs / branding golden: PASS');

for(const token of ['data-hnl-voucher-export-options="toggle"','data-hnl-voucher-export-options="form"','Khổ giấy chia sẻ phiếu kho','Hướng giấy chia sẻ phiếu kho','Co giãn phiếu kho','prepareVoucherFiles(chosen,format,projectName,projectLocation,contractorName,options)'])assert(sheet.includes(token),'Voucher options missing: '+token);
assert(fs.readFileSync('src/utils/warehouseVoucherTextPdf.ts','utf8').includes("format:options.paperSize.toLowerCase()"),'PDF paper size must be real, not UI-only');
assert(excel.includes('const pageSetup=') && excel.includes('fitToWidth'),'Excel print settings must be serialized to OOXML');
assert(excel.includes('new Uint8Array(raw)'),'SheetJS ArrayBuffer must be converted to Uint8Array before fflate ZIP processing');
