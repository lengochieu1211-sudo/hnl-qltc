import React, { useState, useEffect } from 'react';
import { Camera, Image as ImageIcon, Images, Eye, Loader2, X, Pencil } from 'lucide-react';
import { PhotoAttachment, getEntityPhotos, savePhotoAttachment, deletePhotoAttachment, getPhotoDataUrl, updatePhotoAttachmentBlob } from '../utils/photoStorage';
import { ImageViewerModal } from './ImageViewerModal';
import { ImageEditorModal } from './ImageEditorModal';
import { confirmAsync } from '../utils/confirmAsync';

interface PhotoAttachmentPickerProps {
  projectId: string;
  entityType: 'crewRecord' | 'defect';
  entityId: string;
  category?: 'crew_progress' | 'defect_before' | 'defect_after';
  label?: string;
  maxPhotos?: number;
  readOnly?: boolean;
  onPhotosChanged?: (photos: PhotoAttachment[]) => void;
}

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
  
  // Image editor state
  const [editingPhoto, setEditingPhoto] = useState<{ id: string; url: string } | null>(null);

  const loadPhotos = async () => {
    if (!projectId || !entityId) {
      setPhotos([]);
      setPhotoDataUrls({});
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
          const url = p.localUri || await getPhotoDataUrl(p.id, p.cloudUrl, true);
          if (url) urlMap[p.id] = url;
        })
      );
      setPhotoDataUrls(urlMap);

      if (onPhotosChanged) onPhotosChanged(items);
    } catch (err) {
      console.error('Error loading photo attachments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPhotos();
  }, [projectId, entityType, entityId, category]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !projectId || !entityId) return;

    if (photos.length + files.length > maxPhotos) {
      alert(`Bạn chỉ có thể chèn tối đa ${maxPhotos} ảnh!`);
      return;
    }

    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await savePhotoAttachment(
          {
            projectId,
            entityType,
            entityId,
            category,
            fileName: file.name,
            mimeType: file.type || 'image/jpeg',
            fileSize: file.size,
          },
          file
        );
      }
      await loadPhotos();
    } catch (err) {
      console.error('Error uploading photo:', err);
      alert('Có lỗi xảy ra khi xử lý ảnh. Vui lòng thử lại.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDeletePhoto = async (photoId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const confirmed = await confirmAsync('Xóa ảnh này?\n\nBạn có chắc muốn xóa ảnh này không?');
    if (!confirmed) return;
    try {
      await deletePhotoAttachment(projectId, photoId);
      await loadPhotos();
    } catch (err) {
      console.error('Error deleting photo:', err);
    }
  };

  const handleStartEditPhoto = async (photo: PhotoAttachment, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const fullUrl = await getPhotoDataUrl(photo.id, photo.cloudUrl, false);
      if (fullUrl) {
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
      setEditingPhoto(null);
      await loadPhotos();
    } catch (err) {
      console.error('Error saving edited photo:', err);
      alert('Không thể lưu ảnh đã chỉnh sửa');
    } finally {
      setUploading(false);
    }
  };

  const photoImageUrls = photos.map(p => photoDataUrls[p.id] || p.localUri || p.cloudUrl || '');
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
                type="file"
                accept="image/*"
                capture="environment"
                multiple
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
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
                disabled={uploading}
              />
            </label>
          </div>
        )}
      </div>

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
          {photos.map((photo, index) => {
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
          onClose={() => setEditingPhoto(null)}
          imageUrl={editingPhoto.url}
          onSave={handleSaveEditedPhoto}
        />
      )}
    </div>
  );
};
