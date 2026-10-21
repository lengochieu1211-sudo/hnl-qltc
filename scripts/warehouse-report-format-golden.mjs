#!/usr/bin/env node
/** Golden: no Firebase/browser needed. Verifies real styled worksheet XML bytes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { styleWarehouseReportXlsx } from '../src/utils/warehouseReportXlsxStyle.ts';
const entry = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C5"/><sheetData><row r="1"><c r="A1" t="str"><v>Phiếu kho</v></c></row><row r="2"><c r="A2" t="str"><v>Công trình</v></c></row><row r="3"><c r="A3" t="str"><v>Ghi chú</v></c></row><row r="4"><c r="A4" t="str"><v>STT</v></c><c r="B4" t="str"><v>Vật tư</v></c><c r="C4" t="str"><v>KL</v></c></row><row r="5"><c r="A5"><v>1</v></c><c r="B5" t="str"><v>Thép</v></c><c r="C5"><v>20.5</v></c></row></sheetData></worksheet>';
const source=zipSync({'xl/worksheets/sheet1.xml':strToU8(entry),'xl/styles.xml':strToU8('<styleSheet/>')});
const out=styleWarehouseReportXlsx(source,{columnCount:3,headerRow:3,rowCount:1,numericColumns:[2],centerColumns:[0]});
const zip=unzipSync(out);const ws=strFromU8(zip['xl/worksheets/sheet1.xml']),styles=strFromU8(zip['xl/styles.xml']);
assert.match(ws,/<c r="A1" s="1"/,'title is centered');
assert.match(ws,/<c r="B4" s="4"/,'column header is centered');
assert.match(ws,/<c r="A5" s="6"/,'STT is centered');
assert.match(ws,/<c r="B5" s="5"/,'text body stays left');
assert.match(ws,/<c r="C5" s="7"/,'numeric body stays right');
assert.match(ws,/ySplit="4"/,'header rows are frozen');
assert.match(styles,/<borders count="2">/,'thin cell borders actually embedded');
assert.match(styles,/rgb="FFE2E8F0"/,'warehouse voucher header fill embedded');
assert.match(styles,/vertical="center"/,'vertical centering survives XLSX archive');
assert.match(styles,/<cellXfs count="12">/,'body/header/stripe/warning styles embedded');
assert.throws(()=>styleWarehouseReportXlsx(source,{columnCount:0,headerRow:3,rowCount:1}),/không hợp lệ/);
const report=readFileSync(new URL('../src/utils/warehouseCatalogReport.ts',import.meta.url),'utf8');
assert.match(report,/function reportCanvases/, 'PNG must use shared warehouse report schema');
assert.match(report,/baseline:'middle'/,'PDF header and cell vertical alignment must be centered');
assert.match(report,/ctx\.textBaseline='middle'/,'PNG header and cell vertical alignment must be centered');
assert.match(report,/const align=alignColumn\(report,i\)/,'PDF and PNG use shared cell alignment');
assert.match(report,/styleWarehouseReportXlsx\(/,'Excel must serialize actual cells styles');
assert.match(report,/if\(index===report\.rows\.length\)/,'PNG summary only on the last page');
console.log('Warehouse report format golden: PASS — voucher palette, centered PNG/PDF, OOXML cell grid/fill/alignment and freeze');
