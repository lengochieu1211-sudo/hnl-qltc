import { warehouseVoucherPdfFontBase64 } from './warehouseVoucherPdfFont';
import { styleWarehouseReportXlsx } from './warehouseReportXlsxStyle';

export type WarehouseReport = {
  title: string;
  projectName: string;
  projectLocation: string;
  contractorName: string;
  subtitle: string;
  columns: Array<{label:string; width:number; numeric?:boolean}>;
  rows: Array<Array<string | number>>;
  footer?: string;
  // Optional last table row. Only the warehouse order uses this.
  totalRow?: Array<string | number>;
  orderWeightFormulas?: boolean;
  // Warehouse Catalog: keep E/F/G as numeric source snapshots; H/I recalculate in Excel.
  catalogStockFormulas?: boolean;
  warning?: string;
  filePrefix: string;
};
export type WarehouseReportFormat = 'png'|'pdf'|'xlsx';
export type WarehouseReportFile = {id:string; fileName:string; mimeType:string; blob:Blob; dataUrl:string};

// Keep the palette, centered column headers, vertical cell centering and zebra
// rows consistent with the existing shared Nhập/Xuất voucher.
const PALETTE = {ink:'#0f172a',headInk:'#1e293b',muted:'#475569',line:'#94a3b8',grid:'#cbd5e1',header:'#e2e8f0',stripe:'#f8fafc',amber:'#a16207'} as const;
const fmt = (n: number) => new Intl.NumberFormat('vi-VN', {maximumFractionDigits:3}).format(n);
const display = (v: string|number) => typeof v === 'number' ? fmt(v) : String(v ?? '');
const safeName = (name:string) => name.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,70);
const centerColumn = (label:string, index:number) => index===0 || /^(đvt|đơn vị tính)$/i.test(label.trim());
const alignColumn = (report:WarehouseReport, index:number): 'left'|'center'|'right' => report.columns[index].numeric?'right':centerColumn(report.columns[index].label,index)?'center':'left';
const metaLines = (report:WarehouseReport) => [
  `Công trình: ${report.projectName||'—'}`,`Địa điểm: ${report.projectLocation||'—'}`,
  ...(report.contractorName?[`Đơn vị thi công: ${report.contractorName}`]:[]),
];
const toDataUrl = (blob:Blob): Promise<string> => new Promise((resolve,reject)=>{
  const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);
});
const canvasBlob=(canvas:HTMLCanvasElement): Promise<Blob> => new Promise((resolve,reject)=>canvas.toBlob(b=>b?.size?resolve(b):reject(new Error('Không tạo được ảnh bảng kê.')),'image/png'));
const widthsOf = (report:WarehouseReport,tableWidth:number) => {const sum=report.columns.reduce((n,c)=>n+c.width,0)||1;return report.columns.map(c=>c.width*tableWidth/sum);};
function wrapCanvas(ctx:CanvasRenderingContext2D, raw:string, width:number):string[]{
  const result:string[]=[];
  for(const paragraph of String(raw||'—').split(/\r?\n/)){
    let part='';
    for(const word of paragraph.split(/\s+/).filter(Boolean)){
      const next=part?part+' '+word:word;
      if(ctx.measureText(next).width<=width){part=next;continue;}
      if(part){result.push(part);part='';}
      for(const char of word){if(part&&ctx.measureText(part+char).width>width){result.push(part);part='';}part+=char;}
    }
    if(part)result.push(part);
  }
  return result.length?result:['—'];
}
function reportCanvases(report:WarehouseReport):HTMLCanvasElement[]{
  const landscape=report.columns.length>7;
  const width=landscape?1754:1240,height=landscape?1240:1754,left=50,tableWidth=width-100;
  const cols=widthsOf(report,tableWidth), sheets:HTMLCanvasElement[]=[];
  const headerY=report.contractorName?271:247, headerH=65, bodyLimit=height-320;
  let index=0;
  do {
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Thiết bị không hỗ trợ xuất ảnh bảng kê.');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=PALETTE.ink;
    ctx.font='bold 34px Arial, sans-serif';ctx.fillText(report.title,width/2,75,tableWidth);
    ctx.textAlign='left';ctx.font='21px Arial, sans-serif';
    metaLines(report).forEach((line,i)=>ctx.fillText(line,left,124+i*31,tableWidth));
    ctx.textAlign='center';ctx.font='19px Arial, sans-serif';ctx.fillStyle=PALETTE.muted;
    ctx.fillText(report.subtitle,width/2,headerY-31,tableWidth);
    ctx.fillStyle=PALETTE.header;ctx.fillRect(left,headerY,tableWidth,headerH);
    ctx.lineWidth=1.5;ctx.strokeStyle=PALETTE.line;ctx.strokeRect(left,headerY,tableWidth,headerH);
    let x=left;
    report.columns.forEach((c,i)=>{
      ctx.textAlign='center';ctx.font='bold 18px Arial, sans-serif';ctx.fillStyle=PALETTE.headInk;
      const lines=wrapCanvas(ctx,c.label,cols[i]-14);
      // Keep the entire heading group horizontally AND vertically centered.
      const step=23,top=headerY+headerH/2-(lines.length-1)*step/2;
      lines.forEach((line,j)=>ctx.fillText(line,x+cols[i]/2,top+j*step,cols[i]-12));
      x+=cols[i];if(i<cols.length-1){ctx.beginPath();ctx.moveTo(x,headerY);ctx.lineTo(x,headerY+headerH);ctx.stroke();}
    });
    let y=headerY+headerH;
    while(index<report.rows.length){
      const row=report.rows[index];ctx.font='19px Arial, sans-serif';
      const wrapped=row.map((v,i)=>wrapCanvas(ctx,display(v),Math.max(22,cols[i]-16)));
      const rowH=Math.max(60,Math.max(...wrapped.map(lines=>lines.length))*26+22);
      if((y+rowH>bodyLimit || (report.totalRow&&index===report.rows.length-1&&y+rowH+68>bodyLimit)) && y>headerY+headerH)break;
      if(y+rowH>bodyLimit)throw new Error('Một dòng quá dài để xuất ảnh A4.');
      ctx.fillStyle=index%2?PALETTE.stripe:'#ffffff';ctx.fillRect(left,y,tableWidth,rowH);
      ctx.strokeStyle=PALETTE.grid;ctx.strokeRect(left,y,tableWidth,rowH);
      let cellX=left;
      wrapped.forEach((lines,i)=>{
        const align=alignColumn(report,i);ctx.fillStyle=PALETTE.ink;
        ctx.font=`${report.columns[i].numeric?'bold ':''}19px Arial, sans-serif`;
        ctx.textAlign=align;
        const px=cellX+(align==='left'?9:align==='right'?cols[i]-9:cols[i]/2);
        const step=26,top=y+rowH/2-(lines.length-1)*step/2;
        lines.forEach((line,j)=>ctx.fillText(line,px,top+j*step,Math.max(22,cols[i]-16)));
        cellX+=cols[i];if(i<cols.length-1){ctx.beginPath();ctx.moveTo(cellX,y);ctx.lineTo(cellX,y+rowH);ctx.stroke();}
      });
      y+=rowH;index++;
    }
    // Only the last sheet displays totals/warnings. Long text must wrap and
    // remain within the page, rather than being clipped or shown on each page.
    if(index===report.rows.length){
      if(report.totalRow){
        const totalH=68;
        if(y+totalH>bodyLimit)throw new Error('Không đủ chỗ hiển thị dòng tổng khối lượng.');
        ctx.fillStyle=PALETTE.header;ctx.fillRect(left,y,tableWidth,totalH);ctx.strokeStyle=PALETTE.line;ctx.strokeRect(left,y,tableWidth,totalH);
        const startSummary=report.columns.length-2;
        let x=left+cols.slice(0,startSummary).reduce((a,b)=>a+b,0);
        ctx.textAlign='right';ctx.textBaseline='middle';ctx.font='bold 20px Arial, sans-serif';ctx.fillStyle=PALETTE.ink;
        ctx.fillText(display(report.totalRow[0]||report.totalRow[1]),x-12,y+totalH/2,x-left-20);
        for(let i=startSummary;i<report.columns.length;i++){ctx.strokeRect(x,y,cols[i],totalH);ctx.textAlign='right';ctx.fillText(display(report.totalRow[i]??''),x+cols[i]-9,y+totalH/2,cols[i]-16);x+=cols[i];}
        y+=totalH;
      }
      let fy=y+35;ctx.textAlign='left';ctx.font='bold 21px Arial, sans-serif';ctx.fillStyle=PALETTE.ink;
      if(report.footer){const lines=wrapCanvas(ctx,report.footer,tableWidth);lines.forEach(line=>{ctx.fillText(line,left,fy);fy+=27;});}
      if(report.warning){ctx.fillStyle=PALETTE.amber;ctx.font='18px Arial, sans-serif';fy+=7;wrapCanvas(ctx,report.warning,tableWidth).forEach(line=>{ctx.fillText(line,left,fy);fy+=24;});}
      if(fy>height-36)throw new Error('Tổng kết quá dài để xuất ảnh A4.');
    }
    ctx.fillStyle=PALETTE.muted;ctx.font='17px Arial, sans-serif';ctx.textAlign='right';
    ctx.fillText('Trang '+(sheets.length+1),width-left,height-30);
    sheets.push(canvas);
  }while(index<report.rows.length);
  return sheets;
}
export async function buildWarehouseReportFiles(report:WarehouseReport,format:WarehouseReportFormat):Promise<WarehouseReportFile[]>{
  if(!report.rows.length)throw new Error('Không có vật tư, thiết bị phù hợp để xuất.');
  const name=safeName(report.filePrefix);
  if(format==='png'){
    const files:WarehouseReportFile[]=[];
    for(const [i,canvas] of reportCanvases(report).entries()){
      const blob=await canvasBlob(canvas);files.push({id:'page-'+(i+1),fileName:`${name}-TRANG-${i+1}.png`,mimeType:'image/png',blob,dataUrl:await toDataUrl(blob)});
    }
    return files;
  }
  if(format==='xlsx'){
    const XLSX=await import('xlsx');
    const cols=report.columns.length;
    const rows:Array<Array<string|number>>=[
      [report.title],...metaLines(report).map(x=>[x]),[report.subtitle],[],
      report.columns.map(c=>c.label),...report.rows,
      ...(report.totalRow?[report.totalRow]:[]),
      ...(report.footer?[[report.footer]]:[]),...(report.warning?[[report.warning]]:[]),
    ];
    const headerIndex=metaLines(report).length+3;
    const totalIndex=report.totalRow?headerIndex+report.rows.length+1:undefined;
    const footerIndex=report.footer?headerIndex+report.rows.length+1+(report.totalRow?1:0):undefined;
    const warningIndex=report.warning?headerIndex+report.rows.length+1+(report.totalRow?1:0)+(report.footer?1:0):undefined;
    const ws=XLSX.utils.aoa_to_sheet(rows);
    ws['!merges']=[
      ...Array.from({length:headerIndex},(_,r)=>({s:{r,c:0},e:{r,c:cols-1}})),
      ...(totalIndex!==undefined&&report.orderWeightFormulas?[{s:{r:totalIndex,c:0},e:{r:totalIndex,c:4}}]:[]),
      ...(footerIndex!==undefined?[{s:{r:footerIndex,c:0},e:{r:footerIndex,c:cols-1}}]:[]),
      ...(warningIndex!==undefined?[{s:{r:warningIndex,c:0},e:{r:warningIndex,c:cols-1}}]:[]),
    ].filter(m=>cols>1);
    ws['!cols']=report.columns.map(c=>({wch:Math.max(13,Math.min(68,Math.ceil(c.width/5)))}));
    ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:headerIndex,c:0},e:{r:headerIndex+report.rows.length,c:cols-1}})};
    if(report.orderWeightFormulas&&totalIndex!==undefined){
      // Columns D/E are user-editable inputs; F/G are real recalculating Excel formulas.
      // Retain cached values for third-party spreadsheet readers.
      const first=headerIndex+2, last=first+report.rows.length-1, totalExcel=totalIndex+1;
      for(let i=0;i<report.rows.length;i++){
        const r=first+i, values=report.rows[i];
        const valid=typeof values[4]==='number'&&values[4]>0&&typeof values[3]==='number'&&values[3]>0;
        const weight=valid?Number(values[3])*Number(values[4]):null;
        ws['F'+r]={t:valid?'n':'str',f:`IF(OR(NOT(ISNUMBER(D${r})),D${r}<=0),"",IF(AND(ISNUMBER(E${r}),E${r}>0),D${r}*E${r},"Chưa có"))`,v:weight===null?'Chưa có':weight};
        ws['G'+r]=weight!==null&&Number(report.totalRow?.[5]||0)>0
          ?{t:'n',f:`IFERROR(IF(ISNUMBER(F${r}),ROUND(F${r}/$F$${totalExcel}*100,2),""),"")`,v:Number((weight/Number(report.totalRow?.[5])*100).toFixed(2))}
          :{t:'str',f:`IFERROR(IF(ISNUMBER(F${r}),ROUND(F${r}/$F$${totalExcel}*100,2),""),"")`,v:''};
      }
      ws['F'+totalExcel]={t:'n',f:`SUM(F${first}:F${last})`,v:Number(report.totalRow?.[5]||0)};
      ws['G'+totalExcel]={t:'n',f:`IF(F${totalExcel}>0,100,0)`,v:Number(report.totalRow?.[5]||0)>0?100:0};
      ws['A'+totalExcel]={t:'str',f:`IF(COUNTIF(F${first}:F${last},"Chưa có")>0,"TỔNG CỘNG KHỐI LƯỢNG (CHƯA ĐỦ)","TỔNG CỘNG KHỐI LƯỢNG")`,v:String(report.totalRow?.[0]||'TỔNG CỘNG KHỐI LƯỢNG')};
    }
    if(report.catalogStockFormulas){
      // Catalog has 9 columns: E total received, F total issued, G norm,
      // H = current stock, I = received/norm (%). Only H/I are derived.
      // Numeric cached values are kept for viewers that do not recalculate.
      if(cols!==9)throw new Error('Sai số cột Excel Danh mục kho.');
      const first=headerIndex+2;
      for(let i=0;i<report.rows.length;i++){
        const r=first+i,row=report.rows[i];
        const stock=Number(row[4])-Number(row[5]);
        const norm=typeof row[6]==='number'?row[6]:0;
        const ratio=norm>0?Number((Number(row[4])/norm*100).toFixed(2)):null;
        ws['H'+r]={t:'n',f:`IF(AND(ISNUMBER(E${r}),ISNUMBER(F${r})),E${r}-F${r},"Chưa có")`,v:Number.isFinite(stock)?stock:0};
        ws['I'+r]=ratio===null
          ?{t:'str',f:`IF(AND(ISNUMBER(E${r}),ISNUMBER(G${r}),G${r}>0),ROUND(E${r}/G${r}*100,2),"—")`,v:'—'}
          :{t:'n',f:`IF(AND(ISNUMBER(E${r}),ISNUMBER(G${r}),G${r}>0),ROUND(E${r}/G${r}*100,2),"—")`,v:ratio};
      }
    }
    ws['!rows']=rows.map((_,r)=>({hpt:r===0?37:r===headerIndex?42:r>headerIndex&&r<=headerIndex+report.rows.length?Math.max(26,Math.min(88,Math.ceil(Math.max(...rows[r].map(v=>String(v).length))/48)*17+13)):29}));
    ws['!margins']={left:0.3,right:0.3,top:0.4,bottom:0.4,header:0.15,footer:0.15};
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'DANH SACH');
    const raw=XLSX.write(wb,{bookType:'xlsx',type:'array',cellStyles:true});
    // Unlike a JS worksheet object's `.s` property, these styles are verified
    // inside the XLSX archive: actual cell borders/fills/center align survive.
    const bytes=styleWarehouseReportXlsx(new Uint8Array(raw),{
      columnCount:cols,headerRow:headerIndex,rowCount:report.rows.length,totalRow:totalIndex,footerRow:footerIndex,warningRow:warningIndex,
      numericColumns:report.columns.flatMap((c,i)=>c.numeric?[i]:[]),
      centerColumns:report.columns.flatMap((c,i)=>centerColumn(c.label,i)?[i]:[]),
    });
    const mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const blob=new Blob([bytes],{type:mimeType});if(!blob.size)throw new Error('Excel rỗng.');
    return [{id:'excel',fileName:name+'.xlsx',mimeType,blob,dataUrl:await toDataUrl(blob)}];
  }
  const {jsPDF}=await import('jspdf');const landscape=report.columns.length>7;
  const doc=new jsPDF({orientation:landscape?'landscape':'portrait',unit:'mm',format:'a4',compress:true});
  doc.addFileToVFS('HnlWarehouseRoboto.ttf',warehouseVoucherPdfFontBase64);
  doc.addFont('HnlWarehouseRoboto.ttf','HnlWarehouseRoboto','normal');doc.setFont('HnlWarehouseRoboto','normal');
  doc.setProperties({title:report.title,creator:'HNL QLTC'});
  const left=10,pageWidth=landscape?297:210,pageHeight=landscape?210:297,tableWidth=pageWidth-20;
  const cols=widthsOf(report,tableWidth),headerH=11;
  let y=0,page=0;
  const newPage=()=>{
    if(page)doc.addPage();page++;
    doc.setFont('HnlWarehouseRoboto','normal');doc.setTextColor(15,23,42);
    y=15;doc.setFontSize(15);doc.text(report.title,pageWidth/2,y,{align:'center',maxWidth:tableWidth});y+=9;
    doc.setFontSize(8.6);for(const line of metaLines(report)){
      const lines=doc.splitTextToSize(line,tableWidth) as string[];doc.text(lines,left,y);y+=lines.length*4.1+1.5;
    }
    y+=3;doc.setFontSize(8.5);doc.setTextColor(71,85,105);
    doc.text(report.subtitle,pageWidth/2,y,{align:'center',maxWidth:tableWidth});y+=6;
    doc.setFillColor(226,232,240);doc.setDrawColor(148,163,184);doc.rect(left,y,tableWidth,headerH,'FD');
    let x=left;
    report.columns.forEach((c,i)=>{
      if(i)doc.line(x,y,x,y+headerH);
      doc.setFontSize(7.5);doc.setTextColor(30,41,59);
      const lines=(doc.splitTextToSize(c.label,Math.max(4,cols[i]-2)) as string[]).slice(0,3);
      const step=3.15,top=y+headerH/2-(lines.length-1)*step/2;
      lines.forEach((line,j)=>doc.text(line,x+cols[i]/2,top+j*step,{align:'center',baseline:'middle'}));
      x+=cols[i];
    });
    y+=headerH;
  };
  newPage();
  for(const [ri,row] of report.rows.entries()){
    doc.setFontSize(8);
    const parts=row.map((v,i)=>doc.splitTextToSize(display(v),Math.max(4,cols[i]-3)) as string[]);
    const h=Math.max(8,4+Math.max(...parts.map(lines=>lines.length))*3.8);
    if(h>pageHeight-80)throw new Error('Một dòng quá dài để in PDF A4.');
    if(y+h>pageHeight-37)newPage();
    if(ri%2){doc.setFillColor(248,250,252);doc.rect(left,y,tableWidth,h,'F');}
    doc.setDrawColor(203,213,225);doc.rect(left,y,tableWidth,h);
    let x=left;
    parts.forEach((lines,i)=>{
      const align=alignColumn(report,i),step=3.8,top=y+h/2-(lines.length-1)*step/2;
      doc.setTextColor(15,23,42);
      const px=x+(align==='left'?1.5:align==='right'?cols[i]-1.5:cols[i]/2);
      lines.forEach((line,j)=>doc.text(line,px,top+j*step,{align,baseline:'middle'}));
      x+=cols[i];if(i<cols.length-1)doc.line(x,y,x,y+h);
    });
    y+=h;
  }
  if(report.totalRow){
    const totalH=10;if(y+totalH>pageHeight-37)newPage();
    doc.setFillColor(226,232,240);doc.setDrawColor(148,163,184);doc.rect(left,y,tableWidth,totalH,'FD');
    const k=report.columns.length-2;const firstW=cols.slice(0,k).reduce((a,b)=>a+b,0);
    doc.setFontSize(8);doc.setTextColor(15,23,42);
    doc.text(display(report.totalRow[0]||report.totalRow[1]),left+firstW-2,y+totalH/2,{align:'right',baseline:'middle',maxWidth:firstW-4});
    let x=left+firstW;for(let i=k;i<cols.length;i++){doc.line(x,y,x,y+totalH);doc.text(display(report.totalRow[i]??''),x+cols[i]-1.5,y+totalH/2,{align:'right',baseline:'middle',maxWidth:cols[i]-3});x+=cols[i];}
    y+=totalH;
  }
  doc.setFontSize(9.5);const footer=report.footer?(doc.splitTextToSize(report.footer,tableWidth) as string[]):[];
  doc.setFontSize(8);const warning=report.warning?(doc.splitTextToSize(report.warning,tableWidth) as string[]):[];
  const footerH=footer.length*4.9+warning.length*4.3+15;
  if(y+footerH>pageHeight-16)newPage();
  y+=8;doc.setFontSize(9.5);doc.setTextColor(15,23,42);
  if(footer.length){doc.text(footer,left,y);y+=footer.length*4.9+3;}
  if(warning.length){doc.setFontSize(8);doc.setTextColor(161,98,7);doc.text(warning,left,y);}
  const blob=doc.output('blob');if(!blob.size)throw new Error('PDF rỗng.');
  return [{id:'pdf',fileName:name+'.pdf',mimeType:'application/pdf',blob,dataUrl:await toDataUrl(blob)}];
}
