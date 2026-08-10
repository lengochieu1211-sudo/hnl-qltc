/**
 * Utility to format all date strings into DD/MM/YYYY format
 */
export function formatDateDDMMYYYY(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  
  const trimmed = dateStr.trim();
  if (!trimmed) return '';

  // 1. If it's already in DD/MM/YYYY, return as is
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    return trimmed;
  }

  // 2. Supposing input is in YYYY-MM-DD (e.g. from standard <input type="date">)
  const yyyymmddRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = trimmed.match(yyyymmddRegex);
  if (match) {
    const [_, year, month, day] = match;
    return `${day}/${month}/${year}`;
  }

  // 3. Fallback: Parse with standard Date
  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    }
  } catch (e) {
    // If parsing fails, just return original string
  }

  return dateStr;
}
