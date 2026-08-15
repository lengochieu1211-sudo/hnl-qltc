export function stripHeavyImages(obj: any): any {
  if (!obj) return obj;
  if (typeof obj === 'string') {
    // Keep data:image (floor plans & defect photos) intact so user uploads are never lost
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => stripHeavyImages(item));
  }
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        cleaned[k] = stripHeavyImages(obj[k]);
      }
    }
    return cleaned;
  }
  return obj;
}

export function safeSetLocalStorageItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e: any) {
    console.warn(`localStorage setItem failed for key "${key}", attempting cleaning...`, e);
    
    // Attempt 1: If stringified JSON, strip heavy base64 images to free up space
    if (value && (value.startsWith('{') || value.startsWith('['))) {
      try {
        const parsed = JSON.parse(value);
        const cleaned = stripHeavyImages(parsed);
        const cleanedStr = JSON.stringify(cleaned);
        localStorage.setItem(key, cleanedStr);
        return true;
      } catch (innerErr) {
        console.warn(`Cleaned JSON setItem failed for key "${key}":`, innerErr);
      }
    }

    console.error(`❌ Không thể lưu dữ liệu cho khoá "${key}" do bộ nhớ thiết bị (localStorage) đã đầy. Dữ liệu cũ vẫn được giữ nguyên, KHÔNG bị ghi đè!`);
    return false;
  }
}
