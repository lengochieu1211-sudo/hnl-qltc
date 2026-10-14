import type { InventoryItem, TransactionType } from '../types';
import { formatDateDDMMYYYY } from './dateFormatter';
import { formatDecimal } from './numberUtils';

// Print-only grouping. Underlying warehouse transactions keep their original IDs and balances.
export type WarehouseVoucherPrintPage = {
  direction: TransactionType;
  date: string;
  location: string;
  handler: string;
  rows: InventoryItem[];
  pageIndex: number;
  pageCount: number;
};

const PAGE_BODY_BUDGET = 830;
const normalize = (value: unknown) => String(value ?? '').trim();

function estimatedRowHeight(item: InventoryItem): number {
  const nameLines = Math.max(1, Math.ceil(normalize(item.materialName).length / 39));
  const idLines = Math.max(1, Math.ceil(normalize(item.id).length / 20));
  const noteLines = normalize(item.notes) ? Math.ceil(normalize(item.notes).length / 58) : 0;
  return Math.max(68, 26 + nameLines * 28 + noteLines * 22, 26 + idLines * 22);
}

export function paginateWarehouseVouchers(rows: InventoryItem[]): WarehouseVoucherPrintPage[] {
  const grouped = new Map<string, InventoryItem[]>();
  for (const item of rows) {
    if (item.deletedAt != null) continue;
    const key = [item.type, item.date, normalize(item.location), normalize(item.handler)].join('\u001f');
    const group = grouped.get(key) || [];
    group.push(item);
    grouped.set(key, group);
  }
  const pages: WarehouseVoucherPrintPage[] = [];
  for (const group of grouped.values()) {
    const first = group[0];
    const chunks: InventoryItem[][] = [];
    let current: InventoryItem[] = [];
    let used = 0;
    for (const item of group) {
      const cost = estimatedRowHeight(item);
      if (current.length && used + cost > PAGE_BODY_BUDGET) {
        chunks.push(current);
        current = [];
        used = 0;
      }
      current.push(item);
      used += cost;
    }
    if (current.length) chunks.push(current);
    chunks.forEach((chunk, index) => pages.push({
      direction: first.type,
      date: first.date,
      location: first.location,
      handler: first.handler,
      rows: chunk,
      pageIndex: index + 1,
      pageCount: chunks.length,
    }));
  }
  return pages;
}

const WIDTH = 1240;
const HEIGHT = 1754;
const LEFT = 64;
const RIGHT = WIDTH - LEFT;
const TABLE_TOP = 407;
const COLUMN_WIDTHS = [62, 602, 108, 122, 218];

function wrapLines(ctx: CanvasRenderingContext2D, value: unknown, maxWidth: number): string[] {
  const lines: string[] = [];
  const raw = normalize(value) || '—';
  for (const para of raw.split(/\r?\n/)) {
    let current = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = current ? current + ' ' + word : word;
      if (ctx.measureText(candidate).width <= maxWidth) { current = candidate; continue; }
      if (current) { lines.push(current); current = ''; }
      if (ctx.measureText(word).width <= maxWidth) { current = word; continue; }
      // Preserve full long material codes / IDs rather than clipping or ellipsis.
      let piece = '';
      for (const char of word) {
        if (piece && ctx.measureText(piece + char).width > maxWidth) {
          lines.push(piece);
          piece = char;
        } else piece += char;
      }
      current = piece;
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines : ['—'];
}

function drawTextLines(ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, step: number) {
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * step));
}

export function drawWarehouseVoucherPage(page: WarehouseVoucherPrintPage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không thể tạo bản in phiếu kho trên thiết bị.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = '#334155';
  ctx.font = '500 21px Arial, sans-serif';
  ctx.fillText('Đơn vị: ............................................................', LEFT, 83);
  ctx.fillText('Bộ phận: ........................................................', LEFT, 123);
  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'center';
  ctx.font = 'bold 40px Arial, sans-serif';
  ctx.fillText(page.direction === 'in' ? 'PHIẾU NHẬP KHO' : 'PHIẾU XUẤT KHO', WIDTH / 2, 188);
  ctx.font = '22px Arial, sans-serif';
  ctx.fillStyle = '#475569';
  ctx.fillText('Ngày ' + formatDateDDMMYYYY(page.date) + '  •  Trang ' + page.pageIndex + '/' + page.pageCount, WIDTH / 2, 226);
  ctx.textAlign = 'left';
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(LEFT, 252);
  ctx.lineTo(RIGHT, 252);
  ctx.stroke();

  ctx.font = 'bold 22px Arial, sans-serif';
  ctx.fillStyle = '#334155';
  ctx.fillText('Kho / Vị trí:', LEFT, 298);
  ctx.fillText(page.direction === 'in' ? 'Người giao:' : 'Người nhận:', LEFT, 346);
  ctx.font = '23px Arial, sans-serif';
  ctx.fillStyle = '#0f172a';
  ctx.fillText(normalize(page.location) || '—', 228, 298, 945);
  ctx.fillText(normalize(page.handler) || '—', 228, 346, 945);

  const tableWidth = COLUMN_WIDTHS.reduce((total, width) => total + width, 0);
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(LEFT, TABLE_TOP, tableWidth, 63);
  ctx.strokeStyle = '#94a3b8';
  ctx.strokeRect(LEFT, TABLE_TOP, tableWidth, 63);
  let x = LEFT;
  const labels = ['STT', 'Tên vật tư / thiết bị (quy cách, ghi chú)', 'ĐVT', 'Số lượng', 'Mã giao dịch'];
  ctx.font = 'bold 21px Arial, sans-serif';
  ctx.fillStyle = '#1e293b';
  labels.forEach((label, index) => {
    if (index > 0) {
      ctx.beginPath();
      ctx.moveTo(x, TABLE_TOP);
      ctx.lineTo(x, TABLE_TOP + 63);
      ctx.stroke();
    }
    ctx.textAlign = index === 1 ? 'left' : 'center';
    ctx.fillText(label, index === 1 ? x + 13 : x + COLUMN_WIDTHS[index] / 2, TABLE_TOP + 40, COLUMN_WIDTHS[index] - 14);
    x += COLUMN_WIDTHS[index];
  });
  ctx.textAlign = 'left';

  let rowTop = TABLE_TOP + 63;
  page.rows.forEach((item, index) => {
    ctx.font = '23px Arial, sans-serif';
    const name = wrapLines(ctx, item.materialName, COLUMN_WIDTHS[1] - 26);
    ctx.font = '18px Arial, sans-serif';
    const id = wrapLines(ctx, item.id, COLUMN_WIDTHS[4] - 22);
    const notes = normalize(item.notes);
    const noteLines = notes ? wrapLines(ctx, 'Ghi chú: ' + notes, COLUMN_WIDTHS[1] - 26) : [];
    const h = Math.max(68, 25 + name.length * 29 + noteLines.length * 22, 24 + id.length * 23);
    if (rowTop + h > 1378) throw new Error('Bảng kê vượt chiều cao A4. Cần chia trang trước khi xuất.');
    ctx.fillStyle = index % 2 ? '#f8fafc' : '#ffffff';
    ctx.fillRect(LEFT, rowTop, tableWidth, h);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(LEFT, rowTop, tableWidth, h);
    let cx = LEFT;
    COLUMN_WIDTHS.slice(0, -1).forEach((width) => {
      cx += width;
      ctx.beginPath();
      ctx.moveTo(cx, rowTop);
      ctx.lineTo(cx, rowTop + h);
      ctx.stroke();
    });
    ctx.fillStyle = '#0f172a';
    ctx.font = '21px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(index + 1 + page.rows.length * (page.pageIndex - 1)), LEFT + COLUMN_WIDTHS[0] / 2, rowTop + 35);
    ctx.textAlign = 'left';
    ctx.font = '23px Arial, sans-serif';
    drawTextLines(ctx, name, LEFT + COLUMN_WIDTHS[0] + 13, rowTop + 34, 29);
    if (noteLines.length) {
      ctx.font = '18px Arial, sans-serif';
      ctx.fillStyle = '#475569';
      drawTextLines(ctx, noteLines, LEFT + COLUMN_WIDTHS[0] + 13, rowTop + 34 + name.length * 29, 22);
    }
    let offset = LEFT + COLUMN_WIDTHS[0] + COLUMN_WIDTHS[1];
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.font = '21px Arial, sans-serif';
    ctx.fillText(normalize(item.unit) || '—', offset + COLUMN_WIDTHS[2] / 2, rowTop + 35, COLUMN_WIDTHS[2] - 14);
    offset += COLUMN_WIDTHS[2];
    ctx.font = 'bold 21px Arial, sans-serif';
    ctx.fillText(formatDecimal(Number(item.quantity || 0)), offset + COLUMN_WIDTHS[3] / 2, rowTop + 35, COLUMN_WIDTHS[3] - 14);
    offset += COLUMN_WIDTHS[3];
    ctx.font = '17px Arial, sans-serif';
    drawTextLines(ctx, id, offset + 11, rowTop + 28, 23);
    ctx.textAlign = 'left';
    rowTop += h;
  });

  ctx.strokeStyle = '#94a3b8';
  ctx.strokeRect(LEFT, rowTop, tableWidth, 60);
  ctx.font = 'bold 21px Arial, sans-serif';
  ctx.fillStyle = '#334155';
  ctx.fillText('Số dòng trên trang: ' + page.rows.length, LEFT + 16, rowTop + 38);
  ctx.font = '18px Arial, sans-serif';
  ctx.fillText('Số liệu theo đơn vị từng dòng, không cộng khác ĐVT', LEFT + 410, rowTop + 38);

  const signTop = 1480;
  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'center';
  const signatures = ['Người lập phiếu', page.direction === 'in' ? 'Người giao hàng' : 'Người nhận hàng', 'Thủ kho'];
  signatures.forEach((label, index) => {
    const sx = LEFT + tableWidth * (index + 0.5) / 3;
    ctx.font = 'bold 22px Arial, sans-serif';
    ctx.fillText(label, sx, signTop);
    ctx.font = 'italic 18px Arial, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('(Ký, ghi rõ họ tên)', sx, signTop + 35);
    ctx.fillStyle = '#0f172a';
  });
  ctx.textAlign = 'left';
  ctx.fillStyle = '#64748b';
  ctx.font = '17px Arial, sans-serif';
  ctx.fillText('Bản in từ các giao dịch kho hiện có • Mã giao dịch từng dòng được giữ để đối chiếu', LEFT, HEIGHT - 65, tableWidth);
  return canvas;
}
