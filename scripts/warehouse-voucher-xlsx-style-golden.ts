import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import * as XLSX from 'xlsx';
import type { InventoryItem } from '../src/types';
import { paginateWarehouseVouchers } from '../src/utils/warehouseVoucherPrint';
import { buildWarehouseVoucherExcel } from '../src/utils/warehouseVoucherExcel';

/** Actual XLSX integration test, not a test of SheetJS worksheet `.s` objects. */
const sample: InventoryItem[] = [
  { id:'IN-2026-001', type:'in', itemKind:'material', materialName:'Tấm thạch cao chịu ẩm 1220×2440', notes:'Sắp xếp trong kho A', unit:'Tấm', quantity:1234.5, date:'2026-10-28', location:'Kho công trình', handler:'Nguyễn Văn A' },
  { id:'=SUM(A1:A2)', type:'in', itemKind:'material', materialName:'Ty ren M8', unit:'Cây', quantity:2.125, date:'2026-10-28', location:'Kho công trình', handler:'Nguyễn Văn A' },
  { id:'OUT-2026-001', type:'out', itemKind:'material', materialName:'Thép V50×50', unit:'Cây', quantity:8, date:'2026-10-28', location:'Kho công trình', handler:'Nguyễn Văn A' },
];
const before = JSON.stringify(sample);
const pages = paginateWarehouseVouchers(sample);
assert.equal(pages.length,2,'one receipt sheet, one issue sheet');

const sheetResult = await buildWarehouseVoucherExcel(pages,{
  projectName:'Dự án thử nghiệm - Kiểm tra định dạng Excel',projectLocation:'TP.HCM',contractorName:'Công ty An Phú',
}, { paperSize:'A4', orientation:'portrait', fit:'one' });
assert.equal(sheetResult.fileName,'PHIEU_NHAP_XUAT_KHO_2_TRANG.xlsx');
assert(sheetResult.blob.size>1000,'Excel output must not be 0 bytes');
assert.equal(JSON.stringify(sample),before,'no mutation of input inventory ledger');

const bytes=new Uint8Array(await sheetResult.blob.arrayBuffer());
const zip=unzipSync(bytes);
const styles=strFromU8(zip['xl/styles.xml']);
assert.match(styles,/<cellXfs count="15">/,'real OOXML styles must be present');
assert.match(styles,/<borders count="2">/,'thin grid borders must be embedded');
assert.match(styles,/rgb="FFE2E8F0"/,'header fill matching Warehouse Catalog and Order');
assert.match(styles,/rgb="FFF8FAFC"/,'alternate row fill matching Warehouse Catalog');
assert.match(styles,/<alignment horizontal="center" vertical="center" wrapText="1"/,'titles centered and long cells wrapped');

for (const [i,page] of pages.entries()){
  const xml=strFromU8(zip[`xl/worksheets/sheet${i+1}.xml`]);
  assert.match(xml,/<pageSetUpPr fitToPage="1"\/>/,'print fit-to-page preserved');
  assert.match(xml,/<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1"\/>/,'A4 portrait print matches PDF setting');
  assert.match(xml,/<col[^>]+hidden="(?:1|true)"/,'internal E-column IDs remain hidden');
  assert.match(xml,/<pane ySplit="9"/,'repeating visual headers remain visible while scrolling');
  assert.match(xml,/<c r="A4" s="1"/,'large bold title style');
  assert.match(xml,/<c r="B9" s="5"/,'styled header is actually written into sheet XML');
  assert.match(xml,/<c r="B10" s="6"/,'material description left-aligned, bordered');
  assert.match(xml,/<c r="D10" s="7"/,'numeric quantity centered and bordered');
  if (i===0){
    assert.match(xml,/<c r="B11" s="8"/,'second material row gets zebra stripe');
    assert.match(xml,/<c r="D11" s="9"/,'second quantity gets zebra stripe');
  }
  assert(!xml.includes('HNL QLTC'),'voucher should not include app branding');
  assert(page.rows.length>0);
}
const decoded=XLSX.read(bytes,{type:'array',cellStyles:true});
assert.equal(decoded.SheetNames.length,pages.length,'one worksheet per original PDF voucher page');
const first=decoded.Sheets[decoded.SheetNames[0]];
const second=decoded.Sheets[decoded.SheetNames[1]];
assert.equal(first['B10']?.v, 'Tấm thạch cao chịu ẩm 1220×2440\nGhi chú: Sắp xếp trong kho A','keep multiline notes');
assert.equal(first['D10']?.v,1234.5,'numeric quantity must preserve full precision');
assert.equal(first['D11']?.v,2.125,'noninteger quantity must not be rounded');
assert.equal(first['E10']?.v,'IN-2026-001','retain source transaction IDs');
assert.equal(first['E11']?.v,'=SUM(A1:A2)','formula-looking ID must remain inert text');
assert.equal(first['E11']?.f,undefined,'never execute untrusted worksheet ID as formula');
const mobileSummaryRow = 9 + pages[0].rows.length; // zero-based
const mobileSummaryRef = mobileSummaryRow + 1;
assert.equal(first['A'+mobileSummaryRef]?.v,'Số dòng trên trang: ' + pages[0].rows.length,
  'mobile summary count must keep the exact value');
assert.equal(first['C'+mobileSummaryRef]?.v,'Số liệu theo đơn vị từng dòng, không cộng khác ĐVT',
  'mobile summary explanation must remain visible');
assert(first['!cols']?.[0]?.wch >= 16,'mobile A labels must not be trapped in 9-character STT column');
assert(first['!rows']?.[mobileSummaryRow]?.hpt >= 60,
  'mobile summary line wrapping needs enough row height');
assert(first['!merges']?.some(m=>m.s.r===mobileSummaryRow&&m.s.c===0&&m.e.c===1),
  'summary count must span A:B, leaving value and ID intact');
assert(first['!merges']?.some(m=>m.s.r===mobileSummaryRow&&m.s.c===2&&m.e.c===3),
  'summary note must span C:D without depending on hidden E');
assert(!first['!merges']?.some(m=>m.s.r===mobileSummaryRow&&m.e.c>=4),
  'summary must not merge into hidden technical ID column');
assert.equal(second['E10']?.v,'OUT-2026-001','issue transaction must keep its ID');
assert(decoded.SheetNames.some(n=>n.startsWith('NHAP'))&&decoded.SheetNames.some(n=>n.startsWith('XUAT')));

// The export is used by BOTH native Share and Download, so there must be one source.
const share=fs.readFileSync('src/components/WarehouseVoucherShareSheet.tsx','utf8');
assert.match(share,/buildWarehouseVoucherExcel\(pages, \{projectName, projectLocation, contractorName\}, options\)/);
assert.match(share,/if \(format === 'xlsx'\)/);
const src=fs.readFileSync('src/utils/warehouseVoucherExcel.ts','utf8');
assert.match(src,/styleWarehouseVoucherXlsx\(zipSync\(zip,\{level:6\}\),styledLayouts\)/,'serialized XLSX styling must be integrated');
console.log('PASS: warehouse receipt/issue share Excel: real OOXML fonts/fills/borders, multi-sheet PDF-style layout, A4, precise quantities, hidden IDs, safe text, no inventory mutation');
