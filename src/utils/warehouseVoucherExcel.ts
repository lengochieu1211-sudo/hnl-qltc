import type { WarehouseVoucherPrintPage } from './warehouseVoucherPrint';
import { formatDateDDMMYYYY } from './dateFormatter';
import { formatDecimal } from './numberUtils';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {resolveVoucherPaper,DEFAULT_VOUCHER_PAGE_OPTIONS} from './warehouseVoucherPrint';
import type { WarehousePageOptions } from './warehouseCatalogReport';

export const WAREHOUSE_EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type WarehouseVoucherProject = {
  projectName?: string;
  projectLocation?: string;
  contractorName?: string;
};

const clean = (value: unknown) => String(value ?? '').trim();
const textCell = (value: unknown) => clean(value) || '—';

/**
 * A4 voucher worksheet: same facts, column order, page grouping and signature
 * areas as the PNG/PDF version. The technical ID column is hidden, never deleted;
 * no new receipt number, warehouse write or synthetic recipient is introduced.
 */
export async function buildWarehouseVoucherExcel(pages: WarehouseVoucherPrintPage[], project: WarehouseVoucherProject = {}, options: WarehousePageOptions = DEFAULT_VOUCHER_PAGE_OPTIONS) {
  if (!pages.length) throw new Error('Chưa có phiếu kho để xuất Excel.');
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  for (const [index, page] of pages.entries()) {
    const table: Array<Array<string | number | null>> = [];
    const merges: Array<{s:{r:number;c:number};e:{r:number;c:number}}> = [];
    const rowHeights: number[] = [];
    const row = (cells: Array<string | number | null>, height = 25) => {
      table.push([...cells, ...Array<null>(Math.max(0, 5 - cells.length)).fill(null)]);
      rowHeights.push(height);
    };
    const merge = (atRow: number, first: number, last: number) => {
      if (last > first) merges.push({s:{r:atRow,c:first},e:{r:atRow,c:last}});
    };
    row(['Công trình:', textCell(project.projectName)], 29); merge(0,1,4);
    row(['Địa điểm:', textCell(project.projectLocation)], 29); merge(1,1,4);
    if (clean(project.contractorName)) {
      row(['Đơn vị thi công:', clean(project.contractorName)], 29); merge(table.length-1,1,4);
    }
    row([page.direction === 'in' ? 'PHIẾU NHẬP KHO' : 'PHIẾU XUẤT KHO'], 38);
    merge(table.length-1,0,4);
    row(['Ngày ' + formatDateDDMMYYYY(page.date) + '  •  Trang ' + page.pageIndex + '/' + page.pageCount], 29);
    merge(table.length-1,0,4);
    row(['Kho / Vị trí:', textCell(page.location)], 28); merge(table.length-1,1,4);
    row(['Người thực hiện:', textCell(page.handler)], 28); merge(table.length-1,1,4);
    row([], 13);
    const headerRow = table.length;
    row(['STT','Tên vật tư / thiết bị (quy cách, ghi chú)','ĐVT','Số lượng','Mã tham chiếu'], 38);
    const firstDataRow = table.length;
    page.rows.forEach((item, itemIndex) => {
      const notes = clean(item.notes);
      const material = textCell(item.materialName) + (notes ? '\nGhi chú: ' + notes : '');
      row([page.rowOffset + itemIndex + 1, material, textCell(item.unit), Number(item.quantity || 0), textCell(item.id)], Math.max(35, 20 + Math.ceil(material.length/48)*16, 20 + Math.ceil(clean(item.id).length/28)*16));
    });
    const lastDataRow = table.length - 1;
    row(['Số dòng trên trang: ' + page.rows.length, 'Số liệu theo đơn vị từng dòng, không cộng khác ĐVT'], 31);
    merge(table.length-1,1,4);
    row([], 32);
    row(['Người lập phiếu',null,page.direction === 'in' ? 'Người giao hàng' : 'Người nhận hàng','Thủ kho',null], 30);
    row(['(Ký, ghi rõ họ tên)',null,'(Ký, ghi rõ họ tên)','(Ký, ghi rõ họ tên)',null], 24);
    row([], 62);
    row(['Chi tiết giao dịch và mã nội bộ được lưu trong phần mềm'], 26);
    merge(table.length-1,0,4);

    const ws = XLSX.utils.aoa_to_sheet(table);
    ws['!merges'] = merges;
    // Hide technical source IDs on print/display while retaining exact values in E.
    ws['!cols'] = [{wch:9},{wch:62},{wch:16},{wch:17},{wch:38,hidden:true}];
    ws['!rows'] = rowHeights.map(hpt=>({hpt}));
    // Mirror the A4 cell alignment rules in the worksheet model:
    // headings centered; STT/ĐVT/quantity centered; multiline name left;
    // all content vertically middle-aligned. The hidden ID column is untouched.
    const centerStyle = {alignment:{horizontal:'center',vertical:'center',wrapText:true}} as const;
    const leftStyle = {alignment:{horizontal:'left',vertical:'center',wrapText:true}} as const;
    for (let col = 0; col < 4; col++) {
      const address = XLSX.utils.encode_cell({r:headerRow,c:col});
      const cell = ws[address];
      if (cell) cell.s = centerStyle;
    }
    for (let r = firstDataRow; r <= lastDataRow; r++) {
      for (let col = 0; col < 4; col++) {
        const address = XLSX.utils.encode_cell({r,c:col});
        const cell = ws[address];
        if (cell) cell.s = col === 1 ? leftStyle : centerStyle;
      }
    }
    const signTitle = table.findIndex(row => row[0] === 'Người lập phiếu');
    if (signTitle >= 0) {
      for (let r = signTitle; r <= signTitle+1; r++) for (let c = 0; c < 4; c++) {
        const cell = ws[XLSX.utils.encode_cell({r,c})];
        if (cell) cell.s = centerStyle;
      }
    }

    ws['!margins'] = {left:0.3,right:0.3,top:0.4,bottom:0.4,header:0.15,footer:0.15};
    ws['!autofilter'] = {ref:'A'+(headerRow+1)+':E'+Math.max(firstDataRow+1,lastDataRow+1)};
    // Preserve each user-supplied value strictly as text; do not run formula-looking
    // names, notes or IDs from imported historical transactions as Excel formulas.
    for (const cell of Object.values(ws)) {
      if (cell && typeof cell === 'object' && 't' in cell && cell.t === 's') {
        delete (cell as {f?:string}).f;
      }
    }
    const sheetName = (page.direction==='in'?'NHAP':'XUAT') + '-' + String(index+1).padStart(2,'0');
    XLSX.utils.book_append_sheet(wb,ws,sheetName);
  }
  const raw = XLSX.write(wb,{bookType:'xlsx',type:'array',cellStyles:true});
  // SheetJS type:'array' may return an ArrayBuffer; fflate requires Uint8Array.
  const bytes = new Uint8Array(raw);
  // SheetJS Community does not reliably serialize the pageSetup model; set
  // real OOXML print geometry on *generated* sheets only (preserve cell bytes/IDs).
  const zip=unzipSync(bytes);
  const {landscape}=resolveVoucherPaper(options);
  for (const path of Object.keys(zip).filter(p=>/^xl\/worksheets\/sheet\d+\.xml$/.test(p))) {
    let xml=strFromU8(zip[path]);
    xml=xml.replace(/<pageSetup\b[^>]*\/>/g,'');
    const pageSetup=`<pageSetup paperSize="${options.paperSize==='A3'?8:9}" orientation="${landscape?'landscape':'portrait'}" fitToWidth="1" fitToHeight="${options.fit==='one'?1:0}"/>`;
    if(/<pageMargins\b[^>]*\/>/.test(xml))xml=xml.replace(/(<pageMargins\b[^>]*\/>)/,`$1${pageSetup}`);
    else xml=xml.replace('</worksheet>',pageSetup+'</worksheet>');
    if(!xml.includes('<pageSetUpPr')){
      if(/<sheetPr\s*\/>/.test(xml))xml=xml.replace(/<sheetPr\s*\/>/,'<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
      else if(/<sheetPr\b[^>]*>/.test(xml))xml=xml.replace(/(<sheetPr\b[^>]*>)/,'$1<pageSetUpPr fitToPage="1"/>');
      else xml=xml.replace(/(<worksheet\b[^>]*>)/,'$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    }
    zip[path]=strToU8(xml);
  }
  const formattedBytes=zipSync(zip,{level:6});
  const blob = new Blob([formattedBytes],{type:WAREHOUSE_EXCEL_MIME});
  if (!blob.size) throw new Error('Excel phiếu kho rỗng (0 byte).');
  const fileName = 'PHIEU_NHAP_XUAT_KHO_' + pages.length + '_TRANG.xlsx';
  return {workbook:wb,blob,fileName,mimeType:WAREHOUSE_EXCEL_MIME};
}

/** Human-readable text uses exactly the same grouped pages and original UUIDs. */
export function buildWarehouseVoucherText(pages: WarehouseVoucherPrintPage[], project: WarehouseVoucherProject = {}): string {
  return pages.map(page => [
    page.direction === 'in' ? 'PHIẾU NHẬP KHO' : 'PHIẾU XUẤT KHO',
    'Công trình: ' + textCell(project.projectName),
    'Địa điểm: ' + textCell(project.projectLocation),
    ...(clean(project.contractorName) ? ['Đơn vị thi công: ' + clean(project.contractorName)] : []),
    'Ngày: ' + formatDateDDMMYYYY(page.date) + ' · Trang ' + page.pageIndex + '/' + page.pageCount,
    'Kho / Vị trí: ' + textCell(page.location),
    'Người thực hiện: ' + textCell(page.handler),
    'STT | Tên vật tư / thiết bị | ĐVT | Số lượng | Mã tham chiếu',
    ...page.rows.map((item,i) =>
      [page.rowOffset+i+1, textCell(item.materialName), textCell(item.unit), formatDecimal(Number(item.quantity || 0)), textCell(item.id)].join(' | ')
      + (clean(item.notes) ? '\nGhi chú: '+clean(item.notes) : '')),
    'Số dòng trên trang: ' + page.rows.length,
    'Người lập phiếu | ' + (page.direction === 'in' ? 'Người giao hàng' : 'Người nhận hàng') + ' | Thủ kho',
  ].join('\n')).join('\n\n-----\n\n');
}
