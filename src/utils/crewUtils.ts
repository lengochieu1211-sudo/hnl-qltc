/**
 * Converts a saved shift label into an equivalent work-day factor.
 * Morning = 0.5, afternoon = 0.5, evening/overtime = 0.5 by default.
 * A record containing both morning + afternoon therefore counts as 1 workday.
 */
export function getShiftDayFactor(shift?: string): number {
  const raw = String(shift || '').trim().toLowerCase();
  if (!raw || raw === 'default' || raw.includes('hành chính')) return 1;
  if (raw.includes('nghỉ')) return 0;

  let factor = 0;
  if (raw.includes('sáng')) factor += 0.5;
  if (raw.includes('chiều')) factor += 0.5;
  if (raw.includes('tối') || raw.includes('tăng ca')) factor += 0.5;

  // Legacy/free-text shift with no recognizable keyword = one standard workday.
  return factor > 0 ? factor : 1;
}
