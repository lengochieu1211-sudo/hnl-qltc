import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { exportAllToExcelBase64 } from '../src/utils/excelExport';
import type { WorkVolume } from '../src/types';

const workVolume = {
  id: 'wv-formula-1',
  workCategoryId: 'wc-formula-1',
  title: 'Trần thạch cao',
  floor: 'Tầng 1',
  category: 'Trần',
  unit: 'm²',
  planned: 100,
  actual: 25,
  unitPrice: 200000,
  inputExpressions: { planned: '25*4', unitPrice: '100000*2' },
  status: 'Đang thi công',
} as WorkVolume;

const base64 = exportAllToExcelBase64({
  projectName: 'Formula Golden',
  inventory: [],
  materialNorms: [],
  workVolumes: [workVolume],
  roomProgressList: [],
  defects: [],
  checklist: [],
  floorPlans: [],
  canViewFinancials: true,
  selectedModules: {
    inventory: false,
    workVolumes: true,
    floorPlan: false,
    checklist: false,
    crew: false,
  },
});

const wb = XLSX.read(base64, { type: 'base64', cellFormula: true });
const ws = wb.Sheets['Khoi Luong Thi Cong'];
assert.ok(ws, 'Work Volume worksheet must exist');

const headerColumn = (header: string) => {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
    if (String(cell?.v ?? '') === header) return c;
  }
  return -1;
};

const plannedCol = headerColumn('Khối lượng kế hoạch');
const actualCol = headerColumn('Khối lượng thực hiện (chỉ xem - không nhập lại)');
const priceCol = headerColumn('Đơn Giá (VNĐ)');
const amountCol = headerColumn('Thành Tiền (VNĐ)');
const progressCol = headerColumn('Tiến Độ (%)');
assert.ok([plannedCol, actualCol, priceCol, amountCol, progressCol].every((value) => value >= 0), 'Derived Work Volume columns must exist');

const row = 2;
const plannedCell = `${XLSX.utils.encode_col(plannedCol)}${row}`;
const actualCell = `${XLSX.utils.encode_col(actualCol)}${row}`;
const priceCell = `${XLSX.utils.encode_col(priceCol)}${row}`;
const plannedInputCell = ws[XLSX.utils.encode_cell({ r: 1, c: plannedCol })];
const priceInputCell = ws[XLSX.utils.encode_cell({ r: 1, c: priceCol })];
const amountCell = ws[XLSX.utils.encode_cell({ r: 1, c: amountCol })];
const progressCell = ws[XLSX.utils.encode_cell({ r: 1, c: progressCol })];

assert.equal(plannedInputCell?.f, '25*4', 'User-entered planned expression must remain a real Excel formula');
assert.equal(Number(plannedInputCell?.v), 100, 'Planned formula must retain its cached numeric value');
assert.equal(priceInputCell?.f, '100000*2', 'User-entered unit-price expression must remain a real Excel formula');
assert.equal(Number(priceInputCell?.v), 200000, 'Unit-price formula must retain its cached numeric value');
assert.equal(amountCell?.f, `${actualCell}*${priceCell}`, 'Amount must remain a real Excel formula');
assert.equal(Number(amountCell?.v), 5_000_000, 'Amount must keep the current cached numeric value');
assert.equal(progressCell?.f, `IF(${plannedCell}>0,${actualCell}/${plannedCell}*100,0)`, 'Progress must remain a real Excel formula');
assert.equal(Number(progressCell?.v), 25, 'Progress must keep the current cached numeric value');

const exportSource = readFileSync(new URL('../src/utils/excelExport.ts', import.meta.url), 'utf8');
assert.match(exportSource, /applyWarehouseStockFormulas/, 'Warehouse summary must have derived formula support');
assert.match(exportSource, /Định Mức Tổng Kế Hoạch/, 'Warehouse Excel must distinguish total planned norm from scoped need');
assert.match(exportSource, /Còn Cần Theo Kế Hoạch/, 'Warehouse Excel must label planned remaining need explicitly');
assert.match(exportSource, /fullCalcOnLoad: true/, 'Workbook must request recalculation when opened in Excel');

console.log('EXCEL USER + DERIVED FORMULA GOLDEN PASS');
