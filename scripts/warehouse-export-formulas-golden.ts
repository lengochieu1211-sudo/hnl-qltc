/** Warehouse Excel runtime Golden: verify real cached formulas and OOXML grid. */
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {strFromU8, unzipSync} from 'fflate';
import {buildWarehouseReportFiles, type WarehouseReport} from '../src/utils/warehouseCatalogReport';

// The exporter uses FileReader to share the same Blob as PNG/PDF and Excel.
// Node's test runner needs only a harmless data: URI implementation.
Object.defineProperty(globalThis, 'FileReader', {configurable:true, value:class {
  result: string|null = null;
  error: Error|null = null;
  onload: (()=>void)|null = null;
  onerror: (()=>void)|null = null;
  readAsDataURL(blob:Blob) {
    void blob.arrayBuffer().then(bytes=>{
      this.result='data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,'+Buffer.from(bytes).toString('base64');
      this.onload?.();
    }).catch(e=>{this.error=e instanceof Error?e:new Error(String(e));this.onerror?.();});
  }
}});
const meta={projectName:'Công trình Golden',projectLocation:'TP.HCM',contractorName:'An Phú',subtitle:'Kiểm tra công thức',title:'BẢNG KIỂM TRA',filePrefix:'Kiem-tra'};
async function openExcel(report:WarehouseReport){
  const files=await buildWarehouseReportFiles(report,'xlsx');
  assert.equal(files.length,1);
  const bytes=new Uint8Array(await files[0].blob.arrayBuffer());
  assert(bytes.length>2000);
  const sheet=XLSX.read(bytes,{type:'array',cellFormula:true});
  const ws=sheet.Sheets[sheet.SheetNames[0]];
  const zip=unzipSync(bytes);
  const sheetXml=strFromU8(zip['xl/worksheets/sheet1.xml']);
  const styleXml=strFromU8(zip['xl/styles.xml']);
  const workbookXml=strFromU8(zip['xl/workbook.xml']);
  assert.match(styleXml,/<borders count="2">/, 'Grid lines must survive real XLSX export');
  assert.match(workbookXml,/calcMode="auto"/, 'Editing input should recalculate formulas');
  assert.match(sheetXml,/<pane ySplit="7"/, 'Filter headers and labels must stay frozen');
  return {ws,sheetXml,styleXml};
}
const order=await openExcel({...meta,columns:[
  {label:'STT',width:37},{label:'Vật tư / thiết bị',width:230},{label:'ĐVT',width:55},
  {label:'SL đặt',width:69,numeric:true},{label:'KL/đv (kg)',width:82,numeric:true},
  {label:'Thành KL (kg)',width:95,numeric:true},{label:'Tỷ trọng KL (%)',width:78,numeric:true}
],rows:[[1,'Ty ren M8','cái',20000,0.03,600,100],[2,'Tấm chưa đo','tấm',6,'Chưa có','Chưa có','']],
  totalRow:['TỔNG CỘNG KHỐI LƯỢNG (CHƯA ĐỦ)','','','','',600,100],orderWeightFormulas:true});
assert.match(order.ws.F8?.f||'',/D8\*E8/,'Order weight must use quantity x unit kg');
assert.equal(order.ws.F8?.v,600,'Cached kg value retains numeric result');
assert.match(order.ws.G8?.f||'',/F8\/\$F\$10\*100/,'Order percentage uses sum absolute reference');
assert.match(order.ws.F10?.f||'',/SUM\(F8:F9\)/,'Order total is SUM of dynamic weights');
assert.match(order.ws.A10?.f||'',/COUNTIF\(F8:F9/, 'Incomplete warning is dynamic when unit kg is edited');
assert.equal(order.ws.A10?.v,'TỔNG CỘNG KHỐI LƯỢNG (CHƯA ĐỦ)');
assert.equal(order.ws.F9?.v,'Chưa có', 'Missing mass cannot be silently converted to zero');
assert.match(order.sheetXml,/mergeCell ref="A10:E10"/, 'Summary label is visible in first cell of merged total');

const catalog=await openExcel({...meta,columns:[
  {label:'STT',width:32},{label:'Tên vật tư / thiết bị',width:210},
  {label:'Chủng loại',width:120},{label:'ĐVT',width:50},
  {label:'Tổng nhập',width:66,numeric:true},{label:'Tổng xuất',width:66,numeric:true},
  {label:'Nhu cầu ĐM',width:76,numeric:true},{label:'Tồn kho',width:70,numeric:true},
  {label:'Nhập / ĐM (%)',width:79,numeric:true}
],rows:[[1,'Tấm thạch cao','Vật tư','tấm',120,30,200,90,60],[2,'Máy khoan','Thiết bị','cái',4,1,'—',3,'—']],catalogStockFormulas:true});
assert.match(catalog.ws.H8?.f||'',/E8-F8/, 'Catalog stock balance is a live Excel formula');
assert.equal(catalog.ws.H8?.v,90);
assert.match(catalog.ws.I8?.f||'',/E8\/G8\*100/, 'Catalog norm percentage is a live Excel formula');
assert.equal(catalog.ws.I8?.v,60);
assert.equal(catalog.ws.G9?.v,'—','Equipment norm is not invented');
assert.equal(catalog.ws.I9?.v,'—','Equipment percent with no norm remains unavailable');
assert.match(catalog.ws.H9?.f||'',/E9-F9/);
console.log('WAREHOUSE REAL XLSX GOLDEN PASS — dynamic weights/SUM/percent, catalog stock/norm%, missing values, OOXML borders and frozen header');
