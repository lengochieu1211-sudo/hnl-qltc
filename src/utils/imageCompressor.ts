import { getImageQualityProfile } from './imageQualitySettings';

/**
 * Mobile-safe image compressor.
 *
 * Important: do NOT decode a phone-camera photo at full resolution merely to read
 * its width/height. A 48 MP RGBA bitmap can consume ~190 MB before any Base64 or
 * canvas copies are made, which is enough for Android to kill the WebView.
 */

export interface CompressOptions {
  maxDimension?: number;
  quality?: number;
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
}

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('Không đọc được ảnh.'));
  reader.readAsDataURL(blob);
});

const dataUrlToBlob = (dataUrl: string): Blob | null => {
  try {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const header = dataUrl.slice(0, comma);
    const payload = dataUrl.slice(comma + 1);
    const mime = header.match(/^data:([^;,]+)/i)?.[1] || 'image/jpeg';
    const binary = header.includes(';base64') ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
};

interface ImageDimensions { width: number; height: number; }

const readJpegDimensions = (view: DataView): ImageDimensions | null => {
  if (view.byteLength < 10 || view.getUint16(0, false) !== 0xffd8) return null;
  let offset = 2;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < view.byteLength && view.getUint8(offset) === 0xff) offset += 1;
    if (offset >= view.byteLength) break;
    const marker = view.getUint8(offset++);

    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > view.byteLength) break;

    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2) break;

    if (sofMarkers.has(marker) && offset + 7 <= view.byteLength) {
      const height = view.getUint16(offset + 3, false);
      const width = view.getUint16(offset + 5, false);
      if (width > 0 && height > 0) return { width, height };
    }
    offset += segmentLength;
  }
  return null;
};

const readPngDimensions = (view: DataView): ImageDimensions | null => {
  if (view.byteLength < 24) return null;
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < pngSignature.length; i++) {
    if (view.getUint8(i) !== pngSignature[i]) return null;
  }
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return width > 0 && height > 0 ? { width, height } : null;
};

const readWebpDimensions = (view: DataView): ImageDimensions | null => {
  if (view.byteLength < 30) return null;
  const fourCC = (offset: number) => String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3)
  );
  if (fourCC(0) !== 'RIFF' || fourCC(8) !== 'WEBP') return null;
  const kind = fourCC(12);
  if (kind === 'VP8X' && view.byteLength >= 30) {
    const width = 1 + view.getUint8(24) + (view.getUint8(25) << 8) + (view.getUint8(26) << 16);
    const height = 1 + view.getUint8(27) + (view.getUint8(28) << 8) + (view.getUint8(29) << 16);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (kind === 'VP8L' && view.byteLength >= 25 && view.getUint8(20) === 0x2f) {
    const b0 = view.getUint8(21);
    const b1 = view.getUint8(22);
    const b2 = view.getUint8(23);
    const b3 = view.getUint8(24);
    const bits = (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
    const width = 1 + (bits & 0x3fff);
    const height = 1 + ((bits >>> 14) & 0x3fff);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
};

/** Read dimensions from a small header slice, without allocating the full bitmap. */
const readImageDimensionsFromBlob = async (blob: Blob): Promise<ImageDimensions | null> => {
  try {
    // JPEG SOF normally appears near the start. 512 KiB is intentionally bounded.
    const header = await blob.slice(0, Math.min(blob.size, 512 * 1024)).arrayBuffer();
    const view = new DataView(header);
    const mime = String(blob.type || '').toLowerCase();
    if (mime.includes('jpeg') || mime.includes('jpg') || (view.byteLength >= 2 && view.getUint16(0, false) === 0xffd8)) {
      return readJpegDimensions(view);
    }
    if (mime.includes('png')) return readPngDimensions(view);
    if (mime.includes('webp')) return readWebpDimensions(view);
    return readPngDimensions(view) || readWebpDimensions(view) || readJpegDimensions(view);
  } catch {
    return null;
  }
};

const calculateTargetSize = (width: number, height: number, maxDimension: number): ImageDimensions => {
  if (!width || !height || maxDimension <= 0 || (width <= maxDimension && height <= maxDimension)) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  const ratio = Math.min(maxDimension / width, maxDimension / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
};

const canvasToJpegBlob = (canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> => new Promise((resolve) => {
  try {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  } catch {
    resolve(null);
  }
});

/**
 * Blob-first compressor. The main photo never needs to become a large Base64
 * string in the photo-storage pipeline.
 */
export const compressImageToBlob = async (
  source: File | Blob | string,
  maxDimension: number = 1440,
  quality: number = 0.82
): Promise<Blob | null> => {
  if (!source) return null;

  let sourceBlob: Blob | null = null;
  if (typeof source === 'string') {
    if (source.startsWith('data:')) sourceBlob = dataUrlToBlob(source);
    else return null;
  } else if (source instanceof Blob) {
    sourceBlob = source;
  }
  if (!sourceBlob || sourceBlob.size <= 0) return null;

  const dimensions = await readImageDimensionsFromBlob(sourceBlob);

  // Chromium/Android fast path. When dimensions are known, request the downscaled
  // decode immediately. Never call createImageBitmap(sourceBlob) first.
  if (typeof window !== 'undefined' && typeof window.createImageBitmap === 'function' && dimensions) {
    let bitmap: ImageBitmap | null = null;
    const canvas = document.createElement('canvas');
    try {
      const target = calculateTargetSize(dimensions.width, dimensions.height, maxDimension);
      bitmap = await (window.createImageBitmap as any)(sourceBlob, {
        resizeWidth: target.width,
        resizeHeight: target.height,
        resizeQuality: 'medium',
        imageOrientation: 'from-image',
      });

      canvas.width = target.width;
      canvas.height = target.height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return null;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, target.width, target.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(bitmap, 0, 0, target.width, target.height);

      return await canvasToJpegBlob(canvas, quality);
    } catch (err) {
      console.warn('Native resized image decode failed; using compatibility fallback:', err);
    } finally {
      try { bitmap?.close(); } catch {}
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  // Compatibility fallback for older browsers. Uses an object URL (not raw Base64)
  // and releases it immediately. Camera JPEGs on modern Android should use the fast path above.
  return await new Promise<Blob | null>((resolve) => {
    let objectUrl = '';
    const img = new Image();
    const cleanup = () => {
      if (objectUrl) {
        try { URL.revokeObjectURL(objectUrl); } catch {}
      }
      img.onload = null;
      img.onerror = null;
      img.src = '';
    };

    img.onload = async () => {
      const canvas = document.createElement('canvas');
      try {
        const target = calculateTargetSize(img.naturalWidth || img.width, img.naturalHeight || img.height, maxDimension);
        canvas.width = target.width;
        canvas.height = target.height;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
          cleanup();
          resolve(null);
          return;
        }
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, target.width, target.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'medium';
        ctx.drawImage(img, 0, 0, target.width, target.height);
        const out = await canvasToJpegBlob(canvas, quality);
        cleanup();
        resolve(out);
      } catch (err) {
        console.error('Image compression fallback error:', err);
        cleanup();
        resolve(null);
      } finally {
        canvas.width = 1;
        canvas.height = 1;
      }
    };
    img.onerror = () => {
      cleanup();
      resolve(null);
    };
    try {
      objectUrl = URL.createObjectURL(sourceBlob as Blob);
      img.src = objectUrl;
    } catch {
      cleanup();
      resolve(null);
    }
  });
};

/**
 * Compatibility wrapper for existing callers that still require a data URL.
 * Internally the resize is Blob-first so the original camera file is never copied
 * into a giant Base64 string before downscaling.
 */
export const compressImage = async (
  source: File | Blob | string,
  maxDimension: number = 1440,
  quality: number = 0.82
): Promise<string> => {
  if (!source) return '';
  if (typeof source === 'string' && (source.startsWith('http://') || source.startsWith('https://') || source.length < 50000)) {
    return source;
  }
  const blob = await compressImageToBlob(source, maxDimension, quality);
  if (!blob) return typeof source === 'string' ? source : '';
  try {
    return await blobToDataUrl(blob);
  } catch {
    return '';
  }
};

/** Floor-plan import kept memory-safe as well. */
export const readFloorPlanAsDataUrl = async (file: File): Promise<string> => {
  if (!file) return '';
  try {
    return await blobToDataUrl(file);
  } catch (err) {
    console.error('Error reading floor plan file:', err);
    return '';
  }
};

export const compressFloorPlanImage = async (source: File | Blob | string): Promise<string> => {
  const profile = getImageQualityProfile('floorPlan');
  return compressImage(source, profile.maxDimension, profile.quality);
};

export const compressDefectPhoto = (source: File | Blob | string): Promise<string> => {
  const profile = getImageQualityProfile('defect');
  return compressImage(source, profile.maxDimension, profile.quality);
};

export const compressCrewPhoto = (source: File | Blob | string): Promise<string> => {
  const profile = getImageQualityProfile('crew');
  return compressImage(source, profile.maxDimension, profile.quality);
};
