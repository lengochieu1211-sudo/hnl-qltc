import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import * as XLSX from 'xlsx';
import type { InventoryItem } from '../src/types';
import { paginateWarehouseVouchers } from '../src/utils/warehouseVoucherPrint';
import { buildWarehouseVoucherExcel } from '../src/utils/warehouseVoucherExcel';

/** Read-only generated XLSX regression for DEV Backup. No Firebase/R2 access. */
const records: InventoryItem[] = Array.from({ length: 42 }, (_, i) => ({
  id: 'QA-IN-' + String(i + 1).padStart(3, '0'),
  type: 'in', itemKind: 'material',
  materialName: 'Tấm thạch cao ' + i + ' 1220x2440',
  notes: i % 3 === 0 ? 'Lưu kho A, mã ' + i : '',
  unit: 'Tấm', quantity: i === 0 ? 2.125 : i + 0.5,
  date: '2026-10-28', location: 'Kho QA cô lập', handler: 'Thủ kho QA',
}));
records.push({
  id: '=SUM(A1:A2)', type: 'out', itemKind: 'material',
  materialName: 'Ty ren M8', unit: 'Cây', quantity: 12.375,
  date: '2026-10-28', location: 'Kho QA cô lập', handler: 'Thủ kho QA',
});
const original = JSON.stringify(records);
const matrix = [
  { paperSize: 'A4' as const, orientation: 'portrait' as const, fit: 'one' as const, expectedPaper: 9 },
  { paperSize: 'A4' as const, orientation: 'landscape' as const, fit: 'split' as const, expectedPaper: 9 },
  { paperSize: 'A3' as const, orientation: 'portrait' as const, fit: 'one' as const, expectedPaper: 8 },
  { paperSize: 'A3' as const, orientation: 'landscape' as const, fit: 'split' as const, expectedPaper: 8 },
];
const completed = [];
for (const opts of matrix) {
  const pages = paginateWarehouseVouchers(records, opts);
  assert(pages.length >= 2, 'Must retain receipt and issue sheets');
  const result = await buildWarehouseVoucherExcel(pages, {
    projectName: 'Dự án QA', projectLocation: 'TP.HCM', contractorName: 'An Phú',
  }, opts);
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  assert(bytes.byteLength > 3000 && bytes[0] === 0x50 && bytes[1] === 0x4b, 'XLSX must be nonzero ZIP');
  const zip = unzipSync(bytes);
  const style = strFromU8(zip['xl/styles.xml']);
  assert.match(style, /<fonts count="6">/);
  assert.match(style, /<fills count="5">/);
  assert.match(style, /<borders count="2">/);
  const wb = XLSX.read(bytes, { type: 'array', cellStyles: true, cellFormula: true });
  assert.equal(wb.SheetNames.length, pages.length);
  const allIds: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const xml = strFromU8(zip['xl/worksheets/sheet' + (i + 1) + '.xml']);
    const expected = '<pageSetup paperSize="' + opts.expectedPaper +
      '" orientation="' + opts.orientation + '" fitToWidth="1" fitToHeight="' +
      (opts.fit === 'one' ? '1' : '0') + '"/>';
    assert(xml.includes(expected), 'Wrong print setup: ' + expected);
    assert(xml.includes('<pageSetUpPr fitToPage="1"/>'));
    assert.match(xml, /<col[^>]+hidden="(?:1|true)"/, 'Source ID column must stay hidden');
    assert.match(xml, /<pane ySplit="9"/, 'Header must remain frozen');
    const sheet = wb.Sheets[wb.SheetNames[i]];
    assert.equal(sheet['!cols']?.[4]?.hidden, true);
    const summaryZeroIndex = 9 + pages[i].rows.length;
    const summaryRef = String(summaryZeroIndex + 1);
    assert.equal(sheet['A'+summaryRef]?.v, 'Số dòng trên trang: ' + pages[i].rows.length,
      'Must preserve correct sheet-specific count on mobile');
    assert.equal(sheet['C'+summaryRef]?.v, 'Số liệu theo đơn vị từng dòng, không cộng khác ĐVT',
      'Must preserve readable note on mobile');
    assert(sheet['!cols']?.[0]?.wch >= 16, 'Mobile STT/metadata column is too narrow');
    assert(sheet['!rows']?.[summaryZeroIndex]?.hpt >= 60, 'Mobile summary height is too small');
    assert(sheet['!merges']?.some(m=>m.s.r===summaryZeroIndex&&m.s.c===0&&m.e.c===1),
      'Mobile summary count should span A:B');
    assert(sheet['!merges']?.some(m=>m.s.r===summaryZeroIndex&&m.s.c===2&&m.e.c===3),
      'Mobile summary explanation should span C:D');
    assert(!sheet['!merges']?.some(m=>m.s.r===summaryZeroIndex&&m.e.c>=4),
      'Mobile summary must not merge into hidden E');
    for (let j = 0; j < pages[i].rows.length; j++) {
      assert.equal(sheet['E' + (j + 10)]?.v, pages[i].rows[j].id);
      assert.equal(sheet['E' + (j + 10)]?.f, undefined, 'IDs must not execute as formulas');
      assert.equal(sheet['D' + (j + 10)]?.v, pages[i].rows[j].quantity);
      allIds.push(String(sheet['E' + (j + 10)]?.v));
    }
  }
  assert.deepEqual(allIds.sort(), records.map(r => r.id).sort(), 'No dropped/duplicated transaction IDs');
  assert.equal(JSON.stringify(records), original, 'Inventory ledger must not mutate');
  completed.push({ paper: opts.paperSize, orientation: opts.orientation, fit: opts.fit, sheets: pages.length, bytes: bytes.length });
}
console.log('PASS DEV BACKUP XLSX A3/A4 multi-sheet print and ID/no-data-mutation matrix', JSON.stringify(completed));
