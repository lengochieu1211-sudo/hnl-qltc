import { getImageQualityProfile } from './imageQualitySettings';

/**
 * High-performance, memory-safe image compressor for construction defect photos and floor plans.
 * Prevents mobile browser crashes (Out-Of-Memory) when capturing high-resolution photos (12MP - 48MP)
 * by utilizing native hardware-accelerated downscaling (createImageBitmap) and immediate buffer cleanup.
 */

export interface CompressOptions {
  maxDimension?: number;
  quality?: number;
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
}

/**
 * Read floor plan drawings without compression, preserving 100% crisp architectural resolution
 * so numbers, text, and CAD details remain sharp at any zoom level.
 */
export const readFloorPlanAsDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string || '');
    reader.onerror = (err) => {
      console.error('Error reading floor plan file:', err);
      reject(err);
    };
    reader.readAsDataURL(file);
  });
};

/**
 * High-definition preset for architectural floor plans (keeps original quality).
 */
export const compressFloorPlanImage = async (source: File | Blob | string): Promise<string> => {
  const profile = getImageQualityProfile('floorPlan');
  // Even the highest preset goes through the memory-safe decoder. Modern phone
  // cameras can exceed 40 MP; keeping that raw bitmap as Base64 can crash Android
  // WebView. The preset keeps a very high resolution, but caps it to a safe size.
  return compressImage(source, profile.maxDimension, profile.quality);
};

/**
 * Memory-safe image compressor using hardware-accelerated createImageBitmap where supported,
 * avoiding the allocation of huge uncompressed bitmaps into the JavaScript heap.
 */
export const compressImage = async (
  source: File | Blob | string,
  maxDimension: number = 1440,
  quality: number = 0.82
): Promise<string> => {
  if (!source) return '';

  // If already an HTTP/HTTPS URL or compact string, return directly
  if (typeof source === 'string' && (source.startsWith('http://') || source.startsWith('https://') || source.length < 50000)) {
    return source;
  }

  // Helper to convert base64 to Blob safely for memory management
  const getBlob = async (): Promise<Blob | null> => {
    if (typeof source !== 'string') {
      if ((source as unknown) instanceof Blob) {
        return source;
      }
      return null;
    }
    if (typeof source === 'string' && source.startsWith('data:')) {
      try {
        const parts = source.split(';base64,');
        const contentType = parts[0].split(':')[1] || 'image/jpeg';
        const raw = window.atob(parts[1]);
        const rawLength = raw.length;
        const uInt8Array = new Uint8Array(rawLength);
        for (let i = 0; i < rawLength; ++i) {
          uInt8Array[i] = raw.charCodeAt(i);
        }
        return new Blob([uInt8Array], { type: contentType });
      } catch (err) {
        console.warn('Base64 to Blob conversion fallback:', err);
        return null;
      }
    }
    return null;
  };

  const blob = await getBlob();

  // 1. FAST PATH: Hardware-accelerated createImageBitmap with native resize (Chrome, Safari 15+, Android Webview)
  // This bypasses loading huge 48MP raw buffers into JS memory and prevents mobile OS crash/kill.
  if (blob && typeof window.createImageBitmap === 'function') {
    try {
      // First, get natural dimensions cheaply without decoding full bitmap
      let initialBitmap: ImageBitmap | null = null;
      try {
        initialBitmap = await createImageBitmap(blob);
      } catch (bmpErr) {
        initialBitmap = null;
      }

      if (initialBitmap) {
        let width = initialBitmap.width;
        let height = initialBitmap.height;
        initialBitmap.close(); // Immediately close to free GPU/RAM

        if (width && height) {
          // Calculate resized dimensions
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          // Try native downscaled decode
          let resizedBitmap: ImageBitmap | null = null;
          try {
            resizedBitmap = await (createImageBitmap as any)(blob, {
              resizeWidth: width,
              resizeHeight: height,
              resizeQuality: 'medium',
            });
          } catch (_) {
            // Some older browsers don't support options object in createImageBitmap
            resizedBitmap = await createImageBitmap(blob);
          }

          if (resizedBitmap) {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d', { alpha: false });
            if (ctx) {
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'medium';
              ctx.drawImage(resizedBitmap, 0, 0, width, height);
              resizedBitmap.close(); // Free immediately

              const compressed = canvas.toDataURL('image/jpeg', quality);
              canvas.width = 1;
              canvas.height = 1; // Release canvas VRAM
              return compressed;
            }
            resizedBitmap.close();
          }
        }
      }
    } catch (e) {
      console.warn('createImageBitmap optimization failed, using safe fallback:', e);
    }
  }

  // 2. FALLBACK PATH: Standard HTMLImageElement with strict resource cleanup
  return new Promise((resolve) => {
    let objectUrl: string | null = null;
    let imageSrc = '';

    if (typeof source === 'string') {
      imageSrc = source;
    } else {
      try {
        objectUrl = URL.createObjectURL(source);
        imageSrc = objectUrl;
      } catch (err) {
        const reader = new FileReader();
        reader.onload = () => {
          compressImage(reader.result as string, maxDimension, quality).then(resolve);
        };
        reader.onerror = () => resolve('');
        reader.readAsDataURL(source);
        return;
      }
    }

    const cleanup = () => {
      if (objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {}
      }
    };

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (!width || !height) {
          cleanup();
          resolve(typeof source === 'string' ? source : '');
          return;
        }

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
          cleanup();
          resolve(typeof source === 'string' ? source : '');
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'medium';
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);

        canvas.width = 1;
        canvas.height = 1;
        cleanup();
        resolve(compressedDataUrl);
      } catch (err) {
        console.error('Image compression canvas error:', err);
        cleanup();
        resolve(typeof source === 'string' ? source : '');
      }
    };

    img.onerror = () => {
      cleanup();
      resolve(typeof source === 'string' ? source : '');
    };

    img.src = imageSrc;
  });
};

/**
 * Fast & memory-safe preset for camera defect photos.
 * Downscales directly to 1440px max at 0.82 JPEG quality (~150KB - 280KB) - clear visual proof without lag or phone crash.
 */
export const compressDefectPhoto = (source: File | Blob | string): Promise<string> => {
  const profile = getImageQualityProfile('defect');
  return compressImage(source, profile.maxDimension, profile.quality);
};

export const compressCrewPhoto = (source: File | Blob | string): Promise<string> => {
  const profile = getImageQualityProfile('crew');
  return compressImage(source, profile.maxDimension, profile.quality);
};
