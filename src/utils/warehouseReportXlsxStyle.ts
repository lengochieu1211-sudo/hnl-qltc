/**
 * Minimal, deterministic OOXML styling for the two read-only warehouse reports.
 * SheetJS Community writes all cell values safely but does not serialize the
 * required fills/borders from the worksheet `.s` objects.  Apply the styles to
 * ONLY this newly generated workbook; never touch imported/user workbooks.
 */
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

export type WarehouseReportXlsxLayout = {
  columnCount: number;
  headerRow: number; // 0-based
  rowCount: number;
  footerRow?: number;
  totalRow?: number;
  warningRow?: number;
  numericColumns?: number[];
  centerColumns?: number[];
};

// Same neutral palette as the warehouse receipt/issue voucher: slate header,
// alternating white/very-light-slate table rows, subtle grid and amber warning.
const thin = '<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>';
const xf = (fontId:number, fillId:number, borderId:number, align:'left'|'center'|'right', wrap = true) =>
  `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${align}" vertical="center" wrapText="${wrap?1:0}"/></xf>`;
const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="11"/><name val="Arial"/><color rgb="FF0F172A"/></font>
<font><b/><sz val="16"/><name val="Arial"/><color rgb="FF0F172A"/></font>
<font><b/><sz val="11"/><name val="Arial"/><color rgb="FF1E293B"/></font>
<font><b/><sz val="11"/><name val="Arial"/><color rgb="FFA16207"/></font>
</fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF7ED"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${thin}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
${xf(0,0,0,'left',false)}
${xf(1,0,0,'center')}
${xf(0,0,0,'center')}
${xf(0,0,0,'left')}
${xf(2,2,1,'center')}
${xf(0,0,1,'left')}
${xf(0,0,1,'center')}
${xf(0,0,1,'right')}
${xf(0,3,1,'left')}
${xf(0,3,1,'center')}
${xf(0,3,1,'right')}
${xf(3,4,1,'left')}
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const indexOfColumn = (letters: string) => [...letters].reduce((total,ch)=>total*26+ch.charCodeAt(0)-64,0)-1;
export function styleWarehouseReportXlsx(bytes: Uint8Array, layout: WarehouseReportXlsxLayout): Uint8Array {
  const {columnCount, headerRow, rowCount, totalRow, footerRow, warningRow} = layout;
  const numericColumns = new Set(layout.numericColumns || []);
  const centerColumns = new Set(layout.centerColumns || []);
  if (columnCount<1 || columnCount>60 || rowCount<1 || headerRow<1) throw new Error('Bố cục Excel kho không hợp lệ.');
  const zip=unzipSync(bytes);
  const path='xl/worksheets/sheet1.xml';
  if(!zip[path] || !zip['xl/styles.xml']) throw new Error('Excel kho thiếu cấu trúc định dạng.');
  let xml=strFromU8(zip[path]);
  let modified=0;
  // All row indices from the generated SheetJS worksheet remain unchanged.
  xml=xml.replace(/<c\s+r="([A-Z]+)(\d+)"([^>]*)>/g,(match,letters:string,n:string,attr:string)=>{
    const r=Number(n)-1,c=indexOfColumn(letters);
    if(c>=columnCount)return match;
    let style=0;
    if(r===0)style=1;
    else if(r<headerRow)style=r===headerRow-1?2:3;
    else if(r===headerRow)style=4;
    else if(r>=headerRow+1&&r<=headerRow+rowCount) {
      const odd=(r-headerRow-1)%2===1;
      const alignment = numericColumns.has(c) ? 2 : (centerColumns.has(c) ? 1 : 0);
      style=(odd?8:5)+alignment;
    }else if(r===totalRow)style=4;
    else if(r===warningRow)style=11;
    else if(r===footerRow)style=4;
    else style=3;
    modified++;
    const selfClosing=/\/\s*$/.test(attr);
    const cleaned=attr.replace(/\s+s="\d+"/g,'').replace(/\/\s*$/,'');
    return `<c r="${letters}${n}" s="${style}"${cleaned}${selfClosing?'/':''}>`;
  });
  if(modified<columnCount+rowCount)throw new Error('Không áp dụng đủ viền và căn lề cho Excel kho.');
  const pane=`<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow+1}" topLeftCell="A${headerRow+2}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${headerRow+2}" sqref="A${headerRow+2}"/></sheetView></sheetViews>`;
  if(xml.includes('<sheetViews>'))xml=xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/,pane);
  else if(/<dimension\b[^>]*\/>/.test(xml))xml=xml.replace(/(<dimension\b[^>]*\/>)/,'$1'+pane);
  else xml=xml.replace(/(<worksheet\b[^>]*>)/,'$1'+pane);
  zip[path]=strToU8(xml);
  zip['xl/styles.xml']=strToU8(styles);
  // Excel/LibreOffice must recalculate formulas when a user edits ordered amounts.
  if(zip['xl/workbook.xml']){let workbook=strFromU8(zip['xl/workbook.xml']);
    workbook=workbook.replace(/<calcPr\b[^>]*\/?>(?:<\/calcPr>)?/g,'');
    workbook=workbook.replace('</workbook>','<calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>');
    zip['xl/workbook.xml']=strToU8(workbook);
  }
  return zipSync(zip,{level:6});
}
