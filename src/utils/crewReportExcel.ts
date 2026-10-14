import { buildCrewReportMatrices, type CrewReportRow } from './crewReportUtils';
import { formatDateDDMMYYYY } from './dateFormatter';

const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const safeSheetName = (name: string) => String(name || 'Công trình').replace(/[\\/:?*\[\]]/g, '_').slice(0, 26);
const colName = (index: number) => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + (n - 1) % 26) + name;
  }
  return name;
};
const details = (row?: CrewReportRow) => {
  if (!row?.reported) return '';
  return [
    row.floorSummary ? 'Tầng: ' + row.floorSummary : '',
    row.workCategorySummary ? 'Hạng mục: ' + row.workCategorySummary : '',
    row.workSubItemSummary ? 'HM con: ' + row.workSubItemSummary : '',
    row.notesSummary ? 'Ghi chú: ' + row.notesSummary : '',
  ].filter(Boolean).join(' · ');
};

export async function buildCrewReportExcel(params: {
  rows: CrewReportRow[];
  startDate: string;
  endDate: string;
  includeSerial: boolean;
  includeDetails: boolean;
  title?: string;
}) {
  // xlsx is loaded on demand: neither the Home page nor the Crew tab
  // should download the Excel library until the export action is chosen.
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const matrices = buildCrewReportMatrices(params.rows);
  if (!matrices.length) throw new Error('Không có dữ liệu quân số để xuất Excel.');

  for (const [projectIndex, matrix] of matrices.entries()) {
    const offset = params.includeSerial ? 2 : 1;
    const totalColumn = offset + matrix.teams.length * 4;
    const detailColumn = params.includeDetails ? totalColumn + 1 : -1;
    const lastColumn = params.includeDetails ? detailColumn : totalColumn;
    const merges: Array<{s:{r:number;c:number};e:{r:number;c:number}}> = [];
    const addMerge = (r:number,from:number,to:number) => {
      if (to>from) merges.push({s:{r,c:from},e:{r,c:to}});
    };

    const table: unknown[][] = [];
    table.push([params.title || 'BÁO CÁO QUÂN SỐ']);
    table.push(['Công trình: ' + matrix.projectName]);
    table.push(['Thời gian: ' + formatDateDDMMYYYY(params.startDate) + ' – ' + formatDateDDMMYYYY(params.endDate)]);
    table.push(['Địa điểm: ' + (matrix.projectLocation || '—')]);
    table.push(['QS ngày mỗi đội = ca đông nhất; 0 = đã báo không có người; ô trống = chưa báo']);
    for (let r = 0; r < 5; r++) addMerge(r,0,lastColumn);

    const groupHeader=Array<unknown>(lastColumn+1).fill(null);
    const teamHeader=Array<unknown>(lastColumn+1).fill(null);
    const metricHeader=Array<unknown>(lastColumn+1).fill(null);
    if(params.includeSerial) metricHeader[0]='STT';
    metricHeader[params.includeSerial ? 1 : 0]='Ngày';
    for(const group of matrix.groups) {
      const firstIndex=matrix.teams.findIndex(team=>team.teamKey===group.teams[0]?.teamKey);
      if(firstIndex<0)continue;
      const from=offset+firstIndex*4;
      const to=from+group.teams.length*4-1;
      groupHeader[from]=group.structureGroupName;
      addMerge(5,from,to);
    }
    matrix.teams.forEach((team,index)=>{
      const from=offset+index*4;
      teamHeader[from]=team.teamName;
      addMerge(6,from,from+3);
      ['Sáng','Chiều','Tối','QS ngày'].forEach((caption,i)=>{metricHeader[from+i]=caption;});
    });
    metricHeader[totalColumn]='Tổng QS/ngày';
    if(params.includeDetails)metricHeader[detailColumn]='Tầng / Hạng mục / HM con / Ghi chú';
    table.push(groupHeader,teamHeader,metricHeader);

    const firstDataExcelRow=table.length+1;
    matrix.dates.forEach((dateRow,dateIndex)=>{
      const cells=Array<unknown>(lastColumn+1).fill(null);
      if(params.includeSerial)cells[0]=dateIndex+1;
      cells[params.includeSerial?1:0]=formatDateDDMMYYYY(dateRow.date);
      matrix.teams.forEach((team,teamIndex)=>{
        const entry=dateRow.cells[team.teamKey];
        if(!entry?.reported)return;  // blank ≠ zero; never invent an unreported shift
        const start=offset+teamIndex*4;
        cells[start]=entry.morning ?? 0;
        cells[start+1]=entry.afternoon ?? 0;
        cells[start+2]=entry.evening ?? 0;
        cells[start+3]=Number(entry.dailyHeadcount || 0);
      });
      cells[totalColumn]=dateRow.totalDailyHeadcount;
      if(params.includeDetails)cells[detailColumn]=matrix.teams.map(team=>{
        const note=details(dateRow.cells[team.teamKey]);
        return note ? team.teamName + ': ' + note : '';
      }).filter(Boolean).join(' | ');
      table.push(cells);
    });
    const totalZeroRowIndex=table.length;
    const totalCells=Array<unknown>(lastColumn+1).fill(null);
    totalCells[params.includeSerial?1:0]='TỔNG';
    matrix.teams.forEach((team,teamIndex)=>{
      const total=matrix.teamTotals[team.teamKey];
      const start=offset+teamIndex*4;
      [total.morning,total.afternoon,total.evening,total.dailyHeadcount].forEach((value,i)=>{
        totalCells[start+i]=value;
      });
    });
    totalCells[totalColumn]=matrix.grandDailyHeadcount;
    table.push(totalCells);

    const ws=XLSX.utils.aoa_to_sheet(table);
    const formula=(zeroRow:number,zeroCol:number,expression:string,cached:number)=>{
      ws[colName(zeroCol)+(zeroRow+1)]={t:'n',f:expression,v:Number(cached||0)};
    };
    matrix.dates.forEach((dateRow,index)=>{
      const zeroRow=firstDataExcelRow-1+index;
      const qsColumns:string[]=[];
      matrix.teams.forEach((team,teamIndex)=>{
        const entry=dateRow.cells[team.teamKey];
        if(!entry?.reported)return;
        const start=offset+teamIndex*4;
        const excelRow=zeroRow+1;
        formula(zeroRow,start+3,'MAX('+colName(start)+excelRow+':'+colName(start+2)+excelRow+')',Number(entry.dailyHeadcount||0));
        qsColumns.push(colName(start+3)+excelRow);
      });
      formula(zeroRow,totalColumn,qsColumns.length?'SUM('+qsColumns.join(',')+')':'0',dateRow.totalDailyHeadcount);
    });
    const lastDataExcelRow=firstDataExcelRow+matrix.dates.length-1;
    matrix.teams.forEach((team,teamIndex)=>{
      const total=matrix.teamTotals[team.teamKey];
      const start=offset+teamIndex*4;
      [total.morning,total.afternoon,total.evening,total.dailyHeadcount].forEach((value,col)=>{
        const ref=colName(start+col);
        formula(totalZeroRowIndex,start+col,'SUM('+ref+firstDataExcelRow+':'+ref+lastDataExcelRow+')',value);
      });
    });
    const grandColumn=colName(totalColumn);
    formula(totalZeroRowIndex,totalColumn,'SUM('+grandColumn+firstDataExcelRow+':'+grandColumn+lastDataExcelRow+')',matrix.grandDailyHeadcount);

    ws['!merges']=merges;
    ws['!cols']=Array.from({length:lastColumn+1},(_,index)=>{
      if(index===(params.includeSerial?1:0))return{wch:15};
      if(params.includeSerial&&index===0)return{wch:7};
      if(index===totalColumn)return{wch:18};
      if(index===detailColumn)return{wch:76};
      return{wch:12};
    });
    ws['!rows']=Array.from({length:table.length},(_,index)=>({hpt:index<5?27:index===5||index===6?22:index===7?25:23}));
    ws['!views']=[{state:'frozen',ySplit:8,xSplit:offset}];
    ws['!autofilter']={ref:colName(0)+'8:'+colName(lastColumn)+Math.max(8,table.length-1)};
    const name=safeSheetName(matrix.projectName)+'-'+(projectIndex+1);
    XLSX.utils.book_append_sheet(wb,ws,name);
  }
  const data=XLSX.write(wb,{bookType:'xlsx',type:'array'});
  const blob=new Blob([data],{type:EXCEL_MIME});
  if(blob.size<=0)throw new Error('Báo cáo Excel rỗng (0 byte).');
  return {workbook:wb,blob,fileName:'Bao-cao-quan-so-'+params.startDate+'-'+params.endDate+'.xlsx',mimeType:EXCEL_MIME};
}
