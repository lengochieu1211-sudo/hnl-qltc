/**
 * Print-like styling for newly exported warehouse receipt/issue XLSX files.
 * SheetJS Community does not persist most cell .s fills/borders. Apply OOXML
 * styling to the generated archive only; never rewrite a user's workbook.
 * Preserve all cells (including hidden technical IDs), values and formulas.
 */
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

export type WarehouseVoucherSheetLayout = {
  titleRow: number;
  headerRow: number;
  firstDataRow: number;
  lastDataRow: number;
  summaryRow: number;
  signatureRow: number;
  footerRow: number;
};

const thin = '<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>';
const xf = (font: number, fill: number, border: number, align: 'left' | 'center') =>
  `<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${align}" vertical="center" wrapText="1"/></xf>`;
// Slate, borders and alternate row fills intentionally match Danh mục kho / Đặt hàng.
const styleXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="6">
<font><sz val="11"/><name val="Arial"/><color rgb="FF0F172A"/></font>
<font><b/><sz val="17"/><name val="Arial"/><color rgb="FF0F172A"/></font>
<font><b/><sz val="10"/><name val="Arial"/><color rgb="FF1E293B"/></font>
<font><b/><sz val="10"/><name val="Arial"/><color rgb="FF334155"/></font>
<font><sz val="9"/><name val="Arial"/><color rgb="FF64748B"/></font>
<font><b/><sz val="10"/><name val="Arial"/><color rgb="FF0F172A"/></font>
</fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${thin}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
${xf(0,0,0,'left')}
${xf(1,0,0,'center')}
${xf(4,0,0,'center')}
${xf(3,0,0,'left')}
${xf(0,0,0,'left')}
${xf(2,2,1,'center')}
${xf(0,0,1,'left')}
${xf(0,0,1,'center')}
${xf(0,3,1,'left')}
${xf(0,3,1,'center')}
${xf(3,4,1,'left')}
${xf(3,4,1,'center')}
${xf(5,0,0,'center')}
${xf(4,0,0,'center')}
${xf(4,0,0,'left')}
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Style *every* page/sheet, not merely the first sheet of a multi-page voucher. */
export function styleWarehouseVoucherXlsx(bytes: Uint8Array, layouts: WarehouseVoucherSheetLayout[]): Uint8Array {
  if (!layouts.length) throw new Error('Chưa có trang Excel phiếu kho để định dạng.');
  const zip = unzipSync(bytes);
  if (!zip['xl/styles.xml']) throw new Error('Excel phiếu kho không có bảng định dạng.');
  for (const [index, layout] of layouts.entries()) {
    const path = `xl/worksheets/sheet${index + 1}.xml`;
    if (!zip[path]) throw new Error(`Excel phiếu kho thiếu trang ${index + 1}.`);
    const { titleRow, headerRow, firstDataRow, lastDataRow, summaryRow, signatureRow, footerRow } = layout;
    if (!(titleRow >= 2 && headerRow > titleRow + 1 && firstDataRow === headerRow + 1 &&
      summaryRow === lastDataRow + 1 && signatureRow > summaryRow && footerRow > signatureRow)) {
      throw new Error(`Bố cục trang Excel phiếu kho ${index + 1} không hợp lệ.`);
    }
    let xml = strFromU8(zip[path]);
    let styled = 0;
    xml = xml.replace(/<c\s+r="([A-Z]+)(\d+)"([^>]*)>/g, (match, letters: string, number: string, attrs: string) => {
      // A-D are the four printable columns; E is the original hidden ID column.
      if (!/^[A-D]$/.test(letters)) return match;
      const r = Number(number) - 1;
      let n = 0;
      if (r < titleRow) n = letters === 'A' ? 3 : 4;
      else if (r === titleRow) n = 1;
      else if (r === titleRow + 1) n = 2;
      else if (r < headerRow) n = letters === 'A' ? 3 : 4;
      else if (r === headerRow) n = 5;
      else if (r >= firstDataRow && r <= lastDataRow) {
        const alternate = (r - firstDataRow) % 2 === 1;
        n = letters === 'B' ? (alternate ? 8 : 6) : (alternate ? 9 : 7);
      } else if (r === summaryRow) n = letters === 'A' ? 10 : 11;
      else if (r === signatureRow) n = 12;
      else if (r === signatureRow + 1) n = 13;
      else if (r === footerRow) n = 14;
      const selfClosed = /\/\s*$/.test(attrs);
      const clean = attrs.replace(/\s+s="\d+"/g, '').replace(/\/\s*$/, '');
      styled++;
      return `<c r="${letters}${number}" s="${n}"${clean}${selfClosed ? '/' : ''}>`;
    });
    if (styled < 4 + (lastDataRow - firstDataRow + 1) * 4) {
      throw new Error(`Excel phiếu kho ${index + 1} thiếu các ô bắt buộc để định dạng.`);
    }
    // Frozen headers improve multi-row print review. No data or print settings are altered.
    const freeze = `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow + 1}" topLeftCell="A${headerRow + 2}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${headerRow + 2}" sqref="A${headerRow + 2}"/></sheetView></sheetViews>`;
    if (/<sheetViews[\s>]/.test(xml)) xml = xml.replace(/<sheetViews[\s\S]*?<\/sheetViews>/, freeze);
    else if (/<dimension\b[^>]*\/>/.test(xml)) xml = xml.replace(/(<dimension\b[^>]*\/>)/, '$1' + freeze);
    else xml = xml.replace(/(<worksheet\b[^>]*>)/, '$1' + freeze);
    zip[path] = strToU8(xml);
  }
  zip['xl/styles.xml'] = strToU8(styleXml);
  return zipSync(zip, {level: 6});
}
