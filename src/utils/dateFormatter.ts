/**
 * Utility to format Excel dates and general dates according to user configuration
 */

/**
 * Formats a floor name safely avoiding duplicate "Tầng Tầng Trệt" issues.
 * e.g., "Tầng Trệt" -> "Tầng Trệt"
 * e.g., "Trệt" -> "Tầng Trệt"
 * e.g., "Tầng 1" -> "Tầng 1"
 * e.g., "1" -> "Tầng 1"
 */
export function formatFloorName(name?: string): string {
  if (!name || !name.trim()) return 'Mặt bằng';
  const trimmed = name.trim();
  if (/^tầng\b/i.test(trimmed)) {
    return trimmed;
  }
  return `Tầng ${trimmed}`;
}

export type DateFormatPreset = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'DD-MM-YYYY';

/**
 * Parses any timestamp input (number, string ISO, legacy string format) into a valid numeric timestamp (ms since epoch).
 */
export function parseLegacyTimestamp(ts: any, fallbackTime: number = Date.now()): number {
  if (typeof ts === 'number' && !isNaN(ts) && ts > 0) {
    return ts;
  }
  if (typeof ts === 'string' && ts.trim()) {
    const trimmed = ts.trim();
    const num = Number(trimmed);
    if (!isNaN(num) && num > 0) return num;

    // Parse DD/MM/YYYY or DD-MM-YYYY FIRST before native Date.parse to prevent MM/DD/YYYY confusion
    const ddmmyyyyMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (ddmmyyyyMatch) {
      const [_, day, month, year, h, m, s] = ddmmyyyyMatch;
      const hours = Number(h) || 0;
      const mins = Number(m) || 0;
      const secs = Number(s) || 0;
      const y = Number(year), mo = Number(month), da = Number(day);
      const d = new Date(y, mo - 1, da, hours, mins, secs);
      if (!isNaN(d.getTime()) && d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === da
        && d.getHours() === hours && d.getMinutes() === mins && d.getSeconds() === secs) return d.getTime();
    }

    // Parse ISO YYYY-MM-DD
    const isoMatch = trimmed.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (isoMatch) {
      const [_, year, month, day, h, m, s] = isoMatch;
      const hours = Number(h) || 0;
      const mins = Number(m) || 0;
      const secs = Number(s) || 0;
      const y = Number(year), mo = Number(month), da = Number(day);
      const d = new Date(y, mo - 1, da, hours, mins, secs);
      if (!isNaN(d.getTime()) && d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === da
        && d.getHours() === hours && d.getMinutes() === mins && d.getSeconds() === secs) return d.getTime();
    }

    const parsed = Date.parse(trimmed);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return fallbackTime;
}

/**
 * Gets the configured date format preset from localStorage.
 */
export function getDateFormatPreset(): DateFormatPreset {
  if (typeof window === 'undefined') return 'DD/MM/YYYY';
  const saved = localStorage.getItem('app_date_format_preset') as DateFormatPreset;
  if (saved && ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY'].includes(saved)) {
    return saved;
  }
  return 'DD/MM/YYYY';
}

/**
 * Saves the date format preset and dispatches an event to notify UI components.
 */
export function setDateFormatPreset(preset: DateFormatPreset): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('app_date_format_preset', preset);
  window.dispatchEvent(new Event('app_settings_changed'));
}

export function formatExcelDate(excelDate: any): string {
  if (excelDate === null || excelDate === undefined || excelDate === '') return '';
  if (typeof excelDate === 'number') {
    if (isNaN(excelDate) || excelDate <= 0) return '';
    const parsed = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
    return '';
  }
  const dateStr = String(excelDate).trim();
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
    const parts = dateStr.split('/');
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(dateStr)) {
    const parts = dateStr.split('-');
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  return dateStr;
}

/**
 * Formats a date string or Date object into the user's preferred format
 */
export function formatDate(dateInput: string | Date | number | null | undefined, customPreset?: DateFormatPreset): string {
  if (!dateInput) return '';
  
  let d: Date | null = null;
  if (dateInput instanceof Date) {
    d = dateInput;
  } else if (typeof dateInput === 'number') {
    d = new Date(dateInput);
  } else {
    const trimmed = String(dateInput).trim();
    if (!trimmed) return '';

    // Check YYYY-MM-DD
    const yyyymmddMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (yyyymmddMatch) {
      const [_, year, month, day] = yyyymmddMatch;
      d = new Date(Number(year), Number(month) - 1, Number(day));
    } else {
      // Check DD/MM/YYYY
      const ddmmyyyyMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (ddmmyyyyMatch) {
        const [_, day, month, year] = ddmmyyyyMatch;
        d = new Date(Number(year), Number(month) - 1, Number(day));
      } else {
        const parsed = parseLegacyTimestamp(trimmed, Number.NaN);
        d = Number.isFinite(parsed) ? new Date(parsed) : null;
      }
    }
  }

  if (!d || isNaN(d.getTime())) {
    return String(dateInput);
  }

  const preset = customPreset || getDateFormatPreset();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear());

  switch (preset) {
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`;
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'DD-MM-YYYY':
      return `${day}-${month}-${year}`;
    case 'DD/MM/YYYY':
    default:
      return `${day}/${month}/${year}`;
  }
}

/**
 * Main function used across the app to format dates with current user preference.
 */
export function formatDateDDMMYYYY(dateStr: string | null | undefined): string {
  return formatDate(dateStr);
}

/**
 * Formats date and time into configured date format + HH:mm
 */
export function formatDateTime(dateInput: string | Date | number | null | undefined): string {
  if (!dateInput) return '';
  const d = dateInput instanceof Date
    ? dateInput
    : new Date(parseLegacyTimestamp(dateInput, Number.NaN));
  if (isNaN(d.getTime())) return String(dateInput);

  const dateFormatted = formatDate(d);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${dateFormatted} ${hours}:${minutes}`;
}

