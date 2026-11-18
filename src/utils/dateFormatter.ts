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
 * HNL's fixed business timezone. UTC timestamps remain unchanged in Firestore,
 * Chat, expiry and sync; only civil dates / displayed time use Vietnam time.
 * Reuse the formatter because creating an Intl formatter on every render is expensive.
 */
export const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const vietnamInstantFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const vietnamInstantParts = (date: Date) => {
  const parts = Object.fromEntries(vietnamInstantFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return {
    year: parts.year, month: parts.month, day: parts.day,
    hour: parts.hour, minute: parts.minute,
  };
};

/** YYYY-MM-DD business date in Vietnam, independent of device timezone. */
export function toLocalDateInputValue(date: Date): string {
  const { year, month, day } = vietnamInstantParts(date);
  return `${year}-${month}-${day}`;
}

/** Beginning of a Vietnam business day as epoch milliseconds (UTC instant). */
export function vietnamDateInputToDayStartMs(dateInput: string, fallbackTime = Date.now()): number {
  const input = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(dateInput);
  if (!input) return vietnamDateInputToDayStartMs(toLocalDateInputValue(new Date(fallbackTime)));
  const [year, month, day] = input.slice(1).map(Number);
  const dayUtc = Date.UTC(year, month - 1, day);
  const checked = new Date(dayUtc);
  if (checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day) {
    return vietnamDateInputToDayStartMs(toLocalDateInputValue(new Date(fallbackTime)));
  }
  // Vietnam has no daylight-saving transition in the application's supported era.
  return dayUtc - 7 * 60 * 60 * 1000;
}

/** Adds civil calendar days in Vietnam, including across device DST boundaries. */
export function addLocalCalendarDaysToDateInput(date: Date, days: number): string {
  const [year, month, day] = toLocalDateInputValue(date).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10);
}

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

    // Zoned ISO timestamps are absolute instants, unlike date-only civil values.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
      const zoned = Date.parse(trimmed);
      if (Number.isFinite(zoned) && zoned > 0) return zoned;
    }

    // Legacy app records may be saved as HH:mm:ss DD/M/YYYY. Parse this form
    // explicitly before Date.parse so 11/8 is never reinterpreted as MM/DD.
    const timeFirstMatch = trimmed.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (timeFirstMatch) {
      const [_, h, m, sec, day, month, year] = timeFirstMatch;
      const hours = Number(h) || 0, mins = Number(m) || 0, secs = Number(sec) || 0;
      const y = Number(year), mo = Number(month), da = Number(day);
      const d = new Date(y, mo - 1, da, hours, mins, secs);
      if (!isNaN(d.getTime()) && d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === da) return d.getTime();
    }

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
  let businessDateOnly: { year: string; month: string; day: string } | null = null;
  if (dateInput instanceof Date) {
    d = dateInput;
  } else if (typeof dateInput === 'number') {
    d = new Date(dateInput);
  } else {
    const trimmed = String(dateInput).trim();
    if (!trimmed) return '';

    // Zoned ISO timestamp: render LOCAL calendar date, not UTC prefix.
    const isZonedIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
    if (isZonedIso) {
      const instant = new Date(trimmed);
      d = Number.isFinite(instant.getTime()) ? instant : null;
    } else {
      // A civil date without timezone must retain its calendar date.
      const yyyymmddMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (yyyymmddMatch) {
        const [_, year, month, day] = yyyymmddMatch;
        businessDateOnly = { year, month, day };
        d = new Date(Number(year), Number(month) - 1, Number(day));
      } else {
        const ddmmyyyyMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (ddmmyyyyMatch) {
          const [_, day, month, year] = ddmmyyyyMatch;
          businessDateOnly = { year, month, day };
          d = new Date(Number(year), Number(month) - 1, Number(day));
        } else {
          const parsed = parseLegacyTimestamp(trimmed, Number.NaN);
          d = Number.isFinite(parsed) ? new Date(parsed) : null;
        }
      }
    }
  }

  if (!d || isNaN(d.getTime())) {
    return String(dateInput);
  }

  const preset = customPreset || getDateFormatPreset();
  // A date-only business field has no timezone to convert. An instant does.
  const { year, month, day } = businessDateOnly || vietnamInstantParts(d);
  const displayDay = day.padStart(2, '0');
  const displayMonth = month.padStart(2, '0');

  switch (preset) {
    case 'MM/DD/YYYY':
      return `${displayMonth}/${displayDay}/${year}`;
    case 'YYYY-MM-DD':
      return `${year}-${displayMonth}-${displayDay}`;
    case 'DD-MM-YYYY':
      return `${displayDay}-${displayMonth}-${year}`;
    case 'DD/MM/YYYY':
    default:
      return `${displayDay}/${displayMonth}/${year}`;
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
  const { hour, minute } = vietnamInstantParts(d);
  return `${dateFormatted} ${hour}:${minute}`;
}

