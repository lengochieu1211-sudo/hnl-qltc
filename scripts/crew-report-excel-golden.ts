import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {strFromU8, unzipSync} from 'fflate';
import { buildCrewReportExcel } from '../src/utils/crewReportExcel';
import type { CrewReportRow } from '../src/utils/crewReportUtils';
import { buildCrewReportPdf } from '../src/utils/crewReportPdf';

const sample: CrewReportRow = {
  projectId:'p1',projectName:'Dự án quân số',projectLocation:'Địa điểm mẫu',contractorName:'Đơn vị An Phú',date:'2026-10-14',
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
assert.equal(ws['A1']?.v,'BÁO CÁO QUÂN SỐ','Title cell must precede the project metadata');
assert.equal(ws['A2']?.v,'Công trình: Dự án quân số');
assert.equal(ws['A3']?.v,'Địa điểm: Địa điểm mẫu');
assert.equal(ws['A4']?.v,'Đơn vị thi công: Đơn vị An Phú');
assert.equal(ws['A5']?.v,'Thời gian: 14/10/2026 – 15/10/2026');
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
const parts=unzipSync(fileBytes);
const xml=strFromU8(parts['xl/worksheets/sheet1.xml']);
const styleXml=strFromU8(parts['xl/styles.xml']);
assert.match(styleXml,/<borders count="2">/, 'Crew exported XLSX needs visible cell borders');
assert.match(xml,/<c r="I9" s="6"\s*\/>/, 'Unreported crew cells must have grid border but remain truly blank');
assert.doesNotMatch(xml,/<c\b[^>]*\/\s+s=\"\d+\"/, 'Grid style cannot corrupt a self-closing OOXML cell');
assert.match(xml,/ySplit="8"/, 'Crew report heading must stay frozen');
assert.match(styleXml,/<cellXfs count="12">/, 'Crew report must include zebra / header / total styles');
const pdf=await buildCrewReportPdf({rows,startDate:'2026-10-14',endDate:'2026-10-15',includeSerial:false,includeDetails:true,title:'Báo cáo quân số'});
const pdfBytes=new Uint8Array(await pdf.blob.arrayBuffer());
assert.equal(new TextDecoder('ascii').decode(pdfBytes.subarray(0,5)),'%PDF-','Generated PDF must be valid');
assert(pdfBytes.length>2500,'PDF must contain real embedded Unicode font');
assert(pdf.fileName.endsWith('.pdf'));
console.log('CREW REPORT EXPORT: Excel MAX/SUM integrity + unified title/project metadata + real PDF binary PASS');
