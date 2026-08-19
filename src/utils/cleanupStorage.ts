import { compressDefectPhoto } from './imageCompressor';
import { getStorageKeys, getAsyncItem, setAsyncItem } from './asyncStorage';

export const cleanupAndCompressOldImages = async () => {
  try {
    const keys = await getStorageKeys();
    for (const key of keys) {
      // Floor-plan image quality is handled at import time. This cleanup only migrates
      // oversized legacy Defect data URLs and respects the user's current Defect profile.
      if (key && key.includes('construction_defects')) {
        try {
          const val = await getAsyncItem<any[]>(key, []);
          if (Array.isArray(val) && val.length > 0) {
            let hasChanges = false;
            
            for (const item of val) {
              // Only compress if the data URL is excessively large (> 800KB raw base64)
              if (item.imageUrl && typeof item.imageUrl === 'string' && item.imageUrl.startsWith('data:image') && item.imageUrl.length > 800000) {
                item.imageUrl = await compressDefectPhoto(item.imageUrl);
                hasChanges = true;
              }
              if (item.afterImageUrl && typeof item.afterImageUrl === 'string' && item.afterImageUrl.startsWith('data:image') && item.afterImageUrl.length > 800000) {
                item.afterImageUrl = await compressDefectPhoto(item.afterImageUrl);
                hasChanges = true;
              }
            }
            
            if (hasChanges) {
              await setAsyncItem(key, val);
              console.log(`Optimized oversized defect photos for key: ${key}`);
            }
          }
        } catch (err) {
          console.error(`Error cleaning up key ${key}`, err);
        }
      }
    }
  } catch (globalErr) {
    console.error('Error during global cleanup:', globalErr);
  }
};

