import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Share2 } from 'lucide-react';
import type { InventoryItem } from '../types';
import { formatDateDDMMYYYY } from '../utils/dateFormatter';
import { formatDecimal } from '../utils/numberUtils';
import { ContextBackButton } from './ContextBackButton';
import { PhotoAttachmentPicker } from './PhotoAttachmentPicker';

/** Read-only view of the exact original warehouse transaction, never a new ledger entry. */
export const WarehouseVoucherDetailSheet: React.FC<{
  voucher: InventoryItem | null;
  projectId: string;
  projectName: string;
  projectLocation?: string;
  contractorName?: string;
  teamName?: string;
  backLabel: string;
  onBack: () => void;
  onShare?: () => void;
}> = ({ voucher, projectId, projectName, projectLocation, contractorName, teamName, backLabel, onBack, onShare }) => {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onBack();
    };
    document.addEventListener('keydown', onKeyDown);
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('[data-hnl-direct-voucher-back="true"]')?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onBack]);

  const direction = voucher?.type === 'in' ? 'NHẬP' : 'XUẤT';
  const details = voucher ? [
    ['Ngày lập', formatDateDDMMYYYY(voucher.date)],
    ['Người thực hiện', voucher.handler || '—'],
    ['Vị trí / Kho', voucher.location || '—'],
    ['Loại hàng', voucher.itemKind === 'equipment' ? 'Thiết bị' : 'Vật tư'],
    ...(voucher.sourceTeamId ? [['Đội nhận', teamName || `Mã đội: ${voucher.sourceTeamId}`]] : []),
    ...(voucher.warehouseTransferId ? [['Mã điều chuyển', voucher.warehouseTransferId]] : []),
  ] : [];

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div data-hnl-warehouse-direct-voucher="true" className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <section role="dialog" aria-modal="true" aria-label={voucher ? `Phiếu ${direction.toLowerCase()} kho ${voucher.id}` : 'Phiếu kho không còn khả dụng'}
        className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-slate-50 shadow-2xl sm:max-h-[94dvh] sm:max-w-3xl sm:rounded-2xl">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5">
          <ContextBackButton label={backLabel} onClick={onBack} data-hnl-direct-voucher-back="true" />
          <span className="min-w-0 truncate text-xs font-bold text-slate-500">Chi tiết phiếu kho · Chỉ đọc</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-5">
          {voucher ? (
            <div data-hnl-warehouse-direct-voucher-id={voucher.id} className="mx-auto space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="space-y-1 border-b-2 border-slate-800 pb-4 text-center">
                <p className="break-words text-xs font-bold uppercase text-slate-600">{contractorName || projectName}</p>
                {contractorName && <p className="break-words text-xs text-slate-600">Dự án: {projectName}</p>}
                {projectLocation && <p className="break-words text-[11px] text-slate-500">{projectLocation}</p>}
                <h2 className="pt-2 text-xl font-extrabold tracking-wide text-slate-900">PHIẾU {direction} KHO</h2>
                <p className="break-all text-xs font-semibold text-slate-600">Mã phiếu: {voucher.id}</p>
              </div>
              <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {details.map(([label, value]) => (
                  <div key={label} className="flex min-w-0 justify-between gap-3 border-b border-slate-100 py-1 text-xs sm:items-baseline">
                    <span className="shrink-0 text-slate-500">{label}</span>
                    <span className="min-w-0 break-words text-right font-bold text-slate-800">{value}</span>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[340px] text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700"><tr>
                    <th className="p-2">Vật tư / Thiết bị</th><th className="p-2 text-right">Số lượng</th><th className="p-2 text-right">ĐVT</th>
                  </tr></thead>
                  <tbody><tr>
                    <td className="p-2 font-semibold text-slate-900">{voucher.materialName}</td>
                    <td className="p-2 text-right font-extrabold text-slate-900">{formatDecimal(voucher.quantity)}</td>
                    <td className="p-2 text-right text-slate-600">{voucher.unit}</td>
                  </tr></tbody>
                </table>
              </div>
              {voucher.notes && <div className="break-words rounded-lg bg-slate-50 p-3 text-xs text-slate-700"><strong>Ghi chú:</strong> {voucher.notes}</div>}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                {projectId && <div className="min-w-0" data-hnl-direct-voucher-photos={voucher.id}>
                  <PhotoAttachmentPicker key={`${projectId}:${voucher.id}`} projectId={projectId} entityType="inventory" entityId={voucher.id}
                    category="warehouse_receipt" label="Ảnh giao nhận" maxPhotos={10} readOnly compactViewerButton />
                </div>}
                {onShare && <button type="button" data-hnl-direct-voucher-share={voucher.id} onClick={onShare}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700">
                  <Share2 className="h-4 w-4" /> Xuất PDF / Ảnh / Excel / Chia sẻ
                </button>}
              </div>
            </div>
          ) : (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
              Phiếu không còn trong dữ liệu dự án hiện tại hoặc chưa xác minh được quyền truy cập. Quay lại và đồng bộ dữ liệu trước khi mở lại.
            </div>
          )}
        </div>
      </section>
    </div>, document.body,
  );
};
