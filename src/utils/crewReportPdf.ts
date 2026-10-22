/** Print-ready, searchable Unicode PDF for the same read-only crew report matrices.
 * Separate team chunks keep numbers legible on A3 rather than shrinking them.
 */
import type { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { buildCrewReportMatrices, type CrewReportRow } from './crewReportUtils';
import { formatDateDDMMYYYY } from './dateFormatter';
import { warehouseVoucherPdfFontBase64 } from './warehouseVoucherPdfFont';

export async function buildCrewReportPdf(params: {
  rows: CrewReportRow[];
  startDate: string;
  endDate: string;
  title?: string;
  includeSerial?: boolean;
  includeDetails?: boolean;
}) {
  const matrices = buildCrewReportMatrices(params.rows);
  if (!matrices.length) throw new Error('Không có dữ liệu quân số để xuất PDF.');
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({orientation:'landscape',unit:'mm',format:'a3',compress:true});
  doc.addFileToVFS('CrewRoboto.ttf',warehouseVoucherPdfFontBase64);
  doc.addFont('CrewRoboto.ttf','CrewRoboto','normal');
  doc.setFont('CrewRoboto','normal');
  doc.setProperties({title:'BÁO CÁO QUÂN SỐ',subject:'Báo cáo quân số có chữ tiếng Việt tìm kiếm được',creator:'HNL QLTC'});
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),LEFT=12,RIGHT=W-12;
  const field = (label:string,value:string) => `${label}: ${String(value||'').trim()||'—'}`;
  const time = params.startDate===params.endDate
    ? `Ngày: ${formatDateDDMMYYYY(params.startDate)}`
    : `Thời gian: ${formatDateDDMMYYYY(params.startDate)} – ${formatDateDDMMYYYY(params.endDate)}`;
  let started=false;
  for (const matrix of matrices) {
    // Preserve all teams: large reports continue on separately labeled A3 sheets.
    const chunkSize=params.includeDetails?3:4;
    for (let start=0;start<matrix.teams.length;start+=chunkSize) {
      if (started) doc.addPage('a3','landscape');
      started=true;
      const teams=matrix.teams.slice(start,start+chunkSize);
      const lines=[field('Công trình',matrix.projectName),field('Địa điểm',matrix.projectLocation||''),
        field('Đơn vị thi công',matrix.contractorName||''),time];
      const rows=lines.flatMap(text => doc.splitTextToSize(text,RIGHT-LEFT) as string[]);
      const headerTop=30;
      const headerBottom=headerTop+rows.length*5.5+8;
      const drawHeader = (pdf:jsPDF) => {
        pdf.setFont('CrewRoboto','normal');
        pdf.setFontSize(18);
        pdf.setTextColor(15,23,42);
        pdf.text((params.title||'Báo cáo quân số').toLocaleUpperCase('vi-VN'),W/2,18,{align:'center'});
        pdf.setFontSize(10.5);
        pdf.setTextColor(30,41,59);
        rows.forEach((line,index)=>pdf.text(line,LEFT,headerTop+index*5.5));
        pdf.setFontSize(8);
        pdf.setTextColor(71,85,105);
        pdf.text(`Nhóm đội ${start+1}–${start+teams.length}/${matrix.teams.length}`,RIGHT,headerBottom-3,{align:'right'});
        pdf.setDrawColor(203,213,225);
        pdf.line(LEFT,headerBottom,RIGHT,headerBottom);
      };
      drawHeader(doc);
      const columns:(string|{content:string;rowSpan?:number;colSpan?:number})[]=[];
      if(params.includeSerial)columns.push({content:'STT',rowSpan:2});
      columns.push({content:'Ngày',rowSpan:2});
      for(const team of teams)columns.push({content:`${team.structureGroupName} · ${team.teamName}`,colSpan:4});
      columns.push({content:'Tổng QS/ngày',rowSpan:2});
      if(params.includeDetails)columns.push({content:'Tầng / Hạng mục / Ghi chú',rowSpan:2});
      const subHeader=teams.flatMap(()=>['Sáng','Chiều','Tối','QS ngày']);
      const body=(matrix.dates.length?matrix.dates:[]).map((day,index)=>{
        const values: (string|number)[]=[];
        if(params.includeSerial)values.push(index+1);
        values.push(formatDateDDMMYYYY(day.date));
        teams.forEach(team=>{
          const crew=day.cells[team.teamKey];
          values.push(...(crew?.reported?[crew.morning??0,crew.afternoon??0,crew.evening??0,crew.dailyHeadcount??0]:['','','','']));
        });
        values.push(day.totalDailyHeadcount);
        if(params.includeDetails)values.push(teams.map(team=>{
          const data=day.cells[team.teamKey];
          if(!data?.reported)return '';
          const detail=[data.floorSummary,data.workCategorySummary,data.workSubItemSummary,data.notesSummary]
            .filter(Boolean).join(' / ');
          return detail?team.teamName+': '+detail:'';
        }).filter(Boolean).join(' | '));
        return values;
      });
      const total:(string|number)[]=[];
      if(params.includeSerial)total.push('');
      total.push('TỔNG');
      teams.forEach(team=>{
        const t=matrix.teamTotals[team.teamKey]||{morning:0,afternoon:0,evening:0,dailyHeadcount:0};
        total.push(t.morning,t.afternoon,t.evening,t.dailyHeadcount);
      });
      total.push(matrix.grandDailyHeadcount);
      if(params.includeDetails)total.push('');
      const leftCount=params.includeSerial?2:1;
      const detailWidth=params.includeDetails?61:0;
      const metricWidth=(RIGHT-LEFT-(params.includeSerial?10:0)-30-28-detailWidth)/(teams.length*4);
      const styles:Record<number,{cellWidth:number}>={};
      let position=0;
      if(params.includeSerial)styles[position++]={cellWidth:10};
      styles[position++]={cellWidth:30};
      teams.forEach(()=>{for(let i=0;i<4;i++)styles[position++]={cellWidth:metricWidth};});
      styles[position++]={cellWidth:28};
      if(params.includeDetails)styles[position++]={cellWidth:detailWidth};
      autoTable(doc,{
        startY:headerBottom+4,margin:{left:LEFT,right:12,top:headerBottom+4,bottom:19},
        head:[columns,subHeader],body,foot:[total],theme:'grid',
        styles:{font:'CrewRoboto',fontSize:7.4,cellPadding:1.7,overflow:'linebreak',valign:'middle',halign:'center',lineColor:[203,213,225],lineWidth:0.08},
        headStyles:{font:'CrewRoboto',fillColor:[226,232,240],textColor:[30,41,59],fontSize:7.5},
        footStyles:{font:'CrewRoboto',fillColor:[219,234,254],textColor:[30,58,138]},
        columnStyles:styles,
        didDrawPage:data=>{if(data.pageNumber>1)drawHeader(doc);},
        showFoot:'lastPage',
      });
    }
  }
  if(!started)throw new Error('Không có đội thi công để tạo PDF quân số.');
  const pages=doc.getNumberOfPages();
  for(let n=1;n<=pages;n++){
    doc.setPage(n);doc.setFont('CrewRoboto','normal');doc.setFontSize(8);doc.setTextColor(100,116,139);
    doc.text(`Trang ${n}/${pages}`,RIGHT,H-8,{align:'right'});
  }
  const blob=new Blob([doc.output('arraybuffer')],{type:'application/pdf'});
  if(blob.size<500)throw new Error('PDF quân số rỗng.');
  return {blob,fileName:`Bao-cao-quan-so-${params.startDate}-${params.endDate}.pdf`,mimeType:'application/pdf'};
}
