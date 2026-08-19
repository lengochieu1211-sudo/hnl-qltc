export type ImageQualityPreset = 'auto' | 'economy' | 'standard' | 'high' | 'original';
export type ImageQualityKind = 'floorPlan' | 'defect' | 'crew';

export interface ImageQualitySettings {
  floorPlan: ImageQualityPreset;
  defect: ImageQualityPreset;
  crew: ImageQualityPreset;
}

export interface ImageQualityProfile {
  maxDimension: number;
  quality: number;
  keepOriginal?: boolean;
  label: string;
}

const STORAGE_KEY = 'qlct_image_quality_settings_v1';
const CHANGE_EVENT = 'qlct-image-quality-settings-changed';

export const DEFAULT_IMAGE_QUALITY_SETTINGS: ImageQualitySettings = {
  floorPlan: 'auto',
  defect: 'standard',
  crew: 'standard',
};

const isMobileLike = () => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(max-width: 768px)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
};

export function getImageQualitySettings(): ImageQualitySettings {
  if (typeof window === 'undefined') return { ...DEFAULT_IMAGE_QUALITY_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_IMAGE_QUALITY_SETTINGS };
    const parsed = JSON.parse(raw) || {};
    return {
      floorPlan: parsed.floorPlan || DEFAULT_IMAGE_QUALITY_SETTINGS.floorPlan,
      defect: parsed.defect || DEFAULT_IMAGE_QUALITY_SETTINGS.defect,
      crew: parsed.crew || DEFAULT_IMAGE_QUALITY_SETTINGS.crew,
    };
  } catch {
    return { ...DEFAULT_IMAGE_QUALITY_SETTINGS };
  }
}

export function setImageQualitySettings(next: ImageQualitySettings): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
}

export function getImageQualityChangeEventName(): string {
  return CHANGE_EVENT;
}

export function getImageQualityProfile(kind: ImageQualityKind, preset?: ImageQualityPreset): ImageQualityProfile {
  const selected = preset || getImageQualitySettings()[kind];
  const mobile = isMobileLike();
  if (kind === 'floorPlan') {
    switch (selected) {
      case 'economy': return { maxDimension: 2200, quality: 0.82, label: 'Tiết kiệm' };
      case 'standard': return { maxDimension: 3200, quality: 0.88, label: 'Tiêu chuẩn' };
      case 'high': return { maxDimension: 5000, quality: 0.93, label: 'Chất lượng cao' };
      case 'original': return mobile
        ? { maxDimension: 5000, quality: 0.96, keepOriginal: true, label: 'Gần ảnh gốc · an toàn điện thoại' }
        : { maxDimension: 8000, quality: 0.97, keepOriginal: true, label: 'Gần ảnh gốc · an toàn PC' };
      case 'auto':
      default:
        return mobile ? { maxDimension: 3200, quality: 0.88, label: 'Tự động · điện thoại' } : { maxDimension: 4800, quality: 0.92, label: 'Tự động · PC' };
    }
  }
  if (kind === 'defect') {
    switch (selected) {
      case 'economy': return { maxDimension: 1280, quality: 0.78, label: 'Tiết kiệm' };
      case 'high': return { maxDimension: 2048, quality: 0.90, label: 'Chất lượng cao' };
      case 'original': return { maxDimension: 3200, quality: 0.94, label: 'Rất cao' };
      case 'auto':
      case 'standard':
      default: return { maxDimension: 1600, quality: 0.85, label: 'Tiêu chuẩn' };
    }
  }
  switch (selected) {
    case 'economy': return { maxDimension: 1280, quality: 0.76, label: 'Tiết kiệm' };
    case 'high': return { maxDimension: 1920, quality: 0.88, label: 'Chất lượng cao' };
    case 'original': return { maxDimension: 2560, quality: 0.92, label: 'Rất cao' };
    case 'auto':
    case 'standard':
    default: return { maxDimension: 1440, quality: 0.82, label: 'Tiêu chuẩn' };
  }
}
