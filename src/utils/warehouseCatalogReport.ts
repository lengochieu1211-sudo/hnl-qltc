import { warehouseVoucherPdfFontBase64 } from './warehouseVoucherPdfFont';

export type WarehouseReport = {
  title: string;
  projectName: string;
  projectLocation: string;
  contractorName: string;
  subtitle: string;
  columns: Array<{label:string; width:number; numeric?:boolean}>;
  rows: Array<Array<string | number>>;
  footer?: string;
  warning?: string;
  filePrefix: string;
};
export type WarehouseReportFormat = 'png'|'pdf'|'xlsx';
export type WarehouseReportFile = {id:string; fileName:string; mimeType:string; blob:Blob; dataUrl:string};
const fmt = (n: number) => new Intl.NumberFormat('vi-VN', {maximumFractionDigits:3}).format(n);
const display = (v: string|number) => typeof v === 'number' ? fmt(v) : String(v ?? '');
const safeName = (name:string) => name.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,70);
const toDataUrl = (blob:Blob): Promise<string> => new Promise((resolve,reject)=>{
  const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result||'')); reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);
});
const canvasBlob = (canvas:HTMLCanvasElement): Promise<Blob> => new Promise((resolve,reject)=>canvas.toBlob(b=>b?.size?resolve(b):reject(new Error('Không tạo được ảnh bảng kê.')),'image/png'));
function wrapCanvas(ctx: CanvasRenderingContext2D, raw:string, width:number): string[] {
  const out:string[]=[];let part='';
  for(const word of raw.split(/\s+/).filter(Boolean)){
    const next=part?part+' '+word:word;
    if(ctx.measureText(next).width<=width){part=next;continue;}
    if(part)out.push(part);
    part='';
    for(const char of word){if(part&&ctx.measureText(part+char).width>width){out.push(part);part='';}part+=char;}
  }
  if(part)out.push(part);
  return out.length?out:['—'];
}
function reportCanvases(report:WarehouseReport): HTMLCanvasElement[] {
  const landscape=report.columns.length>7;
  const width=landscape?1754:1240, height=landscape?1240:1754, left=50, tableWidth=width-100;
  const bodyLimit=height-240;
  const sumWidth=report.columns.reduce((n,c)=>n+c.width,0)||1;
  const colWidths=report.columns.map(c=>c.width*tableWidth/sumWidth);
  const sheets:HTMLCanvasElement[]=[];
  let index=0;
  do {
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Thiết bị không hỗ trợ xuất ảnh bảng kê.');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
    ctx.fillStyle='#0f172a';ctx.font='bold 34px Arial';ctx.textAlign='center';ctx.fillText(report.title,width/2,75,tableWidth);
    ctx.font='21px Arial';ctx.fillText('Công trình: '+report.projectName,width/2,116,tableWidth);
    ctx.font='19px Arial';ctx.fillText('Địa điểm: '+(report.projectLocation||'—'),width/2,147,tableWidth);
    if(report.contractorName)ctx.fillText('Đơn vị: '+report.contractorName,width/2,178,tableWidth);
    ctx.fillStyle='#475569';ctx.font='18px Arial';ctx.fillText(report.subtitle,width/2,219,tableWidth);
    ctx.textAlign='left';
    let y=260;
    ctx.fillStyle='#dbeafe';ctx.fillRect(left,y,tableWidth,65);
    ctx.strokeStyle='#94a3b8';ctx.strokeRect(left,y,tableWidth,65);
    let x=left;
    report.columns.forEach((c,i)=>{ctx.font='bold 18px Arial';ctx.fillStyle='#1e293b'; const parts=wrapCanvas(ctx,c.label,colWidths[i]-16).slice(0,2);
      parts.forEach((line,j)=>ctx.fillText(line,x+9,y+28+j*24,colWidths[i]-15));x+=colWidths[i];if(i<colWidths.length-1){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+65);ctx.stroke();}});
    y+=65;
    ctx.font='20px Arial';
    while(index<report.rows.length){
      const row=report.rows[index]; const wrapped=row.map((v,i)=>wrapCanvas(ctx,display(v),colWidths[i]-16));
      const rowHeight=Math.max(60,wrapped.reduce((max,lines)=>Math.max(max,lines.length),1)*27+18);
      if(y+rowHeight>bodyLimit&&y>325)break;
      if(y+rowHeight>bodyLimit)throw new Error('Một dòng quá dài để xuất ảnh A4.');
      ctx.fillStyle=index%2?'#f8fafc':'#fff';ctx.fillRect(left,y,tableWidth,rowHeight);
      ctx.strokeStyle='#cbd5e1';ctx.strokeRect(left,y,tableWidth,rowHeight);
      let cellX=left;
      wrapped.forEach((lines,i)=>{
        ctx.fillStyle='#0f172a';ctx.font=report.columns[i].numeric?'bold 19px Arial':'19px Arial';
        const cx=cellX+(report.columns[i].numeric?colWidths[i]-9:9);
        ctx.textAlign=report.columns[i].numeric?'right':'left';
        lines.forEach((line,j)=>ctx.fillText(line,cx,y+28+j*27,colWidths[i]-17));
        cellX+=colWidths[i];if(i<colWidths.length-1){ctx.strokeStyle='#cbd5e1';ctx.beginPath();ctx.moveTo(cellX,y);ctx.lineTo(cellX,y+rowHeight);ctx.stroke();}
      });ctx.textAlign='left';y+=rowHeight;index++;
    }
    ctx.fillStyle='#0f172a';ctx.font='bold 23px Arial';
    if(report.footer)ctx.fillText(report.footer,left,Math.min(height-115,y+48),tableWidth);
    if(report.warning){ctx.fillStyle='#a16207';ctx.font='19px Arial';ctx.fillText(report.warning,left,Math.min(height-75,y+85),tableWidth);}
    ctx.fillStyle='#64748b';ctx.font='17px Arial';ctx.textAlign='right';ctx.fillText('Trang '+(sheets.length+1),width-50,height-28);
    sheets.push(canvas);
  }while(index<report.rows.length);
  return sheets;
}
export async function buildWarehouseReportFiles(report:WarehouseReport, format:WarehouseReportFormat):Promise<WarehouseReportFile[]> {
  if(!report.rows.length)throw new Error('Không có vật tư, thiết bị phù hợp để xuất.');
  const name=safeName(report.filePrefix);
  if(format==='png'){
    const sheets=reportCanvases(report);const files:WarehouseReportFile[]=[];
    for(const [i,canvas] of sheets.entries()){
      const blob=await canvasBlob(canvas);files.push({id:'page-'+(i+1),fileName:`${name}-TRANG-${i+1}.png`,mimeType:'image/png',blob,dataUrl:await toDataUrl(blob)});
    }return files;
  }
  if(format==='xlsx'){
    const XLSX=await import('xlsx');const rows:Array<Array<string|number>>=[
      [report.title],[`Công trình: ${report.projectName}`],[`Địa điểm: ${report.projectLocation}`],
      ...(report.contractorName?[[`Đơn vị: ${report.contractorName}`]]:[]),[report.subtitle],[],
      report.columns.map(c=>c.label),...report.rows,
      ...(report.footer?[[report.footer]]:[]),...(report.warning?[[report.warning]]:[]),
    ];
    const ws=XLSX.utils.aoa_to_sheet(rows); const headerIndex=5+(report.contractorName?1:0);
    ws['!cols']=report.columns.map(c=>({wch:Math.max(15,Math.min(64,Math.ceil(c.width/3)))}));
    ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:headerIndex,c:0},e:{r:headerIndex+report.rows.length,c:report.columns.length-1}})};
    ws['!freeze']={xSplit:0,ySplit:headerIndex+1};
    ws['!rows']=rows.map((_,i)=>({hpt:i===0?32:i===headerIndex?34:24}));
    // Numeric weights remain numeric for totals and user formulas. Names remain text.
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'DANH SACH');
    const bytes=XLSX.write(wb,{bookType:'xlsx',type:'array',cellStyles:true});
    const mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const blob=new Blob([bytes],{type:mimeType});if(!blob.size)throw new Error('Excel rỗng.');
    return [{id:'excel',fileName:name+'.xlsx',mimeType,blob,dataUrl:await toDataUrl(blob)}];
  }
  const {jsPDF}=await import('jspdf');const landscape=report.columns.length>7;
  const doc=new jsPDF({orientation:landscape?'landscape':'portrait',unit:'mm',format:'a4',compress:true});
  doc.addFileToVFS('HnlWarehouseRoboto.ttf',warehouseVoucherPdfFontBase64);
  doc.addFont('HnlWarehouseRoboto.ttf','HnlWarehouseRoboto','normal');doc.setFont('HnlWarehouseRoboto','normal');
  doc.setProperties({title:report.title,creator:'HNL QLTC'});
  const left=10, pageWidth=landscape?297:210, pageHeight=landscape?210:297;
  const tableWidth=pageWidth-20, unit=report.columns.reduce((n,c)=>n+c.width,0)||1;
  const widths=report.columns.map(c=>c.width/unit*tableWidth);
  let y=0, page=0;
  const newPage=()=>{
    if(page)doc.addPage();page++;doc.setFont('HnlWarehouseRoboto','normal');doc.setTextColor(15,23,42);
    y=15;doc.setFontSize(15);doc.text(report.title,pageWidth/2,y,{align:'center',maxWidth:tableWidth});y+=9;
    doc.setFontSize(8.6);for(const line of [`Công trình: ${report.projectName}`,`Địa điểm: ${report.projectLocation}`,...(report.contractorName?[`Đơn vị: ${report.contractorName}`]:[]),report.subtitle]){
      const lines=doc.splitTextToSize(line,tableWidth) as string[];doc.text(lines,left,y);y+=lines.length*4.1+1.5;
    }
    y+=3;doc.setFillColor(219,234,254);doc.rect(left,y,tableWidth,12,'F');
    let x=left;report.columns.forEach((c,i)=>{doc.setFontSize(7.5);const lines=(doc.splitTextToSize(c.label,widths[i]-3) as string[]).slice(0,2);lines.forEach((line,j)=>doc.text(line,x+1.5,y+4+j*3.4));x+=widths[i];});y+=12;
  };
  newPage();
  for(const [ri,row] of report.rows.entries()){
    doc.setFontSize(8);const parts=row.map((v,i)=>doc.splitTextToSize(display(v),Math.max(7,widths[i]-3)) as string[]);
    const h=Math.max(8,4+Math.max(...parts.map(p=>p.length))*3.7);
    if(h>pageHeight-65)throw new Error('Tên vật tư quá dài để in PDF A4.');
    if(y+h>pageHeight-27)newPage();
    if(ri%2) {doc.setFillColor(248,250,252);doc.rect(left,y,tableWidth,h,'F');}
    doc.setDrawColor(203,213,225);doc.rect(left,y,tableWidth,h);
    let x=left;parts.forEach((lines,i)=>{lines.forEach((line,j)=>doc.text(line,x+(report.columns[i].numeric?widths[i]-1.5:1.5),y+3.5+j*3.7,{align:report.columns[i].numeric?'right':'left'}));x+=widths[i];if(i<widths.length-1)doc.line(x,y,x,y+h);});y+=h;
  }
  if(y>pageHeight-45)newPage();
  doc.setTextColor(15,23,42);doc.setFontSize(9.5);
  if(report.footer){doc.text(doc.splitTextToSize(report.footer,tableWidth) as string[],left,y+8);y+=10;}
  if(report.warning){doc.setTextColor(161,98,7);doc.setFontSize(8);doc.text(doc.splitTextToSize(report.warning,tableWidth) as string[],left,y+7);}
  const blob=doc.output('blob');if(!blob.size)throw new Error('PDF rỗng.');
  return [{id:'pdf',fileName:name+'.pdf',mimeType:'application/pdf',blob,dataUrl:await toDataUrl(blob)}];
}
