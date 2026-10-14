import type { jsPDF } from 'jspdf';
import type { WarehouseVoucherPrintPage } from './warehouseVoucherPrint';
import { formatDateDDMMYYYY } from './dateFormatter';
import { formatDecimal } from './numberUtils';
import { warehouseVoucherPdfFontBase64 } from './warehouseVoucherPdfFont';

type ProjectMeta = { projectName?: string; projectLocation?: string; contractorName?: string };
const safe = (value: unknown) => String(value ?? '').trim() || '—';
const W = 210, H = 297, LEFT = 12, RIGHT = 198;
// Four visible columns, keep original IDs only in persisted data/hidden Excel.
const COL = [10, 112, 24, 40] as const;
const HEADERS = ['STT', 'Tên vật tư / thiết bị (quy cách, ghi chú)', 'ĐVT', 'Số lượng'];

type TextBlock = { lines: string[]; notes: string[]; height: number };
const wrap = (doc: jsPDF, text: string, width: number, size: number) => {
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(text, width) as string[];
  return lines.length ? lines : ['—'];
};

export async function buildWarehouseVoucherTextPdf(pages: WarehouseVoucherPrintPage[], project: ProjectMeta = {}) {
  if (!pages.length) throw new Error('Chưa có phiếu kho để xuất PDF.');
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
  // Embed Unicode TrueType once; built-in 14 PDF fonts cannot encode Vietnamese.
  doc.addFileToVFS('VoucherRoboto.ttf', warehouseVoucherPdfFontBase64);
  doc.addFont('VoucherRoboto.ttf','VoucherRoboto','normal');
  doc.setFont('VoucherRoboto','normal');
  doc.setProperties({title:'Phiếu nhập/xuất kho',subject:'Phiếu kho có chữ Unicode có thể tìm kiếm',creator:'Quản lý thi công'});

  let printed = 0;
  for (const page of pages) {
    const block = page.rows.map((item): TextBlock => {
      const name = wrap(doc,safe(item.materialName),COL[1]-5,9);
      const notes = item.notes ? wrap(doc,'Ghi chú: '+String(item.notes),COL[1]-5,7.5) : [];
      const height = Math.max(11,4+name.length*4.6+notes.length*3.9);
      return {lines:name,notes,height};
    });
    let currentY = 0;
    let pageLines = 0;
    let segment = 0;
    const start = () => {
      if(printed)doc.addPage();
      printed++;
      segment++;
      doc.setFont('VoucherRoboto','normal');
      doc.setTextColor(30,41,59);
      let y = 16;
      const field = (label:string, value:string) => {
        doc.setFontSize(9.5);
        doc.setTextColor(71,85,105);
        doc.text(label,LEFT,y);
        doc.setTextColor(15,23,42);
        const lines=wrap(doc,safe(value),RIGHT-(LEFT+31),9.7);
        lines.forEach((line,i)=>doc.text(line,LEFT+31,y+i*4.8));
        y+=Math.max(6,lines.length*4.8+1);
      };
      field('Công trình:',safe(project.projectName));
      field('Địa điểm:',safe(project.projectLocation));
      if(String(project.contractorName||'').trim())field('Đơn vị thi công:',safe(project.contractorName));
      y+=6;
      doc.setFontSize(17);
      doc.setTextColor(15,23,42);
      doc.text(page.direction==='in'?'PHIẾU NHẬP KHO':'PHIẾU XUẤT KHO',W/2,y,{align:'center'});
      y+=7;
      doc.setFontSize(9.8);
      doc.setTextColor(71,85,105);
      doc.text('Ngày '+formatDateDDMMYYYY(page.date)+'  •  Trang '+page.pageIndex+'/'+page.pageCount+
        (segment>1?' (tiếp '+segment+')':''),W/2,y,{align:'center'});
      y+=6;
      doc.setDrawColor(148,163,184);
      doc.line(LEFT,y,RIGHT,y);
      y+=7;
      field('Kho / Vị trí:',safe(page.location));
      field('Người thực hiện:',safe(page.handler));
      y+=3;
      doc.setFillColor(226,232,240);
      doc.setDrawColor(148,163,184);
      doc.rect(LEFT,y,RIGHT-LEFT,9,'FD');
      let x=LEFT;
      HEADERS.forEach((label,i)=>{
        doc.setFontSize(i===1?7.7:8.3);
        doc.setTextColor(30,41,59);
        if(i) doc.line(x,y,x,y+9);
        const lines=wrap(doc,label,COL[i]-2,i===1?7.7:8.3);
        doc.text(lines.slice(0,2), i===1?x+2:x+COL[i]/2,y+3.3,
          {align:i===1?'left':'center',lineHeightFactor:1.08});
        x+=COL[i];
      });
      currentY=y+9;
      pageLines=0;
    };
    const finish = () => {
      const sy=currentY;
      doc.setFillColor(248,250,252);
      doc.setDrawColor(148,163,184);
      doc.rect(LEFT,sy,RIGHT-LEFT,9,'FD');
      doc.setFontSize(9);
      doc.setTextColor(51,65,85);
      doc.text('Số dòng trên trang: '+pageLines,LEFT+2,sy+5.6);
      doc.setFontSize(8);
      doc.text('Số liệu theo đơn vị từng dòng, không cộng khác ĐVT',LEFT+72,sy+5.6);
      const signY=sy+29;
      if(signY>290)throw new Error('Bảng kê quá dài cho vùng chữ ký PDF A4.');
      const signs=['Người lập phiếu',page.direction==='in'?'Người giao hàng':'Người nhận hàng','Thủ kho'];
      signs.forEach((label,i)=>{
        const center=LEFT+(RIGHT-LEFT)*(i+0.5)/3;
        doc.setFontSize(10);
        doc.setTextColor(15,23,42);
        doc.text(label,center,signY,{align:'center'});
        doc.setFontSize(7.9);
        doc.setTextColor(100,116,139);
        doc.text('(Ký, ghi rõ họ tên)',center,signY+5.7,{align:'center'});
      });
      doc.setTextColor(100,116,139);
      doc.setFontSize(7.6);
      doc.text('Chi tiết giao dịch và mã nội bộ được lưu trong phần mềm',LEFT,H-8);
    };
    start();
    for(const [index,item] of page.rows.entries()){
      const data=block[index];
      // Reserve summary + signatures; overlong groups continue on an extra PDF page.
      if(currentY+data.height>246 && pageLines>0){finish();start();}
      if(currentY+data.height>246)throw new Error('Một dòng vật tư quá dài để in PDF A4: '+safe(item.id));
      const y=currentY;
      doc.setFillColor(pageLines%2===0?255:248,pageLines%2===0?255:250,pageLines%2===0?255:252);
      doc.setDrawColor(203,213,225);
      doc.rect(LEFT,y,RIGHT-LEFT,data.height,'FD');
      let x=LEFT;
      COL.slice(0,-1).forEach(c=>{x+=c;doc.line(x,y,x,y+data.height);});
      doc.setTextColor(15,23,42);
      doc.setFontSize(8.5);
      doc.text(String(page.rowOffset+index+1),LEFT+COL[0]/2,y+6,{align:'center'});
      x=LEFT+COL[0]+2;
      doc.setFontSize(9);
      data.lines.forEach((line,i)=>doc.text(line,x,y+5.4+i*4.6));
      doc.setFontSize(7.5);
      doc.setTextColor(71,85,105);
      data.notes.forEach((line,i)=>doc.text(line,x,y+5.4+data.lines.length*4.6+i*3.9));
      x=LEFT+COL[0]+COL[1];
      doc.setTextColor(15,23,42);
      doc.setFontSize(8.5);
      doc.text(safe(item.unit),x+COL[2]/2,y+6,{align:'center',maxWidth:COL[2]-2});
      x+=COL[2];
      doc.text(formatDecimal(Number(item.quantity||0)),x+COL[3]/2,y+6,{align:'center',maxWidth:COL[3]-2});

      currentY+=data.height;
      pageLines++;
    }
    finish();
  }
  const blob=doc.output('blob');
  if(!blob.size)throw new Error('PDF phiếu kho rỗng (0 byte).');
  return blob;
}
