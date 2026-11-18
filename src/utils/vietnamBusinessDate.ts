/**
 * PROD hotfix: only warehouse voucher civil dates and Defect createdAt display.
 * Preserve UTC timestamps, existing stored records, sync and security rules.
 */
export const VIETNAM_BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const vietnamDayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: VIETNAM_BUSINESS_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
});

export function vietnamBusinessDateInput(at: Date = new Date()): string {
  if (!Number.isFinite(at.getTime())) return '';
  const parts = Object.fromEntries(
    vietnamDayFormatter.formatToParts(at).map(({ type, value }) => [type, value]),
  );
  return [parts.year, parts.month, parts.day].join('-');
}

/**
 * ISO timestamps with Z/offset are absolute instants. Convert only those to
 * the Vietnam business date; keep date-only and legacy formats unchanged.
 * The calling UI retains existing user date-format preferences.
 */
export function vietnamDefectCreatedAtInput(value: string): string {
  const input = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(input)) {
    return value;
  }
  const instant = new Date(input);
  return Number.isFinite(instant.getTime()) ? vietnamBusinessDateInput(instant) : value;
}
