import type { WarehouseVoucherPrintPage } from './warehouseVoucherPrint';
import { formatDateDDMMYYYY } from './dateFormatter';
import { formatDecimal } from './numberUtils';

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
 * areas as the PNG/PDF version. All business IDs and quantities remain intact;
 * no new receipt number, warehouse write or synthetic recipient is introduced.
 */
export async function buildWarehouseVoucherExcel(pages: WarehouseVoucherPrintPage[], project: WarehouseVoucherProject = {}) {
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
    row(['Người lập phiếu',null,page.direction === 'in' ? 'Người giao hàng' : 'Người nhận hàng',null,'Thủ kho'], 30);
    row(['(Ký, ghi rõ họ tên)',null,'(Ký, ghi rõ họ tên)',null,'(Ký, ghi rõ họ tên)'], 24);
    row([], 62);
    row(['Mã tham chiếu từng dòng giữ nguyên ID giao dịch gốc để đối chiếu'], 26);
    merge(table.length-1,0,4);

    const ws = XLSX.utils.aoa_to_sheet(table);
    ws['!merges'] = merges;
    ws['!cols'] = [{wch:9},{wch:62},{wch:16},{wch:17},{wch:38}];
    ws['!rows'] = rowHeights.map(hpt=>({hpt}));
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
  const bytes = XLSX.write(wb,{bookType:'xlsx',type:'array'});
  const blob = new Blob([bytes],{type:WAREHOUSE_EXCEL_MIME});
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
