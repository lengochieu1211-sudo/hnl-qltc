import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildCrewReportExcel } from '../src/utils/crewReportExcel';
import type { CrewReportRow } from '../src/utils/crewReportUtils';

const sample: CrewReportRow = {
  projectId:'p1',projectName:'Dự án quân số',date:'2026-10-14',
  structureGroupId:'g1',structureGroupName:'Khối A',structureGroupOrder:0,
  teamKey:'A',teamName:'Đội A',reported:true,morning:7,afternoon:12,evening:8,dailyHeadcount:12,
};
const rows: CrewReportRow[] = [
  sample,
  {...sample,teamKey:'B',teamName:'Đội B',reported:false,morning:null,afternoon:null,evening:null,dailyHeadcount:null},
  {...sample,date:'2026-10-15',morning:9,afternoon:5,evening:0,dailyHeadcount:9},
  {...sample,date:'2026-10-15',teamKey:'B',teamName:'Đội B',reported:true,morning:3,afternoon:4,evening:0,dailyHeadcount:4},
];
const result=await buildCrewReportExcel({rows,startDate:'2026-10-14',endDate:'2026-10-15',
  includeSerial:false,includeDetails:true,title:'BÁO CÁO QUÂN SỐ'});
assert(result.blob.size>2000,'Excel file 0 bytes');
const fileBytes=new Uint8Array(await result.blob.arrayBuffer());
assert.equal(String.fromCharCode(...fileBytes.slice(0,2)),'PK','XLSX zip header');
const wb=XLSX.read(fileBytes,{type:'array',cellFormula:true});
const ws=wb.Sheets[wb.SheetNames[0]];
assert.equal(ws['A9']?.v,'14/10/2026');
assert.equal(ws['E9']?.f,'MAX(B9:D9)');
assert.equal(ws['E9']?.v,12);
assert.equal(ws['I9'],undefined,'Unreported team cannot become zero or formula');
assert.equal(ws['J9']?.f,'SUM(E9)');
assert.equal(ws['J9']?.v,12);
assert.equal(ws['I10']?.f,'MAX(F10:H10)');
assert.equal(ws['J10']?.f,'SUM(E10,I10)');
assert.equal(ws['J10']?.v,13);
assert.equal(ws['E11']?.f,'SUM(E9:E10)');
assert.equal(ws['E11']?.v,21);
assert.equal(ws['I11']?.v,4);
assert.equal(ws['J11']?.f,'SUM(J9:J10)');
assert.equal(ws['J11']?.v,25);
assert((ws['!merges']||[]).length>=3,'Project/group/team multilevel headers must be merged');
console.log('CREW REPORT EXCEL: real XLSX binary + MAX/SUM formulas/cached results + absent-vs-zero PASS');
