import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Image as ImageIcon, Share2, X } from 'lucide-react';
import { getEntityPhotos, getPhotoDataUrl, PhotoAttachment } from '../utils/photoStorage';
import { copyText } from '../utils/contactUtils';
import { ShareAttachmentPayload, sharePreparedContent } from '../utils/shareUtils';

type ShareEntityType = 'defect' | 'crewRecord';

interface ShareEntityMenuProps {
  projectId?: string;
  entityType: ShareEntityType;
  entityId: string;
  title: string;
  text: string;
  shareUrl?: string;
  legacyImageUrls?: string[];
  triggerLabel?: string;
  triggerClassName?: string;
}

const defaultTriggerClass = 'inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-extrabold text-indigo-700 hover:bg-indigo-100 active:scale-95 transition-all';

const safeFileName = (name: string, fallback: string) => {
  const cleaned = String(name || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ');
  return cleaned || fallback;
};

const urlToDataUrl = async (url: string): Promise<string> => {
  const value = String(url || '').trim();
  if (!value) return '';
  if (value.startsWith('data:')) return value;
  try {
    const response = await fetch(value, { cache: 'no-store' });
    if (!response.ok) return '';
    const blob = await response.blob();
    if (!blob.size) return '';
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch (_) {
    return '';
  }
};

const categoryLabel = (photo: PhotoAttachment) => {
  if (photo.category === 'defect_before') return 'Ảnh trước sửa';
  if (photo.category === 'defect_after') return 'Ảnh sau sửa';
  if (photo.category === 'crew_progress') return 'Ảnh hiện trường';
  return 'Ảnh đính kèm';
};

export const ShareEntityMenu: React.FC<ShareEntityMenuProps> = ({
  projectId,
  entityType,
  entityId,
  title,
  text,
  shareUrl,
  legacyImageUrls = [],
  triggerLabel = 'Chia sẻ',
  triggerClassName = defaultTriggerClass,
}) => {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<PhotoAttachment[]>([]);
  const [includeImages, setIncludeImages] = useState(false);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [status, setStatus] = useState('');

  const legacyUrls = useMemo(
    () => Array.from(new Set(legacyImageUrls.map((value) => String(value || '').trim()).filter(Boolean))),
    [legacyImageUrls.join('|')]
  );
  const availableImageCount = photos.length > 0 ? photos.length : legacyUrls.length;

  useEffect(() => {
    if (!open || !projectId || !entityId) return;
    let cancelled = false;
    setLoadingPhotos(true);
    getEntityPhotos(projectId, entityType, entityId)
      .then((rows) => { if (!cancelled) setPhotos(rows.filter((row) => !row.deleted && !row.deletedAt).slice(0, 12)); })
      .catch(() => { if (!cancelled) setPhotos([]); })
      .finally(() => { if (!cancelled) setLoadingPhotos(false); });
    return () => { cancelled = true; };
  }, [open, projectId, entityType, entityId]);

  const resolveAttachments = async (): Promise<ShareAttachmentPayload[]> => {
    if (!includeImages) return [];
    const attachments: ShareAttachmentPayload[] = [];
    const seen = new Set<string>();

    for (const photo of photos.slice(0, 6)) {
      const dataUrl = await getPhotoDataUrl(
        photo.id,
        photo.dataUrl || photo.localUri || photo.cloudUrl || '',
        false,
        projectId || ''
      ).catch(() => '');
      if (!dataUrl || seen.has(dataUrl)) continue;
      seen.add(dataUrl);
      attachments.push({
        id: photo.id,
        fileName: safeFileName(photo.fileName, `HNL-QLTC-${entityType}-${photo.id}.jpg`),
        mimeType: photo.mimeType || 'image/jpeg',
        dataUrl,
      });
    }

    if (attachments.length === 0) {
      for (let index = 0; index < legacyUrls.length && attachments.length < 6; index += 1) {
        const dataUrl = await urlToDataUrl(legacyUrls[index]);
        if (!dataUrl || seen.has(dataUrl)) continue;
        seen.add(dataUrl);
        attachments.push({
          id: `legacy-${index}`,
          fileName: `HNL-QLTC-${entityType}-${index + 1}.jpg`,
          mimeType: dataUrl.match(/^data:([^;,]+)/)?.[1] || 'image/jpeg',
          dataUrl,
        });
      }
    }
    return attachments;
  };

  const handleShare = async () => {
    if (!text.trim() && !shareUrl?.trim()) {
      setStatus('Không có nội dung để chia sẻ.');
      return;
    }
    setSharing(true);
    setStatus(includeImages ? 'Đang chuẩn bị ảnh để chia sẻ…' : 'Đang mở bảng chia sẻ…');
    try {
      const attachments = await resolveAttachments();
      const result = await sharePreparedContent({ title, text, url: shareUrl, attachments });
      if (result.status === 'shared') {
        if (result.fallbackToText) setStatus('Thiết bị không hỗ trợ gửi kèm file; đã mở chia sẻ phần nội dung chữ.');
        else if (result.sharedFiles > 0) setStatus(`Đã mở bảng chia sẻ với ${result.sharedFiles} ảnh.`);
        else setStatus('Đã mở bảng chia sẻ hệ thống.');
      } else if (result.status === 'copied') {
        setStatus(result.fallbackToText
          ? 'Không gửi kèm ảnh được trên trình duyệt này. Nội dung chữ đã được sao chép.'
          : 'Nội dung đã được sao chép.');
      } else if (result.status === 'cancelled') {
        setStatus('Đã hủy bảng chia sẻ.');
      } else {
        setStatus('Không thể mở bảng chia sẻ. Hãy dùng nút Sao chép nội dung.');
      }
    } catch (error: any) {
      setStatus(`Không thể chia sẻ: ${error?.message || String(error)}`);
    } finally {
      setSharing(false);
    }
  };

  const handleCopy = async () => {
    const combined = [text.trim(), String(shareUrl || '').trim()].filter(Boolean).join('\n');
    setStatus((await copyText(combined)) ? 'Đã sao chép nội dung.' : 'Không thể sao chép nội dung.');
  };

  return (
    <>
      <button type="button" onClick={() => { setStatus(''); setIncludeImages(false); setOpen(true); }} className={triggerClassName}>
        <Share2 className="w-3.5 h-3.5" />
        <span>{triggerLabel}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[185] flex items-end sm:items-center justify-center bg-slate-950/45 p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
              <div className="min-w-0">
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-600">Chia sẻ qua ứng dụng trên thiết bị</div>
                <div className="mt-0.5 truncate text-base font-black text-slate-900">{title}</div>
                <div className="mt-0.5 text-[10px] font-semibold text-slate-500">Zalo · Messenger · Telegram · Gmail · SMS · ứng dụng khác</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Đóng">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 p-4">
              <div>
                <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Nội dung chữ</div>
                <div className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] font-semibold leading-relaxed text-slate-700">
                  {text || 'Không có nội dung.'}
                </div>
              </div>

              <label className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${availableImageCount > 0 ? 'border-indigo-200 bg-indigo-50/60 cursor-pointer' : 'border-slate-200 bg-slate-50 opacity-60'}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <ImageIcon className="h-4 w-4 shrink-0 text-indigo-600" />
                  <span>
                    <span className="block text-xs font-extrabold text-slate-800">Kèm hình ảnh</span>
                    <span className="block text-[10px] font-semibold text-slate-500">
                      {loadingPhotos ? 'Đang kiểm tra ảnh…' : availableImageCount > 0 ? `${availableImageCount} ảnh có sẵn · gửi tối đa 6 ảnh` : 'Không có ảnh đính kèm'}
                    </span>
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={includeImages && availableImageCount > 0}
                  disabled={availableImageCount === 0 || loadingPhotos}
                  onChange={(event) => setIncludeImages(event.target.checked)}
                  className="h-4 w-4 accent-indigo-600"
                />
              </label>

              {photos.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {photos.slice(0, 6).map((photo) => (
                    <span key={photo.id} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[9px] font-bold text-slate-600">
                      {categoryLabel(photo)}
                    </span>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => void handleCopy()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50">
                  <Copy className="h-4 w-4" /> Sao chép
                </button>
                <button type="button" disabled={sharing} onClick={() => void handleShare()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-extrabold text-white hover:bg-indigo-700 disabled:opacity-50">
                  <Share2 className="h-4 w-4" /> {sharing ? 'Đang chuẩn bị…' : 'Chia sẻ'}
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-semibold leading-relaxed text-slate-600">
                HNL QLTC chỉ gửi nội dung sau khi bạn bấm Chia sẻ. Ảnh không được tự động đính kèm; bật “Kèm hình ảnh” nếu muốn gửi ảnh thật qua bảng chia sẻ của hệ điều hành.
              </div>
              {status && <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-[10px] font-semibold text-indigo-800">{status}</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
