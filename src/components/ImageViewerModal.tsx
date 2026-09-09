import React, { useState, useRef, useEffect } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, Download, Share2, Loader2 } from 'lucide-react';
import { saveBlobToDownloads } from '../utils/fileExport';
import { sharePreparedContent } from '../utils/shareUtils';

interface ImageViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl?: string;
  images?: string[];
  initialIndex?: number;
}

export const ImageViewerModal: React.FC<ImageViewerModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  images,
  initialIndex = 0
}) => {
  const allImages = images && images.length > 0 ? images : (imageUrl ? [imageUrl] : []);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [mediaAction, setMediaAction] = useState<'download' | 'share' | null>(null);
  const [mediaActionMessage, setMediaActionMessage] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  
  const initialDistRef = useRef(0);
  const initialScaleRef = useRef(1);
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const onCloseRef = useRef(onClose);
  const pushedHistoryRef = useRef(false);
  const closedFromHistoryRef = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex >= 0 && initialIndex < allImages.length ? initialIndex : 0);
      setScale(1);
      setPosition({ x: 0, y: 0 });
      setMediaAction(null);
      setMediaActionMessage('');
    }
  }, [isOpen, initialIndex, images, imageUrl]);

  useEffect(() => {
    if (!isOpen) return;

    try {
      window.history.pushState({ qlctImageViewer: true }, '');
      pushedHistoryRef.current = true;
      closedFromHistoryRef.current = false;
    } catch (_) {}

    const onPopState = () => {
      if (!pushedHistoryRef.current) return;
      pushedHistoryRef.current = false;
      closedFromHistoryRef.current = true;
      onCloseRef.current();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
      } else if (event.key === 'ArrowLeft') {
        handlePrev();
      } else if (event.key === 'ArrowRight') {
        handleNext();
      }
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKeyDown);
      if (pushedHistoryRef.current && !closedFromHistoryRef.current) {
        pushedHistoryRef.current = false;
        try {
          window.history.back();
        } catch (_) {}
      }
      closedFromHistoryRef.current = false;
    };
  }, [isOpen]);

  const activeImage = allImages[currentIndex] || imageUrl || '';

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(c => c - 1);
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  };

  const handleNext = () => {
    if (currentIndex < allImages.length - 1) {
      setCurrentIndex(c => c + 1);
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isOpen) return;
    
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1 && scale <= 1) {
        swipeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else {
        swipeStartRef.current = null;
      }
      if (e.touches.length === 2) {
        e.preventDefault();
        initialDistRef.current = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        initialScaleRef.current = scale;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && initialDistRef.current > 0) {
        e.preventDefault();
        swipeStartRef.current = null;
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const newScale = Math.min(5, Math.max(1, initialScaleRef.current * (dist / initialDistRef.current)));
        setScale(newScale);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) initialDistRef.current = 0;
      const start = swipeStartRef.current;
      swipeStartRef.current = null;
      if (!start || scale > 1 || e.changedTouches.length === 0) return;
      const end = e.changedTouches[0];
      const dx = end.clientX - start.x;
      const dy = end.clientY - start.y;
      if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.15) return;
      if (dx < 0) handleNext();
      else handlePrev();
    };

    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onTouchEnd);

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isOpen, scale, currentIndex, allImages.length]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (scale <= 1) return;
    isDraggingRef.current = true;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch(err){}
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastPosRef.current.x;
    const dy = e.clientY - lastPosRef.current.y;
    setPosition(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    lastPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDraggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch(err){}
  };

  const loadActiveImageBlob = async (): Promise<Blob> => {
    if (!activeImage) throw new Error('Không có ảnh để xử lý.');
    const response = await fetch(activeImage, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Không tải được ảnh (${response.status}).`);
    const blob = await response.blob();
    if (!blob.size) throw new Error('Ảnh tải về rỗng.');
    return blob;
  };

  const extensionForMime = (mimeType: string) => {
    const mime = String(mimeType || '').toLowerCase();
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    return 'jpg';
  };

  const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Không đọc được ảnh để chia sẻ.'));
    reader.readAsDataURL(blob);
  });

  const handleDownload = async () => {
    if (!activeImage || mediaAction) return;
    setMediaAction('download');
    setMediaActionMessage('');
    try {
      const blob = await loadActiveImageBlob();
      const fileName = `HNL-QLTC-anh-${currentIndex + 1}-${Date.now()}.${extensionForMime(blob.type)}`;
      await saveBlobToDownloads(blob, fileName, blob.type || 'image/jpeg');
      setMediaActionMessage('Đã tải ảnh xuống.');
    } catch (error: any) {
      setMediaActionMessage(error?.message || 'Không thể tải ảnh xuống.');
    } finally {
      setMediaAction(null);
    }
  };

  const handleShare = async () => {
    if (!activeImage || mediaAction) return;
    setMediaAction('share');
    setMediaActionMessage('');
    try {
      const blob = await loadActiveImageBlob();
      const mimeType = blob.type || 'image/jpeg';
      const fileName = `HNL-QLTC-anh-${currentIndex + 1}.${extensionForMime(mimeType)}`;
      const dataUrl = await blobToDataUrl(blob);
      const result = await sharePreparedContent({
        title: 'HNL QLTC - Chia sẻ ảnh',
        text: 'Ảnh hiện trường từ HNL QLTC',
        attachments: [{ id: `viewer-${currentIndex + 1}`, fileName, mimeType, dataUrl }],
        allowTextFallback: false,
      });
      if (result.status === 'cancelled') return;
      if (result.status !== 'shared' || result.sharedFiles < 1) {
        throw new Error('Thiết bị/trình duyệt chưa hỗ trợ chia sẻ file ảnh. Hãy dùng Tải xuống.');
      }
      setMediaActionMessage('Đã mở chia sẻ ảnh.');
    } catch (error: any) {
      setMediaActionMessage(error?.message || 'Không thể chia sẻ ảnh.');
    } finally {
      setMediaAction(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/95 z-[200] flex flex-col animate-in fade-in">
      <div className="flex items-center justify-between p-4 text-white z-10 bg-gradient-to-b from-slate-950 to-transparent">
        <h3 className="font-bold text-sm">
          Xem chi tiết ảnh {allImages.length > 1 ? `(${currentIndex + 1}/${allImages.length})` : ''}
        </h3>
        <button onClick={onClose} className="p-2 bg-slate-800/80 hover:bg-slate-700 rounded-full transition-colors backdrop-blur-sm">
          <X className="w-5 h-5" />
        </button>
      </div>
      
      <div 
        ref={containerRef}
        className="flex-1 flex items-center justify-center overflow-hidden touch-none relative"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {allImages.length > 1 && currentIndex > 0 && (
          <button 
            onClick={handlePrev}
            className="absolute left-4 z-20 p-3 bg-slate-900/80 hover:bg-slate-800 text-white rounded-full shadow-lg transition-colors"
          >
            ‹
          </button>
        )}

        {activeImage ? (
          <img 
            src={activeImage} 
            alt="Full Photo" 
            referrerPolicy="no-referrer" 
            crossOrigin="anonymous"
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transition: isDraggingRef.current ? 'none' : 'transform 0.1s ease-out'
            }}
            className="max-w-full max-h-[80vh] object-contain pointer-events-none" 
          />
        ) : (
          <div className="text-white/60 font-bold text-sm">Không có hình ảnh để hiển thị</div>
        )}

        {allImages.length > 1 && currentIndex < allImages.length - 1 && (
          <button 
            onClick={handleNext}
            className="absolute right-4 z-20 p-3 bg-slate-900/80 hover:bg-slate-800 text-white rounded-full shadow-lg transition-colors"
          >
            ›
          </button>
        )}
      </div>
      
      <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 z-10 bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent">
        <div className="flex items-center justify-center gap-4">
          <button onClick={() => setScale(s => Math.max(1, s - 0.5))} className="p-3 bg-slate-800 rounded-full text-white" aria-label="Thu nhỏ ảnh">
            <ZoomOut className="w-5 h-5" />
          </button>
          <span className="text-white font-bold min-w-[3rem] text-center">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => Math.min(5, s + 0.5))} className="p-3 bg-slate-800 rounded-full text-white" aria-label="Phóng to ảnh">
            <ZoomIn className="w-5 h-5" />
          </button>
          {scale > 1 && (
            <button onClick={() => { setScale(1); setPosition({x:0, y:0}); }} className="p-3 bg-slate-800 rounded-full text-white" aria-label="Đặt lại ảnh">
              <RotateCcw className="w-5 h-5" />
            </button>
          )}
        </div>

        {activeImage && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={Boolean(mediaAction)}
              className="min-w-[8.5rem] px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 border border-white/10"
            >
              {mediaAction === 'download' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Tải xuống
            </button>
            <button
              type="button"
              onClick={handleShare}
              disabled={Boolean(mediaAction)}
              className="min-w-[8.5rem] px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2"
            >
              {mediaAction === 'share' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
              Chia sẻ
            </button>
          </div>
        )}
        {mediaActionMessage && (
          <div className="mt-2 text-center text-xs font-semibold text-slate-200" role="status">
            {mediaActionMessage}
          </div>
        )}
      </div>
    </div>
  );
};
