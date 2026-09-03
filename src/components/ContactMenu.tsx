import React, { useMemo, useState } from 'react';
import { Copy, ExternalLink, MessageCircle, Phone, Share2, X } from 'lucide-react';
import {
  buildContactShareText,
  callPhone,
  ContactContext,
  ContactTarget,
  copyText,
  getContactPhone,
  isAndroidWebBrowser,
  openZalo,
  sharePreparedText,
} from '../utils/contactUtils';

interface ContactMenuProps {
  target: ContactTarget;
  context?: ContactContext;
  triggerLabel?: string;
  triggerClassName?: string;
  title?: string;
  disabled?: boolean;
}

const defaultTriggerClass = 'inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-extrabold text-emerald-700 hover:bg-emerald-100 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed';

export const ContactMenu: React.FC<ContactMenuProps> = ({
  target,
  context,
  triggerLabel = 'Liên hệ',
  triggerClassName = defaultTriggerClass,
  title,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const phone = useMemo(() => getContactPhone(target), [target.phone, target.zaloPhone]);
  const shareText = String(context?.shareText || buildContactShareText(target)).trim();
  const shareUrl = String(context?.shareUrl || '').trim();

  const showStatus = (message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus(''), 3800);
  };

  const handleCall = () => {
    if (!callPhone(target.phone || target.zaloPhone)) {
      showStatus('Chưa cập nhật số điện thoại hợp lệ.');
      return;
    }
    setOpen(false);
  };

  const handleOpenZalo = async () => {
    if (!phone.valid) {
      showStatus('Chưa cập nhật số điện thoại để liên hệ qua Zalo.');
      return;
    }

    if (openZalo()) {
      setOpen(false);
      return;
    }

    // Android Web: direct Zalo URLs are intentionally avoided because they can
    // redirect to Google Play even when Zalo is installed. Use the OS share sheet.
    if (isAndroidWebBrowser()) {
      const result = await sharePreparedText({
        title: `HNL QLTC – ${target.name || 'Liên hệ'}`,
        text: shareText,
        url: shareUrl,
      });
      if (result === 'shared') {
        setOpen(false);
      } else if (result === 'copied') {
        showStatus('Đã sao chép nội dung. Hãy mở Zalo và dán để gửi.');
      } else if (result === 'cancelled') {
        showStatus('Đã hủy bảng chia sẻ.');
      } else {
        showStatus('Không mở được bảng chia sẻ. Hãy sao chép nội dung và mở Zalo thủ công.');
      }
      return;
    }

    showStatus('Không mở được Zalo trực tiếp. Hãy dùng “Nhắn qua Zalo / Chia sẻ hệ thống”.');
  };

  const handleMessageZalo = async () => {
    if (!phone.valid) {
      showStatus('Chưa cập nhật số điện thoại để liên hệ qua Zalo.');
      return;
    }
    const result = await sharePreparedText({
      title: `HNL QLTC – ${target.name || 'Liên hệ'}`,
      text: shareText,
      url: shareUrl,
    });
    if (result === 'copied') {
      if (!isAndroidWebBrowser()) openZalo();
      showStatus('Đã sao chép nội dung. Hãy mở Zalo và dán để gửi.');
    } else if (result === 'cancelled') {
      showStatus('Đã hủy bảng chia sẻ.');
    } else if (result === 'failed') {
      showStatus('Không thể chia sẻ tự động. Hãy sao chép nội dung để gửi.');
    }
  };

  const handleCopyPhone = async () => {
    if (!phone.original) {
      showStatus('Chưa cập nhật số điện thoại.');
      return;
    }
    showStatus((await copyText(phone.original)) ? 'Đã sao chép số điện thoại.' : 'Không thể sao chép số điện thoại.');
  };

  const handleCopyContent = async () => {
    const content = [shareText, shareUrl].filter(Boolean).join('\n');
    showStatus((await copyText(content)) ? 'Đã sao chép nội dung liên hệ.' : 'Không thể sao chép nội dung.');
  };

  const actionClass = 'w-full flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setStatus(''); setOpen(true); }}
        className={triggerClassName}
        title={`Liên hệ ${target.name || ''}`.trim()}
      >
        <Phone className="w-3.5 h-3.5" />
        <span>{triggerLabel}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[180] flex items-end sm:items-center justify-center bg-slate-950/45 p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
              <div className="min-w-0">
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-600">{title || 'Liên hệ nhanh'}</div>
                <div className="mt-0.5 truncate text-base font-black text-slate-900">{target.name || 'Chưa cập nhật'}</div>
                <div className="mt-0.5 text-xs font-semibold text-slate-500">{phone.original || 'Chưa cập nhật số điện thoại'}</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Đóng">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 p-3.5">
              <button type="button" onClick={handleCall} disabled={!phone.valid} className={actionClass}>
                <Phone className="w-4 h-4 text-emerald-600" />
                <span>Gọi điện</span>
              </button>
              <button type="button" onClick={() => void handleOpenZalo()} disabled={!phone.valid} className={actionClass}>
                <ExternalLink className="w-4 h-4 text-blue-600" />
                <span>{isAndroidWebBrowser() ? 'Mở Zalo qua bảng chia sẻ' : 'Mở Zalo'}</span>
              </button>
              <button type="button" onClick={() => void handleMessageZalo()} disabled={!phone.valid} className={actionClass}>
                <MessageCircle className="w-4 h-4 text-blue-600" />
                <span>Nhắn qua Zalo / Chia sẻ hệ thống</span>
              </button>
              <button type="button" onClick={() => void handleCopyPhone()} disabled={!phone.original} className={actionClass}>
                <Copy className="w-4 h-4 text-slate-500" />
                <span>Sao chép số điện thoại</span>
              </button>
              <button type="button" onClick={() => void handleCopyContent()} disabled={!shareText && !shareUrl} className={actionClass}>
                <Share2 className="w-4 h-4 text-indigo-600" />
                <span>Sao chép nội dung liên hệ</span>
              </button>

              {isAndroidWebBrowser() && phone.valid && (
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[10px] font-semibold text-blue-800">
                  Trên Web Android, HNL QLTC dùng bảng chia sẻ hệ thống để tránh Chrome chuyển nhầm sang Google Play. Hãy chọn Zalo trong danh sách ứng dụng.
                </div>
              )}
              {!phone.valid && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-semibold text-amber-800">
                  Chưa cập nhật số điện thoại. Các hành động gọi/Zalo đang được khóa an toàn.
                </div>
              )}
              {status && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-[10px] font-semibold text-indigo-800">
                  {status}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
