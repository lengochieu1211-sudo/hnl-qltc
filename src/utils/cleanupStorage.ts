import { compressImage } from './imageCompressor';

export const cleanupAndCompressOldImages = async () => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('construction_floor_plans') || key.includes('construction_defects'))) {
        try {
          const val = localStorage.getItem(key);
          if (val && val.includes('data:image')) {
            const parsed = JSON.parse(val);
            let hasChanges = false;
            
            const compressArray = async (arr: any[]) => {
              for (const item of arr) {
                if (item.imageUrl && item.imageUrl.length > 50000) {
                  item.imageUrl = await compressImage(item.imageUrl, 1200, 0.7);
                  hasChanges = true;
                }
                if (item.afterImageUrl && item.afterImageUrl.length > 50000) {
                  item.afterImageUrl = await compressImage(item.afterImageUrl, 1200, 0.7);
                  hasChanges = true;
                }
              }
            };
            
            if (Array.isArray(parsed)) {
              await compressArray(parsed);
              if (hasChanges) {
                localStorage.setItem(key, JSON.stringify(parsed));
                console.log(`Cleaned up and compressed images for key: ${key}`);
              }
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
