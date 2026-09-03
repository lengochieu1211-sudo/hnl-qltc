import React, { useState, useEffect, useRef } from 'react';
import { Camera, Image as ImageIcon, Images, Eye, Loader2, X, Pencil, AlertTriangle } from 'lucide-react';
import { PhotoAttachment, getEntityPhotos, getProjectPhotos, savePhotoAttachment, deletePhotoAttachment, getPhotoDataUrl, updatePhotoAttachmentBlob, resetPhotoRuntimeMemoryCache } from '../utils/photoStorage';
import { refreshProjectPhotoMetadataFromCloud, uploadPhotoToCloud, verifyPhotoBinaryReadyInCloud } from '../lib/photoCloudSync';
import { getCurrentRealFirebaseUser, onAuthUserChanged } from '../lib/firebase';
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

const isDirectPhotoUrl = (url?: string) => {
  const value = String(url || '').trim();
  return value.startsWith('blob:') || value.startsWith('data:image/') || value.startsWith('http://') || value.startsWith('https://');
};

const isLegacyFirestorePhoto = (photo: PhotoAttachment) => {
  const pointer = String(photo.cloudFileId || photo.cloudUrl || '');
  return String(photo.storageProvider || '') === 'firestore-fallback' || pointer.startsWith('firestore:');
};

const photoPickerServerRefreshKeys = new Set<string>();

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
  const [photoLoadErrors, setPhotoLoadErrors] = useState<Record<string, string>>({});
  const [retryingPhotoIds, setRetryingPhotoIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [syncNotice, setSyncNotice] = useState('');
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
      let items = await getEntityPhotos(projectId, entityType, entityId, category);
      // If the gallery mounts before this account's initial photo snapshot has merged,
      // do one server metadata refresh instead of showing a stale 0/10 until another
      // Firestore event/tab change. The auth UID is part of the key so account switching
      // on the same phone gets an independent first refresh. Photo binaries remain lazy.
      const authUid = getCurrentRealFirebaseUser()?.uid || 'signed-out';
      const refreshKey = `${authUid}:${projectId}:${entityType}:${entityId}:${category}`;
      if (items.length === 0 && typeof navigator !== 'undefined' && navigator.onLine && !photoPickerServerRefreshKeys.has(refreshKey)) {
        const refreshed = await refreshProjectPhotoMetadataFromCloud(projectId).catch(() => ({ verified: false, count: 0 }));
        // Cache a refresh decision only after a real server read succeeds. A transient
        // auth/network failure must never permanently turn an existing gallery into 0/10
        // for the rest of this app session.
        if (refreshed.verified) photoPickerServerRefreshKeys.add(refreshKey);
        items = await getEntityPhotos(projectId, entityType, entityId, category);
      }

      const resolveUrls = async (sourceItems: PhotoAttachment[]) => {
        const map: Record<string, string> = {};
        await Promise.all(sourceItems.map(async (p) => {
          const url = p.localUri || await getPhotoDataUrl(p.id, p.cloudUrl || p.cloudFileId, true, projectId);
          if (url) map[p.id] = url;
        }));
        return map;
      };

      // P0 RC2.2.15: metadata can be visible to Admin while its binary pointer/token is
      // stale on that account. If any thumbnail cannot resolve, force one server metadata
      // reconciliation and retry before rendering a broken placeholder.
      let urlMap = await resolveUrls(items);
      let unresolved = items.filter((p) => !urlMap[p.id]);
      const binaryRecoveryKey = `${refreshKey}:binary`;
      if (unresolved.length > 0 && typeof navigator !== 'undefined' && navigator.onLine && !photoPickerServerRefreshKeys.has(binaryRecoveryKey)) {
        const refreshed = await refreshProjectPhotoMetadataFromCloud(projectId).catch(() => ({ verified: false, count: 0 }));
        if (refreshed.verified) photoPickerServerRefreshKeys.add(binaryRecoveryKey);
        items = await getEntityPhotos(projectId, entityType, entityId, category);
        urlMap = await resolveUrls(items);
        unresolved = items.filter((p) => !urlMap[p.id]);
      }
      setPhotos(items);
      setPhotoLoadErrors(Object.fromEntries(unresolved.map((p) => [
        p.id,
        isLegacyFirestorePhoto(p)
          ? 'Ảnh cũ chỉ còn metadata legacy; binary/chunks không còn đọc được để khôi phục.'
          : 'Không tải được binary ảnh từ Cloud/R2.'
      ])));
      
      // Load data URLs / thumbnails asynchronously
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
    // Same origin + same phone can keep the component mounted while Firebase switches
    // account. IMPORTANT: Firebase auth listeners emit the current user immediately on
    // subscription. RC2.2.9 cleared the shared realtime photo-memory cache on that first
    // emission, so expanding a gallery could temporarily turn an already-synced `3 ảnh`
    // counter into an empty `0/10` gallery until the next Firestore snapshot arrived.
    // Only invalidate/reload when the UID actually changes.
    let lastUid = getCurrentRealFirebaseUser()?.uid || '';
    const unsubscribeAuth = onAuthUserChanged((user) => {
      const nextUid = user?.uid || '';
      if (nextUid === lastUid) return;
      lastUid = nextUid;
      resetPhotoRuntimeMemoryCache();
      void loadPhotos();
    });
    return () => unsubscribeAuth();
  }, [projectId, entityType, entityId, category]);

  useEffect(() => {
    photoDataUrlsRef.current = photoDataUrls;
  }, [photoDataUrls]);

  useEffect(() => () => {
    loadSeqRef.current += 1;
    Object.values(photoDataUrlsRef.current).forEach(revokeBlobUrl);
  }, []);

  const processSelectedFiles = async (files: FileList | File[] | null) => {
    if (readOnly) return;
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
    setSyncNotice('');
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
            createdByUid: getCurrentRealFirebaseUser()?.uid || undefined,
          },
          file
        );
        savedNow.push(saved);
        if (saved.localUri) optimisticUrls[saved.id] = saved.localUri;

        // RC2.2.9: while online, do not report the add operation as finished until the
        // R2/Storage binary and its Firestore ready metadata are both confirmed. This
        // closes the same-phone A -> sign-out -> B race where A saw a local Blob while B
        // received only binaryUploadState=pending metadata and therefore a placeholder.
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          let cloudReady = false;
          let lastCloudError: any = null;
          const retryDelays = [0, 400, 1200, 2500];
          for (let attempt = 0; attempt < retryDelays.length && !cloudReady; attempt += 1) {
            if (retryDelays[attempt] > 0) await new Promise((resolve) => window.setTimeout(resolve, retryDelays[attempt]));
            try {
              await uploadPhotoToCloud(projectId, saved);
              cloudReady = await verifyPhotoBinaryReadyInCloud(projectId, saved.id);
              if (!cloudReady) lastCloudError = new Error('Cloud chưa xác nhận binary ảnh.');
            } catch (err: any) {
              lastCloudError = err;
            }
          }
          if (!cloudReady) {
            console.warn('[Photo Picker] cloud upload pending durable retry:', saved.id, lastCloudError);
            setSyncNotice('Ảnh đang nằm trong hàng đợi riêng trên thiết bị; tài khoản khác sẽ chỉ thấy ảnh sau khi Cloud xác nhận. Ứng dụng đang tự retry.');
          } else {
            setSyncNotice('');
            await refreshProjectPhotoMetadataFromCloud(projectId).catch(() => {});
          }
        } else {
          setSyncNotice('Đang offline: ảnh đã lưu trên thiết bị và sẽ tự đồng bộ Cloud khi có mạng.');
        }
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

  const handleRetryCloudPhoto = async (photo: PhotoAttachment, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!projectId || !photo?.id || retryingPhotoIds[photo.id] || isLegacyFirestorePhoto(photo)) return;
    setRetryingPhotoIds((prev) => ({ ...prev, [photo.id]: true }));
    setPhotoLoadErrors((prev) => { const next = { ...prev }; delete next[photo.id]; return next; });
    try {
      await refreshProjectPhotoMetadataFromCloud(projectId).catch(() => {});
      const latest = (await getEntityPhotos(projectId, entityType, entityId, category)).find((item) => item.id === photo.id) || photo;
      const url = latest.localUri || await getPhotoDataUrl(latest.id, latest.cloudUrl || latest.cloudFileId, true, projectId);
      if (!url) throw new Error('Cloud/R2 chưa trả về binary ảnh cho tài khoản hiện tại.');
      setPhotoDataUrls((prev) => {
        if (prev[photo.id] && prev[photo.id] !== url) revokeBlobUrl(prev[photo.id]);
        const next = { ...prev, [photo.id]: url };
        photoDataUrlsRef.current = next;
        return next;
      });
    } catch (err: any) {
      const message = err?.message || 'Không tải được ảnh Cloud/R2.';
      console.warn('[Photo Picker] cross-account binary retry failed:', photo.id, err);
      setPhotoLoadErrors((prev) => ({ ...prev, [photo.id]: message }));
    } finally {
      setRetryingPhotoIds((prev) => { const next = { ...prev }; delete next[photo.id]; return next; });
    }
  };

  const handleDeletePhoto = async (photoId: string, e: React.MouseEvent) => {
    if (readOnly) return;
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
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      const fullUrl = await getPhotoDataUrl(photo.id, photo.cloudUrl || photo.cloudFileId, false, projectId);
      if (fullUrl) {
        if (editingPhoto?.url) revokeBlobUrl(editingPhoto.url);
        setEditingPhoto({ id: photo.id, url: fullUrl });
      }
    } catch (err) {
      console.error('Error getting photo for edit:', err);
    }
  };

  const handleSaveEditedPhoto = async (editedFile: File) => {
    if (readOnly || !editingPhoto || !projectId) return;
    try {
      setUploading(true);
      await updatePhotoAttachmentBlob(projectId, editingPhoto.id, editedFile);
      const editedPhotoMeta = (await getProjectPhotos(projectId, true)).find((p) => p.id === editingPhoto.id);
      if (editedPhotoMeta && (typeof navigator === 'undefined' || navigator.onLine)) {
        await uploadPhotoToCloud(projectId, editedPhotoMeta);
        const cloudReady = await verifyPhotoBinaryReadyInCloud(projectId, editingPhoto.id);
        if (!cloudReady) setSyncNotice('Ảnh chỉnh sửa đã lưu trên thiết bị nhưng Cloud chưa xác nhận; ứng dụng sẽ tự retry.');
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
  const photoImageUrls = sortedPhotos.map(p => photoDataUrls[p.id] || p.localUri || (isDirectPhotoUrl(p.cloudUrl) ? p.cloudUrl! : ''));
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

      {syncNotice && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] font-semibold text-amber-800">
          {syncNotice}
        </div>
      )}

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
            const url = photoDataUrls[photo.id] || photo.localUri || (isDirectPhotoUrl(photo.cloudUrl) ? photo.cloudUrl : '');
            const legacyUnrecoverable = !url && isLegacyFirestorePhoto(photo) && Boolean(photoLoadErrors[photo.id]);
            return (
              <div
                key={photo.id}
                onClick={() => {
                  if (!url) {
                    if (!legacyUnrecoverable) void handleRetryCloudPhoto(photo);
                    return;
                  }
                  const viewableIndex = photoImageUrls.slice(0, index + 1).filter(Boolean).length - 1;
                  if (viewableIndex >= 0) {
                    setViewingIndex(viewableIndex);
                  }
                }}
                className={`relative group aspect-square rounded-lg border overflow-hidden transition-all shadow-sm ${legacyUnrecoverable ? 'border-amber-300 bg-amber-50 cursor-default' : 'border-slate-200 bg-slate-100 cursor-pointer hover:border-blue-400'}`}
              >
                {url ? (
                  <img
                    src={url}
                    alt={photo.fileName || 'Photo'}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : legacyUnrecoverable ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1 px-1.5 text-center text-amber-800">
                    <AlertTriangle className="w-6 h-6 text-amber-600" />
                    <span className="text-[9px] font-extrabold leading-tight">Ảnh cũ không thể khôi phục</span>
                    <span className="text-[8px] leading-tight text-amber-700">Binary/chunks legacy không còn đọc được.</span>
                    {!readOnly && (
                      <div className="mt-1 flex flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            libraryInputRef.current?.click();
                          }}
                          className="rounded-md border border-emerald-300 bg-white px-1.5 py-0.5 text-[8px] font-extrabold text-emerald-700 hover:bg-emerald-50"
                          title="Thêm ảnh mới thay thế trước khi xóa ảnh lỗi"
                        >
                          Thêm ảnh thay thế
                        </button>
                        <button
                          type="button"
                          onClick={(e) => void handleDeletePhoto(photo.id, e)}
                          className="rounded-md border border-rose-300 bg-white px-1.5 py-0.5 text-[8px] font-extrabold text-rose-700 hover:bg-rose-50"
                          title="Xóa tham chiếu ảnh cũ không còn binary"
                        >
                          Xóa ảnh lỗi
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 px-1 text-center text-slate-400">
                    {retryingPhotoIds[photo.id] ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageIcon className="w-6 h-6" />}
                    <span className="text-[9px] font-semibold leading-tight">
                      {retryingPhotoIds[photo.id] ? 'Đang tải Cloud...' : 'Chưa tải được ảnh'}
                    </span>
                    {!retryingPhotoIds[photo.id] && (
                      <button
                        type="button"
                        onClick={(e) => void handleRetryCloudPhoto(photo, e)}
                        className="rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700 hover:bg-blue-100"
                        title={photoLoadErrors[photo.id] || 'Tải lại binary ảnh từ Cloud/R2'}
                      >
                        Tải lại
                      </button>
                    )}
                  </div>
                )}
                
                {/* Control Action Overlay & Top-Right Delete X */}
                {!readOnly && url && (
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

                {url && (
                  <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <span className="p-1.5 bg-white/90 text-slate-800 rounded-full hover:bg-white transition-colors">
                      <Eye className="w-4 h-4" />
                    </span>
                  </div>
                )}
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
