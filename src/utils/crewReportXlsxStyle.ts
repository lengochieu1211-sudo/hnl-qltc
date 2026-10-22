/** Shared slate grid for crew-report XLSX exports; preserves formulas and blank vs 0. */
import {strFromU8, strToU8, unzipSync, zipSync} from 'fflate';

export type CrewXlsxSheetLayout = {columnCount:number; totalRow:number}; // totalRow: 0-based
const font = '<fonts count="4"><font><sz val="11"/><name val="Arial"/><color rgb="FF0F172A"/></font><font><b/><sz val="16"/><name val="Arial"/><color rgb="FF0F172A"/></font><font><b/><sz val="11"/><name val="Arial"/><color rgb="FF1E293B"/></font><font><b/><sz val="11"/><name val="Arial"/><color rgb="FF1D4ED8"/></font></fonts>';
const fills = '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill></fills>';
const border = '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border></borders>';
const xf = (fontId:number,fill:number,borderId:number,align:'left'|'right'|'center',wrap=true) => `<xf numFmtId="0" fontId="${fontId}" fillId="${fill}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${align}" vertical="center" wrapText="${wrap?1:0}"/></xf>`;
const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${font}${fills}${border}<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="12">${xf(0,0,0,'left',false)}${xf(1,0,0,'center')}${xf(0,0,0,'left')}${xf(2,2,1,'center')}${xf(0,0,1,'left')}${xf(0,0,1,'center')}${xf(0,0,1,'right')}${xf(2,2,1,'right')}${xf(2,3,1,'left')}${xf(0,3,1,'left')}${xf(0,3,1,'center')}${xf(0,3,1,'right')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
const columnIndex = (letters:string) => [...letters].reduce((v,c)=>v*26+c.charCodeAt(0)-64,0)-1;
const columnName = (n:number) => {let value='';for(let i=n+1;i>0;i=Math.floor((i-1)/26)) value=String.fromCharCode(65+(i-1)%26)+value;return value;};

export function styleCrewReportXlsx(bytes:Uint8Array, layouts:CrewXlsxSheetLayout[]):Uint8Array {
  if(!layouts.length)throw new Error('Không có bảng quân số để định dạng.');
  const zip=unzipSync(bytes);
  if(!zip['xl/styles.xml'])throw new Error('Thiếu styles.xml của Excel quân số.');
  layouts.forEach(({columnCount,totalRow},idx)=>{
    if(columnCount<2||columnCount>150||totalRow<8)throw new Error('Bố cục bảng quân số không hợp lệ.');
    const path=`xl/worksheets/sheet${idx+1}.xml`;
    if(!zip[path])throw new Error('Thiếu sheet Excel quân số.');
    let xml=strFromU8(zip[path]);
    // Materialize missing cells as truly blank STRING cells so Excel can show
    // the complete grid without manufacturing zeroes for unreported shifts.
    xml=xml.replace(/<row\b([^>]*)>([\s\S]*?)<\/row>/g,(whole,attrs:string,inner:string)=>{
      const rowNumber=Number(attrs.match(/\br="(\d+)"/)?.[1]||0);
      const r=rowNumber-1;if(r<5||r>totalRow)return whole;
      const map=new Map<number,string>();
      for(const m of inner.matchAll(/<c\s+r="([A-Z]+)(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g))map.set(columnIndex(m[1]),m[0]);
      for(let c=0;c<columnCount;c++)if(!map.has(c))map.set(c,`<c r="${columnName(c)}${rowNumber}"/>`);
      const grid=[...map].sort((a,b)=>a[0]-b[0]).map(([c,cell])=>{
        const isTotal=r===totalRow;
        const header=r>=5&&r<=7;
        const numeric=r>=8&&c>=1&& !/t="(?:s|str|inlineStr)"/.test(cell);
        const stripe=(r-8)%2===1;
        const style=header?3:isTotal?(numeric?7:8):numeric?(stripe?11:6):(stripe?9:4);
        // Blank placeholders are still a styled empty value (not numeric zero).
        // SheetJS often omits cells. Preserve their self-closing XML form:
        // adding s="..." *after* the slash would create malformed OOXML.
        return cell.replace(/<c\s+r="([A-Z]+\d+)"([^>]*)>/,(_m,ref:string,attrs:string)=>{
          const selfClosing=/\/\s*$/.test(attrs);
          const clean=attrs.replace(/\s+s="\d+"/g,'').replace(/\/\s*$/,'');
          return `<c r="${ref}"${clean} s="${style}"${selfClosing?'/':''}>`;
        });
      }).join('');
      return `<row${attrs}>${grid}</row>`;
    });
    // Title/meta cells predate the grid; keep merged headers legible.
    xml=xml.replace(/<c\s+r="([A-Z]+)([1-5])"([^>]*)>/g,(whole,letters:string,number:string,attrs:string)=>`<c r="${letters}${number}"${attrs.replace(/\s+s="\d+"/g,'')} s="${number==='1'?1:2}">`);
    zip[path]=strToU8(xml);
  });
  zip['xl/styles.xml']=strToU8(styles);
  if(zip['xl/workbook.xml']) {
    let w=strFromU8(zip['xl/workbook.xml']);
    w=w.replace(/<calcPr\b[^>]*\/?>(?:<\/calcPr>)?/g,'');
    w=w.replace('</workbook>','<calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>');
    zip['xl/workbook.xml']=strToU8(w);
  }
  return zipSync(zip,{level:6});
}
