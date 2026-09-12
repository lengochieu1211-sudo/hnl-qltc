import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

const binaryStorage = read('src/lib/binaryStorage.ts');
check(binaryStorage.includes("crypto.subtle.digest('SHA-256'"), 'Media binary path must be content-addressed from SHA-256.');
check(binaryStorage.includes('async function immutableMediaInput'), 'Immutable media upload wrapper is missing.');
check(binaryStorage.includes('assetId: `${logicalAssetId}--${contentSha256}`'), 'Edited media must upload under a content-versioned asset directory.');
check(binaryStorage.includes('getCurrentRealFirebaseUser()?.uid'), 'Immutable object ownership must bind to the actual authenticated uploader.');
check(binaryStorage.includes('createdByUid: uploaderUid'), 'Versioned media object metadata must carry the actual uploader uid.');
check(binaryStorage.includes('const immutableInput = await immutableMediaInput(input)'), 'All project media uploads must use immutable media input.');
check(binaryStorage.includes('uploadProjectBinary(immutableInput)'), 'Firebase Storage media upload must use immutable asset id.');
check(binaryStorage.includes('uploadImmutableProjectBinaryToR2(immutableInput)'), 'R2 media upload must receive the immutable asset input.');
check(binaryStorage.includes('return uploadProjectBinaryToR2(input)'), 'R2 adapter must preserve the single direct R2 write authority.');

const photoStorage = read('src/utils/photoStorage.ts');
check(photoStorage.includes('export async function updatePhotoAttachmentBlob'), 'Photo edit/replace path missing.');
check(photoStorage.includes("binaryUploadState: 'pending'"), 'Edited attachment must return to pending before Cloud publication.');
check(photoStorage.includes("storagePath: ''"), 'Edited attachment must clear the old shared pointer locally until replacement publication.');
check(photoStorage.includes('revision: Math.max(Number(p.revision || 0) + 1, 1)'), 'Edited attachment must advance revision.');
check(photoStorage.includes("const photoKind = photo.entityType === 'defect' ? 'defect' : 'crew';"), 'Photo save path must derive the correct image-quality kind at upload time.');
check(photoStorage.includes('const profile = getImageQualityProfile(photoKind);'), 'Photo save/edit path must read the current image-quality profile before compression.');
check(photoStorage.includes('const mainBlob = await compressImageToBlob(imageSource, profile.maxDimension, profile.quality);'), 'Main photo binary must use the selected quality profile.');
check(photoStorage.includes('compressImageToBlob(mainBlob, 320, 0.70)'), 'Gallery thumbnail must stay lightweight and separate from the full photo binary.');

const qualitySettings = read('src/utils/imageQualitySettings.ts');
for (const marker of [
  "case 'economy': return { maxDimension: 1280, quality: 0.76, label: 'Tiết kiệm' };",
  "case 'high': return { maxDimension: 1920, quality: 0.88, label: 'Chất lượng cao' };",
  "case 'original': return { maxDimension: 2560, quality: 0.92, label: 'Rất cao' };",
  "default: return { maxDimension: 1440, quality: 0.82, label: 'Tiêu chuẩn' };",
]) check(qualitySettings.includes(marker), `Crew image-quality preset changed unexpectedly: ${marker}`);

const photoPicker = read('src/components/PhotoAttachmentPicker.tsx');
check(photoPicker.includes("getPhotoDataUrl(p.id, p.cloudUrl || p.cloudFileId, true, projectId)"), 'Photo grid must continue to resolve lightweight thumbnails.');
check(photoPicker.includes("getPhotoDataUrl(photo.id, photo.cloudUrl || photo.cloudFileId, false, projectId)"), 'Photo viewer must lazy-load the full stored binary, not the 320px thumbnail.');
check((photoPicker.match(/onChange=\{handleFileChange\}/g) || []).length >= 2, 'Camera and gallery inputs must share the same current-quality upload pipeline.');
check(photoPicker.includes('onIndexChange={(index) =>'), 'Photo viewer navigation must request full-resolution binaries lazily per image.');
check(photoPicker.includes('clearViewerFullImages'), 'Photo viewer must release full-resolution Blob URLs when closed.');

const imageViewer = read('src/components/ImageViewerModal.tsx');
check(imageViewer.includes('onIndexChange?: (index: number) => void;'), 'Image viewer full-resolution navigation callback missing.');
check(imageViewer.includes('Đang tải ảnh đầy đủ...'), 'Image viewer must indicate thumbnail-to-full-resolution loading.');
check(imageViewer.includes('if (!activeImage || mediaAction || isImageLoading) return;'), 'Download/share must not export a thumbnail while full image is still loading.');

const cloudSync = read('src/lib/photoCloudSync.ts');
check(cloudSync.includes('uploadProjectBinaryToCloud'), 'Photo Cloud sync must route through binaryStorage atomic uploader.');
check(cloudSync.includes("binaryUploadState: 'ready'"), 'Photo metadata must publish an explicit ready state only after upload.');

const storageRules = read('storage.rules');
check(storageRules.includes('match /projects/{projectId}/media/{entityType}/{entityId}/{assetId}/{fileName}'), 'Storage rules must preserve project/entity/asset isolation for versioned media paths.');
check(storageRules.includes('request.resource.metadata.assetId == assetId'), 'Storage rules must bind metadata assetId to the immutable path segment.');
check(storageRules.includes('request.resource.metadata.createdByUid == request.auth.uid'), 'Storage rules must bind object uploader metadata to Firebase auth uid.');

console.log('Media P0 atomic publication golden PASS');
