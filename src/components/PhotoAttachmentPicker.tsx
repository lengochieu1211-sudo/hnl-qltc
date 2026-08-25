import React, { useState, useEffect, useRef } from 'react';
import { Camera, Image as ImageIcon, Images, Eye, Loader2, X, Pencil } from 'lucide-react';
import { PhotoAttachment, getEntityPhotos, getProjectPhotos, savePhotoAttachment, deletePhotoAttachment, getPhotoDataUrl, updatePhotoAttachmentBlob } from '../utils/photoStorage';
import { uploadPhotoToCloud } from '../lib/photoCloudSync';
import { ImageViewerModal } from './ImageViewerModal';
import { ImageEditorModal } from './ImageEditorModal';
import { confirmAsync } from '../utils/confirmAsync';
import { QuickSortBar } from './QuickSortBar';

interface PhotoAttachmentPickerProps {
  projectId: string;
  entityType: 'crewRecord' | 'defect' | 'chat';
  entityId: string;
  category?: 'crew_progress' | 'defect_before' | 'defect_after';
  label?: string;
  maxPhotos?: number;
  readOnly?: boolean;
  onPhotosChanged?: (photos: PhotoAttachment[]) => void;
}

const notifyPhotoAttachmentsChanged = (detail?: Record<string, any>) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('qlct-photo-attachments-changed', { detail }));
  }
};

const revokeBlobUrl = (url?: string) => {
  if (url && url.startsWith('blob:')) {
    try { URL.revokeObjectURL(url); } catch {}
  }
};


export const PhotoAttachmentPicker: React.FC<PhotoAttachmentPickerProps> = ({
  projectId,
  entityType,
  entityId,
  category = 'crew_progress' as const,
  label = 'HÌNH ẢNH HIỆN TRƯỜNG',
  maxPhotos = 10,
  readOnly = false,
  onPhotosChanged
}) => {
  const [photos, setPhotos] = useState<PhotoAttachment[]>([]);
  const [photoDataUrls, setPhotoDataUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);
  const [photoSortBy, setPhotoSortBy] = useState<'date' | 'name' | 'size'>('date');
  const [photoSortOrder, setPhotoSortOrder] = useState<'asc' | 'desc'>('desc');
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);
  const pickerInstanceIdRef = useRef(`photo-picker-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  const photoDataUrlsRef = useRef<Record<string, string>>({});
  const loadSeqRef = useRef(0);
  
  // Image editor state
  const [editingPhoto, setEditingPhoto] = useState<{ id: string; url: string } | null>(null);

  const loadPhotos = async () => {
    const loadSeq = ++loadSeqRef.current;
    if (!projectId || !entityId) {
      setPhotos([]);
      setPhotoDataUrls((prev) => {
        Object.values(prev).forEach(revokeBlobUrl);
        photoDataUrlsRef.current = {};
        return {};
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const items = await getEntityPhotos(projectId, entityType, entityId, category);
      setPhotos(items);
      
      // Load data URLs / thumbnails asynchronously
      const urlMap: Record<string, string> = {};
      await Promise.all(
        items.map(async (p) => {
          const url = p.localUri || await getPhotoDataUrl(p.id, p.cloudUrl || p.cloudFileId, true);
          if (url) urlMap[p.id] = url;
        })
      );
      if (loadSeq !== loadSeqRef.current) {
        Object.values(urlMap).forEach(revokeBlobUrl);
        return;
      }
      setPhotoDataUrls((prev) => {
        Object.values(prev).forEach(revokeBlobUrl);
        photoDataUrlsRef.current = urlMap;
        return urlMap;
      });

      if (onPhotosChanged) onPhotosChanged(items);
    } catch (err) {
      console.error('Error loading photo attachments:', err);
    } finally {
      if (loadSeq === loadSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadPhotos();
    const handleExternalPhotoChange = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      if (detail.originId && detail.originId === pickerInstanceIdRef.current) return;
      if (detail.source === 'cloud' && Array.isArray(detail.entities)) {
        const relevant = detail.entities.some((item: any) =>
          item?.entityType === entityType &&
          item?.entityId === entityId &&
          (!item?.category || item.category === category)
        );
        if (!relevant) return;
      } else {
        if (detail.entityType && detail.entityType !== entityType) return;
        if (detail.entityId && detail.entityId !== entityId) return;
        if (detail.category && detail.category !== category) return;
      }
      loadPhotos().catch(() => {});
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('qlct-photo-attachments-changed', handleExternalPhotoChange);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('qlct-photo-attachments-changed', handleExternalPhotoChange);
      }
    };
  }, [projectId, entityType, entityId, category]);

  useEffect(() => {
    photoDataUrlsRef.current = photoDataUrls;
  }, [photoDataUrls]);

  useEffect(() => () => {
    loadSeqRef.current += 1;
    Object.values(photoDataUrlsRef.current).forEach(revokeBlobUrl);
  }, []);

  const processSelectedFiles = async (files: FileList | File[] | null) => {
    const selected = files ? Array.from(files) : [];
    if (selected.length === 0 || !projectId || !entityId) return;

    if (photos.length + selected.length > maxPhotos) {
      alert(`Bạn chỉ có thể chèn tối đa ${maxPhotos} ảnh!`);
      return;
    }

    const imageNamePattern = /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i;
    const invalid = selected.find((file) => {
      const mime = (file.type || '').toLowerCase();
      // Android/Xiaomi document pickers sometimes return an empty MIME type for valid images.
      return mime ? !mime.startsWith('image/') : !imageNamePattern.test(file.name || '');
    });
    if (invalid) {
      alert(`Tệp "${invalid.name || 'đã chọn'}" không phải hình ảnh hợp lệ.`);
      return;
    }

    setUploading(true);
    try {
      const savedNow: PhotoAttachment[] = [];
      const optimisticUrls: Record<string, string> = {};

      for (const file of selected) {
        // Some Android galleries return HEIC/HEIF. Browser decoding support differs by device,
        // so fail with a useful message instead of saving a broken attachment.
        const type = (file.type || '').toLowerCase();
        const name = (file.name || '').toLowerCase();
        if (type.includes('heic') || type.includes('heif') || name.endsWith('.heic') || name.endsWith('.heif')) {
          throw new Error('Ảnh HEIC/HEIF chưa được trình duyệt này hỗ trợ. Hãy chọn JPG/PNG/WebP hoặc đổi Camera sang định dạng JPG.');
        }

        const saved = await savePhotoAttachment(
          {
            projectId,
            entityType,
            entityId,
            category,
            fileName: file.name || `QLCT_${Date.now()}.jpg`,
            mimeType: file.type || 'image/jpeg',
            fileSize: file.size,
          },
          file
        );
        savedNow.push(saved);
        if (saved.localUri) optimisticUrls[saved.id] = saved.localUri;
        // V6.2.25: start the binary upload immediately after IndexedDB commit.
        // The old 1.8s mobile debounce could be cancelled when the user locked the
        // phone/closed the app, leaving the photo visible only on the capture device.
        void uploadPhotoToCloud(projectId, saved).catch((err) =>
          console.warn('[Photo Picker] immediate cloud upload pending retry:', saved.id, err)
        );
      }

      // Render immediately from the just-compressed data URL. Do not wait for IndexedDB/cloud
      // round-trips; this fixes the "saved but image does not appear" behavior on mobile.
      if (savedNow.length > 0) {
        setPhotos((prev) => [...savedNow, ...prev.filter((p) => !savedNow.some((n) => n.id === p.id))]);
        setPhotoDataUrls((prev) => {
          const next = { ...prev, ...optimisticUrls };
          Object.keys(optimisticUrls).forEach((id) => {
            if (prev[id] && prev[id] !== optimisticUrls[id]) revokeBlobUrl(prev[id]);
          });
          photoDataUrlsRef.current = next;
          return next;
        });
      }

      notifyPhotoAttachmentsChanged({
        operation: 'add',
        entityType,
        entityId,
        category,
        count: savedNow.length,
        originId: pickerInstanceIdRef.current,
      });
      // No immediate self-reload: the optimistic thumbnail is already correct.
      // Avoiding a second IndexedDB pass materially reduces mobile RAM/CPU spikes.
    } catch (err: any) {
      console.error('Error uploading photo:', err);
      alert(err?.message || 'Có lỗi xảy ra khi xử lý ảnh. Vui lòng thử lại.');
    } finally {
      setUploading(false);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (libraryInputRef.current) libraryInputRef.current.value = '';
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await processSelectedFiles(e.target.files);
  };

  const handleDeletePhoto = async (photoId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const confirmed = await confirmAsync('Xóa ảnh này?\n\nBạn có chắc muốn xóa ảnh này không?');
    if (!confirmed) return;
    try {
      await deletePhotoAttachment(projectId, photoId);
      const deletedPhoto = (await getProjectPhotos(projectId, true)).find((p) => p.id === photoId);
      if (deletedPhoto) {
        void uploadPhotoToCloud(projectId, deletedPhoto).catch((err) =>
          console.warn('[Photo Picker] immediate cloud delete pending retry:', photoId, err)
        );
      }
      notifyPhotoAttachmentsChanged({ operation: 'delete', entityType, entityId, category, photoId, originId: pickerInstanceIdRef.current });
      await loadPhotos();
    } catch (err) {
      console.error('Error deleting photo:', err);
    }
  };

  const closeEditingPhoto = () => {
    if (editingPhoto?.url) revokeBlobUrl(editingPhoto.url);
    setEditingPhoto(null);
  };

  const handleStartEditPhoto = async (photo: PhotoAttachment, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const fullUrl = await getPhotoDataUrl(photo.id, photo.cloudUrl || photo.cloudFileId, false);
      if (fullUrl) {
        if (editingPhoto?.url) revokeBlobUrl(editingPhoto.url);
        setEditingPhoto({ id: photo.id, url: fullUrl });
      }
    } catch (err) {
      console.error('Error getting photo for edit:', err);
    }
  };

  const handleSaveEditedPhoto = async (editedFile: File) => {
    if (!editingPhoto || !projectId) return;
    try {
      setUploading(true);
      await updatePhotoAttachmentBlob(projectId, editingPhoto.id, editedFile);
      const editedPhotoMeta = (await getProjectPhotos(projectId, true)).find((p) => p.id === editingPhoto.id);
      if (editedPhotoMeta) {
        void uploadPhotoToCloud(projectId, editedPhotoMeta).catch((err) =>
          console.warn('[Photo Picker] immediate edited-photo upload pending retry:', editingPhoto.id, err)
        );
      }
      closeEditingPhoto();
      notifyPhotoAttachmentsChanged({ operation: 'edit', entityType, entityId, category, photoId: editingPhoto.id, originId: pickerInstanceIdRef.current });
      await loadPhotos();
    } catch (err) {
      console.error('Error saving edited photo:', err);
      alert('Không thể lưu ảnh đã chỉnh sửa');
    } finally {
      setUploading(false);
    }
  };

  const sortedPhotos = [...photos].sort((a, b) => {
    let comparison = 0;
    if (photoSortBy === 'name') {
      comparison = (a.fileName || '').localeCompare(b.fileName || '', 'vi', { numeric: true, sensitivity: 'base' });
    } else if (photoSortBy === 'size') {
      comparison = (Number(a.fileSize) || 0) - (Number(b.fileSize) || 0);
    } else {
      comparison = (Number(a.takenAt || a.createdAt) || 0) - (Number(b.takenAt || b.createdAt) || 0);
    }
    return photoSortOrder === 'asc' ? comparison : -comparison;
  });
  const photoImageUrls = sortedPhotos.map(p => photoDataUrls[p.id] || p.localUri || p.cloudUrl || '');
  const imageUrls = photoImageUrls.filter(Boolean);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-xs font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
          <Camera className="w-4 h-4 text-blue-600" />
          {label} ({photos.length}/{maxPhotos})
        </label>
        {!readOnly && photos.length < maxPhotos && (
          <div className="flex items-center gap-1.5">
            {/* Chụp ảnh trực tiếp qua máy ảnh */}
            <label className="cursor-pointer inline-flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2.5 py-1 rounded-md transition-colors shadow-sm">
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
              <span>Chụp ảnh</span>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
                disabled={uploading}
              />
            </label>

            {/* Chọn ảnh đã chụp sẵn từ thư viện / bộ sưu tập */}
            <label className="cursor-pointer inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-md transition-colors shadow-sm">
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Images className="w-3.5 h-3.5 text-emerald-600" />}
              <span>Thư viện</span>
              <input
                ref={libraryInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
                disabled={uploading}
              />
            </label>
          </div>
        )}
      </div>

      <QuickSortBar
        itemCount={photos.length}
        options={[
          { key: 'date', label: 'Ngày ảnh', kind: 'date', defaultOrder: 'desc' },
          { key: 'name', label: 'Tên tệp', kind: 'alpha' },
          { key: 'size', label: 'Dung lượng', kind: 'number' },
        ]}
        activeKey={photoSortBy}
        order={photoSortOrder}
        onChange={(key, order) => { setPhotoSortBy(key); setPhotoSortOrder(order); }}
        onReset={() => { setPhotoSortBy('date'); setPhotoSortOrder('desc'); }}
        summary={`${photos.length} ảnh`}
      />

      {loading ? (
        <div className="flex items-center justify-center p-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-400 text-xs">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Đang tải hình ảnh...
        </div>
      ) : photos.length === 0 ? (
        <div className="p-3 bg-slate-50 border border-dashed border-slate-300 rounded-lg text-center text-slate-400 text-xs">
          {readOnly
            ? 'Chưa có hình ảnh được đính kèm'
            : 'Chưa có hình ảnh được đính kèm (Bấm "Chụp ảnh" hoặc "Thư viện" để thêm ảnh)'}
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {sortedPhotos.map((photo, index) => {
            const url = photoDataUrls[photo.id] || photo.localUri || photo.cloudUrl;
            return (
              <div
                key={photo.id}
                onClick={() => {
                  const viewableIndex = photoImageUrls.slice(0, index + 1).filter(Boolean).length - 1;
                  if (viewableIndex >= 0) {
                    setViewingIndex(viewableIndex);
                  }
                }}
                className="relative group aspect-square rounded-lg border border-slate-200 overflow-hidden bg-slate-100 cursor-pointer hover:border-blue-400 transition-all shadow-sm"
              >
                {url ? (
                  <img
                    src={url}
                    alt={photo.fileName || 'Photo'}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400">
                    <ImageIcon className="w-6 h-6" />
                  </div>
                )}
                
                {/* Control Action Overlay & Top-Right Delete X */}
                {!readOnly && (
                  <div className="absolute top-1 right-1 flex items-center gap-1 z-10">
                    <button
                      type="button"
                      onClick={(e) => handleStartEditPhoto(photo, e)}
                      className="p-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-md transition-transform active:scale-90"
                      title="Vẽ / Ghi chú trên ảnh"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDeletePhoto(photo.id, e)}
                      className="p-1 bg-rose-600 hover:bg-rose-700 text-white rounded-full shadow-md transition-transform active:scale-90"
                      title="Xóa ảnh này"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <span className="p-1.5 bg-white/90 text-slate-800 rounded-full hover:bg-white transition-colors">
                    <Eye className="w-4 h-4" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewingIndex !== null && (
        <ImageViewerModal
          isOpen={viewingIndex !== null}
          onClose={() => setViewingIndex(null)}
          images={imageUrls}
          initialIndex={viewingIndex}
        />
      )}

      {editingPhoto && (
        <ImageEditorModal
          isOpen={!!editingPhoto}
          onClose={closeEditingPhoto}
          imageUrl={editingPhoto.url}
          onSave={handleSaveEditedPhoto}
        />
      )}
    </div>
  );
};
